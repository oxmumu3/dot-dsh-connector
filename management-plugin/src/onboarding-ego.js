/** Ego-owned official-page onboarding. No credential/session import or browser fallback. */
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {rename,unlink} from 'node:fs/promises';
import {canonicalPrivatePath,ensurePrivateDirectory,readPrivateStateFile,writeNewPrivateStateFile} from './onboarding-store.js';
import {buildEgoPlatformPhaseScript} from './onboarding-ego-platform.js';
import {buildPluginPhaseScript,buildDotPhaseScript} from './onboarding-ego-plugin.js';
const CODES=new Set(['EGO_BROWSER_UNAVAILABLE','ONBOARDING_EGO_CONTROL','ONBOARDING_EGO_HANDOFF','ONBOARDING_EGO_TIMEOUT','ONBOARDING_EGO_OUTPUT_LIMIT','ONBOARDING_EGO_BUSY','ONBOARDING_EGO_BINDING_RECOVERY','ONBOARDING_EGO_FINALIZATION_RECOVERY','ONBOARDING_PRIVATE_STATE','ONBOARDING_PAGE_CHANGED','ONBOARDING_KEY_RECOVERY','ONBOARDING_AUTH_TIMEOUT','ONBOARDING_AUTH_BROWSER_REJECTED','ONBOARDING_BROWSER_CLOSED','ONBOARDING_DOT_SEND_UNCONFIRMED']);
const fail=code=>Object.assign(new Error(CODES.has(code)?code:'ONBOARDING_PAGE_CHANGED'),{code:CODES.has(code)?code:'ONBOARDING_PAGE_CHANGED'});
const check=signal=>{if(signal?.aborted)throw Object.assign(new Error('Cancelled.'),{name:'AbortError'});};
const plain=value=>value&&Object.getPrototypeOf(value)===Object.prototype;
const id=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);
const request=value=>typeof value==='string'&&/^dsh_connect_[a-f0-9]{32}$/.test(value);
const label=value=>typeof value==='string'&&/^p[1-9][0-9]{0,8}$/.test(value);
const persistent=new Set(['version','installation_id','tunnel_name','plugin_name','plugin_id','tunnel_id','organization_id','workspace_id','tunnel_intent','key_intent','key_saved','key_capture_nonce','plugin_intent','plugin_connected','verification_request_ids','verification_pending_request','verification_uncertain_request']);
const temporary=new Set(['plugin_absence_fingerprint','plugin_absence_since']);
const defaultFiles={ensure:ensurePrivateDirectory,read:readPrivateStateFile,write:writeNewPrivateStateFile,rename,unlink};
const delay=(ms,signal)=>new Promise((resolve,reject)=>{check(signal);const abort=()=>{clearTimeout(timer);reject(Object.assign(new Error('Cancelled.'),{name:'AbortError'}));};const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},ms);signal?.addEventListener('abort',abort,{once:true});});

