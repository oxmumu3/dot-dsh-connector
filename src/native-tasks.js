import {randomUUID,randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {isAbsolute,resolve} from 'node:path';
import {z} from 'zod';
import {redactText} from './harness-reader.js';

const MAX_INTERACTION_OPERATIONS=100;
const MAX_ACTIVE_JOBS=100,STATE_BYTES=16*1024*1024,MAX_COMMANDS=400,OFFER_MS=15000,LEASE_MS=60000,INSPECT_MS=2000,REPORT_BYTES=256*1024;
const uuid=z.string().uuid();
const nativeId=z.string().regex(/^native_job_[0-9a-f-]{36}$/i);
const commandId=z.string().regex(/^native_cmd_[0-9a-f-]{36}$/i);
const sessionId=z.string().regex(/^dsh_dot_[0-9a-f-]{36}$/i);
const hasControl=value=>Array.from(value).some(character=>{const code=character.codePointAt(0);return code<32||(code>=127&&code<=159);});
const identifier=z.string().min(1).max(512).refine(value=>!hasControl(value));
const shortIdentifier=z.string().min(1).max(256).refine(value=>!hasControl(value));
const requestId=z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const ownerId=z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const capability=z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const digest=z.string().regex(/^[a-f0-9]{64}$/);
const stamp=z.string().datetime();
const integer=z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const cwd=z.string().max(4096).refine(value=>isAbsolute(value)&&resolve(value)===value&&!hasControl(value));
const statuses=['accepted','starting','running','cancel_requested','succeeded','failed','cancelled','unknown'];
const live=new Set(['accepted','starting','running','cancel_requested']);
const definite=new Set(['succeeded','failed','cancelled']);
const workerFailures=['WORKSPACE_UNAVAILABLE','IDENTITY_MISMATCH','NATIVE_UNAVAILABLE','NATIVE_FAILED','NATIVE_TIMEOUT','INVALID_COMMAND','HISTORY_UNAVAILABLE','INTERACTION_STALE','INTERACTION_INVALID','INTERACTION_UNAVAILABLE','INTERACTION_UNKNOWN'];
const errors={NATIVE_DENIED:'Native task access denied.',NATIVE_INVALID:'Invalid native task request.',NATIVE_CONFLICT:'Native task request conflicts with existing work.',NATIVE_UNAVAILABLE:'Native task service is unavailable.',NATIVE_CAPACITY:'Native task capacity reached.'};
const fail=code=>Object.assign(new Error(errors[code]??errors.NATIVE_UNAVAILABLE),{code:Object.hasOwn(errors,code)?code:'NATIVE_UNAVAILABLE'});
const checked=(schema,value)=>{const parsed=schema.safeParse(value);if(!parsed.success)throw fail('NATIVE_INVALID');return parsed.data;};
const hash=value=>createHash('sha256').update(value).digest('hex');
const matches=(token,expected)=>typeof token==='string'&&typeof expected==='string'&&timingSafeEqual(Buffer.from(hash(token),'hex'),Buffer.from(expected,'hex'));
const cloned=structuredClone;
const text=value=>redactText(value).text;
const bounded=(value,max)=>{const points=Array.from(text(value));return{text:points.slice(0,max).join(''),truncated:points.length>max};};
const controlActions=new Set(['answer_question','decide_approval']);
const preEffectFailures=new Set(['INTERACTION_STALE','INTERACTION_INVALID','INTERACTION_UNAVAILABLE']);
const action=z.enum(['create','prompt','inspect','cancel',...controlActions]);
const taskInput=z.string().trim().min(1).max(8000);
const mode=z.enum(['after_complete','queue','steer']);
const pageSchema=z.strictObject({offset:integer.optional(),limit:integer.min(1).max(100).optional(),status:z.enum(statuses).optional(),workspace_id:identifier.optional(),request_id:requestId.optional(),archived:z.boolean().optional()});
const question=z.strictObject({call_id:identifier,id:identifier,question:z.string().max(2000),header:z.string().max(200).optional(),detail:z.string().max(4000).optional(),options:z.array(z.strictObject({label:z.string().max(300),description:z.string().max(1000).optional()})).max(12).optional(),multi_select:z.boolean().optional(),approval_only:z.boolean().optional(),state:z.enum(['open','continued'])});
const interactionBase={interaction_id:identifier,call_id:shortIdentifier,turn:integer,message_id:uuid,state:z.enum(['open','continued'])};
const interaction=z.discriminatedUnion('kind',[
 z.strictObject({...interactionBase,kind:z.literal('question'),questions:z.array(question).min(1).max(20)}),
 z.strictObject({...interactionBase,kind:z.literal('approval'),tool_name:z.string().min(1).max(200),reason:z.string().max(4000).optional()}),
]);
const answer=z.strictObject({id:shortIdentifier,selected:z.array(z.string().min(1).max(300)).max(12),custom:z.string().min(1).max(4000).optional()});
const operation=z.strictObject({operation_id:commandId,request_id:requestId,interaction_id:identifier,kind:z.enum(['question','approval']),status:z.enum(['accepted','applied','failed','unknown']),created_at:stamp,finished_at:stamp.nullable(),error_code:z.enum(workerFailures).nullable(),fingerprint:digest,call_id:shortIdentifier,turn:integer,message_id:uuid,interaction_state:z.enum(['open','continued']),source_seq:integer.default(0),retryable_after_observation:z.boolean().default(false)});
const continuation=z.strictObject({call_id:shortIdentifier,turn:integer,message_id:uuid,seq:integer.default(0)});
const methods={
 harness_start_task:z.strictObject({workspace_id:identifier,task:taskInput,request_id:requestId}),
 harness_get_task:z.strictObject({job_id:nativeId}),
 harness_answer_question:z.strictObject({job_id:nativeId,interaction_id:identifier,request_id:requestId,answers:z.array(answer).min(1).max(20)}),
 harness_decide_approval:z.strictObject({job_id:nativeId,interaction_id:identifier,request_id:requestId,decision:z.enum(['allow_once','deny'])}),
 harness_list_tasks:pageSchema,
 harness_archive_task:z.strictObject({job_id:nativeId,archived:z.boolean().optional()}),
 harness_followup_task:z.strictObject({job_id:nativeId,task:taskInput,request_id:requestId,mode:mode.optional()}),
 harness_cancel_task:z.strictObject({job_id:nativeId,expected_revision:integer.optional()}),
};
const eventBase={seq:integer,turn:integer};
const event=z.discriminatedUnion('type',[
 z.strictObject({type:z.literal('turn/start'),...eventBase}),
 z.strictObject({type:z.literal('user/message'),...eventBase,message_id:uuid,source_rpc_id:identifier.optional(),source_call_id:shortIdentifier.optional(),source_kind:z.string().min(1).max(40)}),
 z.strictObject({type:z.literal('assistant/message'),...eventBase,text:z.string().max(64000),interrupted:z.boolean().optional(),text_truncated:z.boolean().optional()}),
 z.strictObject({type:z.literal('turn/end'),...eventBase,reason:z.string().regex(/^[a-z][a-z0-9_-]{0,79}$/)}),
]);
const resultSchema=z.discriminatedUnion('ok',[
 z.strictObject({ok:z.literal(false),error_code:z.enum(workerFailures)}),
 z.strictObject({ok:z.literal(true),session_id:sessionId,workspace_id:identifier,cwd,
  accepted:z.boolean().optional(),parent_turn:integer.optional(),cancel_requested:z.boolean().optional(),events:z.array(event).max(256).optional(),
  workspace_name:z.string().max(500).optional(),session_name:z.string().max(500).optional(),last_activity_at:stamp.optional(),questions:z.array(question).max(20).optional(),questions_truncated:z.boolean().optional(),
  interactions:z.array(interaction).max(20).optional(),interaction_result:z.strictObject({interaction_id:identifier,request_id:requestId,outcome:z.literal('applied')}).optional(),
  running:z.boolean().optional(),pending_approvals:integer.optional(),user_question_count:integer.optional(),removed_request_id:uuid.optional(),
 }),
]);
const jobSchema=z.strictObject({
 job_id:nativeId,root_job_id:nativeId,parent_job_id:nativeId.nullable(),principal:ownerId,
 workspace_id:identifier,request_id:requestId,fingerprint:digest,session_id:sessionId,prompt_request_id:uuid,
 message_id:uuid.nullable(),turn:integer.nullable(),status:z.enum(statuses),revision:integer,
 task:z.string().max(8000),result:z.string().max(32000).nullable(),result_truncated:z.boolean(),reason:z.string().max(100).nullable(),
 created_at:stamp,finished_at:stamp.nullable(),observed_at:stamp.nullable(),through_seq:integer.nullable(),
 native_created:z.boolean(),cwd:cwd.nullable(),prompt_accepted:z.boolean(),prompt_attempted:z.boolean().default(false),
 pending_approvals:integer,user_question_count:integer,external_input:z.boolean(),
 parent_turn:integer.nullable().default(null),archived:z.boolean().default(false),archived_at:stamp.nullable().default(null),mode:mode.default('after_complete'),
 workspace_name:z.string().max(500).nullable().default(null),session_name:z.string().max(500).nullable().default(null),last_activity_at:stamp.nullable().default(null),questions:z.array(question).max(20).default([]),questions_truncated:z.boolean().default(false),
 interactions:z.array(interaction).max(20).default([]),interaction_operations:z.array(operation).max(MAX_INTERACTION_OPERATIONS).default([]),continuation_turns:z.array(continuation).max(MAX_INTERACTION_OPERATIONS).default([]),continued_call_ids:z.array(shortIdentifier).max(MAX_INTERACTION_OPERATIONS).default([]),unresolved_question_reply:z.boolean().default(false),
});
const commandSchema=z.strictObject({
 command_id:commandId,job_id:nativeId,action,status:z.enum(['pending','offered','claimed','reported','expired','superseded']),
 created_at:stamp,finished_at:stamp.nullable(),expires_at:stamp.nullable(),
 claim_hash:digest.nullable(),lease_hash:digest.nullable(),client_id:identifier.nullable(),report_hash:digest.nullable(),
 interaction:interaction.optional(),interaction_request_id:requestId.optional(),interaction_fingerprint:digest.optional(),answers:z.array(answer).min(1).max(20).optional(),decision:z.enum(['allow_once','deny']).optional(),
}).refine(value=>controlActions.has(value.action)?Boolean(value.interaction&&value.interaction_request_id&&value.interaction_fingerprint&&(value.action==='answer_question'?value.interaction.kind==='question'&&value.answers&&value.decision===undefined:value.interaction.kind==='approval'&&value.decision&&value.answers===undefined)):['interaction','interaction_request_id','interaction_fingerprint','answers','decision'].every(key=>value[key]===undefined));
const stateSchema=z.strictObject({version:z.literal(2),principal:ownerId,jobs:z.array(jobSchema),commands:z.array(commandSchema).max(MAX_COMMANDS),last_worker_seen_at:stamp.nullable()})
 .refine(value=>new Set(value.jobs.map(job=>job.job_id)).size===value.jobs.length&&new Set(value.commands.map(command=>command.command_id)).size===value.commands.length);
const claimSchema=z.strictObject({command_id:commandId,claim_token:capability,client_id:identifier});
const reportSchema=z.strictObject({command_id:commandId,lease_token:capability,client_id:identifier,result:resultSchema});

/** Durable native task intent. Only an authenticated native worker performs
 * fixed Host operations; this ledger never opens a native cookie or model key.
 * Each instruction is an immutable attempt. Followups get new jobs in the owned session.
 */
export async function createNativeTasks({store,principal,now=()=>new Date()}={}){
 if(!ownerId.safeParse(principal).success||typeof store?.load!=='function'||typeof store?.save!=='function'||typeof now!=='function')throw fail('NATIVE_INVALID');
 const millis=()=>{const value=now(),time=value instanceof Date?value.getTime():typeof value==='number'?value:NaN;if(!Number.isFinite(time))throw fail('NATIVE_UNAVAILABLE');return time;};
 const time=()=>new Date(millis()).toISOString();
 let state;try{state=stateSchema.parse(await store.load()??{version:2,principal,jobs:[],commands:[],last_worker_seen_at:null});}catch{throw fail('NATIVE_UNAVAILABLE');}
 if(state.principal!==principal)throw fail('NATIVE_DENIED');
 // Older v2 ledgers did not retain this fact beyond bounded command history.
 for(const job of state.jobs)if(job.prompt_accepted||job.message_id!==null||state.commands.some(command=>command.job_id===job.job_id&&command.action==='prompt'&&['claimed','reported','expired'].includes(command.status)))job.prompt_attempted=true;
 let queue=Promise.resolve(),closed=false,closing=false,storageFailed=false;
 const available=()=>{if(closed||closing||storageFailed)throw fail('NATIVE_UNAVAILABLE');};
 const guard=owner=>{available();if(owner!==principal)throw fail('NATIVE_DENIED');};
 const save=async next=>{if(Buffer.byteLength(JSON.stringify(next))>STATE_BYTES)throw fail('NATIVE_CAPACITY');try{const validated=stateSchema.parse(next);await store.save(validated);state=validated;}catch{storageFailed=true;throw fail('NATIVE_UNAVAILABLE');}};
 const mutate=(job,patch)=>Object.assign(job,patch,{revision:job.revision+1});
 const uncertain=(job,reason)=>{if(!definite.has(job.status))mutate(job,{status:'unknown',reason,result:null,result_truncated:false,through_seq:null,finished_at:time()});};
 const belongs=(value,id)=>{const job=value.jobs.find(item=>item.job_id===id&&item.principal===principal);if(!job)throw fail('NATIVE_DENIED');return job;};
 function operationView(item,job_id){return{operation_id:item.operation_id,job_id,request_id:item.request_id,interaction_id:item.interaction_id,kind:item.kind,status:item.status,created_at:item.created_at,...item.finished_at?{finished_at:item.finished_at}:{},...item.error_code?{error_code:item.error_code}:{}};}
 function finishOperation(job,command,status,error_code=null){
  if(!controlActions.has(command.action))return;
  const item=job.interaction_operations.find(item=>item.operation_id===command.command_id);
  if(!item||item.request_id!==command.interaction_request_id||item.fingerprint!==command.interaction_fingerprint)throw fail('NATIVE_DENIED');
  Object.assign(item,{status,finished_at:time(),error_code,retryable_after_observation:false});job.revision++;
  job.interactions=job.interactions.filter(item=>item.interaction_id!==command.interaction.interaction_id);
 }
 function commandCapacity(value){while(value.commands.length>=MAX_COMMANDS){const index=value.commands.findIndex(command=>['reported','expired','superseded'].includes(command.status));if(index<0)throw fail('NATIVE_CAPACITY');value.commands.splice(index,1);}}
 function priorControl(request_id,fingerprint){
  for(const job of state.jobs){const item=job.interaction_operations.find(item=>item.request_id===request_id);if(item){if(item.fingerprint!==fingerprint)throw fail('NATIVE_CONFLICT');return operationView(item,job.job_id);}}
  if(state.jobs.some(job=>job.request_id===request_id))throw fail('NATIVE_CONFLICT');
 }
 function answersFor(request,answers){
  const questions=request.questions;
  if(questions.length!==answers.length||new Set(questions.map(item=>item.id)).size!==questions.length||new Set(answers.map(item=>item.id)).size!==answers.length)throw fail('NATIVE_INVALID');
  return questions.map(item=>{
   const value=answers.find(value=>value.id===item.id),labels=(item.options??[]).map(option=>option.label);
   if(!value||new Set(labels).size!==labels.length||new Set(value.selected).size!==value.selected.length||value.selected.some(label=>!labels.includes(label))||(!item.multi_select&&value.selected.length>1)||(!value.selected.length&&!value.custom?.trim())||(item.approval_only&&(value.selected.length!==1||value.custom!==undefined)))throw fail('NATIVE_INVALID');
   return{id:value.id,selected:labels.filter(label=>value.selected.includes(label)),...value.custom!==undefined?{custom:value.custom}:{}};
  });
 }
 function activeAnchor(job){return job.continuation_turns.reduce((latest,item)=>item.seq>latest.seq||item.seq===latest.seq&&item.turn>latest.turn?item:latest,{turn:job.turn,message_id:job.message_id,seq:-1});}
 function lineage(value,job){
  const items=[],seen=new Set();let current=job;
  while(current){
   if(seen.has(current.job_id)||current.root_job_id!==job.root_job_id||current.session_id!==job.session_id||current.workspace_id!==job.workspace_id)throw fail('NATIVE_DENIED');
   seen.add(current.job_id);items.push(current);
   if(current.parent_job_id===null){if(current.job_id!==job.root_job_id)throw fail('NATIVE_DENIED');break;}
   current=belongs(value,current.parent_job_id);
  }
  return items;
 }
 const activeLineage=(value,job)=>{const items=lineage(value,job),boundary=items.findIndex(item=>item.mode==='after_complete');return boundary<0?items:items.slice(0,boundary+1);};
 const appliedQuestions=(value,job)=>activeLineage(value,job).flatMap(owner=>owner.interaction_operations.filter(item=>item.kind==='question'&&item.status==='applied').map(item=>({owner,item})));
 const knownReplies=(value,job)=>activeLineage(value,job).flatMap(owner=>owner.continuation_turns);
 function authority(value,job,extraCall){
  const ancestors=activeLineage(value,job),owned_request_ids=ancestors.map(item=>item.prompt_request_id),operations=ancestors.flatMap(item=>item.interaction_operations.filter(operation=>operation.kind==='question'));
  const continuation_call_ids=[...new Set(operations.filter(item=>item.status==='applied').map(item=>item.call_id))],reserved=new Set(operations.filter(item=>['accepted','applied'].includes(item.status)).map(item=>item.call_id));
  if(extraCall!==undefined)reserved.add(extraCall);
  if(owned_request_ids.length>101||continuation_call_ids.length>100||reserved.size>100)throw fail('NATIVE_CAPACITY');
  return{owned_request_ids,continuation_call_ids};
 }
 function originalAnchor(job,events=[]){
  const candidates=events.filter(item=>item.type==='user/message'&&item.source_kind==='user'&&item.source_rpc_id===job.prompt_request_id);
  if(candidates.some(item=>job.message_id!==null&&(item.message_id!==job.message_id||item.turn!==job.turn)))throw fail('NATIVE_DENIED');
  if(candidates.some(item=>item.message_id!==candidates[0].message_id||item.turn!==candidates[0].turn))throw fail('NATIVE_DENIED');
  return job.message_id!==null?{message_id:job.message_id,turn:job.turn}:candidates[0];
 }
 function recognizeContinuations(job,events,value){
  for(const item of events.filter(item=>item.type==='user/message'&&item.source_kind==='user-question-reply').sort((a,b)=>a.seq-b.seq)){
   const matches=appliedQuestions(value,job).filter(entry=>entry.item.call_id===item.source_call_id),allowed=matches.length===1?matches[0]:null;
   const existing=allowed?.owner.continuation_turns.find(anchor=>anchor.call_id===item.source_call_id);
   if(!allowed||item.turn<allowed.item.turn||item.seq<=allowed.item.source_seq||existing&&(existing.message_id!==item.message_id||existing.turn!==item.turn||existing.seq!==item.seq)){job.external_input=true;uncertain(job,'native_external_input');continue;}
   if(!existing){if(allowed.owner.continuation_turns.length>=MAX_INTERACTION_OPERATIONS)throw fail('NATIVE_CAPACITY');allowed.owner.continuation_turns.push({call_id:item.source_call_id,turn:item.turn,message_id:item.message_id,seq:item.seq});allowed.owner.unresolved_question_reply=false;allowed.owner.revision++;}
  }
 }
 function observedInteractions(job,items,events=[],reconfirm=false){
  if(!items.length)return[];
  const original=originalAnchor(job,events),anchors=[...original?[original]:[],...job.continuation_turns];
  if(new Set(items.map(item=>item.interaction_id)).size!==items.length)throw fail('NATIVE_DENIED');
  for(const item of items){
   if(!anchors.some(anchor=>anchor.turn===item.turn&&anchor.message_id===item.message_id))throw fail('NATIVE_DENIED');
   if(item.kind==='question'&&(new Set(item.questions.map(question=>question.id)).size!==item.questions.length||item.questions.some(question=>question.call_id!==item.call_id||question.state!==item.state)))throw fail('NATIVE_DENIED');
   if(reconfirm)for(const operation of job.interaction_operations)if(operation.interaction_id===item.interaction_id&&operation.kind===item.kind&&operation.call_id===item.call_id&&operation.turn===item.turn&&operation.message_id===item.message_id&&operation.status==='failed'&&preEffectFailures.has(operation.error_code)&&(operation.interaction_state===item.state||operation.interaction_state==='open'&&item.state==='continued')){operation.retryable_after_observation=true;job.revision++;}
   if(item.kind==='question'&&item.state==='continued'&&!job.continued_call_ids.includes(item.call_id)){if(job.continued_call_ids.length>=MAX_INTERACTION_OPERATIONS)throw fail('NATIVE_CAPACITY');job.continued_call_ids.push(item.call_id);}
  }
  return items.filter(item=>!job.interaction_operations.some(operation=>operation.interaction_id===item.interaction_id&&!(operation.status==='failed'&&operation.retryable_after_observation))).map(item=>cloned(item));
 }
 function safeInteraction(item){return{...item,...item.kind==='question'?{questions:item.questions.map(safeQuestion)}:{tool_name:bounded(item.tool_name,200).text,...item.reason!==undefined?{reason:bounded(item.reason,4000).text}:{}}};}
 function enqueue(value,job,kind){
  if(value.commands.some(command=>command.job_id===job.job_id&&command.action===kind&&['pending','offered','claimed'].includes(command.status)))return false;
  commandCapacity(value);
  value.commands.push({command_id:`native_cmd_${randomUUID()}`,job_id:job.job_id,action:kind,status:'pending',created_at:time(),finished_at:null,expires_at:null,claim_hash:null,lease_hash:null,client_id:null,report_hash:null});return true;
 }
 async function expire(){
  const next=cloned(state);let dirty=false;
  for(const command of next.commands){
   if(!['offered','claimed'].includes(command.status)||Date.parse(command.expires_at)>millis())continue;
   if(command.status==='offered')Object.assign(command,{status:'pending',expires_at:null,claim_hash:null});
   else{Object.assign(command,{status:'expired',finished_at:time()});const job=belongs(next,command.job_id);finishOperation(job,command,'unknown','NATIVE_TIMEOUT');uncertain(job,'native_reply_unknown');}
   dirty=true;
  }
  if(dirty)await save(next);
 }
 const serial=fn=>{
  try{available();}catch(error){return Promise.reject(error);}
  const work=queue.then(async()=>{available();await expire();return fn();});queue=work.catch(()=>{});return work;
 };
 const restarted=cloned(state);let restartDirty=false;
 for(const job of restarted.jobs)if(live.has(job.status)){uncertain(job,'native_broker_restarted');restartDirty=true;}
 for(const command of restarted.commands)if(['pending','offered','claimed'].includes(command.status)){finishOperation(belongs(restarted,command.job_id),command,'unknown','NATIVE_UNAVAILABLE');Object.assign(command,{status:'expired',finished_at:time(),claim_hash:null,lease_hash:null});restartDirty=true;}
 if(restartDirty)await save(restarted);

 function view(job,{summary=false,duplicate=false}={}){
  const stage=definite.has(job.status)?'terminal':job.status==='unknown'?'needs_reconcile':job.status==='cancel_requested'?'cancelling':job.message_id===null?'queued':job.user_question_count>0||job.unresolved_question_reply||job.continued_call_ids.some(id=>!job.continuation_turns.some(anchor=>anchor.call_id===id))?'waiting_for_answer':job.pending_approvals>0?'waiting_for_approval':'running';
  const out={job_id:job.job_id,root_job_id:job.root_job_id,parent_job_id:job.parent_job_id,project_id:job.workspace_id,workspace_id:job.workspace_id,
   execution_kind:'native',request_id:job.request_id,archived:job.archived,archived_at:job.archived_at,mode:job.mode,workspace_name:job.workspace_name===null?null:bounded(job.workspace_name,500).text,session_name:job.session_name===null?null:bounded(job.session_name,500).text,last_activity_at:job.last_activity_at,session_id:job.session_id,message_id:job.message_id,turn:job.turn,status:job.status,stage,revision:job.revision,
   task:bounded(job.task,summary?500:8000).text,result_truncated:job.status==='succeeded'&&job.result_truncated,reason:job.reason,
   created_at:job.created_at,finished_at:job.finished_at,observed_at:job.observed_at,
   pending_approvals:job.pending_approvals,user_question_count:job.user_question_count,acceptance:'unverified',duplicate,
   stale:job.observed_at===null||millis()-Date.parse(job.observed_at)>INSPECT_MS*2};
  const anchor=activeAnchor(job);if(anchor.turn!==job.turn||anchor.message_id!==job.message_id){out.active_turn=anchor.turn;out.active_message_id=anchor.message_id;}
  if(!summary){out.interactions=job.external_input||job.status==='unknown'?[]:job.interactions.map(safeInteraction);out.interaction_operations=job.interaction_operations.map(item=>operationView(item,job.job_id));out.result=job.status==='succeeded'&&job.result!==null?bounded(job.result,16000).text:null;out.questions=job.questions.map(safeQuestion);out.questions_truncated=job.questions_truncated;}
  return out;
 }
 function safeQuestion(value){return{...value,question:bounded(value.question,2000).text,...value.header!==undefined?{header:bounded(value.header,200).text}:{},...value.detail!==undefined?{detail:bounded(value.detail,4000).text}:{},...value.options?{options:value.options.map(option=>({...option,label:bounded(option.label,300).text,...option.description!==undefined?{description:bounded(option.description,1000).text}:{}}))}:{}};}
 function commandView(command,job,value=state){
  const parent=job.parent_job_id===null?null:belongs(value,job.parent_job_id),permissions=authority(value,job);
  return{command_id:command.command_id,action:command.action,job_id:job.job_id,workspace_id:job.workspace_id,session_id:job.session_id,request_id:job.prompt_request_id,mode:job.mode,
   ...parent&&job.mode!=='after_complete'?{parent_request_id:parent.prompt_request_id}:{},...job.cwd?{expected_cwd:job.cwd}:{},...command.action==='prompt'?{task:job.task}:{},
   ...['prompt','inspect','cancel',...controlActions].includes(command.action)?{owned_request_ids:permissions.owned_request_ids}:{},
   ...controlActions.has(command.action)?{interaction:cloned(command.interaction),interaction_request_id:command.interaction_request_id,...command.answers?{answers:cloned(command.answers)}:{decision:command.decision}}:{},
   ...permissions.continuation_call_ids.length?{continuation_call_ids:permissions.continuation_call_ids}:{}};
 }
 const requestFingerprint=args=>hash(JSON.stringify(args));
 function priorRequest(value,request_id,fingerprint){if(value.jobs.some(job=>job.interaction_operations.some(item=>item.request_id===request_id)))throw fail('NATIVE_CONFLICT');const prior=value.jobs.find(job=>job.principal===principal&&job.request_id===request_id);if(prior&&prior.fingerprint!==fingerprint)throw fail('NATIVE_CONFLICT');return prior;}
 function newJob(value,{workspace_id,task,request_id,parent=null,fingerprint,mode='after_complete'}){
  if(value.jobs.filter(job=>!definite.has(job.status)).length>=MAX_ACTIVE_JOBS)throw fail('NATIVE_CAPACITY');
  const job_id=`native_job_${randomUUID()}`,created_at=time();
  const job={job_id,root_job_id:parent?.root_job_id??job_id,parent_job_id:parent?.job_id??null,principal,workspace_id,task,request_id,fingerprint,
   session_id:parent?.session_id??`dsh_dot_${randomUUID()}`,prompt_request_id:randomUUID(),message_id:null,turn:null,status:'accepted',revision:0,
   result:null,result_truncated:false,reason:null,created_at,finished_at:null,observed_at:null,through_seq:parent?.through_seq??null,
   parent_turn:mode==='after_complete'?null:parent?activeAnchor(parent).turn:null,archived:false,archived_at:null,mode,workspace_name:parent?.workspace_name??null,session_name:parent?.session_name??null,last_activity_at:parent?.last_activity_at??null,questions:[],questions_truncated:false,interactions:[],interaction_operations:[],continuation_turns:[],continued_call_ids:[],unresolved_question_reply:false,
   native_created:parent?.native_created??false,cwd:parent?.cwd??null,prompt_accepted:false,prompt_attempted:false,pending_approvals:0,user_question_count:0,external_input:false};
  authority(value,job);value.jobs.push(job);enqueue(value,job,parent?'prompt':'create');return job;
 }
 async function call(owner,tool,args){
  guard(owner);if(!Object.hasOwn(methods,tool))throw fail('NATIVE_INVALID');const parsed=checked(methods[tool],args);
  return serial(async()=>{
   guard(owner);
   if(tool==='harness_start_task'){
    const fingerprint=requestFingerprint({tool,...parsed});const prior=priorRequest(state,parsed.request_id,fingerprint);if(prior)return view(prior,{duplicate:true});
    const next=cloned(state),job=newJob(next,{...parsed,fingerprint});await save(next);return view(job);
   }
   if(tool==='harness_list_tasks')return jobs(parsed);
   if(tool==='harness_answer_question'||tool==='harness_decide_approval'){
    const fingerprint=requestFingerprint({tool,...parsed}),prior=priorControl(parsed.request_id,fingerprint);if(prior)return prior;
    const found=belongs(state,parsed.job_id),kind=tool==='harness_answer_question'?'question':'approval';
    if(found.status!=='running'||found.archived||found.external_input||!found.prompt_accepted||found.message_id===null||found.turn===null||found.interaction_operations.some(item=>item.interaction_id===parsed.interaction_id&&!(item.status==='failed'&&item.retryable_after_observation)))throw fail('NATIVE_CONFLICT');
    const observed=found.interactions.find(item=>item.interaction_id===parsed.interaction_id&&item.kind===kind),anchor=activeAnchor(found);
    const atActive=observed&&observed.turn===anchor.turn&&observed.message_id===anchor.message_id;
    const known=observed&&[{turn:found.turn,message_id:found.message_id},...found.continuation_turns].some(item=>item.turn===observed.turn&&item.message_id===observed.message_id);
    if(!observed||!atActive&&!(kind==='question'&&observed.state==='continued'&&known))throw fail('NATIVE_CONFLICT');
    const answers=kind==='question'?answersFor(observed,parsed.answers):undefined;authority(state,found,kind==='question'?observed.call_id:undefined);
    if(found.interaction_operations.length>=MAX_INTERACTION_OPERATIONS)throw fail('NATIVE_CAPACITY');
    const next=cloned(state),job=belongs(next,found.job_id);commandCapacity(next);
    const command={command_id:`native_cmd_${randomUUID()}`,job_id:job.job_id,action:kind==='question'?'answer_question':'decide_approval',status:'pending',created_at:time(),finished_at:null,expires_at:null,claim_hash:null,lease_hash:null,client_id:null,report_hash:null,interaction:cloned(observed),interaction_request_id:parsed.request_id,interaction_fingerprint:fingerprint,...answers?{answers}:{decision:parsed.decision}};
    const item={operation_id:command.command_id,request_id:parsed.request_id,interaction_id:observed.interaction_id,kind,status:'accepted',created_at:command.created_at,finished_at:null,error_code:null,fingerprint,call_id:observed.call_id,turn:observed.turn,message_id:observed.message_id,interaction_state:observed.state,source_seq:found.through_seq??0,retryable_after_observation:false};
    next.commands.push(command);job.interaction_operations.push(item);job.interactions=job.interactions.filter(item=>item.interaction_id!==parsed.interaction_id);job.revision++;
    await save(next);return operationView(item,job.job_id);
   }
   const found=belongs(state,parsed.job_id);
   if(tool==='harness_archive_task'){
    if(!definite.has(found.status))throw fail('NATIVE_CONFLICT');
    const archived=parsed.archived??true;if(found.archived===archived)return view(found);
    const next=cloned(state),job=belongs(next,found.job_id);mutate(job,{archived,archived_at:archived?time():null});await save(next);return view(job);
   }
   if(tool==='harness_followup_task'){
    // Omitted and explicit after_complete preserve the original v2 fingerprint.
    const {mode:requestedMode='after_complete',...legacyArgs}=parsed;
    const fingerprint=requestFingerprint({tool,...legacyArgs,...requestedMode!=='after_complete'?{mode:requestedMode}:{}});const prior=priorRequest(state,parsed.request_id,fingerprint);if(prior)return view(prior,{duplicate:true});
    if(found.archived||!found.native_created||state.jobs.some(job=>job.parent_job_id===found.job_id))throw fail('NATIVE_CONFLICT');
    if(requestedMode==='after_complete'){if(!definite.has(found.status)||state.jobs.some(job=>job.root_job_id===found.root_job_id&&!definite.has(job.status)))throw fail('NATIVE_CONFLICT');}
    else if(found.status!=='running'||!found.prompt_accepted||found.external_input)throw fail('NATIVE_CONFLICT');
    const next=cloned(state),job=newJob(next,{workspace_id:found.workspace_id,task:parsed.task,request_id:parsed.request_id,parent:found,fingerprint,mode:requestedMode});await save(next);return view(job);
   }
   if(tool==='harness_get_task'){
    if(!definite.has(found.status)){
     const next=cloned(state),job=belongs(next,found.job_id);
     if(!next.commands.some(command=>command.job_id===job.job_id&&['pending','offered','claimed'].includes(command.status)&&command.action!=='inspect')){
      if(enqueue(next,job,'inspect'))await save(next);
     }
    }
    return view(belongs(state,found.job_id));
   }
   if(found.external_input)throw fail('NATIVE_CONFLICT');
   if(parsed.expected_revision!==undefined&&parsed.expected_revision!==found.revision)throw fail('NATIVE_CONFLICT');
   if(definite.has(found.status))return view(found);
   const next=cloned(state),job=belongs(next,found.job_id);
   const mutations=next.commands.filter(command=>command.job_id===job.job_id&&['create','prompt'].includes(command.action));
   const mayHavePrompted=job.prompt_attempted||job.prompt_accepted||mutations.some(command=>command.action==='prompt'&&['claimed','reported','expired'].includes(command.status));
   for(const command of next.commands)if(command.job_id===job.job_id&&['pending','offered'].includes(command.status)){finishOperation(job,command,'failed','INTERACTION_STALE');Object.assign(command,{status:'superseded',finished_at:time()});}
   if(!mayHavePrompted&&!mutations.some(command=>command.status==='claimed'))mutate(job,{status:'cancelled',reason:'cancelled_before_prompt',result:null,finished_at:time()});
   else{mutate(job,{status:'cancel_requested',reason:null,finished_at:null});enqueue(next,job,'cancel');}
   await save(next);return view(job);
  });
 }
 async function offer(owner){
  guard(owner);return serial(async()=>{
   guard(owner);const next=cloned(state);let dirty=false;
   for(const job of next.jobs)if(['running','cancel_requested'].includes(job.status)&&job.prompt_accepted&&(job.observed_at===null||millis()-Date.parse(job.observed_at)>=INSPECT_MS)
    &&!next.commands.some(command=>command.job_id===job.job_id&&['pending','offered','claimed'].includes(command.status))){dirty=enqueue(next,job,'inspect')||dirty;}
   const priority=item=>item.action==='cancel'?0:controlActions.has(item.action)?1:item.action==='inspect'?3:2;
   const command=[...next.commands].sort((a,b)=>priority(a)-priority(b)).find(item=>item.status==='pending'&&!next.commands.some(other=>belongs(next,other.job_id).session_id===belongs(next,item.job_id).session_id&&['offered','claimed'].includes(other.status)));
   if(!command){if(dirty)await save(next);return null;}
   const claim_token=randomBytes(32).toString('base64url');Object.assign(command,{status:'offered',claim_hash:hash(claim_token),expires_at:new Date(millis()+OFFER_MS).toISOString()});
   await save(next);return{command_id:command.command_id,claim_token,expires_at:command.expires_at};
  });
 }
 async function claim(input){
  const args=checked(claimSchema,input);return serial(async()=>{
   const next=cloned(state),command=next.commands.find(item=>item.command_id===args.command_id);
   if(!command||command.status!=='offered'||Date.parse(command.expires_at)<=millis()||!matches(args.claim_token,command.claim_hash))throw fail('NATIVE_DENIED');
   const lease_token=randomBytes(32).toString('base64url');Object.assign(command,{status:'claimed',lease_hash:hash(lease_token),client_id:args.client_id,expires_at:new Date(millis()+LEASE_MS).toISOString()});next.last_worker_seen_at=time();
   const job=belongs(next,command.job_id);if(command.action==='create'&&job.status==='accepted')mutate(job,{status:'starting'});
   if(command.action==='prompt')job.prompt_attempted=true;
   const view=commandView(command,job,next);await save(next);return{command:view,lease_token,expires_at:command.expires_at};
  });
 }
 function reduce(job,events,value){
  const owned=new Set(value.jobs.filter(item=>item.root_job_id===job.root_job_id&&item.prompt_attempted).map(item=>item.prompt_request_id));
  const targetTurn=job.turn??events.find(item=>item.type==='user/message'&&item.source_rpc_id===job.prompt_request_id&&item.source_kind==='user')?.turn;
  if(targetTurn!==undefined&&job.mode!=='after_complete'){
   const parent=belongs(value,job.parent_job_id);const parentTurn=job.parent_turn??activeAnchor(parent).turn??events.find(item=>item.type==='user/message'&&item.source_rpc_id===parent.prompt_request_id&&item.source_kind==='user')?.turn;
   if(parentTurn===undefined||parentTurn===null){uncertain(job,'native_followup_parent_unverified');return;}
   job.parent_turn=parentTurn;
   if(job.mode==='steer'?targetTurn!==parentTurn:targetTurn<=parentTurn){uncertain(job,'native_followup_turn_mismatch');return;}
  }
  const active=activeAnchor({...job,turn:targetTurn});
  const ownedTurns=new Set([targetTurn,...job.continuation_turns.map(item=>item.turn)]);
  const trustedReply=item=>item.source_kind==='user-question-reply'&&knownReplies(value,job).some(anchor=>anchor.call_id===item.source_call_id&&anchor.turn===item.turn&&anchor.message_id===item.message_id);
  if(targetTurn!==undefined&&events.some(item=>item.type==='user/message'&&ownedTurns.has(item.turn)&&((item.source_kind==='user'&&!owned.has(item.source_rpc_id))||(item.source_kind==='user-question-reply'&&!trustedReply(item))))){job.external_input=true;uncertain(job,'native_external_input');return;}
  const previousThrough=job.through_seq;let seq=previousThrough,proofIncomplete=false;
  for(const item of [...events].sort((a,b)=>a.seq-b.seq)){
   if(seq!==null&&item.seq<=seq)continue;
   seq=item.seq;
   if(item.type==='user/message'){
    if(item.source_rpc_id===job.prompt_request_id&&item.source_kind==='user'){
     if(job.message_id!==null&&(job.message_id!==item.message_id||job.turn!==item.turn)){uncertain(job,'native_identity_mismatch');job.external_input=true;continue;}
     job.message_id=item.message_id;job.turn=item.turn;job.prompt_accepted=true;
     if(!job.external_input&&!definite.has(job.status)&&job.status!=='cancel_requested')Object.assign(job,{status:'running',finished_at:null,reason:null});
    }else if(trustedReply(item)&&!job.external_input&&!definite.has(job.status)&&job.status!=='cancel_requested')Object.assign(job,{status:'running',finished_at:null,reason:null});
   }else if(job.turn!==null&&item.turn===active.turn&&!job.external_input){
    if(item.type==='assistant/message'&&item.interrupted!==true&&item.text.trim()){
     const result=bounded(item.text,16000);job.result=result.text;job.result_truncated=result.truncated||item.text_truncated===true;
    }else if(item.type==='turn/end'){
     const pendingQuestions=job.interactions.filter(request=>request.kind==='question'&&request.turn===active.turn);
     const pendingReadQuestions=job.user_question_count>0?job.questions:[];
     const pendingContinuation=job.continued_call_ids.some(id=>!job.continuation_turns.some(anchor=>anchor.call_id===id));
     if(item.reason==='completed'&&(pendingQuestions.length||job.user_question_count>0||job.unresolved_question_reply||pendingContinuation)){
      job.unresolved_question_reply=true;
      for(const request of [...pendingQuestions,...pendingReadQuestions])if(!job.continued_call_ids.includes(request.call_id)){if(job.continued_call_ids.length>=MAX_INTERACTION_OPERATIONS)throw fail('NATIVE_CAPACITY');job.continued_call_ids.push(request.call_id);}
      Object.assign(job,{status:job.status==='cancel_requested'?'cancel_requested':'running',reason:'awaiting_question_reply',finished_at:null,result:null,result_truncated:false});continue;
     }
     if(item.reason==='completed'&&!job.result?.trim()){uncertain(job,'native_result_unavailable');proofIncomplete=true;continue;}
     Object.assign(job,{status:item.reason==='completed'?'succeeded':['aborted','cancelled'].includes(item.reason)?'cancelled':'failed',reason:item.reason,finished_at:time(),pending_approvals:0,user_question_count:0,questions:[],questions_truncated:false,interactions:[],unresolved_question_reply:false});
     if(job.status!=='succeeded'){job.result=null;job.result_truncated=false;}
    }
   }
  }
  // Keep the earlier cursor when bounded history cannot yet establish completion.
  job.through_seq=job.message_id===null||proofIncomplete?previousThrough:seq;
 }
 async function report(input){
  let bytes;try{bytes=Buffer.byteLength(JSON.stringify(input));}catch{throw fail('NATIVE_INVALID');}if(bytes>REPORT_BYTES)throw fail('NATIVE_INVALID');
  const args=checked(reportSchema,input),report_hash=hash(JSON.stringify(args.result));
  return serial(async()=>{
   const next=cloned(state),command=next.commands.find(item=>item.command_id===args.command_id);
   if(!command||command.client_id!==args.client_id||!matches(args.lease_token,command.lease_hash))throw fail('NATIVE_DENIED');
   const job=belongs(next,command.job_id);
   if(command.status==='reported'){
    if(command.report_hash!==report_hash)throw fail('NATIVE_CONFLICT');return{accepted:true,duplicate:true,job:view(job)};
   }
   if(command.status!=='claimed'||Date.parse(command.expires_at)<=millis())throw fail('NATIVE_DENIED');
   if(args.result.ok&&(args.result.session_id!==job.session_id||args.result.workspace_id!==job.workspace_id||(job.cwd!==null&&args.result.cwd!==job.cwd)))throw fail('NATIVE_DENIED');
   const isControl=controlActions.has(command.action);
   if(args.result.ok&&args.result.interaction_result){const receipt=args.result.interaction_result;if(!isControl||receipt.interaction_id!==command.interaction.interaction_id||receipt.request_id!==command.interaction_request_id)throw fail('NATIVE_DENIED');}
   Object.assign(command,{status:'reported',report_hash,finished_at:time()});next.last_worker_seen_at=time();
   if(!args.result.ok){
    if(isControl){const unknown=['NATIVE_TIMEOUT','NATIVE_FAILED','NATIVE_UNAVAILABLE','HISTORY_UNAVAILABLE','INTERACTION_UNKNOWN'].includes(args.result.error_code);finishOperation(job,command,unknown?'unknown':'failed',args.result.error_code);if(unknown)uncertain(job,'native_interaction_unknown');}
    else if(!definite.has(job.status)){
     if(command.action==='create'&&['WORKSPACE_UNAVAILABLE','INVALID_COMMAND'].includes(args.result.error_code))mutate(job,{status:'failed',reason:args.result.error_code,result:null,finished_at:time()});
     else uncertain(job,args.result.error_code);
    }
   }else{
    const result=args.result;job.native_created=true;job.cwd??=result.cwd;job.observed_at=time();
    if(isControl){if(result.interaction_result)finishOperation(job,command,'applied');else{finishOperation(job,command,'unknown','NATIVE_FAILED');uncertain(job,'native_interaction_unconfirmed');}}
    if(result.events?.length)recognizeContinuations(job,result.events,next);
    if(result.interactions!==undefined)job.interactions=observedInteractions(job,result.interactions,result.events??[],command.action==='inspect');
    if(result.parent_turn!==undefined&&job.mode!=='after_complete'){if(job.parent_turn!==null&&job.parent_turn!==result.parent_turn)throw fail('NATIVE_DENIED');job.parent_turn=result.parent_turn;}
    job.pending_approvals=result.pending_approvals??0;job.user_question_count=result.user_question_count??0;
    if(result.workspace_name!==undefined)job.workspace_name=bounded(result.workspace_name,500).text;if(result.session_name!==undefined)job.session_name=bounded(result.session_name,500).text;if(result.last_activity_at!==undefined)job.last_activity_at=result.last_activity_at;
    if(result.questions!==undefined){job.questions=result.questions.map(safeQuestion);job.questions_truncated=result.questions_truncated===true;}
    if(job.user_question_count>0)for(const question of job.questions)if(question.state==='continued'&&!job.continued_call_ids.includes(question.call_id)){if(job.continued_call_ids.length>=MAX_INTERACTION_OPERATIONS)throw fail('NATIVE_CAPACITY');job.continued_call_ids.push(question.call_id);}
    if(command.action==='create'){
     if(job.status==='cancel_requested'){mutate(job,{status:'cancelled',reason:'cancelled_before_prompt',finished_at:time()});for(const pending of next.commands)if(pending.job_id===job.job_id&&['pending','offered'].includes(pending.status))Object.assign(pending,{status:'superseded',finished_at:time()});}
     else if(!definite.has(job.status)){mutate(job,{status:'accepted',reason:null,finished_at:null});enqueue(next,job,'prompt');}
    }else if(command.action==='prompt'){
     if(result.accepted!==true)uncertain(job,'native_prompt_unconfirmed');
     else{job.prompt_accepted=true;if(job.status!=='cancel_requested'&&!definite.has(job.status))mutate(job,{status:'running',reason:null,finished_at:null});}
    }else if(command.action==='cancel'&&!definite.has(job.status)){
     if(result.removed_request_id===job.prompt_request_id&&job.turn===null)mutate(job,{status:'cancelled',reason:'native_queue_removed',result:null,finished_at:time()});
     else mutate(job,{status:'cancel_requested',reason:null,finished_at:null});
    }
    if(result.events?.length){reduce(job,result.events,next);job.revision++;}
    if(command.action==='inspect'&&job.unresolved_question_reply&&!job.external_input&&!definite.has(job.status)&&job.status!=='cancel_requested'&&result.running===false&&result.user_question_count===0&&result.questions?.length===0&&result.questions_truncated!==true&&result.interactions?.length===0)uncertain(job,'native_question_unavailable');
    if(!live.has(job.status)&&job.status!=='unknown')for(const pending of next.commands)if(pending.job_id===job.job_id&&['pending','offered'].includes(pending.status)){finishOperation(job,pending,'failed','INTERACTION_STALE');Object.assign(pending,{status:'superseded',finished_at:time()});}
   }
   await save(next);return{accepted:true,duplicate:false,job:view(job)};
  });
 }
 function jobs(input={}){
  available();const {offset=0,limit=20,status,workspace_id,request_id,archived=false}=checked(pageSchema,input),items=state.jobs.filter(job=>job.principal===principal&&job.archived===archived&&(status===undefined||job.status===status)&&(workspace_id===undefined||job.workspace_id===workspace_id)&&(request_id===undefined||job.request_id===request_id)).toReversed();
  return{items:items.slice(offset,offset+limit).map(job=>view(job,{summary:true})),total:items.length,offset,next_offset:offset+limit<items.length?offset+limit:null,has_more:offset+limit<items.length};
 }
 function job(id){available();checked(nativeId,id);return view(belongs(state,id));}
 function overview(){available();const counts=Object.fromEntries(statuses.map(status=>[status,state.jobs.filter(job=>job.status===status).length]));return{jobs_total:state.jobs.length,jobs_archived:state.jobs.filter(job=>job.archived).length,jobs_visible:state.jobs.filter(job=>!job.archived).length,counts,queued:state.commands.filter(command=>['pending','offered'].includes(command.status)).length,claimed:state.commands.filter(command=>command.status==='claimed').length,last_worker_seen_at:state.last_worker_seen_at};}
 let closePromise;
 return{call,offer,claim,report,jobs,job,overview,close(){if(closePromise)return closePromise;closing=true;closePromise=(async()=>{await queue;closed=true;await store.close?.();})();return closePromise;}};
}
