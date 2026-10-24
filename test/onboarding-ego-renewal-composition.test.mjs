import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtemp,realpath,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createEgoTransport} from '../management-plugin/src/onboarding-ego-transport.js';
import {createEgoOnboardingBrowser} from '../management-plugin/src/onboarding-ego.js';
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;

test('actual renewal phase passes typed transport, stops for the grant, captures privately, and resumes without another grant',async()=>{
 const directory=await realpath(await mkdtemp(join(tmpdir(),'dsh-synthetic-renewal-'))),installationId='a'.repeat(32),renewalId='c'.repeat(32),runtimeKeyFile=join(directory,'runtime.key'),tunnelName='dsh-dot-'+installationId,pluginName='DeepSeek Harness · '+installationId;
 const initial={version:1,installation_id:installationId,tunnel_name:tunnelName,plugin_name:pluginName,tunnel_id:'tunnel_1234567890abcdef',workspace_id:'12345678-1234-1234-1234-123456789012',plugin_connected:true,key_saved:true,verification_request_ids:['dsh_connect_'+'b'.repeat(32)]};
 const original='sk-'+ 'o'.repeat(32),candidate='sk-'+ 'n'.repeat(32),markerName='__dsh_ego_key_'+installationId+'_'+renewalId;
 for(const[name,value]of [['browser-state.json',JSON.stringify(initial)],['ego-binding.json',JSON.stringify({spaceId:110,platformPage:'p2',dotPage:'p1',verificationPage:'p4'})],['runtime.key',original+'\n']])await writeFile(join(directory,name),value,{mode:0o600});
 const previous={document:globalThis.document,location:globalThis.location,getComputedStyle:globalThis.getComputedStyle};let mode='draft',handedOff=false,handoffs=0,resumes=0,finishes=0,phaseCalls=0;const output=[];
 const dialog={getClientRects:()=>[{}],querySelectorAll:s=>s.startsWith('h1')?[{textContent:'Save your key'}]:s.startsWith('input[readonly]')?[{value:candidate}]:[]};
 globalThis.document={querySelectorAll:()=>[dialog],removeEventListener:()=>{}};globalThis.location={origin:'https://platform.openai.com'};globalThis.getComputedStyle=()=>({visibility:'visible'});
 const page={url:async()=>{if(handedOff)throw Object.assign(Error(),{code:'EGO_USER_CONTROL'});return'https://platform.openai.com/settings/organization/api-keys';},evaluate:async(fn,input)=>{
  if(fn.name==='inspectPlatform'){phaseCalls++;return{kind:mode==='draft'?'key_ready':'key_saved_dialog'};}
  if(fn.name==='armEgoKeyCapture'){assert.equal(input.markerName,markerName);globalThis[markerName]={nonce:input.nonce,armed:false,creationObservedAt:null,listener:()=>{}};return true;}
  return fn(input);
 }};
 const space={spaceId:110,page:label=>{assert.equal(label,'p2');return page;},handOff:async()=>{handoffs++;handedOff=true;},pages:async()=>['p1','p2','p4'].map(label=>({label})),finish:async({keep})=>{assert.deepEqual(keep,['p1','p4']);finishes++;}};
 const spawnImpl=()=>{const child=new EventEmitter();child.pid=12345;child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.stdin=new EventEmitter();child.kill=()=>{};child.stdin.end=script=>queueMicrotask(async()=>{try{await new AsyncFunction('taskSpace','takeOverTaskSpace','listTaskSpaces','console',script)(async()=>space,async id=>{assert.equal(id,110);resumes++;handedOff=false;return space;},async()=>[{id:110,name:'Owned'}],{log:value=>{output.push(value);child.stderr.emit('data',Buffer.from(value+'\n'));}});child.emit('close',0);}catch(error){child.stderr.emit('data',Buffer.from(String(error.code)));child.emit('close',1);}});return child;};
 const transport=createEgoTransport({executablePath:'/synthetic/ego-browser',spawnImpl,lstatImpl:async()=>({isFile:()=>true,isSymbolicLink:()=>false,mode:0o100755,uid:process.getuid?.()}),realpathImpl:async path=>path});
 const browser=createEgoOnboardingBrowser({directory,runtimeKeyFile,installationId,tunnelName,pluginName,transport,pollMs:0,waitTimeoutMs:2000});
 try{
  await browser.prepare({purpose:'key-renewal'});await assert.rejects(browser.renewRuntimeKey({renewalId}),{code:'ONBOARDING_EGO_HANDOFF'});assert.equal(handoffs,1);
  const intent=JSON.parse(await readFile(join(directory,'key-renewal.json'),'utf8'));assert.equal(intent.key_capture_nonce,globalThis[markerName].nonce);assert.equal(intent.key_intent,true);
  await assert.rejects(browser.renewRuntimeKey({renewalId}),{code:'ONBOARDING_EGO_HANDOFF'});assert.equal(phaseCalls,1);
  // Simulates only the already-authorized person's final button click; no browser runs.
  globalThis[markerName].armed=true;globalThis[markerName].creationObservedAt=Date.now()-1000;mode='saved';
  await browser.close();await browser.prepare({purpose:'key-renewal',resumeAuthorized:true});assert.equal(resumes,1);const receipt=await browser.renewRuntimeKey({renewalId});assert.equal(receipt.candidate_saved,true);assert.equal(receipt.expiry_source,'creation_observed');assert.equal(receipt.renewal_id,renewalId);
  assert.equal(await readFile(runtimeKeyFile,'utf8'),original+'\n');assert.equal(await readFile(join(directory,'runtime-next-'+renewalId+'.key'),'utf8'),candidate+'\n');assert.deepEqual(JSON.parse(await readFile(join(directory,'browser-state.json'),'utf8')),initial);
  const before=phaseCalls;assert.deepEqual(await browser.renewRuntimeKey({renewalId}),receipt);assert.equal(phaseCalls,before);await browser.complete();assert.equal(finishes,1);assert.equal(handoffs,1);assert.doesNotMatch(output.join('\n'),/sk-[no]{32}/);
 }finally{await browser.close();delete globalThis[markerName];for(const[k,v]of Object.entries(previous)){if(v===undefined)delete globalThis[k];else globalThis[k]=v;}await rm(directory,{recursive:true,force:true});}
});
