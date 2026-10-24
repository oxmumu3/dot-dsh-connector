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

const renewalId='c'.repeat(32),candidateFile=directory+'/runtime-next-'+renewalId+'.key';
function seedRenewal(f){seedVerified(f);f.values.set(directory+'/browser-state.json',JSON.stringify({...verifiedState,tunnel_id:'tunnel_1234567890abcdef',workspace_id:'12345678-1234-1234-1234-123456789012',key_saved:true}));f.values.set(runtimeKeyFile,'sk-'+ 'o'.repeat(32));}
test('renewal reclaims only the same Space and opens only a fresh Platform page',async()=>{
 const kinds=[];const f=fixture({transport:{claimBinding:async({spaceId})=>{assert.equal(spaceId,110);return{spaceId,claimed:true,protectedPages:['p5']};},createPage:async({kind})=>{kinds.push(kind);return{pageLabel:'p6'};}}});seedRenewal(f);f.values.set(directory+'/ego-binding.json',JSON.stringify(finishedBinding));
 await f.browser.prepare({resumeAuthorized:true,purpose:'key-renewal'});assert.deepEqual(kinds,['platform']);assert.equal(JSON.parse(f.values.get(directory+'/ego-binding.json')).platformPage,'p6');
});
test('renewal saves an isolated candidate and metadata without changing the original key or task dedup state',async()=>{
 let f;f=fixture({transport:{run:async input=>{f.calls.push(input);if(input.script.includes('ego-prepare'))return{status:'prepared'};const renewal=JSON.parse(f.values.get(directory+'/key-renewal.json'));assert.equal(renewal.renewal_id,renewalId);assert.equal(renewal.tunnel_id,'tunnel_1234567890abcdef');f.values.set(candidateFile,'sk-'+ 'n'.repeat(32));return{status:'key_saved',key_saved:true};}}});seedRenewal(f);const oldKey=f.values.get(runtimeKeyFile),oldState=f.values.get(directory+'/browser-state.json');await f.browser.prepare({resumeAuthorized:true,purpose:'key-renewal'});
 assert.deepEqual(await f.browser.renewRuntimeKey({renewalId}),{candidate_saved:true,renewal_id:renewalId,creation_observed_at:null,lifetime_days:30,expiry_source:'unknown'});assert.equal(f.values.get(runtimeKeyFile),oldKey);assert.equal(f.values.get(directory+'/browser-state.json'),oldState);
 assert.equal(JSON.parse(f.values.get(directory+'/key-renewal.json')).candidate_saved,true);const before=f.calls.length;await f.browser.renewRuntimeKey({renewalId});assert.equal(f.calls.length,before);assert.doesNotMatch(JSON.stringify(f.calls),/sk-n{32}|sk-o{32}/);
});
test('renewal intent and nonce survive a human grant handoff and reject a different unfinished operation',async()=>{
 let f,handoffs=0,resumes=0;f=fixture({transport:{run:async input=>input.script.includes('ego-prepare')?{status:'prepared'}:{status:'draft',step:'key_confirm',waiting_for:'authorization',patch:{key_intent:true,key_capture_nonce:'d'.repeat(32)}},handOffBinding:async()=>{handoffs++;},resumeBinding:async()=>{resumes++;}}});seedRenewal(f);await f.browser.prepare({resumeAuthorized:true,purpose:'key-renewal'});
 await assert.rejects(f.browser.renewRuntimeKey({renewalId}),{code:'ONBOARDING_EGO_HANDOFF'});assert.equal(handoffs,1);const renewal=JSON.parse(f.values.get(directory+'/key-renewal.json'));assert.equal(renewal.key_intent,true);assert.equal(renewal.key_capture_nonce,'d'.repeat(32));assert.equal(JSON.parse(f.values.get(directory+'/browser-state.json')).key_intent,undefined);
 await assert.rejects(f.browser.renewRuntimeKey({renewalId}),{code:'ONBOARDING_EGO_HANDOFF'});await f.browser.prepare({resumeAuthorized:true,purpose:'key-renewal'});await assert.rejects(f.browser.renewRuntimeKey({renewalId:'e'.repeat(32)}),{code:'ONBOARDING_KEY_RECOVERY'});assert.equal(resumes,2);assert.equal(handoffs,1);
});
test('renewal refuses a pre-existing candidate with no matching persisted operation and never creates a Space',async()=>{
 const f=fixture();seedRenewal(f);f.values.set(candidateFile,'sk-'+ 'n'.repeat(32));await f.browser.prepare({resumeAuthorized:true,purpose:'key-renewal'});await assert.rejects(f.browser.renewRuntimeKey({renewalId}),{code:'ONBOARDING_KEY_RECOVERY'});
 const missing=fixture();seedRenewal(missing);missing.values.delete(directory+'/ego-binding.json');await assert.rejects(missing.browser.prepare({resumeAuthorized:true,purpose:'key-renewal'}),{code:'ONBOARDING_EGO_BINDING_RECOVERY'});
});
test('renewal complete retains old user and result pages and never runs plugin or Dot phases',async()=>{
 let finishes=0,f;f=fixture({transport:{run:async input=>{f.calls.push(input);if(!input.script.includes('ego-prepare'))f.values.set(candidateFile,'sk-'+ 'n'.repeat(32));return input.script.includes('ego-prepare')?{status:'prepared'}:{status:'key_saved',key_saved:true};},finishBinding:async input=>{finishes++;assert.deepEqual(input.keep,['p1','p4']);return{spaceId:110,finished:true};}}});seedRenewal(f);await f.browser.prepare({resumeAuthorized:true,purpose:'key-renewal'});await f.browser.renewRuntimeKey({renewalId});assert.deepEqual(await f.browser.complete(),{completed:true});assert.equal(finishes,1);assert.equal(f.calls.length,2);
});
test('provision reports known creation metadata and never guesses the age of legacy credentials',async()=>{
 const f=fixture();seedRenewal(f);await f.browser.prepare();assert.equal((await f.browser.provision()).expiry_source,'unknown');const observed='2026-10-01T00:00:00.000Z';f.values.set(directory+'/runtime.json',JSON.stringify({version:1,installation_id:installationId,creation_observed_at:observed,lifetime_days:30,expiry_source:'creation_observed'}));assert.equal((await f.browser.provision()).creation_observed_at,observed);
});