export function createEgoOnboardingBrowser({directory,runtimeKeyFile,tunnelName,pluginName,installationId,transport:providedTransport,files=defaultFiles,pollMs=1200,waitTimeoutMs=900000,now=Date.now}={}){
 canonicalPrivatePath(directory);canonicalPrivatePath(runtimeKeyFile);
 if(runtimeKeyFile!==join(directory,'runtime.key')||typeof installationId!=='string'||!/^[a-f0-9]{32}$/.test(installationId)||tunnelName!=='dsh-dot-'+installationId||pluginName!=='DeepSeek Harness · '+installationId)throw fail('ONBOARDING_PRIVATE_STATE');
 const bindingFile=join(directory,'ego-binding.json'),intentFile=join(directory,'ego-binding-intent.json'),stateFile=join(directory,'browser-state.json');
 let transport=providedTransport,binding,state,ephemeral={},closed=false,prepared=false,activeRequestId,activePageLabel,completionFlight,authRecoveryAuthorized=false;
 // Explicit Continue permits recovery; every recovery immediately hands off.
 // Errors and handoff revoke that permission before another round can run.
 async function safe(operation){try{return await operation();}catch(error){authRecoveryAuthorized=false;if(error?.name==='AbortError')throw error;throw Object.assign(fail(error?.code),error?.mayHaveLateEffects?{mayHaveLateEffects:true}:{});}}
 function validateState(value){
  if(!plain(value)||Object.keys(value).some(k=>!persistent.has(k))||value.version!==1||value.installation_id!==installationId||value.tunnel_name!==tunnelName||value.plugin_name!==pluginName)throw fail('ONBOARDING_PRIVATE_STATE');
  for(const key of ['plugin_id','tunnel_id','organization_id','workspace_id'])if(value[key]!==undefined&&!id(value[key]))throw fail('ONBOARDING_PRIVATE_STATE');
  for(const key of ['tunnel_intent','key_intent','key_saved','plugin_intent','plugin_connected'])if(value[key]!==undefined&&typeof value[key]!=='boolean')throw fail('ONBOARDING_PRIVATE_STATE');
  if(!Array.isArray(value.verification_request_ids)||value.verification_request_ids.length>32||value.verification_request_ids.some(x=>!request(x)))throw fail('ONBOARDING_PRIVATE_STATE');
  if(value.verification_pending_request!==undefined&&value.verification_pending_request!==null&&!request(value.verification_pending_request))throw fail('ONBOARDING_PRIVATE_STATE');
  if(value.verification_uncertain_request!==undefined&&value.verification_uncertain_request!==null&&!request(value.verification_uncertain_request))throw fail('ONBOARDING_PRIVATE_STATE');
  if(value.key_capture_nonce!==undefined&&!/^[a-f0-9]{32}$/.test(value.key_capture_nonce))throw fail('ONBOARDING_PRIVATE_STATE');
  return value;
 }
 function validateBinding(value){
  const fields=new Set(['version','installation_id','spaceId','platformPage','dotPage','connectionPage','verificationPage','platform_page_intent','connection_page_intent','verification_page_intent','handedOff','finalization','claim_intent','protectedPages']);
  if(!plain(value)||Object.keys(value).some(k=>!fields.has(k))||!Number.isSafeInteger(value.spaceId)||value.spaceId<1||value.version!==undefined&&value.version!==1||value.installation_id!==undefined&&value.installation_id!==installationId)throw fail('ONBOARDING_PRIVATE_STATE');
  if(value.finalization!==undefined&&!['pending','finished','reopening'].includes(value.finalization))throw fail('ONBOARDING_PRIVATE_STATE');
  if(!['finished','reopening'].includes(value.finalization)&&!label(value.platformPage))throw fail('ONBOARDING_PRIVATE_STATE');
  for(const key of ['platformPage','dotPage','connectionPage','verificationPage'])if(value[key]!==undefined&&!label(value[key]))throw fail('ONBOARDING_PRIVATE_STATE');
  for(const key of ['platform_page_intent','connection_page_intent','verification_page_intent','handedOff','claim_intent'])if(value[key]!==undefined&&typeof value[key]!=='boolean')throw fail('ONBOARDING_PRIVATE_STATE');
  if(value.protectedPages!==undefined&&(!Array.isArray(value.protectedPages)||value.protectedPages.length>100||value.protectedPages.some(page=>!label(page))||new Set(value.protectedPages).size!==value.protectedPages.length))throw fail('ONBOARDING_PRIVATE_STATE');
  if(value.connectionPage&&[value.platformPage,value.dotPage].includes(value.connectionPage)||value.verificationPage&&[value.platformPage,value.dotPage,value.connectionPage].includes(value.verificationPage))throw fail('ONBOARDING_PRIVATE_STATE');
  if([value.platformPage,value.connectionPage,value.verificationPage].some(page=>page&&value.protectedPages?.includes(page)))throw fail('ONBOARDING_PRIVATE_STATE');
  return value;
 }
 async function read(path){try{return JSON.parse(await files.read(path));}catch(e){if(e.code==='ENOENT')return;throw fail('ONBOARDING_PRIVATE_STATE');}}
 async function write(path,value){await files.ensure(directory);const temp=join(directory,'ego-'+randomBytes(12).toString('hex')+'.tmp');try{await files.write(temp,JSON.stringify(value)+'\n');await files.rename(temp,path);}finally{await files.unlink(temp).catch(()=>{});}}
 async function save(patch){
  if(!plain(patch)||Object.keys(patch).some(k=>!persistent.has(k)&&!temporary.has(k)))throw fail('ONBOARDING_PRIVATE_STATE');
  const stable={};for(const[k,value]of Object.entries(patch)){if(temporary.has(k)){if(k==='plugin_absence_since'&&value!==null&&(!Number.isFinite(value)||value<0))throw fail('ONBOARDING_PRIVATE_STATE');if(k==='plugin_absence_fingerprint'&&value!==null&&(typeof value!=='string'||value.length>16384||!/^[/A-Za-z0-9_|-]*$/.test(value)))throw fail('ONBOARDING_PRIVATE_STATE');ephemeral[k]=value;}else stable[k]=value;}
  const next=validateState({...state,...stable});if(JSON.stringify(next)!==JSON.stringify(state)){await write(stateFile,next);state=next;}
 }
 async function run(script,pageLabel,signal){check(signal);if(closed)throw fail('ONBOARDING_BROWSER_CLOSED');activePageLabel=pageLabel;return transport.run({spaceId:binding.spaceId,pageLabel,script,signal});}
 async function hasKey(){try{return Boolean((await files.read(runtimeKeyFile,4096)).trim());}catch(e){if(e.code==='ENOENT')return false;throw fail('ONBOARDING_PRIVATE_STATE');}}
 async function dedicated(kind,signal){const field=kind+'Page',intent=kind+'_page_intent';if(binding[field])return binding[field];if(binding[intent])throw fail(binding.finalization==='reopening'?'ONBOARDING_EGO_FINALIZATION_RECOVERY':'ONBOARDING_EGO_BINDING_RECOVERY');binding={...binding,[intent]:true};await write(bindingFile,binding);const receipt=await transport.createPage({spaceId:binding.spaceId,kind,signal});if(!label(receipt?.pageLabel))throw fail('ONBOARDING_PRIVATE_STATE');binding=validateBinding({...binding,[field]:receipt.pageLabel,[intent]:false});await write(bindingFile,binding);return binding[field];}
 async function reopen(signal){
  if(binding.finalization==='reopening'&&['platform','connection','verification'].some(kind=>binding[kind+'_page_intent']&&!binding[kind+'Page']))throw fail('ONBOARDING_EGO_FINALIZATION_RECOVERY');
  if(binding.finalization==='finished'){
   if(binding.claim_intent)throw fail('ONBOARDING_EGO_FINALIZATION_RECOVERY');
   binding={...binding,claim_intent:true};await write(bindingFile,binding);
   const claimed=await transport.claimBinding({spaceId:binding.spaceId,signal});
   if(claimed?.spaceId!==binding.spaceId||claimed?.claimed!==true||!Array.isArray(claimed.protectedPages))throw fail('ONBOARDING_EGO_FINALIZATION_RECOVERY');
   binding=validateBinding({version:1,installation_id:installationId,spaceId:binding.spaceId,finalization:'reopening',protectedPages:claimed.protectedPages});await write(bindingFile,binding);
  }else if(transport.resumeBinding)await transport.resumeBinding({spaceId:binding.spaceId,signal});
  for(const kind of ['platform','connection','verification'])await dedicated(kind,signal);
  const {finalization,...active}=binding;binding=validateBinding(active);await write(bindingFile,binding);
 }
 function progress(onProgress,receipt){const step=receipt?.step;if(['platform_login','tunnel_scope','tunnel_confirm','key_project','key_confirm','chatgpt_login','plugin_confirm','plugin_connect','dot_verify'].includes(step))onProgress?.({step});}
 async function handOff(signal){authRecoveryAuthorized=false;binding={...binding,handedOff:true};await write(bindingFile,binding);await transport.handOffBinding({spaceId:binding.spaceId,signal});throw fail('ONBOARDING_EGO_HANDOFF');}
 async function loop(build,pageLabel,{signal,onProgress,accept}={}){const until=now()+waitTimeoutMs;do{check(signal);const result=await run(build(),pageLabel,signal);if(!plain(result))throw fail('ONBOARDING_PAGE_CHANGED');if(result.patch)await save(result.patch);progress(onProgress,result);const answer=await accept(result);if(answer!==undefined)return answer;if(result.waiting_for||result.step==='chatgpt_login')await handOff(signal);await delay(pollMs,signal);}while(now()<until);throw fail('ONBOARDING_AUTH_TIMEOUT');}
 const api={
  async prepare({signal,onProgress,resumeAuthorized=false}={}){return safe(async()=>{check(signal);authRecoveryAuthorized=resumeAuthorized===true;if(prepared&&!closed)return{prepared:true};await files.ensure(directory);transport??=(await import('./onboarding-ego-transport.js')).createEgoTransport();state=validateState(await read(stateFile)??{version:1,installation_id:installationId,tunnel_name:tunnelName,plugin_name:pluginName,verification_request_ids:[]});binding=await read(bindingFile);
   if(binding)binding=validateBinding(binding);else{if(await read(intentFile))throw fail('ONBOARDING_EGO_BINDING_RECOVERY');await files.write(intentFile,JSON.stringify({version:1,installation_id:installationId})+'\n');let created;try{created=await transport.createBinding({name:'Harness Dot · '+installationId,signal});}catch(error){if(error?.code==='EGO_BROWSER_UNAVAILABLE'&&!error.mayHaveLateEffects)await files.unlink(intentFile);throw error;}binding=validateBinding({version:1,installation_id:installationId,...created});await write(bindingFile,binding);await files.unlink(intentFile);}
   if(binding.finalization){if(binding.finalization==='pending'||!resumeAuthorized)throw fail('ONBOARDING_EGO_FINALIZATION_RECOVERY');await reopen(signal);}
   else{if(binding.handedOff&&!resumeAuthorized)throw fail('ONBOARDING_EGO_HANDOFF');
    if(resumeAuthorized&&transport.resumeBinding){await transport.resumeBinding({spaceId:binding.spaceId,handedOff:binding.handedOff===true,signal});if(binding.handedOff){binding={...binding,handedOff:false};await write(bindingFile,binding);}}}
   closed=false;onProgress?.({phase:'preparing'});await run('/* ego-prepare: read only, preserve current draft */ await page.url(); return {status:"prepared"};',binding.platformPage,signal);prepared=true;completionFlight=undefined;return{prepared:true};});},
  async provision({signal,onProgress}={}){return safe(async()=>{if(!prepared)throw fail('ONBOARDING_BROWSER_CLOSED');if(await hasKey()){if(!state.key_saved||!state.tunnel_id)throw fail('ONBOARDING_KEY_RECOVERY');return receipt();}
   return loop(()=>buildEgoPlatformPhaseScript({directory,runtimeKeyFile,tunnelName,installationId,state,recoverRejected:authRecoveryAuthorized}),binding.platformPage,{signal,onProgress,accept:async result=>{
    if(result.status==='tunnel_ready'){if(result.tunnel_name!==tunnelName||!/^tunnel_[A-Za-z0-9_-]{8,128}$/.test(result.tunnel_id??'')||!id(result.workspace_id))throw fail('ONBOARDING_PRIVATE_STATE');if(state.tunnel_id&&state.tunnel_id!==result.tunnel_id)throw fail('ONBOARDING_PRIVATE_STATE');await save({tunnel_id:result.tunnel_id,...result.organization_id?{organization_id:result.organization_id}:{},workspace_id:result.workspace_id});}
    if(result.status==='key_saved'){if(!state.tunnel_id||!await hasKey())throw fail('ONBOARDING_PRIVATE_STATE');await save({key_saved:true});return receipt();}
   }});});},
  async connectPlugin({tunnel_id,signal,onProgress}={}){return safe(async()=>{if(!prepared||tunnel_id!==state.tunnel_id)throw fail('ONBOARDING_PRIVATE_STATE');const pageLabel=await dedicated('connection',signal);return loop(()=>buildPluginPhaseScript({pluginName,tunnelId:tunnel_id,state:{...state,...ephemeral},allowNavigate:true,recoverRejected:authRecoveryAuthorized}),pageLabel,{signal,onProgress,accept:async result=>{if(result.status==='connected'){const pluginId=result.plugin_id??result.patch?.plugin_id??state.plugin_id;if(!/^plugin_asdk_app_[A-Za-z0-9_-]+$/.test(pluginId??''))throw fail('ONBOARDING_PRIVATE_STATE');await save({plugin_id:pluginId,plugin_connected:true});return{connected:true,plugin_id:pluginId,plugin_name:pluginName};}}});});},
  async verifyDot({requestId,forceResend=false,signal,onProgress}={}){return safe(async()=>{
   if(!request(requestId)||typeof forceResend!=='boolean')throw fail('ONBOARDING_PRIVATE_STATE');activeRequestId=requestId;
   const previouslySent=state.verification_request_ids.includes(requestId);
   if(state.verification_uncertain_request===requestId)return{sent:false,uncertain:true};
   // A persisted retry intent from an earlier invocation has an unknown outcome.
   // Its original confirmed transcript cannot acknowledge this later send.
   if(previouslySent&&state.verification_pending_request===requestId){await save({verification_uncertain_request:requestId});return{sent:false,uncertain:true};}
   if(previouslySent&&!forceResend)return{sent:true};
   const pageLabel=await dedicated('verification',signal);
   try{return await loop(()=>buildDotPhaseScript({pluginName,requestId,mode:'verify',state,allowNavigate:true,forceResend,recoverRejected:authRecoveryAuthorized}),pageLabel,{signal,onProgress,accept:async result=>{if(result.status==='sent')return{sent:true};if(result.step==='dot_send_unconfirmed'){await save({verification_uncertain_request:requestId});return{sent:false,uncertain:true};}}});}
   catch(error){if(error?.mayHaveLateEffects&&state.verification_pending_request===requestId){await save({verification_uncertain_request:requestId});return{sent:false,uncertain:true};}throw error;}
  });},
  async pendingAction({signal,onProgress}={}){return safe(async()=>{if(!binding?.verificationPage)return;const requestId=activeRequestId??state.verification_pending_request??state.verification_request_ids.at(-1);if(!requestId)return;const result=await run(buildDotPhaseScript({pluginName,requestId,mode:'pending',state}),binding.verificationPage,signal);progress(onProgress,result);if(result.status==='approval'||result.step==='dot_tool_approval'||result.step==='chatgpt_login')await handOff(signal);return undefined;});},
  async focus(){return safe(async()=>{if(!prepared||closed)throw fail('ONBOARDING_BROWSER_CLOSED');await run('await page.cdp("Page.bringToFront", {}, {timeout:5000}); return {status:"prepared"};',activePageLabel??binding.verificationPage??binding.connectionPage??binding.platformPage);});},
  async complete({signal}={}){
   completionFlight??=safe(async()=>{
    check(signal);if(binding?.finalization==='finished')return{completed:true};
    if(binding?.finalization||!prepared||closed||!binding.verificationPage||state.plugin_connected!==true)throw fail('ONBOARDING_EGO_FINALIZATION_RECOVERY');
    const keep=[...new Set([...(binding.protectedPages??[]),binding.dotPage,binding.verificationPage].filter(Boolean))];
    binding={...binding,finalization:'pending'};await write(bindingFile,binding);prepared=false;closed=true;
    const result=await transport.finishBinding({spaceId:binding.spaceId,keep,signal});
    if(result?.spaceId!==binding.spaceId||result?.finished!==true)throw fail('ONBOARDING_EGO_FINALIZATION_RECOVERY');
    binding={version:1,installation_id:installationId,spaceId:binding.spaceId,finalization:'finished'};await write(bindingFile,binding);prepared=false;closed=true;return{completed:true};
   });return completionFlight;
  },
  async close(){closed=true;prepared=false;authRecoveryAuthorized=false;/* Detach only; completion has its own durable lifecycle. */},
 };
 function receipt(){return{tunnel_id:state.tunnel_id,tunnel_name:tunnelName,...state.organization_id?{organization_id:state.organization_id}:{},...state.workspace_id?{workspace_id:state.workspace_id}:{}};}
 return api;
}
