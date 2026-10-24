import {test} from 'node:test';import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';
import {createEgoTransport} from '../management-plugin/src/onboarding-ego-transport.js';import {createEgoOnboardingBrowser} from '../management-plugin/src/onboarding-ego.js';
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const directory='/private/synthetic/ego',installationId='a'.repeat(32),pluginName='DeepSeek Harness · '+installationId,tunnelName='dsh-dot-'+installationId,requestId='dsh_connect_'+'b'.repeat(32);
function fixture({observed={kind:'key_ready'},pageUrl='https://platform.openai.com/settings/organization/api-keys',state={},binding={spaceId:110,platformPage:'p2',dotPage:'p1'}}={}){
 const values=new Map([[directory+'/ego-binding.json',JSON.stringify(binding)],[directory+'/browser-state.json',JSON.stringify({version:1,installation_id:installationId,plugin_name:pluginName,tunnel_name:tunnelName,tunnel_id:'tunnel_1234567890abcdef',workspace_id:'12345678-1234-1234-1234-123456789012',verification_request_ids:[],...state})]]);const calls=[];let handedOff=0,tookOver=0,claimed=0,afterHandoff=false;
 const files={ensure:async()=>{},read:async p=>{if(!values.has(p))throw Object.assign(Error(),{code:'ENOENT'});return values.get(p);},write:async(p,v)=>{if(values.has(p))throw Object.assign(Error(),{code:'EEXIST'});values.set(p,v);},rename:async(a,b)=>{values.set(b,values.get(a));values.delete(a);},unlink:async p=>values.delete(p)};
 const page={url:async()=>{if(afterHandoff)throw Object.assign(Error(),{code:'EGO_USER_CONTROL'});return pageUrl;},evaluate:async fn=>fn.name==='inspectPlatform'||fn.name==='inspectPage'?observed:fn.name==='armEgoKeyCapture'?true:undefined,click:async()=>{throw Error('unconfirmed page action');},fill:async()=>{},cdp:async()=>{}};
 const space={spaceId:110,page:()=>page,handOff:async()=>{handedOff++;afterHandoff=true;}};
 const spawnImpl=(command,args,options)=>{const child=new EventEmitter();child.pid=11111;child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.stdin=new EventEmitter();child.kill=()=>{};child.stdin.end=script=>{calls.push(script);queueMicrotask(async()=>{try{await new AsyncFunction('taskSpace','takeOverTaskSpace','claimTaskSpace','listTaskSpaces','console',script)(async()=>space,async()=>{tookOver++;afterHandoff=false;return space;},async id=>{assert.equal(id,110);claimed++;afterHandoff=false;return space;},async()=>[{id:110,name:'Owned'}],{log:value=>child.stdout.emit('data',Buffer.from(value+'\n'))});child.emit('close',0);}catch(e){child.stderr.emit('data',Buffer.from(String(e.code)));child.emit('close',1);}});};return child;};
 const transport=createEgoTransport({executablePath:'/synthetic/ego-browser',spawnImpl,lstatImpl:async()=>({isFile:()=>true,isSymbolicLink:()=>false,mode:0o100755,uid:process.getuid?.()}),realpathImpl:async p=>p});
 // Multiple real wrapper rounds must not depend on a 50 ms wall-clock budget.
 const browser=createEgoOnboardingBrowser({directory,runtimeKeyFile:directory+'/runtime.key',installationId,tunnelName,pluginName,transport,files,pollMs:0,waitTimeoutMs:2000});return{browser,values,calls,page,space,setObserved:v=>observed=v,count:()=>({handedOff,tookOver,claimed})};
}
test('real platform plan and transport preserve nonce then hand off once; explicit resume takes same Space back',async()=>{
 const f=fixture();await f.browser.prepare();await assert.rejects(f.browser.provision(),{code:'ONBOARDING_EGO_HANDOFF'});
 const state=JSON.parse(f.values.get(directory+'/browser-state.json'));assert.match(state.key_capture_nonce,/^[a-f0-9]{32}$/);assert.equal(state.key_intent,true);assert.equal(JSON.parse(f.values.get(directory+'/ego-binding.json')).handedOff,true);assert.equal(f.count().handedOff,1);
 const count=f.calls.length;await new Promise(r=>setTimeout(r,5));assert.equal(f.calls.length,count);await f.browser.close();await f.browser.prepare({resumeAuthorized:true});assert.equal(f.count().tookOver,1);assert.equal(JSON.parse(f.values.get(directory+'/ego-binding.json')).handedOff,false);
});
test('real provider and transport recover a rejected login only after explicit Continue and stop for the person',async()=>{
 for(const stage of ['platform','plugin','dot']){
  const f=fixture({pageUrl:'https://accounts.google.com/v3/signin/rejected?private=synthetic',binding:{spaceId:110,platformPage:'p2',dotPage:'p1',connectionPage:'p3',verificationPage:'p4'}}),navigated=[];
  f.page.goto=async url=>navigated.push(url);
  const run=()=>stage==='platform'?f.browser.provision():stage==='plugin'?f.browser.connectPlugin({tunnel_id:'tunnel_1234567890abcdef'}):f.browser.verifyDot({requestId});
  await f.browser.prepare();await assert.rejects(run(),{code:'ONBOARDING_AUTH_BROWSER_REJECTED'});assert.deepEqual(navigated,[]);assert.equal(f.count().handedOff,0);
  await f.browser.close();await f.browser.prepare({resumeAuthorized:true});await assert.rejects(run(),{code:'ONBOARDING_EGO_HANDOFF'});
  assert.deepEqual(navigated,[stage==='platform'?'https://platform.openai.com/settings/organization/api-keys':stage==='plugin'?'https://chatgpt.com/plugins':'https://chatgpt.com/dots/home']);assert.equal(f.count().handedOff,1);
  const count=f.calls.length;await new Promise(r=>setTimeout(r,5));assert.equal(f.calls.length,count);assert.equal(JSON.parse(f.values.get(directory+'/ego-binding.json')).spaceId,110);
  const state=JSON.parse(f.values.get(directory+'/browser-state.json'));assert.equal(state.tunnel_id,'tunnel_1234567890abcdef');assert.deepEqual(state.verification_request_ids,[]);assert.equal(state.verification_pending_request,undefined);
  await f.browser.close();await assert.rejects(f.browser.prepare(),{code:'ONBOARDING_EGO_HANDOFF'});assert.equal(navigated.length,1);
 }
});
test('an actual Dot login route hands off before any message or task dispatch',async()=>{
 const f=fixture({pageUrl:'https://chatgpt.com/auth/login',binding:{spaceId:110,platformPage:'p2',dotPage:'p1',verificationPage:'p4'}});await f.browser.prepare();await assert.rejects(f.browser.verifyDot({requestId}),{code:'ONBOARDING_EGO_HANDOFF'});assert.equal(f.count().handedOff,1);const state=JSON.parse(f.values.get(directory+'/browser-state.json'));assert.deepEqual(state.verification_request_ids,[]);assert.equal(state.verification_pending_request,undefined);
});
test('explicit login recovery remains available after an already connected plugin is observed',async()=>{
 const pluginId='plugin_asdk_app_owned123',f=fixture({pageUrl:'https://chatgpt.com/settings/plugins-settings/'+pluginId,binding:{spaceId:110,platformPage:'p2',dotPage:'p1',connectionPage:'p3',verificationPage:'p4'},state:{plugin_id:pluginId},observed:{title:true,uninstall:true,association:true}}),navigated=[];
 f.page.goto=async url=>navigated.push(url);await f.browser.prepare({resumeAuthorized:true});assert.equal((await f.browser.connectPlugin({tunnel_id:'tunnel_1234567890abcdef'})).connected,true);
 f.page.url=async()=> 'https://accounts.google.com/v3/signin/rejected';await assert.rejects(f.browser.verifyDot({requestId}),{code:'ONBOARDING_EGO_HANDOFF'});assert.deepEqual(navigated,['https://chatgpt.com/dots/home']);assert.equal(f.count().handedOff,1);
});
test('Open connection window focuses the actual blocked stage even when later dedicated pages already exist',async()=>{
 for(const [stage,expected]of [['platform','p2'],['plugin','p3'],['dot','p4']]){
  const f=fixture({pageUrl:'https://accounts.google.com/v3/signin/rejected',binding:{spaceId:110,platformPage:'p2',dotPage:'p1',connectionPage:'p3',verificationPage:'p4'}}),accessed=[],front=[];
  f.space.page=label=>{accessed.push(label);return f.page;};f.page.cdp=async(...args)=>front.push(args);
  await f.browser.prepare();await assert.rejects(stage==='platform'?f.browser.provision():stage==='plugin'?f.browser.connectPlugin({tunnel_id:'tunnel_1234567890abcdef'}):f.browser.verifyDot({requestId}),{code:'ONBOARDING_AUTH_BROWSER_REJECTED'});
  await f.browser.focus();assert.equal(accessed.at(-1),expected);assert.deepEqual(front,[['Page.bringToFront',{}, {timeout:5000}]]);assert.ok(!accessed.includes('p1'));
 }
});
test('actual pending-approval plan receives the current request and hands off without another send',async()=>{
 const f=fixture({binding:{spaceId:110,platformPage:'p2',dotPage:'p1',verificationPage:'p4'},state:{verification_request_ids:[requestId]},pageUrl:'https://chatgpt.com/dots/home',observed:{approval:true}});await f.browser.prepare();await assert.rejects(f.browser.pendingAction(),{code:'ONBOARDING_EGO_HANDOFF'});assert.equal(f.count().handedOff,1);assert.match(f.calls[1],new RegExp(requestId));
});
test('a pending verification redirected to login hands off with its login step and never navigates or resends',async()=>{
 const f=fixture({binding:{spaceId:110,platformPage:'p2',dotPage:'p1',verificationPage:'p4'},state:{verification_request_ids:[requestId]},pageUrl:'https://chatgpt.com/auth/login'}),progress=[];
 f.page.goto=async()=>assert.fail('pending inspection must not navigate');
 await f.browser.prepare();await assert.rejects(f.browser.pendingAction({onProgress:value=>progress.push(value)}),{code:'ONBOARDING_EGO_HANDOFF'});
 assert.deepEqual(progress,[{step:'chatgpt_login'}]);assert.equal(f.count().handedOff,1);
 const saved=JSON.parse(f.values.get(directory+'/browser-state.json'));assert.deepEqual(saved.verification_request_ids,[requestId]);assert.equal(saved.verification_pending_request,undefined);
});
test('a pending verification reports Google rejection without retrying its login or sending a task',async()=>{
 const f=fixture({binding:{spaceId:110,platformPage:'p2',dotPage:'p1',verificationPage:'p4'},state:{verification_request_ids:[requestId]},pageUrl:'https://accounts.google.com/v3/signin/rejected'});
 f.page.goto=async()=>assert.fail('pending inspection must not recover login');
 await f.browser.prepare({resumeAuthorized:true});await assert.rejects(f.browser.pendingAction(),{code:'ONBOARDING_AUTH_BROWSER_REJECTED'});assert.equal(f.count().handedOff,0);
 assert.deepEqual(JSON.parse(f.values.get(directory+'/browser-state.json')).verification_request_ids,[requestId]);
});
test('unknown real send exception is retained as uncertain and never blindly replayed',async()=>{
 const promptObservation={editor:'loc=css:#composer',editorMatches:true,send:'loc=css:#send',sendEnabled:true};const f=fixture({binding:{spaceId:110,platformPage:'p2',dotPage:'p1',verificationPage:'p4'},state:{verification_pending_request:requestId},pageUrl:'https://chatgpt.com/dots/home',observed:promptObservation});await f.browser.prepare();assert.deepEqual(await f.browser.verifyDot({requestId}),{sent:false,uncertain:true});const before=f.calls.length;assert.deepEqual(await f.browser.verifyDot({requestId,forceResend:true}),{sent:false,uncertain:true});assert.equal(f.calls.length,before);assert.equal(JSON.parse(f.values.get(directory+'/browser-state.json')).verification_uncertain_request,requestId);
});
test('an uncertain later retry takes precedence over the earlier confirmed send for the same request',async()=>{
 const f=fixture({binding:{spaceId:110,platformPage:'p2',dotPage:'p1',verificationPage:'p4'},state:{verification_request_ids:[requestId],verification_pending_request:requestId,verification_uncertain_request:requestId},pageUrl:'https://chatgpt.com/dots/home',observed:{sent:true}});await f.browser.prepare();const before=f.calls.length;
 for(const forceResend of [false,true])assert.deepEqual(await f.browser.verifyDot({requestId,forceResend}),{sent:false,uncertain:true});
 assert.equal(f.calls.length,before);
});
test('real provider transport and phase retry a confirmed stopped request once despite its old transcript',async()=>{
 const empty={sent:true,editor:'loc=css:#composer',editorEmpty:true,editorMatches:false,send:'loc=css:#send',sendEnabled:true};
 const f=fixture({binding:{spaceId:110,platformPage:'p2',dotPage:'p1',verificationPage:'p4'},state:{verification_request_ids:[requestId]},pageUrl:'https://chatgpt.com/dots/home',observed:empty});let clicks=0;
 f.page.fill=async()=>f.setObserved({...empty,editorEmpty:false,editorMatches:true});
 f.page.click=async()=>{assert.equal(JSON.parse(f.values.get(directory+'/browser-state.json')).verification_pending_request,requestId);clicks++;};
 await f.browser.prepare();assert.deepEqual(await f.browser.verifyDot({requestId,forceResend:true}),{sent:true});assert.equal(clicks,1);assert.equal(JSON.parse(f.values.get(directory+'/browser-state.json')).verification_pending_request,null);
 assert.deepEqual(await f.browser.verifyDot({requestId}),{sent:true});assert.equal(clicks,1);
});
test('a retry interrupted after persisting intent stays uncertain even with an earlier confirmed message',async()=>{
 for(const forceResend of [false,true]){
  const f=fixture({binding:{spaceId:110,platformPage:'p2',dotPage:'p1',verificationPage:'p4'},state:{verification_request_ids:[requestId],verification_pending_request:requestId},pageUrl:'https://chatgpt.com/dots/home',observed:{sent:true,editorMatches:true}});await f.browser.prepare();const before=f.calls.length;
  assert.deepEqual(await f.browser.verifyDot({requestId,forceResend}),{sent:false,uncertain:true});assert.equal(f.calls.length,before);
 }
});
test('after document navigation an unrelated Save your key dialog cannot read or write a key',async()=>{
 const f=fixture({state:{key_intent:true,key_capture_nonce:'c'.repeat(32)},observed:{kind:'key_saved_dialog'}});await f.browser.prepare();await assert.rejects(f.browser.provision(),{code:'ONBOARDING_KEY_RECOVERY'});assert.equal(f.values.has(directory+'/runtime.key'),false);assert.doesNotMatch(f.calls.join('\n'),/sk-synthetic/);
});

