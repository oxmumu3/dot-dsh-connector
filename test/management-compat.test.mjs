import {test} from 'node:test';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,realpath,writeFile,readFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createAdminAdapter,mountManagement} from '../management-plugin/index.js';
const run=promisify(execFile),root=fileURLToPath(new URL('../',import.meta.url));
const TOKEN='synthetic-legacy-channel-token-01234567890',ADMIN='synthetic-legacy-admin-token-01234567890';
async function fixture(t){const directory=await realpath(await mkdtemp(join(tmpdir(),'dot-legacy-compat-')));const resources=[];t.after(async()=>{for(const resource of resources)await resource.close();await rm(directory,{recursive:true,force:true});});const tokenFile=join(directory,'admin.key');await writeFile(tokenFile,ADMIN,{mode:0o600});return{directory,tokenFile,resources};}
async function oldHost(t){
 const f=await fixture(t),archive=join(f.directory,'base.tar');
 const bytes=await readFile(new URL('./fixtures/legacy-management-caf1cb1.tar.gz',import.meta.url));assert.equal(createHash('sha256').update(bytes).digest('hex'),'dfe63b25cb80eda84d26b046aacf4c519ab2e98762d8db3b8f0e2a3f036f92f9');await writeFile(archive,bytes);await run('tar',['-xf',archive,'-C',f.directory]);
 await symlink(join(root,'node_modules'),join(f.directory,'node_modules'));
 const {launchManagement}=await import(pathToFileURL(join(f.directory,'scripts/management.mjs')));
 const host=await launchManagement({config:{enabled:true,principal:'owner',stateDir:join(f.directory,'audit'),readUrl:'http://127.0.0.1:1/rpc',nativeExecution:true,gatewayPort:0,adminPort:0,workerPort:0},channelToken:TOKEN,adminToken:ADMIN,forward:async()=>({})});f.resources.push(host);
 const calls=[],adapter=await createAdminAdapter({tokenFile:f.tokenFile,url:host.adminUrl,fetchImpl:(url,options)=>{calls.push(JSON.parse(options.body));return fetch(url,options);}});f.resources.unshift(adapter);return{...f,host,adapter,calls};
}
async function rpc(url,token,tool,args={}){const response=await fetch(url,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({tool,args})});return{status:response.status,value:await response.json()};}

test('new Host adapter reads actual caf1cb1 manager and preserves existing pause/list/get/cancel',async t=>{
 const {host,adapter,calls}=await oldHost(t);
 const start=await rpc(host.gatewayUrl,TOKEN,'harness_start_task',{workspace_id:'legacy-workspace',task:'Read the project instructions.',request_id:'legacy-task'});assert.equal(start.status,200);const id=start.value.result.job_id;
 const overview=await adapter.call('manager_overview',{include_control:false});assert.equal(overview.management_protocol.version,1);assert.equal(overview.management_protocol.features.archive,false);assert.equal(Object.hasOwn(overview,'native_control'),false);
 const list=await adapter.call('manager_jobs',{offset:0,limit:20,archived:false});assert.equal(list.items[0].job_id,id);assert.deepEqual(calls.find(call=>call.tool==='manager_jobs').args,{offset:0,limit:20});
 assert.equal((await adapter.call('manager_job',{job_id:id})).job.job_id,id);
 assert.deepEqual(await adapter.call('manager_set_paused',{paused:true}),{paused:true});assert.equal((await adapter.call('manager_overview',{include_control:false})).admission.paused,true);
 assert.equal((await adapter.call('manager_cancel',{job_id:id})).job.job_id,id);
 for(const [tool,args] of [['manager_archive',{job_id:id,archived:true}],['manager_followup',{job_id:id,task:'Again',request_id:'r2'}],['manager_jobs',{archived:true}],['manager_jobs',{workspace_id:'legacy-workspace'}],['manager_jobs',{request_id:'legacy-task'}]])await assert.rejects(adapter.call(tool,args),error=>error.code==='UNSUPPORTED');
 assert.equal(calls.some(call=>['manager_archive','manager_followup','manager_worker_poll'].includes(call.tool)),false);
});

test('read-only overview preserves an actual legacy native offer for worker claim',async t=>{
 const {host,adapter}=await oldHost(t);
 const start=await rpc(host.gatewayUrl,TOKEN,'harness_start_task',{workspace_id:'legacy-workspace',task:'Do not execute; test claim routing only.',request_id:'offer-route'});assert.equal(start.status,200);
 const overview=await adapter.call('manager_overview',{include_control:false});assert.equal(Object.hasOwn(overview,'native_control'),false);
 const worker=await adapter.call('manager_worker_poll',{});assert.ok(worker.native_control?.claim_token);
 const offer=worker.native_control,response=await fetch(host.nativeWorkerUrl+'/native/claim',{method:'POST',headers:{origin:'dsh-app://app',authorization:`Bearer ${offer.claim_token}`,'content-type':'application/json'},body:JSON.stringify({command_id:offer.command_id,claim_token:offer.claim_token,client_id:'compat-test'})});assert.equal(response.status,200);
 const claim=(await response.json()).result;assert.equal(claim.command.job_id,start.value.result.job_id);assert.equal((await adapter.call('manager_worker_poll',{})).native_control,null);
});

