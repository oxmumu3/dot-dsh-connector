import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,realpath,chmod,rm,readFile,writeFile} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {createOnboardingRuntime} from '../management-plugin/src/onboarding-runtime.js';
import {createOnboardingStore} from '../management-plugin/src/onboarding-store.js';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function settle(r,match=s=>['ready','blocked','restoring','cancelled'].includes(s.phase)){for(let i=0;i<1000;i++){const s=await r.status();if(match(s))return s;await sleep(5);}throw Error('did not settle');}
async function fixture(t,extra={}){
 const root=await realpath(await mkdtemp(join(tmpdir(),'dsh-renew-run-')));await chmod(root,0o700);const directory=join(root,'onboarding'),calls=[],state={newKeyAccepted:true};let currentKey,active=0;
 const local={prepare:async()=>({phase:'prepared'}),start:async()=>({phase:'running'}),onboardingReference:async()=>({directory,mcpCommand:'synthetic-mcp-command'}),setCloudHealthFile:async()=>{}};
 const baseBrowserFactory=options=>({prepare:async args=>{calls.push(['prepare',args.purpose]);},provision:async()=>{await writeFile(options.runtimeKeyFile,'old-synthetic-key',{mode:0o600});return{tunnel_id:'tunnel_test',creation_observed_at:new Date().toISOString(),lifetime_days:30,expiry_source:'creation_observed'};},connectPlugin:async()=>{calls.push(['plugin']);return{connected:true};},verifyDot:async()=>{calls.push(['task']);return{sent:true};},renewRuntimeKey:async({renewalId,onProgress})=>{calls.push(['renew',renewalId]);if(state.handoff){onProgress({step:'key_confirm'});throw Object.assign(Error('handoff'),{code:'ONBOARDING_EGO_HANDOFF'});}await writeFile(join(directory,`runtime-next-${renewalId}.key`),'new-synthetic-key',{mode:0o600});return{candidate_saved:true,renewal_id:renewalId,creation_observed_at:new Date().toISOString(),lifetime_days:30,expiry_source:'creation_observed'};},complete:async()=>({completed:true}),close:async()=>{calls.push(['browser_close']);}});
 const browserFactory=options=>({...baseBrowserFactory(options),...extra.browser?.({options,state,calls})});
 const tunnelFactory=()=>{let opened=false;return{prepare:async()=>{},start:async({runtimeKeyFile})=>{assert.equal(active,0,'never run two transports for the same tunnel');opened=true;active++;currentKey=await readFile(runtimeKeyFile,'utf8');calls.push(['start',currentKey,runtimeKeyFile]);},close:async()=>{if(opened){opened=false;active--;calls.push(['stop']);}}};};
 const r=createOnboardingRuntime({local,browserFactory,tunnelFactory,store:extra.storeFactory?.({directory,state,calls}),verify:async()=>({tunnel_online:true,dot_read:true,task_complete:true}),transportHealth:async()=>currentKey==='new-synthetic-key'&&!state.newKeyAccepted?{tunnel_online:false}:{tunnel_online:false,awaiting_first_call:true},pollMs:2,verifyTimeoutMs:50,monitorMs:60000,...extra});t.after(async()=>{await r.close();await rm(root,{recursive:true,force:true});});
 await r.start();await settle(r,extra.initialMatch??(s=>s.phase==='ready'&&s.actions.renew===true));const before=JSON.parse(await readFile(join(directory,'state.json'),'utf8'));return{r,root,directory,calls,state,before};
}

