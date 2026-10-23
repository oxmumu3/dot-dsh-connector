import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,symlink,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCore} from '../src/core.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function fixture(t){
 const root=await realpath(await mkdtemp(join(tmpdir(),'dot-core-')));t.after(()=>rm(root,{recursive:true,force:true}));
 await writeFile(join(root,'README.md'),'public context');
 let state=null;let count=0;let cb;let job;
 const store={load:async()=>structuredClone(state),save:async value=>{state=structuredClone(value);}};
 const executor={start:async(j,{onEvent})=>{count++;cb=onEvent;job=j;},cancel:async()=>{}};
 const config={projects:[{id:'public',label:'Public',root,contextFiles:['README.md'],principals:['owner'],public:true}],store,executor};
 const core=await createCore(config);t.after(()=>core.close());
 const start=()=>core.call('owner','start_task',{project_id:'public',task:'Summarize',request_id:'req-1'});
 const emit=event=>cb({session_id:job.session_id,...event});
 return{root,core,start,emit,config,store,get state(){return state;},get count(){return count;},get job(){return job;}};
}
test('only configured public projects are discoverable and context has sources',async t=>{
 const f=await fixture(t);assert.deepEqual(await f.core.call('stranger','list_projects',{}),{projects:[]});
 await assert.rejects(f.core.call('stranger','read_project_context',{project_id:'public'}),/denied/);
 const result=await f.core.call('owner','read_project_context',{project_id:'public'});
 assert.equal(result.files[0].text,'public context');assert.match(result.files[0].sha256,/^[a-f0-9]{64}$/);assert.equal(result.files[0].path,'README.md');assert.equal(JSON.stringify(result).includes(f.root),false);
});
test('context rejects traversal, symlinks and oversized reads',async t=>{
 const f=await fixture(t);await f.core.close();
 await symlink(join(f.root,'README.md'),join(f.root,'linked.md'));
 for(const path of ['../outside','linked.md']){
 const core=await createCore({...f.config,projects:[{...f.config.projects[0],contextFiles:[path]}]});
 await assert.rejects(core.call('owner','read_project_context',{project_id:'public'}));await core.close();
 }
 await writeFile(join(f.root,'README.md'),'x'.repeat(32769));
 const core=await createCore(f.config);await assert.rejects(core.call('owner','read_project_context',{project_id:'public'}),/limit/);await core.close();
});
test('start returns job before execution, dedupes retries and rejects changed payload',async t=>{
 const f=await fixture(t);const first=await f.start();assert.equal(first.status,'accepted');assert.equal(f.count,0);
 const second=await f.start();assert.equal(first.job_id,second.job_id);
 await assert.rejects(f.core.call('owner','start_task',{project_id:'public',task:'Changed',request_id:'req-1'}),/conflict/);
 await tick();assert.equal(f.count,1);assert.ok(f.job.session_id&&f.job.message_id);
 await assert.rejects(f.core.call('stranger','get_task',{job_id:first.job_id}),/denied/);
});
test('only exact message claim and completed turn expose result with provenance',async t=>{
 const f=await fixture(t);const {job_id}=await f.start();await tick();
 await f.emit({type:'assistant/message',turn:1,text:'unclaimed'});
 await f.emit({type:'turn/end',turn:1,reason:'completed'});
 assert.equal((await f.core.call('owner','get_task',{job_id})).status,'starting');
 await f.emit({type:'user/message',message_id:f.job.message_id,turn:2,source:'user'});
 await f.emit({type:'assistant/message',turn:999,text:'wrong turn'});
 await f.emit({type:'assistant/message',turn:2,text:'real result'});
 await f.emit({type:'turn/end',turn:2,reason:'completed'});
 const result=await f.core.call('owner','get_task',{job_id});assert.equal(result.status,'succeeded');assert.equal(result.result,'real result');assert.equal(result.turn,2);assert.equal(result.session_id,f.job.session_id);assert.equal(result.message_id,f.job.message_id);assert.equal(result.acceptance,'unverified');
});
test('mixed direct input and failed turn cannot leak partial reply',async t=>{
 const f=await fixture(t);const {job_id}=await f.start();await tick();
 await f.emit({type:'user/message',message_id:f.job.message_id,turn:2,source:'user'});
 await f.emit({type:'assistant/message',turn:2,text:'partial'});
 await f.emit({type:'user/message',message_id:'foreign',turn:2,source:'user'});
 await f.emit({type:'turn/end',turn:2,reason:'completed'});
 const result=await f.core.call('owner','get_task',{job_id});assert.equal(result.status,'failed');assert.equal(result.result,null);assert.equal(result.reason,'mixed_input');
});
test('cancel is pending until terminal event, never idle inference',async t=>{
 const f=await fixture(t);const {job_id}=await f.start();await tick();
 await f.emit({type:'user/message',message_id:f.job.message_id,turn:1,source:'user'});
 assert.equal((await f.core.call('owner','cancel_task',{job_id})).status,'cancel_requested');
 await f.emit({type:'turn/end',turn:1,reason:'aborted'});
 assert.equal((await f.core.call('owner','get_task',{job_id})).status,'cancelled');
});
test('restart marks unfinished job unknown and never replays request',async t=>{
 const f=await fixture(t);const {job_id}=await f.start();await tick();await f.core.close();
 const next=await createCore(f.config);t.after(()=>next.close());
 const result=await next.call('owner','get_task',{job_id});assert.equal(result.status,'unknown');
 assert.equal((await next.call('owner','start_task',{project_id:'public',task:'Summarize',request_id:'req-1'})).job_id,job_id);await tick();assert.equal(f.count,1);
});
test('unknown fields, invalid inputs, or nonpublic config fail closed',async t=>{
 const f=await fixture(t);await assert.rejects(f.core.call('owner','start_task',{project_id:'public',task:'read',request_id:'a',principal:'stranger'}));
 await assert.rejects(createCore({...f.config,projects:[{...f.config.projects[0],public:false}]}));
});
test('bounded response labels truncation and does not expose failed partial output',async t=>{
 const f=await fixture(t);const {job_id}=await f.start();await tick();
 await f.emit({type:'user/message',message_id:f.job.message_id,turn:1,source:'user'});
 await f.emit({type:'assistant/message',turn:1,text:'山'.repeat(8001)});
 await f.emit({type:'turn/end',turn:1,reason:'completed'});
 const result=await f.core.call('owner','get_task',{job_id});assert.equal(result.result.length,8000);assert.equal(result.result_truncated,true);
});
test('foreign scheduled or agent inbox claims also make the result mixed',async t=>{
 for(const source of ['schedule','agent-message','unknown']){
  const f=await fixture(t);const {job_id}=await f.start();await tick();
  await f.emit({type:'user/message',message_id:f.job.message_id,turn:1,source:'user'});
  await f.emit({type:'assistant/message',turn:1,text:'partial'});
  await f.emit({type:'user/message',message_id:'foreign',turn:1,source});
  await f.emit({type:'turn/end',turn:1,reason:'completed'});
  const result=await f.core.call('owner','get_task',{job_id});assert.equal(result.status,'failed');assert.equal(result.reason,'mixed_input');assert.equal(result.result,null);
 }
});