test('lost candidate-save receipt resumes from disk without another browser mutation',async()=>{
 let f,runs=0;f=fixture({transport:{run:async input=>{f.calls.push(input);if(input.script.includes('ego-prepare'))return{status:'prepared'};runs++;f.values.set(candidateFile,'sk-'+ 'n'.repeat(32));throw Object.assign(Error('lost receipt'),{mayHaveLateEffects:true});}}});seedRenewal(f);await f.browser.prepare({resumeAuthorized:true,purpose:'key-renewal'});await assert.rejects(f.browser.renewRuntimeKey({renewalId}));assert.equal((await f.browser.renewRuntimeKey({renewalId})).candidate_saved,true);assert.equal(runs,1);
});
test('renewal scope blocks onboarding plugin and Dot methods without a browser call',async()=>{
 const f=fixture();seedRenewal(f);await f.browser.prepare({resumeAuthorized:true,purpose:'key-renewal'});const before=f.calls.length;
 await assert.rejects(f.browser.provision(),{code:'ONBOARDING_PRIVATE_STATE'});await assert.rejects(f.browser.connectPlugin({tunnel_id:'tunnel_1234567890abcdef'}),{code:'ONBOARDING_PRIVATE_STATE'});await assert.rejects(f.browser.verifyDot({requestId:verifiedState.verification_request_ids[0]}),{code:'ONBOARDING_PRIVATE_STATE'});assert.equal(await f.browser.pendingAction(),undefined);assert.equal(f.calls.length,before);
});
test('renewal never accepts a secret-less saved receipt or mutated nonce',async()=>{
 for(const result of [{status:'key_saved',key_saved:true},{status:'draft',patch:{key_intent:false}},{status:'draft',patch:{key_intent:true,key_capture_nonce:'e'.repeat(32)}}]){
  const f=fixture({transport:{run:async input=>input.script.includes('ego-prepare')?{status:'prepared'}:result}});seedRenewal(f);f.values.set(directory+'/key-renewal.json',JSON.stringify({version:1,installation_id:installationId,renewal_id:renewalId,tunnel_id:'tunnel_1234567890abcdef',candidate_saved:false,key_intent:true,key_capture_nonce:'d'.repeat(32)}));await f.browser.prepare({resumeAuthorized:true,purpose:'key-renewal'});await assert.rejects(f.browser.renewRuntimeKey({renewalId}),{code:result.status==='key_saved'?'ONBOARDING_KEY_RECOVERY':'ONBOARDING_PRIVATE_STATE'});assert.equal(f.values.get(runtimeKeyFile),'sk-'+ 'o'.repeat(32));
 }
});

