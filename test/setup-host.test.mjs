import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,realpath,writeFile,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
import * as native from '../management-plugin/index.js';
async function token(t){const dir=await realpath(await mkdtemp(join(tmpdir(),'dot-setup-host-')));t.after(()=>rm(dir,{recursive:true,force:true}));const path=join(dir,'admin.key');await writeFile(path,'test-admin-'+'x'.repeat(48),{mode:0o600});return path;}
class TypertRemoteService{constructor(ctx){this.ctx=ctx;}}
class RemoteError extends Error{constructor(code,message,details){super(message);this.code=code;this.details=details;}}
test('busy backend keeps a public retryable code through trusted Host adapter',async t=>{
 const adapter=await native.createAdminAdapter({tokenFile:await token(t),fetchImpl:async()=>new Response(JSON.stringify({error:{code:'MANAGEMENT_BUSY',message:'private server detail'}}),{status:429})});t.after(()=>adapter.close());
 await assert.rejects(adapter.call('manager_overview',{}),error=>error.code==='MANAGEMENT_BUSY'&&!error.message.includes('private'));
});
test('Host-only setup calls never pass to the admin HTTP gateway and are owner restricted',async()=>{
 const calls=[],ctx={invocation:{peer:{principal:{kind:'owner'}}},typert:{register(){}}};
 const service=await native.mountManagement(ctx,{call:async()=>{throw Error('must not forward');}},{TypertRemoteService,RemoteError},{setup:{status:async()=>{calls.push('status');return{mode:'managed',phase:'setup_required'};}}});
 assert.deepEqual(await service.setupStatus({}),{mode:'managed',phase:'setup_required'});assert.deepEqual(calls,['status']);ctx.invocation.peer.principal.kind='external';await assert.rejects(service.setupStatus({}),error=>error.code==='dot-management/denied');assert.equal(calls.length,1);
});
test('Host exposes retryable busy to native UI without leaking original error',async()=>{
 const ctx={invocation:{peer:{principal:{kind:'owner'}}},typert:{register(){}}};
 const service=await native.mountManagement(ctx,{call:async()=>{throw Object.assign(Error('secret'),{code:'MANAGEMENT_BUSY'});}},{TypertRemoteService,RemoteError});
 await assert.rejects(service.overview({}),error=>error.code==='dot-management/busy'&&!error.message.includes('secret'));
});
test('external admin adapter rejects setup methods instead of forwarding them',async t=>{
 let count=0;const adapter=await native.createAdminAdapter({tokenFile:await token(t),fetchImpl:async()=>{count++;return new Response('{}');}});t.after(()=>adapter.close());await assert.rejects(adapter.call('manager_setup_start',{}),/invalid/i);assert.equal(count,0);
});
test('managed adapter shares one acquisition and closes late acquisition when lifecycle stops',async()=>{
 assert.equal(typeof native.createManagedAdapter,'function');let acquisitions=0,closed=0,release;const gate=new Promise(resolve=>release=resolve);
 const resource=native.createManagedAdapter({adminReference:async()=>{await gate;return{};}},{createAdapter:async()=>{acquisitions++;return{call:async()=>({ok:true}),close(){closed++;}};}});
 const one=resource.call('manager_overview',{}),two=resource.call('manager_overview',{});resource.reset();release();const results=await Promise.allSettled([one,two]);assert.equal(results.every(result=>result.status==='rejected'),true);assert.equal(acquisitions,1);assert.equal(closed,1);
 assert.deepEqual(await resource.call('manager_overview',{}),{ok:true});await resource.close();assert.equal(acquisitions,2);assert.equal(closed,2);await assert.rejects(resource.call('manager_overview',{}));
});
test('managed worker polling obtains its endpoint only from the owned runtime',async()=>{
 let references=0;const resource=native.createManagedAdapter({adminReference:async()=>({}),nativeWorkerReference:async()=>{references++;return'http://127.0.0.1:43117/native/';}},{createAdapter:async()=>({call:async()=>({native_control:null,native_worker_url:'https://foreign.invalid/'}),close(){}})});
 assert.deepEqual(await resource.call('manager_worker_poll',{}),{native_control:null,native_worker_url:'http://127.0.0.1:43117/native/'});assert.equal(references,1);await resource.close();
});
test('five owner-only connection operations return safe native views without gateway forwarding',async()=>{
 const ctx={invocation:{peer:{principal:{kind:'owner'}}},typert:{register(){}}},calls=[],safe={phase:'idle',verification:{dot_read:false}};
 const setup=Object.fromEntries(['status','start','resume','cancel','open'].map(op=>['connect_'+op,async()=>{calls.push(op);return safe;}]));
 const service=await native.mountManagement(ctx,{call:async()=>{throw Error('must not forward');}},{TypertRemoteService,RemoteError},{setup});
 for(const op of ['Status','Start','Resume','Cancel','Open'])assert.deepEqual(await service['setupConnect'+op]({}),safe);
 assert.deepEqual(calls,['status','start','resume','cancel','open']);await assert.rejects(service.setupConnectStart({url:'https://evil.test'}),e=>e.code==='dot-management/invalid-request');
 ctx.invocation.peer.principal.kind='external';await assert.rejects(service.setupConnectStart({}),e=>e.code==='dot-management/denied');assert.equal(calls.length,5);
});
test('existing external deployments expose explicit non-migrating connection state',async()=>{
 const ctx={invocation:{peer:{principal:{kind:'owner'}}},typert:{register(){}}};const service=await native.mountManagement(ctx,{call:async()=>{throw Error('must not forward');}},{TypertRemoteService,RemoteError});
 const status=await service.setupStatus({});assert.equal(status.mode,'external');assert.equal(status.connection_setup?.phase,'external');const connect=await service.setupConnectStatus({});assert.equal(connect.phase,'external');assert.equal(connect.actions.start,false);
});