test('real provider and transport finish once then explicitly reclaim the same space with fresh labels only',async()=>{
 const f=fixture({binding:{spaceId:110,platformPage:'p2',dotPage:'p1',connectionPage:'p3',verificationPage:'p4'},state:{plugin_connected:true,verification_request_ids:[requestId]}});
 let managed=['p1','p2','p3','p4'],kept=[],finishes=0,next=5;const accessed=[];
 f.space.pages=async()=>managed.map(label=>({label}));
 f.space.tabs=async()=>kept.map(label=>({targetId:'retained-'+label,page:{}})).concat(managed.map(label=>({label,page:{}})));
 f.space.page=label=>{assert.ok(managed.includes(label),'old finished label must never be reused');accessed.push(label);return f.page;};
 f.space.finish=async({keep})=>{assert.equal(JSON.parse(f.values.get(directory+'/ego-binding.json')).finalization,'pending');finishes++;kept=keep;managed=[];};
 f.space.newPage=async()=>{const label='p'+next++;managed.push(label);return{label};};
 await f.browser.prepare();assert.deepEqual(await f.browser.complete(),{completed:true});assert.deepEqual(await f.browser.complete(),{completed:true});assert.equal(finishes,1);assert.deepEqual(kept,['p1','p4']);
 await assert.rejects(f.browser.prepare(),{code:'ONBOARDING_EGO_FINALIZATION_RECOVERY'});assert.equal(f.count().claimed,0);
 await f.browser.prepare({resumeAuthorized:true});assert.equal(f.count().claimed,1);assert.deepEqual(accessed,['p2','p5']);assert.deepEqual(kept,['p1','p4']);
 const saved=JSON.parse(f.values.get(directory+'/ego-binding.json'));assert.equal(saved.platformPage,'p5');assert.equal(saved.connectionPage,'p6');assert.equal(saved.verificationPage,'p7');assert.equal(saved.finalization,undefined);
});
