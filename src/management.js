import {z} from 'zod';
import {HARNESS_TOOL_NAMES,NATIVE_TASK_TOOL_NAMES,publicError} from './bridge.js';
import {createManagementQueue} from './management-queue.js';
import {createCloudStatus} from './cloud-status.js';

const reads=new Set(HARNESS_TOOL_NAMES);
const tasks=new Set(['list_projects','read_project_context','start_task','get_task','cancel_task']);
const nativeTools=new Set(NATIVE_TASK_TOOL_NAMES);
const HEALTH_DEADLINE_MS=1500,HEALTH_CACHE_MS=5000,WORKER_FRESH_MS=30000;
const jobId=z.string().regex(/^(?:job|native_job)_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
const isNativeJob=id=>typeof id==='string'&&id.startsWith('native_job_');
const page={offset:z.number().int().min(0).max(10000000).optional(),limit:z.number().int().min(1).max(100).optional()};
export const MANAGEMENT_TOOL_NAMES=Object.freeze(['manager_overview','manager_events','manager_jobs','manager_job','manager_set_paused','manager_cancel','manager_worker_poll','manager_archive','manager_followup']);
const taskFilters={workspace_id:z.string().min(1).max(512).optional(),request_id:z.string().regex(/^[A-Za-z0-9_-]{1,100}$/).optional(),archived:z.boolean().optional()};
const schemas={
 manager_overview:z.object({include_control:z.boolean().optional()}).strict(),
 manager_events:z.object({...page,category:z.enum(['read','task','control']).optional(),outcome:z.enum(['pending','succeeded','failed','unknown','denied']).optional()}).strict(),
 manager_jobs:z.object({...page,...taskFilters,status:z.enum(['accepted','starting','running','cancel_requested','succeeded','failed','cancelled','unknown']).optional()}).strict(),
 manager_job:z.object({job_id:jobId}).strict(),manager_set_paused:z.object({paused:z.boolean()}).strict(),manager_cancel:z.object({job_id:jobId}).strict(),
 manager_worker_poll:z.object({}).strict(),
 manager_archive:z.object({job_id:jobId,archived:z.boolean().optional()}).strict(),
 manager_followup:z.object({job_id:jobId,task:z.string().trim().min(1).max(8000),request_id:z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),mode:z.enum(['after_complete','queue','steer']).optional()}).strict(),
};
const error=code=>Object.assign(new Error(code==='CONNECTOR_PAUSED'?'Connector is paused.':code==='AUDIT_UNAVAILABLE'?'Connector audit is unavailable.':'Management access denied.'),{code});
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function selectors(args){const out={};if(!record(args))return out;for(const key of ['project_id','workspace_id','session_id','job_id','path','offset','limit','max_bytes'])if(typeof args[key]==='string'&&args[key].length<=2000||Number.isSafeInteger(args[key])&&args[key]>=0)out[key]=args[key];return out;}
function summary(value){const out={};if(!record(value))return out;for(const key of ['total','source_bytes','next_offset'])if(Number.isSafeInteger(value[key])&&value[key]>=0)out[key]=value[key];for(const key of ['eof','has_more','result_truncated'])if(typeof value[key]==='boolean')out[key]=value[key];if(typeof value.sha256_redacted==='string'&&/^[a-f0-9]{64}$/.test(value.sha256_redacted))out.sha256_redacted=value.sha256_redacted;if(value.source==='existing_harness_persisted')out.source=value.source;for(const key of ['items','projects','entries','files'])if(Array.isArray(value[key])){out.count=value[key].length;break;}if(jobId.safeParse(value.job_id).success)out.job_id=value.job_id;if(['accepted','starting','running','cancel_requested','succeeded','failed','cancelled','unknown'].includes(value.status))out.status=value.status;return out;}

