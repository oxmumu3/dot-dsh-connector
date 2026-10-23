/** Read-only observation of one explicitly linked official Tunnel runtime.
 * Local RPC traffic, audit activity and worker polls are never cloud evidence.
 */
import {open,realpath} from 'node:fs/promises';
import {constants} from 'node:fs';
import {isAbsolute,resolve} from 'node:path';

const CACHE_MS=5000,SNAPSHOT_MAX_AGE_MS=15000,FUTURE_SKEW_MS=5000,BODY_LIMIT=65536;
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const timestamp=value=>typeof value==='string'&&value.length<=40&&/^\d{4}-\d{2}-\d{2}T/.test(value)&&Number.isFinite(Date.parse(value))?Date.parse(value):null;
const stamp=value=>new Date(value).toISOString();
const fault=reason=>Object.assign(new Error('Cloud connection state could not be checked.'),{reason});

async function endpoint(file){
 if(typeof file!=='string'||!isAbsolute(file)||resolve(file)!==file||file.includes('\0'))throw fault('invalid_reference');
 let handle;
 try{
  if(await realpath(file)!==file)throw fault('invalid_reference');
  handle=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  const info=await handle.stat();
  if(!info.isFile()||info.nlink!==1||(info.mode&0o077)!==0||(process.getuid&&info.uid!==process.getuid())||info.size<1||info.size>256)throw fault('invalid_reference');
  const bytes=Buffer.alloc(257),{bytesRead}=await handle.read(bytes,0,bytes.length,0);
  if(bytesRead!==info.size)throw fault('invalid_reference');
  const value=new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,bytesRead)).trim();
  const match=/^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})\/?$/.exec(value);
  if(!match||Number(match[1])<1024||Number(match[1])>65535)throw fault('invalid_reference');
  return `http://127.0.0.1:${match[1]}/health?details=true`;
 }finally{await handle?.close();}
}

async function boundedJson(response){
 const reader=response.body?.getReader();if(!reader)throw fault('invalid_health');
 const chunks=[];let length=0;
 try{while(true){const part=await reader.read();if(part.done)break;length+=part.value.byteLength;if(length>BODY_LIMIT)throw fault('invalid_health');chunks.push(part.value);}return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}
 finally{await reader.cancel().catch(()=>{});}
}

function classify(value,now){
 const snapshot=timestamp(value?.snapshot_at),started=timestamp(value?.runtime?.started_at);
 if(!record(value)||value.schema_version!==1||snapshot===null||now-snapshot>SNAPSHOT_MAX_AGE_MS||snapshot-now>FUTURE_SKEW_MS||!record(value.components)||!record(value.runtime)||typeof value.runtime.instance_id!=='string'||!/^[-A-Za-z0-9_]{1,128}$/.test(value.runtime.instance_id)||started===null||started>snapshot)throw fault('invalid_health');
 const control=value.components['control-plane'],mcp=value.components.mcp,dispatcher=value.components.dispatcher;
 const identity=mcp?.details?.initialize;
 const delivery=value.components['response-delivery'],negative=component=>['error','failed','unhealthy'].includes(component?.status);
 const details=control?.details,success=timestamp(details?.last_success),deadline=details?.deadline_seconds,age=details?.current_poll_age_seconds;
 const polling=control?.status==='ok'&&control.state==='polling'&&success!==null&&success>=started&&success<=now+FUTURE_SKEW_MS&&Number.isFinite(deadline)&&deadline>=1&&deadline<=300&&now-success<=Math.max(60000,(deadline+5)*1000)&&Number.isFinite(age)&&age>=0&&age<=deadline+5&&details.consecutive_failures===0;
 const accepting=dispatcher?.status==='ok'&&dispatcher.state==='accepting'&&dispatcher.details?.accepting===true;
 // Official stdio health observes discovery only after the first real call.
 // A live polling child with no identity yet is waiting, never proven online.
 const unobservedIdentity=record(identity)&&identity.ok===false&&identity.identity_complete===false&&Object.entries(identity).every(([key,part])=>key==='capability_names'?Array.isArray(part)&&part.length===0:part===false?['ok','identity_complete','limited'].includes(key):part===null||part==='');
 if(value.live===true&&value.ready===true&&value.runtime.lifecycle==='running'&&polling&&accepting&&!negative(delivery)&&mcp?.status==='unknown'&&mcp.state==='not_observed'&&mcp.details?.transport==='stdio'&&mcp.details.child_state==='running'&&mcp.details.evidence==='same_child'&&unobservedIdentity)return{state:'unknown',reason:'awaiting_first_call'};
 if(identity?.server_name!=='dot-dsh-connector'||mcp?.details?.transport!=='stdio')throw fault('mcp_unverified');
 let interaction=null;
 if(delivery?.status==='ok'&&delivery?.details?.http_status>=200&&delivery.details.http_status<300){
  const candidates=[delivery.details.last_accepted,delivery.details.last_completed].map(timestamp).filter(time=>time!==null&&time>=started&&time<=snapshot+FUTURE_SKEW_MS);
  if(candidates.length)interaction=stamp(Math.max(...candidates));
 }
 if(['stopped','stopping'].includes(value.runtime.lifecycle)||negative(control)||negative(mcp)||negative(dispatcher)||mcp?.details?.child_state==='exited')return{state:'offline',reason:'tunnel_unavailable',interaction};
 // Incomplete/new-child identities cannot borrow an earlier child's green status.
 if(identity.ok!==true||identity.identity_complete!==true||mcp.details.evidence!=='same_child')throw fault('mcp_unverified');
 if(negative(delivery))return{state:'unknown',reason:'response_delivery_unverified',interaction};
 const initialized=mcp?.status==='ok'&&mcp.state==='initialized'&&mcp.details.child_state==='running';
 if(value.live===true&&value.ready===true&&value.runtime.lifecycle==='running'&&polling&&initialized&&accepting)return{state:'online',reason:'healthy',interaction,connected:stamp(snapshot)};
 return{state:'unknown',reason:polling?'runtime_not_ready':'cloud_poll_unverified',interaction};
}