test('failed protocol handshake is never interpreted as legacy and is retried after failure',async t=>{
 const {tokenFile}=await fixture(t),calls=[];let denied=true;
 const adapter=await createAdminAdapter({tokenFile,fetchImpl:async(_url,options)=>{const request=JSON.parse(options.body);calls.push(request);if(denied)return new Response(JSON.stringify({error:{code:'MANAGEMENT_DENIED'}}),{status:403});return new Response(JSON.stringify({result:{connection:{state:'connected'},management_protocol:{version:2,features:{task_filters:true,archive:true,followup:true,worker_poll:true}}}}));}});t.after(()=>adapter.close());
 await assert.rejects(adapter.call('manager_jobs',{}),error=>error.code==='UNAVAILABLE');assert.deepEqual(calls,[{tool:'manager_overview',args:{}}]);
 denied=false;await adapter.call('manager_jobs',{});assert.deepEqual(calls.map(call=>call.tool),['manager_overview','manager_overview','manager_jobs']);
});

test('unsupported is distinct from unavailable through the Host Remote boundary',async()=>{
 class TypertRemoteService{constructor(ctx){this.ctx=ctx;}}class RemoteError extends Error{constructor(code,message){super(message);this.code=code;}}
 const ctx={invocation:{peer:{principal:{kind:'owner'}}},typert:{register(){}}};const service=await mountManagement(ctx,{call:async()=>{throw Object.assign(new Error('private detail'),{code:'UNSUPPORTED'});}},{TypertRemoteService,RemoteError});
 await assert.rejects(service.archive({job_id:'native_job_00000000-0000-4000-8000-000000000000'}),error=>error.code==='dot-management/unsupported'&&!error.message.includes('private'));
});

test('concurrent first reads share one handshake and offer is handed to a worker only once',async t=>{
 const {tokenFile}=await fixture(t),calls=[],offer={command_id:'command-one',claim_token:'x'.repeat(43),expires_at:new Date(Date.now()+60000).toISOString()};let count=0;
 const adapter=await createAdminAdapter({tokenFile,fetchImpl:async(_url,options)=>{calls.push(JSON.parse(options.body));return new Response(JSON.stringify({result:{connection:{state:'connected'},native_control:count++===0?offer:null}}));}});t.after(()=>adapter.close());
 const [view,first,second]=await Promise.all([adapter.call('manager_overview',{include_control:false}),adapter.call('manager_worker_poll',{}),adapter.call('manager_worker_poll',{})]);
 assert.equal(Object.hasOwn(view,'native_control'),false);assert.deepEqual(first.native_control,offer);assert.equal(second.native_control,null);assert.equal(calls.length,2);assert.equal(calls.every(call=>call.tool==='manager_overview'&&Object.keys(call.args).length===0),true);
});

test('expired handshake offers are discarded rather than replayed to worker',async t=>{
 const {tokenFile}=await fixture(t);let now=Date.now(),count=0;t.mock.method(Date,'now',()=>now);
 const offer={command_id:'command-expired',claim_token:'x'.repeat(43),expires_at:new Date(now+1000).toISOString()};
 const adapter=await createAdminAdapter({tokenFile,fetchImpl:async()=>new Response(JSON.stringify({result:{connection:{state:'connected'},native_control:count++===0?offer:null}}))});t.after(()=>adapter.close());
 await adapter.call('manager_overview',{include_control:false});now+=1001;assert.equal((await adapter.call('manager_worker_poll',{})).native_control,null);assert.equal(count,2);
});

test('successful overview discovers a later v2 manager without reloading the Host adapter',async t=>{
 const {tokenFile}=await fixture(t),calls=[];let upgraded=false;
 const modern={version:2,features:{task_filters:true,archive:true,followup:true,worker_poll:true}};
 const adapter=await createAdminAdapter({tokenFile,fetchImpl:async(_url,options)=>{const request=JSON.parse(options.body);calls.push(request);return new Response(JSON.stringify({result:request.tool==='manager_overview'?{connection:{state:'connected'},...upgraded?{management_protocol:modern}:{}}:{items:[],total:0}}));}});t.after(()=>adapter.close());
 assert.equal((await adapter.call('manager_overview',{include_control:false})).management_protocol.version,1);upgraded=true;
 assert.equal((await adapter.call('manager_overview',{include_control:false})).management_protocol.version,2);
 await adapter.call('manager_jobs',{workspace_id:'new-project',archived:true});assert.deepEqual(calls.at(-1),{tool:'manager_jobs',args:{workspace_id:'new-project',archived:true}});
});

test('invalid later overview protocol is rejected without downgrading known capabilities',async t=>{
 const {tokenFile}=await fixture(t);let invalid=false;
 const modern={version:2,features:{task_filters:true,archive:true,followup:true,worker_poll:true}};
 const adapter=await createAdminAdapter({tokenFile,fetchImpl:async(_url,options)=>new Response(JSON.stringify({result:JSON.parse(options.body).tool==='manager_overview'?{connection:{state:'connected'},management_protocol:invalid?{version:99}:modern}:{items:[],total:0}}))});t.after(()=>adapter.close());
 await adapter.call('manager_overview',{include_control:false});invalid=true;await assert.rejects(adapter.call('manager_overview',{include_control:false}),error=>error.code==='UNAVAILABLE');
 assert.deepEqual(await adapter.call('manager_jobs',{workspace_id:'still-supported'}),{items:[],total:0});
});