/** Management stores only selected metadata; original read bodies are returned but never retained. */
export async function createManagement({audit,forward,principal,loadJobs,nativeTasks,cloudStatus=createCloudStatus()}={}){
 if(!audit||typeof forward!=='function'||typeof principal!=='string'||!principal)throw error('MANAGEMENT_DENIED');let closed=false,active=0,lastWorkerPollAt=null,workerFlight=null;
 const healthLifetime=new AbortController();let healthCache=null,healthFlight=null;
 const guard=owner=>{if(closed||owner!==principal)throw error('MANAGEMENT_DENIED');};
 const adminQueue=createManagementQueue({available:()=>guard(principal)});
 const cloud=async()=>{try{return await cloudStatus.read();}catch{return{state:'unknown',source:'none',reason:'probe_unavailable',checked_at:new Date(Date.now()).toISOString(),last_connected_at:null,last_interaction_at:null};}};
 const cloudFields=value=>({cloud_state:value.state,cloud_source:value.source,cloud_reason:value.reason,cloud_checked_at:value.checked_at,cloud_last_connected_at:value.last_connected_at,cloud_last_interaction_at:value.last_interaction_at});
 function execution(nativeView){
  const candidates=[lastWorkerPollAt,nativeView?.last_worker_seen_at].filter(value=>typeof value==='string'&&Number.isFinite(Date.parse(value)));
  const last=candidates.sort((a,b)=>Date.parse(b)-Date.parse(a))[0]??null,age=last===null?Infinity:Date.now()-Date.parse(last);
  const ready=Boolean(nativeTasks)&&age>=0&&age<=WORKER_FRESH_MS;
  return{configured:Boolean(nativeTasks),ready,worker_backend:ready?'online':last?'stale':'not_seen',last_worker_seen_at:last};
 }
 async function workerPoll(owner){
  guard(owner);if(!nativeTasks)return{native_control:null,native_execution:null};
  lastWorkerPollAt=new Date(Date.now()).toISOString();
  if(workerFlight)return workerFlight;
  workerFlight=Promise.resolve().then(async()=>{guard(owner);const control=await nativeTasks.offer(owner);guard(owner);return{native_control:control,native_execution:await nativeTasks.overview()};}).finally(()=>{workerFlight=null;});
  return workerFlight;
 }
 const save=async(fn)=>{try{return await fn();}catch{throw error('AUDIT_UNAVAILABLE');}};
 async function refresh(){if(!loadJobs)return;let rows;try{rows=await loadJobs();}catch{return;}if(Array.isArray(rows))await save(()=>audit.importJobs(rows));}
 const healthProbe=tool=>new Promise(resolve=>{
  let settled=false,timer;
  const finish=online=>{if(settled)return;settled=true;clearTimeout(timer);healthLifetime.signal.removeEventListener('abort',abort);resolve(online);};
  const abort=()=>finish(false);healthLifetime.signal.addEventListener('abort',abort,{once:true});
  if(healthLifetime.signal.aborted)return abort();
  timer=setTimeout(abort,HEALTH_DEADLINE_MS);timer.unref?.();
  Promise.resolve().then(()=>forward(tool,{})).then(()=>finish(true),()=>finish(false));
 });
 function health(){
  const age=healthCache?Date.now()-healthCache.time:Infinity;
  if(age>=0&&age<HEALTH_CACHE_MS)return Promise.resolve(healthCache);
  if(healthFlight)return healthFlight;
  healthFlight=Promise.all(['list_projects','harness_status'].map(healthProbe)).then(([task,read])=>{
   const time=Date.now(),value={task,read,time,checked_at:new Date(time).toISOString()};if(!closed)healthCache=value;return value;
  }).finally(()=>{healthFlight=null;});return healthFlight;
 }
 async function channelCall(owner,tool,args){
  guard(owner);if(!reads.has(tool)&&!tasks.has(tool)&&!(nativeTasks&&nativeTools.has(tool))||!record(args)||active>=4)throw error('MANAGEMENT_DENIED');
  active++;let id;
  try{
   id=await save(()=>audit.begin({tool,category:reads.has(tool)?'read':'task',selectors:selectors(args),...(typeof args.request_id==='string'&&args.request_id.length<=100?{request_id:args.request_id}:{}),...(jobId.safeParse(args.job_id).success?{job_id:args.job_id}:{})}));
   if(audit.overview().paused&&!['get_task','cancel_task','harness_status','harness_get_task','harness_list_tasks','harness_archive_task','harness_cancel_task'].includes(tool)){await save(()=>audit.finish(id,{outcome:'denied',error_code:'CONNECTOR_PAUSED'}));throw error('CONNECTOR_PAUSED');}
   let result;
   try{result=nativeTools.has(tool)?await nativeTasks.call(owner,tool,args):await forward(tool,args);}catch(failure){const safe=publicError(failure);await save(()=>audit.finish(id,{outcome:['REQUEST_TIMEOUT','BACKEND_OFFLINE','NATIVE_UNAVAILABLE'].includes(safe.code)?'unknown':'failed',error_code:safe.code}));throw Object.assign(new Error(safe.message),{code:safe.code});}
   if(tool==='harness_status'&&record(result))result={...result,capabilities:{persisted_reads:true,native_tasks:execution(nativeTasks?await nativeTasks.overview():null)},admission:{paused:audit.overview().paused},cloud_connection:await cloud()};
   const taskJob=!nativeTools.has(tool)&&jobId.safeParse(result?.job_id).success?{...result,...typeof args.task==='string'?{task:args.task}:{},...typeof args.request_id==='string'?{request_id:args.request_id}:{}}:undefined;
   await save(()=>audit.finish(id,{outcome:'succeeded',summary:summary(result),...taskJob?{job:taskJob}:{}}));return result;
  }finally{active--;}
 }
 const channel={call:channelCall};
 const adminCall=async(owner,tool,args)=>{
  guard(owner);if(!Object.hasOwn(schemas,tool))throw error('MANAGEMENT_DENIED');const parsed=schemas[tool].safeParse(args);if(!parsed.success)throw error('MANAGEMENT_DENIED');args=parsed.data;
  if(tool==='manager_worker_poll')return workerPoll(owner);
  if(tool==='manager_set_paused'){
   const id=await save(()=>audit.begin({tool,category:'control',selectors:{}}));
   const result=await save(()=>audit.setPaused(args.paused));await save(()=>audit.finish(id,{outcome:'succeeded',summary:{status:args.paused?'paused':'accepting'}}));return{paused:result.paused};
  }
  await refresh();guard(owner);
  if(tool==='manager_events')return audit.listEvents(args);
  if(tool==='manager_jobs'){
   const offset=args.offset??0,limit=args.limit??20;
   const legacy=args.archived?[]:audit.listJobs({offset:0,limit:100,...args.status?{status:args.status}:{}}).items.filter(job=>(!args.workspace_id||(job.workspace_id??job.project_id)===args.workspace_id)&&(!args.request_id||job.request_id===args.request_id));
   const base=Math.max(0,offset-legacy.length),nativeRows=[];let nativeTotal=0;
   if(nativeTasks){
    let cursor=base;const end=offset+limit;
    do{const result=await nativeTasks.jobs({...args,offset:cursor,limit:Math.min(100,end-cursor)});nativeRows.push(...result.items);nativeTotal=result.total;cursor=result.next_offset;if(cursor==null)break;}while(cursor<end);
   }
   const items=[...legacy,...nativeRows].sort((a,b)=>b.created_at.localeCompare(a.created_at)),total=legacy.length+nativeTotal;
   return{items:items.slice(offset-base,offset-base+limit).map(job=>Object.fromEntries(['job_id','project_id','workspace_id','workspace_name','session_id','session_name','request_id','status','stage','created_at','finished_at','last_activity_at','observed_at','stale','archived','archived_at','execution_kind','mode','result_truncated','task','acceptance','pending_approvals','user_question_count'].filter(key=>Object.hasOwn(job,key)).map(key=>[key,job[key]]))),total,offset,next_offset:offset+limit<total?offset+limit:null};
  }
  if(tool==='manager_archive'||tool==='manager_followup'){
   if(!isNativeJob(args.job_id)||!nativeTasks||!await nativeTasks.job(args.job_id))throw error('MANAGEMENT_DENIED');
   const job=await channelCall(owner,tool==='manager_archive'?'harness_archive_task':'harness_followup_task',args);return{job,cached:false};
  }
  if(tool==='manager_job'||tool==='manager_cancel'){
   if(isNativeJob(args.job_id)){
    if(!nativeTasks||!await nativeTasks.job(args.job_id))throw error('MANAGEMENT_DENIED');
    const value=await channelCall(owner,tool==='manager_cancel'?'harness_cancel_task':'harness_get_task',args);return{job:value,cached:false};
   }
   let known;try{known=audit.job(args.job_id);}catch{throw error('MANAGEMENT_DENIED');}if(!known)throw error('MANAGEMENT_DENIED');
   if(tool==='manager_cancel'){await channelCall(owner,'cancel_task',args);return{job:audit.job(args.job_id)};}
   try{await channelCall(owner,'get_task',args);return{job:audit.job(args.job_id),cached:false};}catch(failure){return{job:known,cached:true,refresh_error:publicError(failure).code};}
  }
  const [checked,cloudView]=await Promise.all([health(),cloud()]);guard(owner);const readOnline=checked.read;const view=audit.overview();
  const nativeView=nativeTasks?await nativeTasks.overview():null;
  const readiness=execution(nativeView),taskOnline=nativeTasks?readiness.ready:checked.task;
  return{management_protocol:{version:2,features:{task_filters:true,archive:true,followup:true,worker_poll:true}},connection:{state:taskOnline&&readOnline?'connected':taskOnline||readOnline?'partial':'offline',task_backend:taskOnline?'online':'offline',read_backend:readOnline?'online':'offline',checked_at:checked.checked_at,worker_backend:readiness.worker_backend,last_worker_seen_at:readiness.last_worker_seen_at,...cloudFields(cloudView)},capabilities:{persisted_reads:true,native_tasks:readiness},admission:{paused:view.paused},scope:{read:'owner_harness_persisted',task:nativeTasks?'native_workspace':'fixture_only',credential_files:false,live_memory:false},audit:{...view,jobs_total:view.jobs_total+(nativeView?.jobs_total??0)},recent_events:audit.listEvents({limit:5}).items,...nativeTasks?{native_control:args.include_control===false?null:await nativeTasks.offer(owner),native_execution:nativeView}:{}};
 };
 const admin={async call(owner,tool,args){guard(owner);if(!Object.hasOwn(schemas,tool)||!schemas[tool].safeParse(args).success)throw error('MANAGEMENT_DENIED');return tool==='manager_worker_poll'?adminCall(owner,tool,args):adminQueue.run(()=>adminCall(owner,tool,args));}};
 return{channel,admin,close:async()=>{closed=true;adminQueue.close();healthLifetime.abort();cloudStatus.close?.();}};
}