test('concurrent renewals and late cancelled capture cannot duplicate the operation',async()=>{
 let f,release,entered;const waiting=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve),controller=new AbortController();let runs=0;
 f=fixture({transport:{run:async input=>{if(input.script.includes('ego-prepare'))return{status:'prepared'};runs++;entered();await gate;f.values.set(candidateFile,'sk-'+ 'n'.repeat(32));return{status:'key_saved',key_saved:true};}}});seedRenewal(f);await f.browser.prepare({purpose:'key-renewal'});const pending=f.browser.renewRuntimeKey({renewalId,signal:controller.signal});await waiting;await assert.rejects(f.browser.renewRuntimeKey({renewalId}),{code:'ONBOARDING_EGO_BUSY'});controller.abort();release();await assert.rejects(pending,{name:'AbortError'});assert.equal(JSON.parse(f.values.get(directory+'/key-renewal.json')).candidate_saved,false);
 assert.equal((await f.browser.renewRuntimeKey({renewalId})).candidate_saved,true);assert.equal(runs,1);
});

test('explicit abandon preserves all credentials, invalidates its old ID, and the next operation reuses the official Platform page',async()=>{
 let f,navigations=0;f=fixture({transport:{run:async input=>{if(input.script.includes('ego-prepare'))return{status:'prepared'};if(input.script.includes('ego-renewal-restart')){navigations++;return{navigated:true};}f.values.set(candidateFile,'sk-'+ 'n'.repeat(32));return{status:'key_saved',key_saved:true};}}});seedRenewal(f);const oldId='e'.repeat(32),oldCandidate=directory+'/runtime-next-'+oldId+'.key';f.values.set(oldCandidate,'sk-'+ 'p'.repeat(32));f.values.set(directory+'/key-renewal.json',JSON.stringify({version:1,installation_id:installationId,renewal_id:oldId,tunnel_id:'tunnel_1234567890abcdef',candidate_saved:true,key_intent:true,key_capture_nonce:'d'.repeat(32)}));await f.browser.prepare({purpose:'key-renewal'});
 assert.deepEqual(await f.browser.abandonRenewal({renewalId:oldId}),{abandoned:true,renewal_id:oldId});assert.equal(f.values.get(oldCandidate),'sk-'+ 'p'.repeat(32));assert.equal(f.values.get(runtimeKeyFile),'sk-'+ 'o'.repeat(32));await assert.rejects(f.browser.renewRuntimeKey({renewalId:oldId}),{code:'ONBOARDING_KEY_RECOVERY'});assert.equal((await f.browser.renewRuntimeKey({renewalId})).candidate_saved,true);assert.equal(navigations,1);
});
test('prepare distinguishes an inventory-confirmed missing Space without creating or claiming anything',async()=>{
 const f=fixture({transport:{inspectBinding:async({spaceId})=>({spaceId,found:false}),resumeBinding:async()=>assert.fail('cannot claim a missing space')}});seedRenewal(f);await assert.rejects(f.browser.prepare({resumeAuthorized:true,purpose:'key-renewal'}),{code:'ONBOARDING_EGO_SPACE_MISSING'});assert.equal(f.calls.length,0);
});
test('explicit missing-window replacement keeps an immutable old binding and task state, and persists its real new identity',async()=>{
 let creates=0;const f=fixture({transport:{inspectBinding:async({spaceId})=>({spaceId,found:spaceId!==110}),createBinding:async({name})=>{creates++;assert.match(name,/Harness Dot/);return{spaceId:158,platformPage:'p1'};}}});seedRenewal(f);const state=f.values.get(directory+'/browser-state.json');const result=await f.browser.replaceMissingBinding();assert.deepEqual(result,{reopened:true});assert.equal(creates,1);assert.equal(JSON.parse(f.values.get(directory+'/ego-binding.json')).spaceId,158);const intent=JSON.parse(f.values.get(directory+'/ego-binding-replacement.json'));assert.match(intent.replacement_id,/^[a-f0-9]{32}$/);assert.equal(intent.previous_space_id,110);assert.equal(JSON.parse(f.values.get(directory+'/ego-binding-history-'+intent.replacement_id+'.json')).spaceId,110);assert.equal(f.values.get(directory+'/browser-state.json'),state);assert.deepEqual(await f.browser.replaceMissingBinding(),{reopened:true});assert.equal(creates,1);
});
test('unknown Space creation is recovered by exact name, never recreated after a lost reply',async()=>{
 let creates=0,recoveries=0;const f=fixture({transport:{inspectBinding:async({spaceId})=>({spaceId,found:false}),createBinding:async()=>{creates++;throw Object.assign(Error('lost'),{mayHaveLateEffects:true});},recoverBinding:async({name})=>{recoveries++;assert.match(name,new RegExp(installationId));return{found:true,spaceId:158,platformPage:'p1'};}}});seedRenewal(f);await assert.rejects(f.browser.replaceMissingBinding());const before=f.values.get(directory+'/ego-binding-replacement.json');assert.deepEqual(await f.browser.replaceMissingBinding(),{reopened:true});assert.equal(creates,1);assert.equal(recoveries,1);assert.equal(JSON.parse(before).replacement_id,JSON.parse(f.values.get(directory+'/ego-binding-replacement.json')).replacement_id);
});
test('window replacement refuses an existing Space, incomplete inventory or timeout',async()=>{
 for(const inspectBinding of [async({spaceId})=>({spaceId,found:true}),async()=>({}),async()=>{throw Object.assign(Error(),{code:'ONBOARDING_EGO_TIMEOUT'});}]){
  let creates=0;const f=fixture({transport:{inspectBinding,createBinding:async()=>{creates++;}}});seedRenewal(f);await assert.rejects(f.browser.replaceMissingBinding());assert.equal(creates,0);assert.equal(f.values.has(directory+'/ego-binding-replacement.json'),false);
 }
});

