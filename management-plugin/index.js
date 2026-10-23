import {open,realpath} from 'node:fs/promises';
import {constants} from 'node:fs';
import {isAbsolute,resolve} from 'node:path';
import {z} from 'zod';
import {createManagementRemote} from './src/remote.js';
import {createManagedRuntime,externalSetupStatus} from './src/setup-runtime.js';
import {createOnboardingRuntime,externalConnectionStatus} from './src/onboarding-runtime.js';

export const name='dot-dsh-management';
export const inject=['typert'];
const configuration=z.union([z.strictObject({enabled:z.literal(true),tokenFile:z.string().refine(isAbsolute)}),z.strictObject({enabled:z.literal(true).optional(),dshHome:z.string().refine(isAbsolute).optional(),dataDir:z.string().refine(isAbsolute).optional(),cloudHealthFile:z.string().refine(value=>isAbsolute(value)&&resolve(value)===value&&!value.includes('\0')&&!value.includes('\\')).optional()})]);
const methods=createManagementRemote(z).methods;
const byTool=new Map(Object.entries(methods).filter(([,definition])=>!definition.tool.startsWith('manager_setup_')).map(([method,definition])=>[definition.tool,{method,...definition}]));
const fail=code=>Object.assign(new Error(code==='INVALID_CONFIG'?'Invalid management configuration.':code==='INVALID_REQUEST'?'Invalid management request.':code==='PRIVATE_TOKEN_REQUIRED'?'A private token file is required.':code==='MANAGEMENT_BUSY'?'Management service is busy. Retry shortly.':code==='UNSUPPORTED'?'This management service does not support this operation.':'Management service is unavailable or the operation failed.'),{code});