/** Metadata only. The URL, instance identity, response bodies and private paths
 * stay in this Host process; no private source is returned to the renderer.
 */
export function createCloudStatus({healthFile,fetchImpl=globalThis.fetch,now=Date.now,timeoutMs=1200}={}){
 if(typeof fetchImpl!=='function'||typeof now!=='function'||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>2000)throw new Error('Invalid cloud status configuration.');
 const lifetime=new AbortController();let closed=false,pending,cache,lastConnected=null,lastInteraction=null;
 const view=(state,reason,checked)=>({state,source:healthFile===undefined?'none':'official_tunnel_health',reason,checked_at:stamp(checked),last_connected_at:lastConnected,last_interaction_at:lastInteraction});
 async function probe(){
  let result;
  try{
   const url=await endpoint(healthFile);if(closed)throw fault('closed');
   const response=await fetchImpl(url,{redirect:'error',signal:AbortSignal.any([lifetime.signal,AbortSignal.timeout(timeoutMs)]),headers:{accept:'application/json'}});
   if(![200,503].includes(response.status))throw fault('invalid_health');
   result=classify(await boundedJson(response),now());
   if(response.status!==200&&(result.state==='online'||result.reason==='awaiting_first_call'))throw fault('invalid_health');
  }catch(error){
   const missing=error?.code==='ENOENT',refused=error?.cause?.code==='ECONNREFUSED'||error?.code==='ECONNREFUSED';
   result={state:missing||refused?'offline':'unknown',reason:missing?'tunnel_not_running':refused?'tunnel_unavailable':['invalid_reference','invalid_health','mcp_unverified','closed'].includes(error?.reason)?error.reason:'probe_unavailable'};
  }
  const checked=now();if(closed)return view('unknown','closed',checked);
  if(result.connected)lastConnected=result.connected;
  if(result.interaction&&(lastInteraction===null||Date.parse(result.interaction)>Date.parse(lastInteraction)))lastInteraction=result.interaction;
  const value=view(result.state,result.reason,checked);cache={at:checked,value};return value;
 }
 return{
  async read(){
   const checked=now();if(closed)return view('unknown','closed',checked);
   if(healthFile===undefined)return view('not_configured','health_reference_required',checked);
   if(cache&&checked-cache.at>=0&&checked-cache.at<CACHE_MS)return structuredClone(cache.value);
   if(!pending){const current=probe();pending=current;current.finally(()=>{if(pending===current)pending=undefined;}).catch(()=>{});}
   return structuredClone(await pending);
  },
  close(){if(closed)return;closed=true;cache=undefined;lifetime.abort();},
 };
}
