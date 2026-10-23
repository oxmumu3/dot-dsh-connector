import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

async function api(){const value=await import('../scripts/harness-read.mjs').catch(()=>({}));assert.equal(typeof value.launchHarnessRead,'function','independent read-only host launcher required');return value;}
async function fixture(t){const root=await realpath(await mkdtemp(join(tmpdir(),'harness-read-host-')));const home=join(root,'.dsh');await mkdir(home);t.after(()=>rm(root,{recursive:true,force:true}));return{config:{enabled:true,scope:'owner-harness-read-only',dshHome:home,principal:'owner',tokenEnv:'DOT_DSH_TOKEN',port:0},token:'synthetic-only-channel-token-12345678901234567890'};}
async function call(host,token,tool,args={}){const res=await fetch(host.url,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({tool,args})});return{status:res.status,body:await res.json()};}

test('read host serves fixed-principal tools and rejects task mutation before storage calls',async t=>{
 const f=await fixture(t);const {launchHarnessRead}=await api();let calls=0,closed=0;const host=await launchHarnessRead({...f,storageFactory:async()=>({rpc:async()=>{calls++;return{items:[]};},close:async()=>{closed++;}})});t.after(()=>host.close());const page=await call(host,f.token,'harness_list_workspaces');assert.equal(page.status,200);assert.equal(page.body.result.total,0);const before=calls;const denied=await call(host,f.token,'start_task',{project_id:'p',task:'do not run',request_id:'r'});assert.notEqual(denied.status,200);assert.equal(calls,before);assert.equal((await call(host,'invalid','harness_status')).status,401);await host.close();await host.close();assert.equal(closed,1);
});
test('disabled or unacknowledged scope fails before acquiring storage',async t=>{
 const f=await fixture(t);const {launchHarnessRead}=await api();let opened=0;const storageFactory=async()=>{opened++;throw new Error('must remain inert');};for(const config of [{...f.config,enabled:false},{...f.config,scope:undefined}])await assert.rejects(launchHarnessRead({...f,config,storageFactory}));assert.equal(opened,0);
});
test('read concurrency is bounded without an unbounded queue',async t=>{
 const f=await fixture(t);const {launchHarnessRead}=await api();const both=Promise.withResolvers(),release=Promise.withResolvers();let calls=0;const host=await launchHarnessRead({...f,storageFactory:async()=>({rpc:async()=>{calls++;if(calls===2)both.resolve();await release.promise;return{items:[]};},close:async()=>{}})});t.after(()=>host.close());const first=call(host,f.token,'harness_list_workspaces'),second=call(host,f.token,'harness_list_workspaces');await both.promise;const third=await call(host,f.token,'harness_list_workspaces');assert.notEqual(third.status,200);assert.equal(calls,2);release.resolve();assert.equal((await first).status,200);assert.equal((await second).status,200);
});
test('startup abort disposes storage returned after the abort',async t=>{
 const f=await fixture(t);const {launchHarnessRead}=await api();const entered=Promise.withResolvers(),release=Promise.withResolvers();let closed=0;const controller=new AbortController();const pending=launchHarnessRead({...f,signal:controller.signal,storageFactory:async()=>{entered.resolve();await release.promise;return{rpc:async()=>({items:[]}),close:async()=>{closed++;}};}});await entered.promise;controller.abort();release.resolve();await assert.rejects(pending);assert.equal(closed,1);
});
test('operator supplemental contexts are passed to storage and validated before acquisition',async t=>{
 const f=await fixture(t);const {launchHarnessRead}=await api();const extraWorkspaces=[{workspaceId:'global-instructions',path:f.config.dshHome,title:'Harness instructions',contextKind:'instructions',sessionIds:[]}];let seen;const host=await launchHarnessRead({...f,config:{...f.config,extraWorkspaces},storageFactory:async options=>{seen=options;return{rpc:async()=>({items:[]}),close:async()=>{}};}});t.after(()=>host.close());assert.deepEqual(seen.extraWorkspaces,extraWorkspaces);for(const invalid of [[{...extraWorkspaces[0],contextKind:'arbitrary'}],[{...extraWorkspaces[0],sessionIds:['foreign']}],Array(101).fill(extraWorkspaces[0])])await assert.rejects(launchHarnessRead({...f,config:{...f.config,extraWorkspaces:invalid},storageFactory:async()=>{throw new Error('must not open');}}));
});