async function privateToken(tokenFile){
 if(typeof tokenFile!=='string'||!isAbsolute(tokenFile)||resolve(tokenFile)!==tokenFile)throw fail('INVALID_CONFIG');
 let handle;
 try{
  if(await realpath(tokenFile)!==tokenFile)throw fail('PRIVATE_TOKEN_REQUIRED');
  handle=await open(tokenFile,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  const stat=await handle.stat();
  if(!stat.isFile()||stat.nlink!==1||(stat.mode&0o077)!==0||stat.size<32||stat.size>1024)throw fail('PRIVATE_TOKEN_REQUIRED');
  const bytes=Buffer.alloc(1025);const {bytesRead}=await handle.read(bytes,0,bytes.length,0);
  if(bytesRead>1024)throw fail('PRIVATE_TOKEN_REQUIRED');
  const token=bytes.subarray(0,bytesRead).toString('utf8').trim();
  if(token.length<32||token.length>512||!/^[A-Za-z0-9._~+/=-]+$/.test(token))throw fail('PRIVATE_TOKEN_REQUIRED');
  return token;
 }catch{throw fail('PRIVATE_TOKEN_REQUIRED');}finally{await handle?.close();}
}

/** Trusted Node-only adapter. Neither the reference nor value enters Client code. */
export async function createAdminAdapter({tokenFile,url='http://127.0.0.1:31473/rpc',fetchImpl=globalThis.fetch}={}){
 if(typeof url!=='string'||!/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}\/rpc$/.test(url)||Number(new URL(url).port)>65535)throw fail('INVALID_CONFIG');
 if(typeof tokenFile!=='string'||!isAbsolute(tokenFile))throw fail('INVALID_CONFIG');
 let token=await privateToken(tokenFile),closed=false,protocol,handshake;
 const lifetime=new AbortController(),offers=new Map();
 const features=['task_filters','archive','followup','worker_poll'];
 const legacy={version:1,features:Object.fromEntries(features.map(key=>[key,false]))};
 const protocolSchema=z.strictObject({version:z.literal(2),features:z.strictObject(Object.fromEntries(features.map(key=>[key,z.boolean()]))) });
 const captureOffer=value=>{const offer=value?.native_control;if(offer&&typeof offer.command_id==='string'&&typeof offer.claim_token==='string'&&offer.claim_token.length<=512&&Number.isFinite(Date.parse(offer.expires_at))&&Date.parse(offer.expires_at)>Date.now()&&offers.size<100)offers.set(offer.command_id,{command_id:offer.command_id,claim_token:offer.claim_token,expires_at:offer.expires_at});};
 const takeOffer=()=>{for(const [id,offer]of offers){offers.delete(id);if(Date.parse(offer.expires_at)>Date.now())return offer;}return null;};
 const protocolView=()=>({version:protocol.version,features:{...protocol.features}});
 const acceptOverview=value=>{
  if(!value||typeof value!=='object'||Array.isArray(value)||!value.connection||typeof value.connection!=='object')throw fail('UNAVAILABLE');
  const parsed=value.management_protocol===undefined?{success:true,data:legacy}:protocolSchema.safeParse(value.management_protocol);
  if(!parsed.success||closed)throw fail('UNAVAILABLE');protocol=parsed.data;captureOffer(value);
 };
 async function request(tool,args,signal){
  if(closed)throw fail('UNAVAILABLE');
  try{
   const response=await fetchImpl(url,{
    method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`},
    body:JSON.stringify({tool,args}),redirect:'error',
    signal:AbortSignal.any([lifetime.signal,AbortSignal.timeout(10000),...(signal?[signal]:[])]),
   });
   const reader=response.body?.getReader();if(!reader)throw fail('UNAVAILABLE');
   let bytes=0;const chunks=[];
   try{while(true){const frame=await reader.read();if(frame.done)break;bytes+=frame.value.byteLength;if(bytes>1024*1024)throw fail('UNAVAILABLE');chunks.push(frame.value);}}
   finally{await reader.cancel().catch(()=>{});}
   const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));
   if(response.status===429&&value?.error?.code==='MANAGEMENT_BUSY')throw fail('MANAGEMENT_BUSY');
   if(!response.ok||!value||Object.getPrototypeOf(value)!==Object.prototype||Object.keys(value).length!==1||!Object.hasOwn(value,'result'))throw fail('UNAVAILABLE');
   return z.json().parse(value.result);
  }catch(error){throw fail(error?.code==='MANAGEMENT_BUSY'?'MANAGEMENT_BUSY':'UNAVAILABLE');}
 }
 async function negotiate(signal){
  if(protocol)return null;
  if(!handshake){const pending=(async()=>{
   const value=await request('manager_overview',{},signal);
   acceptOverview(value);return value;
  })();handshake=pending;pending.finally(()=>{if(handshake===pending)handshake=undefined;}).catch(()=>{});}
  return handshake;
 }
 return {
  async call(tool,args,signal){
   if(closed)throw fail('UNAVAILABLE');
   const definition=byTool.get(tool),parsed=definition?.schema.safeParse(args);
   if(!parsed?.success)throw fail('INVALID_REQUEST');
   args=parsed.data;
   if(!['manager_overview','manager_jobs','manager_worker_poll','manager_archive','manager_followup'].includes(tool))return request(tool,args,signal);
   const initial=await negotiate(signal);
   if(tool==='manager_overview'){
    const value=initial??await request(tool,protocol.version===1?{}:args,signal);if(!initial)acceptOverview(value);
    const {native_control,...view}=value;
    return{...view,management_protocol:protocolView(),...args.include_control===false?{}:{native_control:takeOffer()}};
   }
   if(tool==='manager_worker_poll'){
    const saved=takeOffer();if(saved)return{native_control:saved,management_protocol:protocolView()};
    if(protocol.features.worker_poll)return request(tool,args,signal);
    const value=await request('manager_overview',{},signal);acceptOverview(value);const {native_control,...view}=value;return{...view,native_control:takeOffer(),management_protocol:protocolView()};
   }
   if(tool==='manager_jobs'&&!protocol.features.task_filters){
    if(args.archived===true||args.workspace_id!==undefined||args.request_id!==undefined)throw fail('UNSUPPORTED');
    const {archived,...rest}=args;return request(tool,rest,signal);
   }
   if(tool==='manager_archive'&&!protocol.features.archive||tool==='manager_followup'&&!protocol.features.followup)throw fail('UNSUPPORTED');
   return request(tool,args,signal);
  },
  close(){if(closed)return;closed=true;token='';offers.clear();lifetime.abort();},
 };
}

/** One shared trusted adapter per managed generation; disposal also rejects late acquisition. */
export function createManagedAdapter(runtime,{createAdapter=createAdminAdapter}={}){
 let adapter,pending,generation=0,closed=false;
 const reset=()=>{generation++;adapter?.close();adapter=undefined;pending=undefined;};
 return{reset,close(){closed=true;reset();},async call(tool,args,signal){
  if(closed)throw fail('UNAVAILABLE');
  if(!adapter){if(!pending){const current=generation;const acquiring=(async()=>{const value=await createAdapter(await runtime.adminReference());if(closed||generation!==current){value.close();throw fail('UNAVAILABLE');}adapter=value;return value;})();pending=acquiring;acquiring.finally(()=>{if(pending===acquiring)pending=undefined;}).catch(()=>{});}await pending;}
  if(closed||!adapter)throw fail('UNAVAILABLE');const current=generation,value=await adapter.call(tool,args,signal);
  if(closed||generation!==current)throw fail('UNAVAILABLE');
  if(tool==='manager_worker_poll'){const url=await runtime.nativeWorkerReference();if(closed||generation!==current)throw fail('UNAVAILABLE');return{...value,native_worker_url:url};}
  return value;
 }};
}

/** Install a native Remote face only; all operations stay in the independent gateway. */
export async function mountManagement(ctx,adapter,{TypertRemoteService,RemoteError},{setup}={}){
 const remote=createManagementRemote(z);
 class ManagementService extends TypertRemoteService{
  constructor(scope){super(scope,'dotDshManagement');}
 }
 for(const [method,{tool,schema}]of Object.entries(remote.methods)){
  Object.defineProperty(ManagementService.prototype,method,{value:async function(request,signal){
   if(this.ctx.invocation?.peer?.principal?.kind!=='owner')throw new RemoteError('dot-management/denied','Only the local owner may manage this connection.',{});
   const parsed=schema.safeParse(request);if(!parsed.success)throw new RemoteError('dot-management/invalid-request','Invalid management request.',{});
   try{
    if(tool.startsWith('manager_setup_')){const operation=tool.slice('manager_setup_'.length);if(!setup){if(operation==='status')return{...externalSetupStatus(),connection_setup:externalConnectionStatus()};if(operation.startsWith('connect_'))return externalConnectionStatus();}if(!setup||typeof setup[operation]!=='function')throw fail('INVALID_REQUEST');return await setup[operation]();}
    return await adapter.call(tool,parsed.data,signal);
   }catch(error){throw new RemoteError(error?.code==='MANAGEMENT_BUSY'?'dot-management/busy':error?.code==='UNSUPPORTED'?'dot-management/unsupported':'dot-management/unavailable',error?.code==='MANAGEMENT_BUSY'?'Management service is busy. Retry shortly.':error?.code==='UNSUPPORTED'?'This management service does not support this operation.':'Management service is unavailable or the operation failed.',{});}
  }});
 }
 const service=new ManagementService(ctx);
 ctx.typert.register({package:remote.package,face:'host',schemas:[],invocations:remote.descriptors,model:{services:[],events:[],objects:[]}});
 return service;
}

/** Default mount exposes setup only. Existing tokenFile deployments remain external. */
export async function apply(ctx,options={}){
 if(options.enabled===false)return;
 const parsed=configuration.safeParse(options);if(!parsed.success)throw fail('INVALID_CONFIG');
 if(typeof ctx?.effect!=='function'||typeof ctx?.typert?.register!=='function')throw fail('INVALID_CONFIG');
 let adapter,runtime,localAdapter,onboarding,closed=false;
 // Cordis invokes this disposer for disable, update and uninstall. No foreign resource is owned.
 ctx.effect(()=>async()=>{closed=true;await onboarding?.close();adapter?.close();localAdapter?.close();await runtime?.close();});
 try{
  const sdk=await import('@deepseek-ai/dsh-typert-protocol');if(closed)throw fail('UNAVAILABLE');
  if(parsed.data.tokenFile){
   adapter=await createAdminAdapter(parsed.data);if(closed){adapter.close();throw fail('UNAVAILABLE');}
   await mountManagement(ctx,adapter,sdk);return;
  }
  runtime=createManagedRuntime(parsed.data);
  localAdapter=createManagedAdapter(runtime);
  onboarding=createOnboardingRuntime({local:runtime,call:(tool,args,signal)=>localAdapter.call(tool,args,signal)});
  const setup={status:async()=>({...await runtime.status(),connection_setup:await onboarding.status()}),prepare:()=>runtime.prepare(),start:async()=>{localAdapter.reset();return runtime.start();},stop:async()=>{await onboarding.cancel();localAdapter.reset();return runtime.stop();},...Object.fromEntries(['status','start','resume','cancel','open'].map(operation=>['connect_'+operation,()=>onboarding[operation]()]))};
  await mountManagement(ctx,localAdapter,sdk,{setup});
  if(closed)throw fail('UNAVAILABLE');await runtime.resume();if(!closed)await onboarding.restore();
 }catch(error){await onboarding?.close();adapter?.close();localAdapter?.close();await runtime?.close();throw error;}
}
