import {test} from 'node:test';
import assert from 'node:assert/strict';
const api=await import('../management-plugin/src/onboarding-ego.js').catch(()=>({}));
const installationId='a'.repeat(32),directory='/private/synthetic/onboarding',runtimeKeyFile=directory+'/runtime.key';
const identity={installationId,directory,runtimeKeyFile,tunnelName:'dsh-dot-'+installationId,pluginName:'DeepSeek Harness · '+installationId};
function fixture(extra={}){
 const values=new Map([[directory+'/ego-binding.json',JSON.stringify({spaceId:110,platformPage:'p2',dotPage:'p1'})]]),calls=[];
 const files={ensure:async()=>{},read:async path=>{if(!values.has(path))throw Object.assign(Error(),{code:'ENOENT'});return values.get(path);},write:async(path,value)=>{if(values.has(path))throw Object.assign(Error(),{code:'EEXIST'});values.set(path,value);},rename:async(a,b)=>{values.set(b,values.get(a));values.delete(a);},unlink:async p=>values.delete(p)};
 const transport={run:async input=>{calls.push(input);return{status:'prepared'};},createBinding:async()=>{throw Error('must not create another space');},createPage:async()=>({pageLabel:'p3'}),...extra.transport};
 assert.equal(typeof api.createEgoOnboardingBrowser,'function');
 const browser=api.createEgoOnboardingBrowser({...identity,files,transport,pollMs:0,waitTimeoutMs:2000,...extra,transport});return{browser,values,calls,files,transport};
}
test('prepares from exact private binding without starting another browser or navigating existing pages',async()=>{
 const f=fixture();assert.deepEqual(await f.browser.prepare(),{prepared:true});assert.equal(f.calls[0].spaceId,110);assert.equal(f.calls[0].pageLabel,'p2');assert.doesNotMatch(f.calls[0].script,/\.goto\(|\.close\(|finish\(|claimTaskSpace|launchPersistent/);await f.browser.close();assert.equal(f.calls.length,1);
});
test('invalid binding fails closed without a browser call',async()=>{const f=fixture();f.values.set(directory+'/ego-binding.json',JSON.stringify({spaceId:110,platformPage:'p2',dotPage:'p1',token:'forbidden'}));await assert.rejects(f.browser.prepare(),{code:'ONBOARDING_PRIVATE_STATE'});assert.equal(f.calls.length,0);});
test('new space creation intent prevents a second creation after an unknown outcome',async()=>{
 let creates=0;const f=fixture({transport:{createBinding:async()=>{creates++;throw Error('unknown outcome');}}});f.values.delete(directory+'/ego-binding.json');await assert.rejects(f.browser.prepare());await assert.rejects(f.browser.prepare(),{code:'ONBOARDING_EGO_BINDING_RECOVERY'});assert.equal(creates,1);
});
test('provision persists real tunnel receipt and existing-page draft intent, never imports a key',async()=>{
 const tunnelId='tunnel_1234567890abcdef',workspace='12345678-1234-1234-1234-123456789012';let phase=0;let f;
 f=fixture({transport:{run:async input=>{f.calls.push(input);if(input.script.includes('ego-prepare'))return{status:'prepared'};phase++;if(phase===1)return{status:'draft',step:'tunnel_confirm',patch:{tunnel_intent:true}};if(phase===2)return{status:'tunnel_ready',tunnel_id:tunnelId,tunnel_name:identity.tunnelName,workspace_id:workspace};f.values.set(runtimeKeyFile,'synthetic-new-key');return{status:'key_saved',key_saved:true};}}});
 await f.browser.prepare();const receipt=await f.browser.provision();assert.equal(receipt.tunnel_id,tunnelId);assert.equal(receipt.workspace_id,workspace);const state=JSON.parse(f.values.get(directory+'/browser-state.json'));assert.equal(state.tunnel_intent,true);assert.equal(state.tunnel_id,tunnelId);assert.equal(state.key_saved,true);assert.doesNotMatch(JSON.stringify(f.calls),/synthetic-new-key/);
});
test('key saved receipt without private key is rejected',async()=>{const f=fixture({transport:{run:async input=>input.script.includes('ego-prepare')?{status:'prepared'}:{status:'key_saved',key_saved:true}}});await f.browser.prepare();await assert.rejects(f.browser.provision(),{code:'ONBOARDING_PRIVATE_STATE'});});
test('control loss preserves binding and resume does not silently create or claim another space',async()=>{const f=fixture({transport:{run:async()=>{throw Object.assign(Error('private OAuth URL'),{code:'ONBOARDING_EGO_CONTROL'});}}});await assert.rejects(f.browser.prepare(),e=>e.code==='ONBOARDING_EGO_CONTROL'&&!e.message.includes('OAuth'));assert.ok(f.values.has(directory+'/ego-binding.json'));});
test('foreign tunnel receipt is rejected before key preparation',async()=>{const f=fixture({transport:{run:async input=>input.script.includes('ego-prepare')?{status:'prepared'}:{status:'tunnel_ready',tunnel_id:'tunnel_1234567890abcdef',tunnel_name:'foreign',workspace_id:'12345678-1234-1234-1234-123456789012'}}});await f.browser.prepare();await assert.rejects(f.browser.provision(),{code:'ONBOARDING_PRIVATE_STATE'});});
test('missing Ego before spawning does not leave an unrecoverable creation intent',async()=>{let missing=true,creates=0;const f=fixture({transport:{createBinding:async()=>{creates++;if(missing)throw Object.assign(Error(),{code:'EGO_BROWSER_UNAVAILABLE'});return{spaceId:110,platformPage:'p2'};}}});f.values.delete(directory+'/ego-binding.json');await assert.rejects(f.browser.prepare(),{code:'EGO_BROWSER_UNAVAILABLE'});missing=false;await f.browser.prepare();assert.equal(creates,2);});

const verifiedState={version:1,installation_id:installationId,tunnel_name:identity.tunnelName,plugin_name:identity.pluginName,plugin_connected:true,verification_request_ids:['dsh_connect_'+'b'.repeat(32)]};
const finishedBinding={version:1,installation_id:installationId,spaceId:110,finalization:'finished'};
function seedVerified(f){f.values.set(directory+'/ego-binding.json',JSON.stringify({spaceId:110,platformPage:'p2',dotPage:'p1',connectionPage:'p3',verificationPage:'p4'}));f.values.set(directory+'/browser-state.json',JSON.stringify(verifiedState));}

test('complete persists an intent before one finish, keeps user and result pages, and retires all old labels',async()=>{
 let finishes=0,f;f=fixture({transport:{finishBinding:async input=>{finishes++;assert.equal(JSON.parse(f.values.get(directory+'/ego-binding.json')).finalization,'pending');assert.deepEqual(input.keep,['p1','p4']);return{spaceId:110,finished:true};}}});seedVerified(f);await f.browser.prepare();
 assert.deepEqual(await f.browser.complete(),{completed:true});assert.deepEqual(await f.browser.complete(),{completed:true});assert.equal(finishes,1);
 assert.deepEqual(JSON.parse(f.values.get(directory+'/ego-binding.json')),finishedBinding);await f.browser.close();assert.equal(f.calls.length,1);
});

test('uncertain finish is never repeated or repaired by claiming or creating another space',async()=>{
 let finishes=0,claims=0;const f=fixture({transport:{finishBinding:async()=>{finishes++;throw Object.assign(Error('lost receipt'),{mayHaveLateEffects:true});},claimBinding:async()=>{claims++;}}});seedVerified(f);await f.browser.prepare();
 await assert.rejects(f.browser.complete());await assert.rejects(f.browser.complete());assert.equal(finishes,1);
 assert.equal(JSON.parse(f.values.get(directory+'/ego-binding.json')).finalization,'pending');await f.browser.close();
 await assert.rejects(f.browser.prepare({resumeAuthorized:true}),{code:'ONBOARDING_EGO_FINALIZATION_RECOVERY'});assert.equal(claims,0);assert.equal(f.calls.length,1);
});

test('only explicit reverify claims the finished space and persists three fresh dedicated labels',async()=>{
 let claims=0,next=6;const created=[];const f=fixture({transport:{claimBinding:async({spaceId})=>{claims++;assert.equal(spaceId,110);return{spaceId,claimed:true,protectedPages:['p5']};},createPage:async({spaceId,kind})=>{assert.equal(spaceId,110);created.push(kind);return{pageLabel:'p'+next++};}}});f.values.set(directory+'/ego-binding.json',JSON.stringify(finishedBinding));f.values.set(directory+'/browser-state.json',JSON.stringify(verifiedState));
 await assert.rejects(f.browser.prepare(),{code:'ONBOARDING_EGO_FINALIZATION_RECOVERY'});assert.equal(claims,0);
 await f.browser.prepare({resumeAuthorized:true});assert.equal(claims,1);assert.deepEqual(created,['platform','connection','verification']);
 const binding=JSON.parse(f.values.get(directory+'/ego-binding.json'));assert.equal(binding.platformPage,'p6');assert.equal(binding.connectionPage,'p7');assert.equal(binding.verificationPage,'p8');assert.deepEqual(binding.protectedPages,['p5']);assert.equal(binding.finalization,undefined);assert.equal(binding.dotPage,undefined);assert.equal(f.calls[0].pageLabel,'p6');
});

test('unknown claim and fresh-page creation leave resumable intents without repeating mutations',async()=>{
 for(const failure of ['claim','page']){
  let claims=0,creates=0;const f=fixture({transport:{claimBinding:async()=>{claims++;if(failure==='claim')throw Error('claim reply lost');return{spaceId:110,claimed:true,protectedPages:[]};},createPage:async()=>{creates++;if(creates===2)throw Error('new page reply lost');return{pageLabel:'p6'};}}});f.values.set(directory+'/ego-binding.json',JSON.stringify(finishedBinding));
  await assert.rejects(f.browser.prepare({resumeAuthorized:true}));await assert.rejects(f.browser.prepare({resumeAuthorized:true}),{code:'ONBOARDING_EGO_FINALIZATION_RECOVERY'});assert.equal(claims,1);assert.equal(creates,failure==='claim'?0:2);
 }
});
