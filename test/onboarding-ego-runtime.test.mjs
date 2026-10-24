import {test} from 'node:test';import assert from 'node:assert/strict';import {createOnboardingRuntime} from '../management-plugin/src/onboarding-runtime.js';
import {mkdtemp,realpath,chmod,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {createOnboardingStore} from '../management-plugin/src/onboarding-store.js';
const until=async r=>{const deadline=Date.now()+20000;while(Date.now()<deadline){const s=await r.status();if(s.phase==='blocked')return s;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('not blocked');};
async function isolatedRuntime(t,code='ONBOARDING_EGO_CONTROL',step){
 const root=await realpath(await mkdtemp(join(tmpdir(),'dsh-ego-runtime-')));await chmod(root,0o700);const directory=join(root,'onboarding'),prepares=[];
 const store=createOnboardingStore({directory});
 const local={prepare:async()=>({phase:'prepared'}),start:async()=>({phase:'running'}),onboardingReference:async()=>({directory,mcpCommand:'synthetic'}),setCloudHealthFile:async()=>{}};
 const r=createOnboardingRuntime({local,store,browserFactory:()=>({prepare:async options=>{prepares.push(options);if(step)options.onProgress({step});throw Object.assign(Error('private OAuth URL'),{code});},close:async()=>{}})});t.after(async()=>{await r.close();await rm(root,{recursive:true,force:true});});return{r,prepares};
}
test('Ego dependency failure is actionable without exposing raw browser details',async t=>{const{r}=await isolatedRuntime(t,'EGO_BROWSER_UNAVAILABLE');await r.start();const s=await until(r);assert.equal(s.error.code,'EGO_BROWSER_UNAVAILABLE');assert.match(s.message+s.error.message,/Ego/);assert.doesNotMatch(JSON.stringify(s),/OAuth/);});
test('only explicit resume authorizes taking over a handed-off Ego Space',async t=>{const{r,prepares}=await isolatedRuntime(t);await r.start();await until(r);await new Promise(resolve=>setImmediate(resolve));await r.resume();await until(r);await new Promise(resolve=>setImmediate(resolve));await r.restore();await until(r);assert.deepEqual(prepares.map(p=>p.resumeAuthorized),[false,true,false]);});
test('key handoff retains the specific instruction to keep the save dialog open and continue without copying',async t=>{const{r}=await isolatedRuntime(t,'ONBOARDING_EGO_HANDOFF','key_confirm');await r.start();const status=await until(r);assert.equal(status.step,'key_confirm');assert.match(status.message,/保留.*保存密钥/);assert.match(status.message,/继续连接/);assert.match(status.message,/无需复制/);assert.equal(status.error.message,status.message);assert.equal(status.actions.resume,true);});