function interruptCommitAt(expectedKey){return({directory,state})=>{
 const store=createOnboardingStore({directory});
 return{...store,withOwnership:operation=>store.withOwnership(own=>operation(async()=>{
  await own();if(!state.interruptCommit)return;
  const journal=JSON.parse(await readFile(join(directory,'key-lifecycle.json'),'utf8'));
  if(journal.renewal?.phase==='committing'&&await readFile(join(directory,'runtime.key'),'utf8')===expectedKey){state.interruptCommit=false;state.interrupted=true;throw Error('synthetic commit interruption');}
 }))};
};}
test('post-replacement commit interruption recovers without starting another key renewal',async t=>{
 const f=await fixture(t,{storeFactory:interruptCommitAt('new-synthetic-key')});f.state.interruptCommit=true;
 await f.r.renew();const s=await settle(f.r,s=>s.phase==='blocked'&&s.actions.renew);
 assert.equal(f.state.interrupted,true);assert.equal(await readFile(join(f.directory,'runtime.key'),'utf8'),'new-synthetic-key');
 assert.equal(JSON.parse(await readFile(join(f.directory,'key-lifecycle.json'),'utf8')).renewal,null);
 assert.equal(s.credential.renewal_pending,false);assert.notEqual(s.purpose,'key-renewal');assert.equal(s.error.code,'RESTORE_UNAVAILABLE');
 await f.r.resume();await settle(f.r,s=>s.phase==='ready'&&s.actions.renew);
 assert.equal(f.calls.filter(c=>c[0]==='renew').length,1,'resume must not request a second official key grant');
});
test('pre-replacement commit interruption keeps the original key and resumes the same renewal',async t=>{
 const f=await fixture(t,{storeFactory:interruptCommitAt('old-synthetic-key')});f.state.interruptCommit=true;
 await f.r.renew();const s=await settle(f.r,s=>s.phase==='blocked'&&s.actions.renew);
 assert.equal(f.state.interrupted,true);assert.equal(await readFile(join(f.directory,'runtime.key'),'utf8'),'old-synthetic-key');
 assert.equal(s.purpose,'key-renewal');assert.equal(s.credential.renewal_pending,true);assert.equal(s.error.code,'KEY_RENEW_UNVERIFIED');
 await f.r.resume();await settle(f.r,s=>['ready','restoring'].includes(s.phase)&&s.actions.renew);
 const ids=f.calls.filter(c=>c[0]==='renew').map(c=>c[1]);assert.equal(ids.length,2);assert.equal(new Set(ids).size,1);
});
test('initial tunnel receipt is never persisted before its observed credential expiry',async t=>{
 let provisions=0,interrupted=false;
 const f=await fixture(t,{initialMatch:s=>s.phase==='blocked',browser:({options})=>({provision:async()=>{
  provisions++;await writeFile(options.runtimeKeyFile,'old-synthetic-key',{mode:0o600});
  return{tunnel_id:'tunnel_test',creation_observed_at:new Date().toISOString(),lifetime_days:30,expiry_source:'creation_observed'};
 }}),storeFactory:({directory})=>{
  const store=createOnboardingStore({directory});return{...store,update:async patch=>{const result=await store.update(patch);if(patch.tunnel_id&&!interrupted){interrupted=true;throw Error('synthetic interruption after persisted tunnel receipt');}return result;}};
 }});
 assert.equal(interrupted,true);assert.equal(f.before.tunnel_id,'tunnel_test');
 const s=await f.r.status();assert.equal(s.credential.expiry_source,'estimated');assert.equal(s.credential.state,'valid');
 await f.r.resume();await settle(f.r,s=>s.phase==='ready'&&s.actions.renew);
 assert.equal(provisions,1,'persisted first connection must resume without creating another key');
 assert.equal((await f.r.status()).credential.expiry_source,'estimated');
});
test('renewal retains resources and task proof, validates candidate and runs the accepted canonical key',async t=>{const f=await fixture(t);const count=f.calls.filter(c=>c[0]==='task').length;await f.r.renew();const s=await settle(f.r,s=>['restoring','ready','blocked'].includes(s.phase)&&s.actions.renew);assert.notEqual(s.phase,'blocked');assert.equal(s.credential.state,'valid');assert.equal(s.credential.renewal_pending,false);assert.equal(f.calls.filter(c=>c[0]==='task').length,count);assert.equal(f.calls.filter(c=>c[0]==='plugin').length,1);assert.equal(f.calls.filter(c=>c[0]==='renew').length,1);assert.equal(f.calls.filter(c=>c[0]==='start').at(-1)[2],join(f.directory,'runtime.key'));const after=JSON.parse(await readFile(join(f.directory,'state.json'),'utf8'));for(const key of ['installation_id','tunnel_id','request_id','completed_at'])assert.equal(after[key],f.before[key]);assert.doesNotMatch(JSON.stringify(s),/synthetic-key|runtime-next|tunnel_test/);});
test('renewed canonical transport gets its own cold-start grace before waiting for a real cloud call',async t=>{
 let renewing=false,checks=0,online=false,elapsed=0;
 const f=await fixture(t,{now:()=>Date.now()+elapsed,monitorMs:2,verifyTimeoutMs:45000,transportHealth:async()=>{
  if(!renewing)return{tunnel_online:true};checks++;
  if(checks===1)return{tunnel_online:false,awaiting_first_call:true}; // Candidate accepted.
  if(checks<=3){elapsed+=10000;if(checks===2)throw Error('first health response not yet available');return{tunnel_online:false};} // Canonical first poll still settling.
  return online?{tunnel_online:true}:{tunnel_online:false,awaiting_first_call:true};
 }});
 renewing=true;await f.r.renew();
 const pending=await settle(f.r,s=>s.phase==='blocked'||checks>=4&&s.phase==='restoring'&&s.actions.renew);
 assert.equal(pending.phase,'restoring');assert.equal(pending.verification.tunnel_online,false);
 assert.equal(pending.credential.renewal_pending,false);assert.equal(pending.credential.expiry_source,'estimated');
 online=true;const ready=await settle(f.r,s=>s.phase==='ready');assert.equal(ready.verification.tunnel_online,true);
 assert.equal(f.calls.filter(c=>c[0]==='task').length,1);assert.equal(f.calls.filter(c=>c[0]==='renew').length,1);
 assert.equal(f.calls.filter(c=>c[0]==='start').length,3,'old, candidate, then canonical only');
 assert.deepEqual(JSON.parse(await readFile(join(f.directory,'state.json'),'utf8')),f.before);
});
test('renewed canonical warmup is bounded and cannot label unknown health online',async t=>{
 let renewing=false,checks=0,elapsed=0,online=false;
 const f=await fixture(t,{now:()=>Date.now()+elapsed,monitorMs:2,verifyTimeoutMs:45000,transportHealth:async()=>{
  if(!renewing)return{tunnel_online:true};if(++checks===1)return{tunnel_online:false,awaiting_first_call:true};
  elapsed+=50000;return{tunnel_online:online};
 }});
 renewing=true;await f.r.renew();const blocked=await settle(f.r,s=>s.phase==='blocked');
 assert.equal(blocked.error.code,'CONNECTION_FAILED');assert.equal(blocked.verification.tunnel_online,false);
 assert.equal(blocked.credential.renewal_pending,false);assert.equal(blocked.last_verified_at,f.before.completed_at);
 online=true;await settle(f.r,s=>s.phase==='ready');assert.equal(f.calls.filter(c=>c[0]==='start').length,3);
});
test('renewal health supervision recovers a transient failure only after fresh online health without another grant or task',async t=>{
 let health='online';const f=await fixture(t,{monitorMs:2,transportHealth:async()=>{
  if(health==='error')throw Error('temporary health failure');
  return{tunnel_online:health==='online'};
 }});
 await f.r.renew();await settle(f.r,s=>s.phase==='ready'&&s.actions.renew);
 for(const unavailable of ['offline','error']){
  health=unavailable;const blocked=await settle(f.r,s=>s.phase==='blocked');
  assert.equal(blocked.error.code,'CONNECTION_FAILED');assert.equal(blocked.verification.tunnel_online,false);
  health='unknown';await sleep(20);assert.equal((await f.r.status()).phase,'blocked');
  health='online';const recovered=await settle(f.r,s=>s.phase==='ready');
  assert.equal(recovered.error,undefined);assert.equal(recovered.last_verified_at,f.before.completed_at);
 }
 assert.equal(f.calls.filter(c=>c[0]==='task').length,1);assert.equal(f.calls.filter(c=>c[0]==='renew').length,1);
 assert.equal(f.calls.filter(c=>c[0]==='start').length,3);
 assert.deepEqual(JSON.parse(await readFile(join(f.directory,'state.json'),'utf8')),f.before);
});
test('unaccepted candidate never overwrites the current key and restores its transport',async t=>{const f=await fixture(t);f.state.newKeyAccepted=false;await f.r.renew();const s=await settle(f.r,s=>s.phase==='blocked');assert.equal(s.error.code,'KEY_RENEW_UNVERIFIED');assert.equal(await readFile(join(f.directory,'runtime.key'),'utf8'),'old-synthetic-key');assert.equal(f.calls.filter(c=>c[0]==='start').at(-1)[1],'old-synthetic-key');assert.equal(s.credential.renewal_pending,true);assert.equal(s.purpose,'key-renewal');});
test('official confirmation handoff keeps the current transport and retry reuses the renewal',async t=>{const f=await fixture(t);f.state.handoff=true;await f.r.renew();const s=await settle(f.r,s=>s.phase==='blocked');assert.equal(s.waiting_for,'authorization');assert.equal(s.purpose,'key-renewal');assert.equal(f.calls.filter(c=>c[0]==='stop').length,0);f.state.handoff=false;await sleep(10);await f.r.resume();await settle(f.r,s=>['restoring','ready'].includes(s.phase)&&s.actions.renew);const ids=f.calls.filter(c=>c[0]==='renew').map(c=>c[1]);assert.equal(ids.length,2);assert.equal(new Set(ids).size,1);});
test('cancel renewal preserves activation and the original saved connection',async t=>{const f=await fixture(t);f.state.handoff=true;await f.r.renew();await settle(f.r,s=>s.phase==='blocked');await f.r.cancel();const s=await settle(f.r,s=>['ready','restoring'].includes(s.phase));assert.notEqual(s.purpose,'key-renewal');const after=JSON.parse(await readFile(join(f.directory,'state.json'),'utf8'));assert.equal(after.activated,true);assert.equal(after.request_id,f.before.request_id);assert.equal(await readFile(join(f.directory,'runtime.key'),'utf8'),'old-synthetic-key');});
test('missing Ego during renewal installs and resumes renewal without another first-connection task',async t=>{let unavailable=false,installs=0;const f=await fixture(t,{browser:()=>({prepare:async()=>{if(unavailable)throw Object.assign(Error('missing'),{code:'EGO_BROWSER_UNAVAILABLE'});}}),egoInstallerFactory:()=>({prepare:async()=>{installs++;unavailable=false;return{ready:true};}})});unavailable=true;await f.r.renew();assert.equal((await settle(f.r,s=>s.phase==='blocked')).error.code,'EGO_BROWSER_UNAVAILABLE');await sleep(10);await f.r.resume();await settle(f.r,s=>['ready','restoring'].includes(s.phase)&&s.actions.renew);assert.equal(installs,1);assert.equal(f.calls.filter(c=>c[0]==='task').length,1);assert.equal(f.calls.filter(c=>c[0]==='plugin').length,1);});
test('lost key capture is restarted only by an explicit action and keeps the original runtime key until accepted',async t=>{let lost=false,abandoned=0;const ids=[];const f=await fixture(t,{browser:({options})=>({renewRuntimeKey:async({renewalId})=>{ids.push(renewalId);if(lost)throw Object.assign(Error('lost'),{code:'ONBOARDING_KEY_RECOVERY'});await writeFile(join(options.directory,`runtime-next-${renewalId}.key`),'new-synthetic-key',{mode:0o600});return{candidate_saved:true,renewal_id:renewalId,creation_observed_at:new Date().toISOString(),lifetime_days:30,expiry_source:'creation_observed'};},abandonRenewal:async()=>{assert.equal(await readFile(options.runtimeKeyFile,'utf8'),'old-synthetic-key');abandoned++;lost=false;}})});lost=true;await f.r.renew();await settle(f.r,s=>s.phase==='blocked'&&s.actions.restart_key);await f.r.resume();await settle(f.r,s=>s.phase==='blocked'&&s.actions.restart_key);assert.equal(abandoned,0);assert.equal(new Set(ids).size,1);await f.r.restartkey();await settle(f.r,s=>['ready','restoring'].includes(s.phase)&&s.actions.renew);assert.equal(abandoned,1);assert.equal(new Set(ids).size,2);assert.equal(f.calls.filter(c=>c[0]==='task').length,1);});
test('a missing connection window requires an explicit reopen action and preserves renewal identity',async t=>{let missing=false,reopened=0;const f=await fixture(t,{browser:()=>({prepare:async()=>{if(missing)throw Object.assign(Error('missing space'),{code:'ONBOARDING_EGO_SPACE_MISSING'});},replaceMissingBinding:async()=>{reopened++;missing=false;return{reopened:true};}})});missing=true;await f.r.renew();const blocked=await settle(f.r,s=>s.phase==='blocked'&&s.actions.reopen);assert.equal(blocked.actions.open,false);assert.equal(reopened,0);const before=JSON.parse(await readFile(join(f.directory,'key-lifecycle.json'),'utf8')).renewal.id;await f.r.reopen();await settle(f.r,s=>['ready','restoring'].includes(s.phase)&&s.actions.renew);assert.equal(reopened,1);assert.equal(f.calls.filter(c=>c[0]==='renew').at(-1)[1],before);});
