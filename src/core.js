import {randomUUID,createHash} from 'node:crypto';
import {z} from 'zod';
import {projectAccess,readContext} from './projects.js';
const id=z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const methods={list_projects:z.object({}).strict(),read_project_context:z.object({project_id:id}).strict(),start_task:z.object({project_id:id,task:z.string().trim().min(1).max(2000),request_id:id}).strict(),get_task:z.object({job_id:id}).strict(),cancel_task:z.object({job_id:id}).strict()};
const live=new Set(['accepted','starting','running','cancel_requested']);
const bounded=text=>Array.from(text).slice(0,8000).join('');
const copy=structuredClone;
const stateSchema=z.object({version:z.literal(1),jobs:z.array(z.object({job_id:id,principal:id,project_id:id,request_id:id,fingerprint:z.string().regex(/^[a-f0-9]{64}$/),task:z.string().max(2000),session_id:id,message_id:id,turn:z.number().int().nonnegative().nullable(),status:z.enum(['accepted','starting','running','cancel_requested','succeeded','failed','cancelled','unknown']),result:z.string().max(16000).nullable(),result_truncated:z.boolean().default(false),reason:z.string().max(100).nullable(),created_at:z.string().datetime(),finished_at:z.string().datetime().nullable(),context_sources:z.array(z.object({path:z.string().max(300),sha256:z.string().length(64)}).strict()).max(6)}).strict()).max(100)}).strict();
export async function createCore({projects=[],store,executor,timeoutMs=120000,clock=()=>new Date()}){
 const access=projectAccess(projects);if(!store?.load||!store?.save||!executor?.start||!executor?.cancel)throw new Error('Connector dependencies unavailable');
 if(!Number.isInteger(timeoutMs)||timeoutMs<10||timeoutMs>600000)throw new Error('Invalid task timeout');
 let state=stateSchema.parse(await store.load()??{version:1,jobs:[]});let queue=Promise.resolve(),closed=false,storageFailed=false;
 const active=new Map();const workers=new Set();
 const serial=fn=>{const p=queue.then(fn);queue=p.catch(()=>{});return p;};
 const time=()=>clock().toISOString();
 async function save(next){try{await store.save(stateSchema.parse(next));state=next;}catch{storageFailed=true;for(const a of active.values())a.controller.abort();throw new Error('Connector storage unavailable');}}
 const restart=copy(state);let dirty=false;for(const j of restart.jobs)if(live.has(j.status)){j.status='unknown';j.result=null;j.reason='connector_restarted';j.finished_at=time();dirty=true;}if(dirty)await save(restart);
 const view=(j,duplicate=false)=>({job_id:j.job_id,project_id:j.project_id,status:j.status,session_id:j.session_id,message_id:j.message_id,turn:j.turn,result:j.status==='succeeded'?j.result:null,result_truncated:j.status==='succeeded'&&j.result_truncated,reason:j.reason,created_at:j.created_at,finished_at:j.finished_at,context_sources:copy(j.context_sources),acceptance:'unverified',duplicate});
 const owner=(principal,id)=>{const j=state.jobs.find(j=>j.job_id===id&&j.principal===principal);if(!j)throw new Error('Job access denied');access.get(principal,j.project_id);return j;};
 function stopTimer(id){const a=active.get(id);if(a)clearTimeout(a.timer);}
 async function observe(job_id,event){return serial(async()=>{
  if(closed||storageFailed)return;const next=copy(state),j=next.jobs.find(j=>j.job_id===job_id);if(!j||!live.has(j.status)||event.session_id!==j.session_id)return;
  let changed=false;
  if(event.type==='user/message'&&Number.isSafeInteger(event.turn)&&event.turn>=0){
   if(event.message_id===j.message_id&&event.source==='user'&&j.turn===null){j.turn=event.turn;j.status=j.status==='cancel_requested'?'cancel_requested':'running';changed=true;}
   else if(event.message_id!==j.message_id||event.source!=='user'){j.status='failed';j.reason='mixed_input';j.result=null;j.finished_at=time();changed=true;}
  }else if(event.type==='discarded'&&event.message_id===j.message_id){j.status='cancelled';j.reason='discarded';j.result=null;j.finished_at=time();changed=true;}
  else if(j.turn!==null&&event.turn===j.turn){
   if(event.type==='assistant/message'&&!event.interrupted&&typeof event.text==='string'){j.result=bounded(event.text);j.result_truncated=Array.from(event.text).length>8000;changed=true;}
   if(event.type==='turn/end'){
    const reason=typeof event.reason==='string'?event.reason:'unknown';j.reason=/^[a-z-]{1,80}$/.test(reason)?reason:'unknown';
    j.status=reason==='completed'&&j.result?.trim()?'succeeded':reason==='aborted'?'cancelled':'failed';
    if(reason==='completed'&&!j.result?.trim())j.reason='no_text';if(j.status!=='succeeded')j.result=null;j.finished_at=time();changed=true;
   }
  }
  if(changed){await save(next);if(!live.has(j.status)){stopTimer(j.job_id);if(j.reason==='mixed_input')void executor.cancel(j.session_id).catch(()=>{});}}
 });}
 async function fail(job_id,reason){return serial(async()=>{if(closed||storageFailed)return;const next=copy(state),j=next.jobs.find(j=>j.job_id===job_id);if(!j||!live.has(j.status))return;j.status='unknown';j.result=null;j.reason=reason;j.finished_at=time();await save(next);stopTimer(job_id);});}
 async function dispatch(job_id,context,project){
  const controller=new AbortController();active.set(job_id,{controller,timer:null});
  let job=await serial(async()=>{if(closed)return;const next=copy(state),j=next.jobs.find(j=>j.job_id===job_id);if(j?.status!=='accepted')return;j.status='starting';await save(next);return copy(j);});
  if(!job){active.delete(job_id);return;}
  const entry=active.get(job_id);entry.timer=setTimeout(()=>{controller.abort();void fail(job_id,'deadline_exceeded').catch(()=>{});void executor.cancel(job.session_id).catch(()=>{});},timeoutMs);entry.timer.unref?.();
  try{await executor.start({...job,context,project_root:project.root},{signal:controller.signal,onEvent:e=>observe(job_id,e)});}
  catch{await fail(job_id,'dispatch_uncertain');}
 }
 async function call(principal,tool,args){
  id.parse(principal);if(!Object.hasOwn(methods,tool))throw new Error('Unknown tool');args=methods[tool].parse(args);
  return serial(async()=>{
   if(closed||storageFailed)throw new Error('Connector not accepting requests');
   if(tool==='list_projects')return{projects:access.list(principal)};
   if(tool==='read_project_context')return readContext(access.get(principal,args.project_id));
   if(tool==='get_task')return view(owner(principal,args.job_id));
   if(tool==='start_task'){
    const project=access.get(principal,args.project_id);
    const fingerprint=createHash('sha256').update(JSON.stringify({project_id:project.id,root:project.root,files:project.contextFiles,task:args.task})).digest('hex');
    const prior=state.jobs.find(j=>j.principal===principal&&j.request_id===args.request_id);
    if(prior){if(prior.fingerprint!==fingerprint)throw new Error('request_id conflict');return view(prior,true);}
    if(state.jobs.length>=100||state.jobs.filter(j=>live.has(j.status)).length>=2)throw new Error('Job capacity reached');
    const context=await readContext(project);
    const job={job_id:`job_${randomUUID()}`,principal,project_id:project.id,request_id:args.request_id,fingerprint,task:args.task,session_id:`dsh_dot_${randomUUID()}`,message_id:randomUUID(),turn:null,status:'accepted',result:null,result_truncated:false,reason:null,created_at:time(),finished_at:null,context_sources:context.files.map(({path,sha256})=>({path,sha256}))};
    const next=copy(state);next.jobs.push(job);await save(next);
    setImmediate(()=>{if(closed)return;const work=dispatch(job.job_id,context,project);workers.add(work);void work.catch(()=>{storageFailed=true;}).finally(()=>workers.delete(work));});
    return view(job);
   }
   const job=owner(principal,args.job_id);if(!live.has(job.status))return view(job);
   const next=copy(state),j=next.jobs.find(j=>j.job_id===job.job_id);
   if(j.status==='accepted'){j.status='cancelled';j.reason='cancelled_before_dispatch';j.finished_at=time();}
   else{j.status='cancel_requested';active.get(j.job_id)?.controller.abort();}
   await save(next);
   if(j.status==='cancel_requested')void executor.cancel(j.session_id).catch(()=>{});
   return view(j);
  });
 }
 async function close(){if(closed)return;closed=true;for(const [id,a]of active){stopTimer(id);a.controller.abort();}await executor.close?.();await Promise.allSettled([...workers]);await queue;await store.close?.();}
 return{call,observe,close};
}