test('a replacement whose creation outcome stays unknown never creates again',async()=>{
 let creates=0;const f=fixture({transport:{inspectBinding:async({spaceId})=>({spaceId,found:false}),createBinding:async()=>{creates++;throw Object.assign(Error(),{mayHaveLateEffects:true});},recoverBinding:async()=>({found:false})}});seedRenewal(f);await assert.rejects(f.browser.replaceMissingBinding());await assert.rejects(f.browser.replaceMissingBinding(),{code:'ONBOARDING_EGO_BINDING_RECOVERY'});await assert.rejects(f.browser.replaceMissingBinding(),{code:'ONBOARDING_EGO_BINDING_RECOVERY'});assert.equal(creates,1);
});
test('reopening after a later deletion starts a new persisted generation only on the next explicit action',async()=>{
 const live=new Set();let creates=0;const f=fixture({transport:{inspectBinding:async({spaceId})=>({spaceId,found:live.has(spaceId)}),createBinding:async()=>{const spaceId=158+creates++;live.add(spaceId);return{spaceId,platformPage:'p1'};}}});seedRenewal(f);await f.browser.replaceMissingBinding();const first=JSON.parse(f.values.get(directory+'/ego-binding-replacement.json'));await f.browser.replaceMissingBinding();assert.equal(creates,1);live.delete(158);await f.browser.replaceMissingBinding();const second=JSON.parse(f.values.get(directory+'/ego-binding-replacement.json'));assert.equal(second.previous_space_id,158);assert.notEqual(first.replacement_id,second.replacement_id);assert.equal(creates,2);
});
test('a lost binding write receipt resumes from the one already-created replacement',async()=>{
 let creates=0;const f=fixture({transport:{inspectBinding:async({spaceId})=>({spaceId,found:spaceId===158}),createBinding:async()=>{creates++;return{spaceId:158,platformPage:'p1'};},recoverBinding:async()=>({found:true,spaceId:158,platformPage:'p1'})}});seedRenewal(f);const originalRename=f.files.rename;let loseOnce=true;f.files.rename=async(a,b)=>{await originalRename(a,b);if(b===directory+'/ego-binding.json'&&loseOnce){loseOnce=false;throw Error('reply lost');}};await assert.rejects(f.browser.replaceMissingBinding());assert.deepEqual(await f.browser.replaceMissingBinding(),{reopened:true});assert.equal(creates,1);assert.equal(JSON.parse(f.values.get(directory+'/ego-binding-replacement.json')).status,'created');
});
