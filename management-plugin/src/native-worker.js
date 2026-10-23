/** Runs only inside the native owner renderer. The function is serialized into the DSH lazy bundle. */
export function createNativeWorker(options={}){
 const {remote,overview=()=>remote.dotDshManagement.workerPoll({}),fetchImpl=globalThis.fetch,location=globalThis.location,randomUUID=()=>globalThis.crypto.randomUUID(),now=()=>Date.now(),pollIntervalMs=1000,timeoutMs=30000,setTimeoutImpl=globalThis.setTimeout,clearTimeoutImpl=globalThis.clearTimeout,diagnostic=(stage,code)=>globalThis.console?.warn('Dot native worker',stage,code)}=options;
 const enabled=location?.protocol==='dsh-app:'&&location?.hostname==='app';
 const legacyBase='http://127.0.0.1:31474/native/',clientId=enabled?randomUUID():null;
 const endpoint=value=>typeof value==='string'&&/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}\/native\/$/.test(value)&&Number(new URL(value).port)<=65535?value:null;
 const controllers=new Set();let closed=false,started=false,busy=false,timer=null,pending=null,stage='native.execute';
 const diagnosticCodes=new Set(['gateway/invocation-unavailable','gateway/definition-unavailable','gateway/service-unavailable','gateway/method-unavailable','gateway/binding-invalid','gateway/input-invalid','gateway/bad-request','gateway/internal','gateway/cancelled','session/not-found','session/agent-unavailable','session/queue-item-not-found','workspace/not-found']);
 const stages=new Set(['native.execute','workspace.follow','session.list','session.create','session.follow','session.page','session.prompt','session.updateQueue','session.cancel']);
 const at=(label,callback)=>{stage=stages.has(label)?label:'native.execute';return callback();};
 const fault=code=>Object.assign(new Error(code),{safeCode:code});
 const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
 const text=value=>typeof value==='string'&&value.length>0&&value.length<=200;
 const path=value=>typeof value==='string'&&value.startsWith('/')&&!value.includes('\0')&&!value.split('/').some(p=>p==='.'||p==='..')?value.replace(/\/+$/,'')||'/':null;
 const unwrap=result=>{if(!plain(result)||result.ok!==true)throw Object.assign(fault('NATIVE_FAILED'),{nativeCode:diagnosticCodes.has(result?.error?.code)?result.error.code:'native/failed'});return result.value;};
 const nativeCall=async(callback,code='NATIVE_TIMEOUT')=>{
  if(closed)throw fault('NATIVE_UNAVAILABLE');
  const controller=new AbortController();controllers.add(controller);let handle;
  try{return await Promise.race([Promise.resolve().then(()=>callback(controller.signal)),new Promise((_,reject)=>{handle=setTimeoutImpl(()=>{controller.abort();reject(fault(code));},timeoutMs);})]);}
  finally{clearTimeoutImpl(handle);controller.abort();controllers.delete(controller);}
 };
 const firstFrame=async(open,type)=>nativeCall(async signal=>{
  const iterator=open(signal)[Symbol.asyncIterator]();
  try{const next=await iterator.next();if(next.done||next.value?.type!==type)throw fault('HISTORY_UNAVAILABLE');return next.value;}
  finally{signal.throwIfAborted?.();Promise.resolve(iterator.return?.()).catch(()=>{});}
 });
 const workspace=async id=>{
  const frame=await at('workspace.follow',()=>firstFrame(signal=>remote.workspace.follow(signal),'baseline'));
  const matches=frame.value?.items?.filter(item=>item.workspaceId===id)??[];
  if(matches.length!==1||!path(matches[0].path))throw fault('WORKSPACE_UNAVAILABLE');return matches[0];
 };
 const list=async()=>{const result=unwrap(await at('session.list',()=>nativeCall(signal=>remote.session.list({},signal))));if(!Array.isArray(result?.items))throw fault('NATIVE_FAILED');return result.items;};
 const history=async command=>{
  const opening=await at('session.follow',()=>firstFrame(signal=>remote.session.follow({address:{kind:'session',sessionId:command.session_id},maxMessages:256,turnWindow:{minMessages:32,minTurns:8}},signal),'snapshot'));
  if(opening.header?.id!==command.session_id)throw fault('IDENTITY_MISMATCH');
  let records=Array.isArray(opening.records)?opening.records:[],hasMore=opening.hasMore===true;
  const anchorId=command.action==='prompt'&&command.parent_request_id?command.parent_request_id:command.request_id;
  const requestAnchor=()=>{let turn=null,found=false;for(const record of [...records].sort((a,b)=>(a.event?.seq??-1)-(b.event?.seq??-1))){if(record.type!=='event')continue;const e=record.event;if((e?.type==='turn/start'||e?.type==='step/start')&&Number.isSafeInteger(e.data?.turn)&&e.data.turn>=0)turn=e.data.turn;if(e?.type==='user/message'&&e.data?.source?.rpcId===anchorId){found=true;if(turn!==null)return'anchored';}}return found?'unanchored':'absent';};
  // Page only when the bounded opening omitted the requested turn. Retain the inclusive opening cursor.
  for(let page=0;hasMore&&page<8&&requestAnchor()!=='anchored';page++){
   const seqs=records.filter(r=>r.type==='event').map(r=>r.event?.seq).filter(Number.isSafeInteger);
   if(!seqs.length||!Number.isSafeInteger(opening.cursor))throw fault('HISTORY_UNAVAILABLE');
   const result=unwrap(await at('session.page',()=>nativeCall(signal=>remote.session.page({address:{kind:'session',sessionId:command.session_id},throughSeq:opening.cursor,beforeSeq:Math.min(...seqs),maxMessages:256,turnWindow:{minMessages:32,minTurns:8}},signal))));
   if(!Array.isArray(result?.records)||!result.records.length)break;
   records=[...result.records,...records];hasMore=result.hasMore===true;
   if(records.length>10000)throw fault('HISTORY_UNAVAILABLE');
  }
  if(requestAnchor()==='unanchored')throw fault('HISTORY_UNAVAILABLE');
  return{...opening,records};
 };
 const clip=(value,max)=>typeof value==='string'?value.slice(0,max):null;
 const questionsOf=active=>{
  const questions=[];let truncated=false,budget=8192;
  const take=(value,max)=>{const result=clip(value,Math.min(max,budget));budget-=result.length;truncated||=result.length<value.length;return result;};
  for(const batch of Array.isArray(active)?active:[]){
   if(!text(batch?.callId)||!['open','continued'].includes(batch.state)||!Array.isArray(batch.questions))continue;
   for(const question of batch.questions){
    if(!text(question?.id)||typeof question.question!=='string')continue;
    if(questions.length>=20||budget===0){truncated=true;continue;}
    const item={call_id:batch.callId,id:question.id,question:take(question.question,2000),state:batch.state};
    for(const [key,max]of [['header',200],['detail',4000]])if(typeof question[key]==='string'){item[key]=take(question[key],max);truncated||=question[key].length>max;}
    truncated||=question.question.length>2000;
    if(typeof question.multiSelect==='boolean')item.multi_select=question.multiSelect;
    if(Array.isArray(question.options)){truncated||=question.options.length>12;item.options=question.options.slice(0,12).filter(option=>typeof option?.label==='string').map(option=>{truncated||=option.label.length>300||(typeof option.description==='string'&&option.description.length>1000);return{label:take(option.label,300),...typeof option.description==='string'?{description:take(option.description,1000)}:{}};});}
    questions.push(item);
   }
  }
  return{questions,questions_truncated:truncated};
 };
 const metadata=(registered,item,snapshot)=>{const name=snapshot.projections?.values?.title??item.projections?.values?.title;return{...typeof registered.title==='string'?{workspace_name:clip(registered.title,500)}:{},...typeof name==='string'?{session_name:clip(name,500)}:{},...Number.isFinite(item.updatedAt)&&Math.abs(item.updatedAt)<=8640000000000000?{last_activity_at:new Date(item.updatedAt).toISOString()}:{}};};
 const normalize=snapshot=>{
  const raw=snapshot.records.filter(r=>r.type==='event'&&plain(r.event)&&Number.isSafeInteger(r.event.seq)&&r.event.seq>=0).map(r=>r.event).sort((a,b)=>a.seq-b.seq);
  const events=[],approvals=new Set();let currentTurn=null,activeTurn=null,activeRequest=null;
  for(const e of raw){const d=e.data;
   if(!plain(d))continue;
   if((e.type==='turn/start'||e.type==='step/start')&&Number.isSafeInteger(d.turn)&&d.turn>=0){currentTurn=d.turn;if(e.type==='turn/start'){activeTurn=d.turn;activeRequest=null;events.push({type:'turn/start',seq:e.seq,turn:d.turn});}}
   if(e.type==='user/message'&&currentTurn!==null&&text(d.id)&&plain(d.source)){
    const item={type:'user/message',seq:e.seq,turn:currentTurn,message_id:d.id,source_kind:typeof d.source.kind==='string'?d.source.kind:'unknown'};
    if(text(d.source.rpcId))item.source_rpc_id=d.source.rpcId;
    events.push(item);if(d.source.kind==='user'&&activeTurn===currentTurn)activeRequest=d.source.rpcId??null;
   }
   if(e.type==='assistant/message'&&Number.isSafeInteger(d.turn)&&d.turn>=0){const content=d.message?.content;const value=Array.isArray(content)?content.filter(b=>b?.type==='text'&&typeof b.text==='string').map(b=>b.text).join('\n'):'';const characters=Array.from(value);events.push({type:'assistant/message',seq:e.seq,turn:d.turn,text:characters.slice(0,16000).join(''),...characters.length>16000?{text_truncated:true}:{},interrupted:d.interrupted===true});}
   if(e.type==='turn/end'&&Number.isSafeInteger(d.turn)&&d.turn>=0){const reason=typeof d.reason?.kind==='string'?d.reason.kind:'unknown';events.push({type:'turn/end',seq:e.seq,turn:d.turn,reason});if(activeTurn===d.turn){activeTurn=null;activeRequest=null;}}
   if(e.type==='approval/asked'&&text(d.id))approvals.add(d.id);
   if(e.type==='approval/decided'&&text(d.id))approvals.delete(d.id);
  }
  const values=snapshot.projections?.values??{},inbox=values.inbox??{};
  return{events,activeTurn,activeRequest,...questionsOf(values.userQuestions?.active),pending_approvals:approvals.size,user_question_count:Array.isArray(values.userQuestions?.active)?values.userQuestions.active.length:0,queued:['next-turn','next-step'].flatMap(key=>Array.isArray(inbox[key])?inbox[key]:[])};
 };
 const validate=command=>{
  const keys=new Set(['command_id','action','job_id','workspace_id','session_id','request_id','task','expected_cwd','mode','parent_request_id','owned_request_ids']);
  if(!plain(command)||Object.keys(command).some(key=>!keys.has(key))||!['create','prompt','inspect','cancel'].includes(command.action)||!['command_id','job_id','workspace_id','session_id','request_id'].every(key=>text(command[key]))||!/^dsh_dot_[0-9a-f-]{36}$/i.test(command.session_id)||!(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(command.request_id)))throw fault('INVALID_COMMAND');
  if(command.action==='prompt'&&(typeof command.task!=='string'||!command.task.trim()||Array.from(command.task).length>64000))throw fault('INVALID_COMMAND');
  if(command.owned_request_ids!==undefined&&(!Array.isArray(command.owned_request_ids)||command.owned_request_ids.length>101||!command.owned_request_ids.every(id=>typeof id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))))throw fault('INVALID_COMMAND');
  if(command.mode!==undefined&&!['after_complete','queue','steer'].includes(command.mode))throw fault('INVALID_COMMAND');
  if(command.mode==='queue'||command.mode==='steer'){if(command.action==='create'||!(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(command.parent_request_id??''))||command.parent_request_id===command.request_id)throw fault('INVALID_COMMAND');}
  else if(command.parent_request_id!==undefined)throw fault('INVALID_COMMAND');
  if(command.expected_cwd!==undefined&&!path(command.expected_cwd))throw fault('INVALID_COMMAND');
 };
 const verify=async(command,registered)=>{
  const items=await list(),item=items.find(item=>item.sessionId===command.session_id);
  if(!item||item.origin==='subagent')throw fault('IDENTITY_MISMATCH');
  if(!Array.isArray(registered.sessionIds)||!registered.sessionIds.includes(command.session_id))throw fault('IDENTITY_MISMATCH');
  const snapshot=await history(command),cwd=path(snapshot.header.cwd),root=path(registered.path);
  if(!cwd||cwd!==root||(command.expected_cwd!==undefined&&cwd!==path(command.expected_cwd)))throw fault('IDENTITY_MISMATCH');
  return{snapshot,item,cwd};
 };
 const execute=async(command,expiresAt)=>{
  const deadline=Date.parse(expiresAt);
  const mutation=(method,args)=>at(`session.${method}`,()=>nativeCall(signal=>{if(closed||!Number.isFinite(deadline)||now()>=deadline)throw fault('NATIVE_TIMEOUT');return method==='prompt'?remote.session.prompt(args,signal):remote.session[method](args);}));
  try{
   stage='native.execute';validate(command);if(!Number.isFinite(deadline)||now()>=deadline)throw fault('NATIVE_TIMEOUT');let registered=await workspace(command.workspace_id);
   if(command.action==='create'){
    const existing=(await list()).find(item=>item.sessionId===command.session_id);
    if(!existing){const created=unwrap(await mutation('create',{workspaceId:command.workspace_id,sessionId:command.session_id}));if(created?.sessionId!==command.session_id)throw fault('IDENTITY_MISMATCH');registered=await workspace(command.workspace_id);}
    const {cwd,item,snapshot}=await verify(command,registered);return{ok:true,session_id:command.session_id,workspace_id:command.workspace_id,cwd,...metadata(registered,item,snapshot)};
   }
   let {snapshot,item,cwd}=await verify(command,registered);let state=normalize(snapshot);
   const identity={ok:true,session_id:command.session_id,workspace_id:command.workspace_id,cwd,...metadata(registered,item,snapshot)};
   if(command.action==='prompt'){
    const activeMode=command.mode==='queue'||command.mode==='steer';
    if(activeMode){const owned=new Set(command.owned_request_ids??[command.parent_request_id,command.request_id]);if(item.running!==true||state.activeTurn===null||state.activeRequest!==command.parent_request_id||state.events.some(event=>event.type==='user/message'&&event.turn===state.activeTurn&&event.source_kind==='user'&&!owned.has(event.source_rpc_id)))throw fault('IDENTITY_MISMATCH');}
    else if(state.activeTurn!==null&&state.activeRequest!==command.request_id)throw fault('IDENTITY_MISMATCH');
    // Native requestId deduplicates both pending inbox messages and durable user/message events.
    const result=unwrap(await mutation('prompt',{sessionId:command.session_id,requestId:command.request_id,mode:command.mode==='steer'?'steer':'queue',content:[{type:'text',text:command.task}]}));
    if(result?.accepted!==true)throw fault('NATIVE_FAILED');return{...identity,accepted:true,...activeMode?{parent_turn:state.activeTurn}:{}};
   }
   let removed;
   if(command.action==='cancel'){
    const owned=state.queued.filter(message=>message?.source?.kind==='user'&&message.source.rpcId===command.request_id&&text(message.id));
    if(!owned.length&&state.activeTurn!==null&&state.activeRequest!==command.request_id)throw fault('IDENTITY_MISMATCH');
    for(const message of owned){const result=unwrap(await mutation('updateQueue',{sessionId:command.session_id,itemId:message.id,action:{kind:'remove'}}));if(result?.accepted!==true)throw fault('NATIVE_FAILED');}
    if(owned.length){snapshot=await history(command);state=normalize(snapshot);if(!state.queued.some(message=>message?.source?.rpcId===command.request_id)&&!state.events.some(e=>e.type==='user/message'&&e.source_rpc_id===command.request_id))removed=command.request_id;}
    if(state.activeTurn!==null&&state.activeRequest===command.request_id){const allowed=new Set(command.owned_request_ids??[command.request_id]);if(state.events.some(event=>event.type==='user/message'&&event.turn===state.activeTurn&&event.source_kind==='user'&&!allowed.has(event.source_rpc_id)))throw fault('IDENTITY_MISMATCH');const result=unwrap(await mutation('cancel',{sessionId:command.session_id}));if(result?.accepted!==true)throw fault('NATIVE_FAILED');}
   }
   const parentTurn=command.parent_request_id?state.events.find(e=>e.type==='user/message'&&e.source_rpc_id===command.parent_request_id)?.turn:undefined;
   const target=state.events.find(e=>e.type==='user/message'&&e.source_rpc_id===command.request_id)?.turn;
   const events=target===undefined?[]:state.events.filter(e=>e.turn===target);
   if(events.length>256)throw fault('HISTORY_UNAVAILABLE');
   const result={...identity,...parentTurn!==undefined?{parent_turn:parentTurn}:{},running:item.running===true,events,questions:state.questions,questions_truncated:state.questions_truncated,pending_approvals:state.pending_approvals,user_question_count:state.user_question_count,...command.action==='cancel'?{cancel_requested:true}:{},...removed?{removed_request_id:removed}:{}};
   // Leave space for the authenticated report wrapper and JSON encoding overhead.
   if(new TextEncoder().encode(JSON.stringify(result)).length>240*1024)throw fault('HISTORY_UNAVAILABLE');return result;
  }catch(error){try{diagnostic(stage,diagnosticCodes.has(error?.nativeCode)?error.nativeCode:diagnosticCodes.has(error?.code)?error.code:'native/failed');}catch{}const codes=new Set(['WORKSPACE_UNAVAILABLE','IDENTITY_MISMATCH','NATIVE_UNAVAILABLE','NATIVE_FAILED','NATIVE_TIMEOUT','INVALID_COMMAND','HISTORY_UNAVAILABLE']);return{ok:false,error_code:codes.has(error?.safeCode)?error.safeCode:'NATIVE_FAILED'};}
 };
 const post=async(base,route,body,token)=>nativeCall(async signal=>{
  const response=await fetchImpl(base+route,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},credentials:'omit',redirect:'error',body:JSON.stringify(body),signal});
  const value=await response.json();
  if(!response?.ok){const terminal=(response?.status===403&&value?.error?.code==='NATIVE_DENIED')||(response?.status===409&&value?.error?.code==='NATIVE_CONFLICT');throw Object.assign(fault('NATIVE_UNAVAILABLE'),{terminal});}
  if(!plain(value)||!Object.hasOwn(value,'result'))throw fault('NATIVE_UNAVAILABLE');return value.result;
 });
 const sendPending=async()=>{if(!pending)return;try{await post(pending.base,'report',pending.body,pending.body.lease_token);pending=null;}catch(error){if(error?.terminal===true)pending=null;throw error;}};
 async function poll(){
  if(!enabled||closed||busy)return;busy=true;
  try{
   if(pending){await sendPending();return;}
   const view=unwrap(await nativeCall(()=>overview())),offer=view?.native_control;
   if(!plain(offer)||!text(offer.command_id)||typeof offer.claim_token!=='string'||offer.claim_token.length<24||offer.claim_token.length>512)return;
   const base=Object.hasOwn(view,'native_worker_url')?endpoint(view.native_worker_url):legacyBase;if(!base)return;
   const lease=await post(base,'claim',{command_id:offer.command_id,claim_token:offer.claim_token,client_id:clientId},offer.claim_token);
   if(closed||!plain(lease)||lease.command?.command_id!==offer.command_id||typeof lease.lease_token!=='string'||lease.lease_token.length<24)return;
   const result=await execute(lease.command,lease.expires_at);if(closed)return;
   pending={base,body:{command_id:offer.command_id,lease_token:lease.lease_token,client_id:clientId,result}};await sendPending();
  }catch{}finally{busy=false;}
 }
 function schedule(){if(closed||!started||!enabled)return;timer=setTimeoutImpl(async()=>{timer=null;await poll();schedule();},pollIntervalMs);}
 function start(){if(closed||started||!enabled)return;started=true;void poll().finally(schedule);}
 function close(){closed=true;started=false;if(timer!==null)clearTimeoutImpl(timer);timer=null;for(const controller of controllers)controller.abort();controllers.clear();}
 return{start,close,poll};
}
