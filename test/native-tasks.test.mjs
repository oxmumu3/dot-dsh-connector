import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createNativeTasks} from '../src/native-tasks.js';

function fixture(){
 let value=null,time=Date.parse('2026-10-22T12:00:00Z'),saves=0;
 const store={load:async()=>structuredClone(value),save:async next=>{value=structuredClone(next);saves++;},close:async()=>{}};
 return {store,now:()=>new Date(time),advance:ms=>{time+=ms;},state:()=>structuredClone(value),saves:()=>saves};
}
async function setup(t){const f=fixture();const core=await createNativeTasks({store:f.store,principal:'owner',now:f.now});t.after(()=>core.close());return {...f,core};}
const start=(core,request_id='request-one',task='Implement the requested project change')=>core.call('owner','harness_start_task',{workspace_id:'workspace-one',request_id,task});
async function lease(core,client_id='worker-one'){
 const offer=await core.offer('owner');assert.ok(offer);
 const claim=await core.claim({command_id:offer.command_id,claim_token:offer.claim_token,client_id});
 return {...claim,client_id};
}
function ok(l,extra={}){return{ok:true,session_id:l.command.session_id,workspace_id:l.command.workspace_id,cwd:'/workspace/project',...extra};}
const report=(core,l,result)=>core.report({command_id:l.command.command_id,lease_token:l.lease_token,client_id:l.client_id,result});
async function createdAndPrompted(core){
 const job=await start(core),create=await lease(core);assert.equal(create.command.action,'create');
 await report(core,create,ok(create));const prompt=await lease(core);assert.equal(prompt.command.action,'prompt');
 await report(core,prompt,ok(prompt,{accepted:true}));return{job,prompt};
}
function completed(prompt,{startSeq=1,text='Finished the project change',reason='completed'}={}){
 return[
  {type:'turn/start',seq:startSeq,turn:3},
  {type:'user/message',seq:startSeq+1,turn:3,message_id:'a8f6fed7-5186-4912-a254-206f92363921',source_rpc_id:prompt.command.request_id,source_kind:'user'},
  {type:'assistant/message',seq:startSeq+2,turn:3,text,interrupted:false},
  {type:'turn/end',seq:startSeq+3,turn:3,reason},
 ];
}

test('native tasks persist real workspace intent and idempotency without exposing any capability',async t=>{
 const f=await setup(t),a=await start(f.core,'same','Read and modify the selected project');
 assert.match(a.job_id,/^native_job_/);assert.match(a.session_id,/^dsh_dot_/);assert.equal(a.message_id,null);assert.equal(a.turn,null);assert.equal(a.status,'accepted');
 assert.equal(f.state().version,2);assert.equal(f.state().jobs.length,1);assert.equal(f.state().commands.length,1);
 assert.equal((await start(f.core,'same','Read and modify the selected project')).job_id,a.job_id);
 await assert.rejects(start(f.core,'same','Different request'),e=>e.code==='NATIVE_CONFLICT');
 assert.equal(f.state().jobs.length,1);
 const offer=await f.core.offer('owner');assert.ok(offer.claim_token);
 assert.doesNotMatch(JSON.stringify(f.core.job(a.job_id)),new RegExp(offer.claim_token));
});

test('owner, strict input, foreign jobs and arbitrary native session selectors fail before dispatch',async t=>{
 const {core,state}=await setup(t);await start(core);
 for(const [owner,tool,args]of [
  ['other','harness_start_task',{workspace_id:'workspace-one',request_id:'r',task:'task'}],
  ['owner','harness_start_task',{workspace_id:'workspace-one',request_id:'r',task:'task',cwd:'/untrusted'}],
  ['owner','harness_cancel_task',{job_id:'dsh_dot_foreign'}],
  ['owner','harness_followup_task',{job_id:'native_job_00000000-0000-4000-8000-000000000001',request_id:'r',task:'task'}],
 ])await assert.rejects(core.call(owner,tool,args),e=>['NATIVE_DENIED','NATIVE_INVALID'].includes(e.code));
 await assert.rejects(core.offer('other'),e=>e.code==='NATIVE_DENIED');assert.equal(state().commands.length,1);
});

test('a command is atomically claimed by one client and its report is authenticated and idempotent',async t=>{
 const {core}=await setup(t);await start(core);const offer=await core.offer('owner');
 await assert.rejects(core.claim({...offer,client_id:'one'}),e=>e.code==='NATIVE_INVALID');
 const clients=['one','two'],results=await Promise.allSettled(clients.map(client_id=>core.claim({command_id:offer.command_id,claim_token:offer.claim_token,client_id})));
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(results.filter(x=>x.status==='rejected'&&x.reason.code==='NATIVE_DENIED').length,1);
 const winner=results.findIndex(x=>x.status==='fulfilled'),claim=results[winner].value,l={...claim,client_id:clients[winner]};
 await assert.rejects(core.report({command_id:offer.command_id,lease_token:claim.lease_token,client_id:clients[1-winner],result:ok(l)}),e=>e.code==='NATIVE_DENIED');
 const first=await report(core,l,ok(l));assert.equal(first.accepted,true);assert.equal((await report(core,l,ok(l))).duplicate,true);
 await assert.rejects(report(core,l,ok(l,{running:true})),e=>e.code==='NATIVE_CONFLICT');
});

test('create and prompt are separate durable commands and only exact correlated terminal events prove success',async t=>{
 const {core}=await setup(t),{job,prompt}=await createdAndPrompted(core);
 assert.equal(core.job(job.job_id).message_id,null);assert.equal(core.job(job.job_id).status,'running');
 await core.call('owner','harness_get_task',{job_id:job.job_id});const inspect=await lease(core);assert.equal(inspect.command.action,'inspect');
 await report(core,inspect,ok(inspect,{running:false,events:completed(prompt)}));
 const result=core.job(job.job_id);assert.equal(result.status,'succeeded');assert.equal(result.turn,3);assert.equal(result.message_id,'a8f6fed7-5186-4912-a254-206f92363921');assert.equal(result.result,'Finished the project change');
 assert.equal(result.acceptance,'unverified');assert.ok(result.finished_at);
});

test('native idle, text and wrong-turn completion cannot manufacture success',async t=>{
 const {core}=await setup(t),{job,prompt}=await createdAndPrompted(core);
 await core.call('owner','harness_get_task',{job_id:job.job_id});let inspect=await lease(core);
 await report(core,inspect,ok(inspect,{running:false,events:[{type:'assistant/message',seq:1,turn:99,text:'Uncorrelated text'},{type:'turn/end',seq:2,turn:99,reason:'completed'}]}));
 assert.notEqual(core.job(job.job_id).status,'succeeded');assert.equal(core.job(job.job_id).result,null);
 await core.call('owner','harness_get_task',{job_id:job.job_id});inspect=await lease(core);
 await report(core,inspect,ok(inspect,{running:true,pending_approvals:1,user_question_count:1,events:[{type:'user/message',seq:3,turn:3,message_id:'a8f6fed7-5186-4912-a254-206f92363921',source_rpc_id:prompt.command.request_id,source_kind:'user'}]}));
 const result=core.job(job.job_id);assert.equal(result.status,'running');assert.equal(result.pending_approvals,1);assert.equal(result.user_question_count,1);assert.equal(result.finished_at,null);
});

test('followup creates a new owned attempt in the same session and refuses stale parents',async t=>{
 const {core}=await setup(t),{job,prompt}=await createdAndPrompted(core);
 await assert.rejects(core.call('owner','harness_followup_task',{job_id:job.job_id,request_id:'follow','task':'Continue'}),e=>e.code==='NATIVE_CONFLICT');
 await core.call('owner','harness_get_task',{job_id:job.job_id});const inspect=await lease(core);await report(core,inspect,ok(inspect,{running:false,events:completed(prompt)}));
 const follow=await core.call('owner','harness_followup_task',{job_id:job.job_id,request_id:'follow','task':'Now run the project verification'});
 assert.notEqual(follow.job_id,job.job_id);assert.equal(follow.session_id,job.session_id);assert.equal(follow.parent_job_id,job.job_id);assert.equal(follow.root_job_id,job.job_id);assert.equal(follow.message_id,null);
 assert.equal((await core.call('owner','harness_followup_task',{job_id:job.job_id,request_id:'follow','task':'Now run the project verification'})).job_id,follow.job_id);
 await assert.rejects(core.call('owner','harness_followup_task',{job_id:job.job_id,request_id:'stale','task':'Another instruction'}),e=>e.code==='NATIVE_CONFLICT');
 const next=await lease(core);assert.equal(next.command.action,'prompt');assert.equal(next.command.session_id,job.session_id);assert.notEqual(next.command.request_id,prompt.command.request_id);
});

test('cancel before any native claim prevents dispatch, while native cancellation remains pending until evidence',async t=>{
 const {core}=await setup(t),early=await start(core,'early');
 assert.equal((await core.call('owner','harness_cancel_task',{job_id:early.job_id})).status,'cancelled');assert.equal(await core.offer('owner'),null);
 const {job,prompt}=await createdAndPrompted(core);
 assert.equal((await core.call('owner','harness_cancel_task',{job_id:job.job_id})).status,'cancel_requested');
 const cancel=await lease(core);assert.equal(cancel.command.action,'cancel');await report(core,cancel,ok(cancel,{cancel_requested:true}));
 assert.equal(core.job(job.job_id).status,'cancel_requested');
 await core.call('owner','harness_get_task',{job_id:job.job_id});const inspect=await lease(core);await report(core,inspect,ok(inspect,{running:false,events:completed(prompt,{reason:'aborted'})}));
 assert.equal(core.job(job.job_id).status,'cancelled');assert.equal(core.job(job.job_id).result,null);
});

test('claimed create expiry becomes unknown and only an inspect is issued afterwards',async t=>{
 const {core,advance}=await setup(t),job=await start(core),create=await lease(core);assert.equal(create.command.action,'create');
 advance(120000);assert.equal((await core.call('owner','harness_get_task',{job_id:job.job_id})).status,'unknown');
 const inspect=await lease(core);assert.equal(inspect.command.action,'inspect');
 await assert.rejects(report(core,create,ok(create)),e=>e.code==='NATIVE_DENIED');
 await report(core,inspect,ok(inspect,{running:false,events:[]}));assert.notEqual(core.job(job.job_id).status,'succeeded');
 assert.equal(await core.offer('owner'),null);
});

test('restart never replays an unfinished native mutation and retains its owned identity for inspection',async()=>{
 const f=fixture(),first=await createNativeTasks({store:f.store,principal:'owner',now:f.now});const job=await start(first);await lease(first);await first.close();
 const second=await createNativeTasks({store:f.store,principal:'owner',now:f.now});
 try{assert.equal(second.job(job.job_id).status,'unknown');assert.equal(await second.offer('owner'),null);assert.equal((await start(second)).job_id,job.job_id);await second.call('owner','harness_get_task',{job_id:job.job_id});assert.equal((await lease(second)).command.action,'inspect');}
 finally{await second.close();}
});

test('worker result identity, strict report shape and untrusted failure text cannot alter another task',async t=>{
 const {core}=await setup(t),job=await start(core),create=await lease(core);
 await assert.rejects(report(core,create,ok(create,{session_id:'dsh_dot_00000000-0000-4000-8000-000000000001'})),e=>e.code==='NATIVE_DENIED');
 await assert.rejects(report(core,create,{ok:false,error_code:'secret-raw-error'}),e=>e.code==='NATIVE_INVALID');
 await report(core,create,{ok:false,error_code:'IDENTITY_MISMATCH'});
 const result=core.job(job.job_id);assert.equal(result.status,'unknown');assert.equal(result.result,null);assert.equal(await core.offer('owner'),null);
});

test('public result redacts sensitive text and bounds Unicode without dumping full results in the list',async t=>{
 const {core}=await setup(t),{job,prompt}=await createdAndPrompted(core);await core.call('owner','harness_get_task',{job_id:job.job_id});const inspect=await lease(core);
 const text='api_key=sk-synthetic012345678901234567890123456789\n'+'字'.repeat(18000);
 await report(core,inspect,ok(inspect,{running:false,events:completed(prompt,{text})}));
 const result=core.job(job.job_id);assert.ok(Array.from(result.result).length<=16000);assert.equal(result.result_truncated,true);assert.ok(!result.result.includes('sk-synthetic012345678901234567890123456789'));
 const list=core.jobs({offset:0,limit:10});assert.equal(list.total,1);assert.equal(Object.hasOwn(list.items[0],'result'),false);assert.equal(Object.hasOwn(list.items[0],'prompt_request_id'),false);
});

test('live native tasks receive read-only inspections without an execution deadline or forced cancellation',async t=>{
 const {core,advance}=await setup(t),{job}=await createdAndPrompted(core);advance(5000);const next=await lease(core);assert.equal(next.command.action,'inspect');
 await report(core,next,ok(next,{running:true,pending_approvals:2,events:[]}));advance(10*60*1000);
 assert.equal(core.job(job.job_id).status,'running');const poll=await lease(core);assert.equal(poll.command.action,'inspect');assert.equal(core.overview().jobs_total,1);
});

test('registered native identifiers and cwd accept ordinary letters and numbers but reject real controls',async t=>{
 const {core}=await setup(t);
 const job=await core.call('owner','harness_start_task',{workspace_id:'registered-project-u123',request_id:'normal',task:'Read project'});
 const create=await lease(core);await report(core,create,ok(create,{cwd:'/synthetic/project-u123'}));
 const prompt=await lease(core);assert.equal(prompt.command.expected_cwd,'/synthetic/project-u123');
 assert.equal(core.job(job.job_id).status,'accepted');
 for(const control of [String.fromCodePoint(0),String.fromCodePoint(31),String.fromCodePoint(127),String.fromCodePoint(133),String.fromCodePoint(159)]){
  await assert.rejects(core.call('owner','harness_start_task',{workspace_id:'bad'+control+'workspace',request_id:'invalid',task:'Read project'}),e=>e.code==='NATIVE_INVALID');
  await assert.rejects(report(core,prompt,ok(prompt,{accepted:true,cwd:'/synthetic/project'+control})),e=>e.code==='NATIVE_INVALID');
 }
});

for(const kind of ['missing','blank','interrupted'])test(`completed turn with ${kind} assistant body cannot claim success`,async t=>{
 const {core}=await setup(t),{job,prompt}=await createdAndPrompted(core);
 await core.call('owner','harness_get_task',{job_id:job.job_id});const inspect=await lease(core);
 const events=completed(prompt,{text:kind==='blank'?' \n\t ':'Unconfirmed assistant body'});
 if(kind==='missing')events.splice(2,1);
 if(kind==='interrupted')events[2].interrupted=true;
 await report(core,inspect,ok(inspect,{running:false,events}));
 assert.equal(core.job(job.job_id).status,'unknown');assert.equal(core.job(job.job_id).result,null);assert.equal(core.job(job.job_id).reason,'native_result_unavailable');
});

test('worker truncation marker survives already bounded assistant text',async t=>{
 const {core}=await setup(t),{job,prompt}=await createdAndPrompted(core);
 await core.call('owner','harness_get_task',{job_id:job.job_id});const inspect=await lease(core),events=completed(prompt,{text:'字'.repeat(16000)});events[2].text_truncated=true;
 await report(core,inspect,ok(inspect,{running:false,events}));assert.equal(core.job(job.job_id).status,'succeeded');assert.equal(core.job(job.job_id).result_truncated,true);
});

test('readonly inspection recovers a lost prompt acknowledgement and resumes automatic monitoring',async t=>{
 const {core,advance}=await setup(t),job=await start(core),create=await lease(core);await report(core,create,ok(create));const prompt=await lease(core);
 advance(61000);assert.equal((await core.call('owner','harness_get_task',{job_id:job.job_id})).status,'unknown');const inspect=await lease(core);
 await report(core,inspect,ok(inspect,{running:true,events:completed(prompt).slice(0,2)}));assert.equal(core.job(job.job_id).status,'running');
 advance(2100);const next=await lease(core);assert.equal(next.command.action,'inspect');
});

test('a bounded snapshot without correlation cannot discard older proof returned by a later inspection',async t=>{
 const {core}=await setup(t),{job,prompt}=await createdAndPrompted(core);
 await core.call('owner','harness_get_task',{job_id:job.job_id});let inspect=await lease(core);
 const events=completed(prompt,{startSeq:100});await report(core,inspect,ok(inspect,{running:false,events:events.slice(2)}));
 await core.call('owner','harness_get_task',{job_id:job.job_id});inspect=await lease(core);await report(core,inspect,ok(inspect,{running:false,events}));
 assert.equal(core.job(job.job_id).status,'succeeded');assert.equal(core.job(job.job_id).result,'Finished the project change');
});

test('incomplete completed proof may recover the missing assistant body through a fuller readonly inspection',async t=>{
 const {core}=await setup(t),{job,prompt}=await createdAndPrompted(core);
 await core.call('owner','harness_get_task',{job_id:job.job_id});let inspect=await lease(core);const events=completed(prompt);
 await report(core,inspect,ok(inspect,{running:false,events:events.filter(event=>event.type!=='assistant/message')}));assert.equal(core.job(job.job_id).status,'unknown');
 await core.call('owner','harness_get_task',{job_id:job.job_id});inspect=await lease(core);await report(core,inspect,ok(inspect,{running:false,events}));
 assert.equal(core.job(job.job_id).status,'succeeded');assert.equal(core.job(job.job_id).result,'Finished the project change');
});

for(const source_kind of ['synthetic','user'])test(`same-turn ${source_kind} input has the appropriate ownership effect`,async t=>{
 const {core}=await setup(t),{job,prompt}=await createdAndPrompted(core);
 await core.call('owner','harness_get_task',{job_id:job.job_id});const inspect=await lease(core),events=completed(prompt);
 events[2].seq=4;events[3].seq=5;events.splice(2,0,{type:'user/message',seq:3,turn:3,message_id:'a8f6fed7-5186-4912-a254-206f92363922',source_rpc_id:'other-request',source_kind});
 await report(core,inspect,ok(inspect,{running:false,events}));assert.equal(core.job(job.job_id).status,source_kind==='user'?'unknown':'succeeded');
 if(source_kind==='user')assert.equal(core.job(job.job_id).result,null);
});

test('an expired readonly inspection can recover already observed text from a full native page',async t=>{
 const {core,advance}=await setup(t),{job,prompt}=await createdAndPrompted(core),events=completed(prompt);
 await core.call('owner','harness_get_task',{job_id:job.job_id});let inspect=await lease(core);await report(core,inspect,ok(inspect,{running:true,events:events.slice(0,3)}));
 advance(2100);inspect=await lease(core);advance(61000);
 assert.equal((await core.call('owner','harness_get_task',{job_id:job.job_id})).status,'unknown');inspect=await lease(core);
 await report(core,inspect,ok(inspect,{running:false,events}));assert.equal(core.job(job.job_id).status,'succeeded');assert.equal(core.job(job.job_id).result,'Finished the project change');
});

test('a dispatched prompt remains uncertain after bounded command history is removed',async()=>{
 const f=fixture(),first=await createNativeTasks({store:f.store,principal:'owner',now:f.now});const job=await start(first),create=await lease(first);await report(first,create,ok(create));await lease(first);await first.close();
 const saved=f.state();saved.commands=[];await f.store.save(saved);
 const second=await createNativeTasks({store:f.store,principal:'owner',now:f.now});
 try{assert.equal((await second.call('owner','harness_cancel_task',{job_id:job.job_id})).status,'cancel_requested');assert.equal((await lease(second)).command.action,'cancel');}finally{await second.close();}
});

test('storage failure closes dispatch without returning an unpersisted job or lease',async()=>{
 let writes=0;const store={load:async()=>null,save:async()=>{writes++;throw new Error('private storage detail');}};
 const core=await createNativeTasks({store,principal:'owner'});
 try{await assert.rejects(start(core),e=>e.code==='NATIVE_UNAVAILABLE'&&!e.message.includes('private'));await assert.rejects(core.offer('owner'),e=>e.code==='NATIVE_UNAVAILABLE');assert.equal(writes,1);}finally{await core.close();}
});

test('task discovery recovers a lost request receipt with owner-scoped filters and archive pagination',async t=>{
 const {core}=await setup(t),a=await start(core,'recover-me'),b=await start(core,'other');
 await core.call('owner','harness_cancel_task',{job_id:a.job_id});
 const archived=await core.call('owner','harness_archive_task',{job_id:a.job_id});assert.equal(archived.archived,true);assert.ok(archived.archived_at);
 assert.deepEqual((await core.call('owner','harness_list_tasks',{})).items.map(j=>j.job_id),[b.job_id]);
 const page=await core.call('owner','harness_list_tasks',{request_id:'recover-me',workspace_id:'workspace-one',status:'cancelled',archived:true,limit:1});
 assert.equal(page.total,1);assert.equal(page.items[0].job_id,a.job_id);assert.equal(page.items[0].request_id,'recover-me');assert.equal(page.has_more,false);
 assert.equal((await core.call('owner','harness_archive_task',{job_id:a.job_id,archived:false})).archived,false);
 assert.equal(core.overview().jobs_archived,0);assert.equal(core.overview().jobs_visible,2);
 await assert.rejects(core.call('other','harness_list_tasks',{}),e=>e.code==='NATIVE_DENIED');
 await assert.rejects(core.call('owner','harness_archive_task',{job_id:b.job_id}),e=>e.code==='NATIVE_CONFLICT');
});

test('more than 100 finished jobs remain retry-safe and discoverable across archive and restart',async()=>{
 const f=fixture();let core=await createNativeTasks({store:f.store,principal:'owner',now:f.now});
 try{
  const ids=[];
  for(let i=0;i<115;i++){const job=await start(core,`history-${i}`);ids.push(job.job_id);await core.call('owner','harness_cancel_task',{job_id:job.job_id});if(i%2===0)await core.call('owner','harness_archive_task',{job_id:job.job_id});}
  assert.equal(core.overview().jobs_total,115);assert.equal(core.overview().jobs_archived,58);
  await core.close();core=await createNativeTasks({store:f.store,principal:'owner',now:f.now});
  const retry=await start(core,'history-0');assert.equal(retry.job_id,ids[0]);assert.equal(retry.duplicate,true);assert.equal(retry.archived,true);
  await assert.rejects(start(core,'history-0','Changed payload'),e=>e.code==='NATIVE_CONFLICT');
  assert.equal((await core.call('owner','harness_list_tasks',{archived:true,offset:50,limit:10})).items.length,8);
  assert.equal((await start(core,'new-after-history')).status,'accepted');
 }finally{await core.close();}
});

test('legacy v2 jobs acquire archive and continuation defaults without losing retry fingerprints',async()=>{
 const f=fixture(),first=await createNativeTasks({store:f.store,principal:'owner',now:f.now});const job=await start(first);await first.call('owner','harness_cancel_task',{job_id:job.job_id});await first.close();
 const state=f.state();for(const j of state.jobs)for(const key of ['archived','archived_at','mode','workspace_name','session_name','last_activity_at','questions','questions_truncated'])delete j[key];await f.store.save(state);
 const core=await createNativeTasks({store:f.store,principal:'owner',now:f.now});try{assert.equal(core.job(job.job_id).archived,false);assert.equal(core.job(job.job_id).mode,'after_complete');assert.equal((await start(core)).job_id,job.job_id);}finally{await core.close();}
});

for(const mode of ['queue','steer'])test(`active ${mode} followup keeps an immutable request and reconciles after restart without replay`,async()=>{
 const f=fixture();let core=await createNativeTasks({store:f.store,principal:'owner',now:f.now});
 try{
  const {job,prompt}=await createdAndPrompted(core),args={job_id:job.job_id,task:`Continue via ${mode}`,request_id:`active-${mode}`,mode};
  const follow=await core.call('owner','harness_followup_task',args);assert.notEqual(follow.job_id,job.job_id);assert.equal(follow.mode,mode);assert.equal(follow.session_id,job.session_id);
  assert.equal((await core.call('owner','harness_followup_task',args)).job_id,follow.job_id);
  const next=await lease(core);assert.equal(next.command.mode,mode);assert.equal(next.command.parent_request_id,prompt.command.request_id);assert.notEqual(next.command.request_id,prompt.command.request_id);
  await core.close();core=await createNativeTasks({store:f.store,principal:'owner',now:f.now});assert.equal(await core.offer('owner'),null);
  assert.equal((await core.call('owner','harness_followup_task',args)).job_id,follow.job_id);
  await core.call('owner','harness_get_task',{job_id:follow.job_id});const inspect=await lease(core);assert.equal(inspect.command.action,'inspect');
  const events=completed(next).map(e=>({...e,turn:mode==='queue'?4:3}));
  await report(core,inspect,ok(inspect,{running:false,parent_turn:3,events}));assert.equal(core.job(follow.job_id).status,'succeeded');assert.equal(core.job(follow.job_id).turn,mode==='queue'?4:3);
  assert.equal(core.job(job.job_id).status,'unknown');
 }finally{await core.close();}
});

test('steering within an owned turn preserves both message identities and ignores text before the steering message',async t=>{
 const {core}=await setup(t),{job,prompt}=await createdAndPrompted(core);
 const follow=await core.call('owner','harness_followup_task',{job_id:job.job_id,task:'Correct the requested scope',request_id:'steer-one',mode:'steer'}),next=await lease(core);
 await report(core,next,ok(next,{accepted:true}));
 const events=[...completed(prompt).slice(0,3),{type:'user/message',seq:4,turn:3,message_id:'a8f6fed7-5186-4912-a254-206f92363923',source_rpc_id:next.command.request_id,source_kind:'user'},{type:'assistant/message',seq:5,turn:3,text:'Corrected result'},{type:'turn/end',seq:6,turn:3,reason:'completed'}];
 for(const id of [job.job_id,follow.job_id]){await core.call('owner','harness_get_task',{job_id:id});const inspection=await lease(core);await report(core,inspection,ok(inspection,{running:false,events}));}
 const a=core.job(job.job_id),b=core.job(follow.job_id);assert.equal(a.status,'succeeded');assert.equal(b.status,'succeeded');assert.notEqual(a.message_id,b.message_id);assert.equal(a.turn,b.turn);assert.equal(b.result,'Corrected result');
});

test('native names and waiting questions are bounded and redacted before returning task detail',async t=>{
 const {core}=await setup(t),{job}=await createdAndPrompted(core);await core.call('owner','harness_get_task',{job_id:job.job_id});const inspect=await lease(core);
 await report(core,inspect,ok(inspect,{running:true,workspace_name:'Example project',session_name:'A native session',last_activity_at:'2026-10-22T12:00:00.000Z',pending_approvals:1,user_question_count:1,questions:[{call_id:'call-one',id:'q-one',question:'api_key=sk-synthetic012345678901234567890123456789',header:'Choose',options:[{label:'Proceed'}],state:'open'}],questions_truncated:false}));
 const view=core.job(job.job_id);assert.equal(view.workspace_name,'Example project');assert.equal(view.session_name,'A native session');assert.equal(view.last_activity_at,'2026-10-22T12:00:00.000Z');assert.equal(view.questions.length,1);assert.doesNotMatch(JSON.stringify(view),/sk-synthetic/);assert.equal(view.questions[0].state,'open');
});

test('commands in the same native session cannot hold overlapping mutation or inspection leases',async t=>{
 const {core}=await setup(t),{job}=await createdAndPrompted(core);
 await core.call('owner','harness_get_task',{job_id:job.job_id});const inspect=await lease(core);
 await core.call('owner','harness_followup_task',{job_id:job.job_id,task:'Continue',request_id:'while-inspecting',mode:'queue'});
 assert.equal(await core.offer('owner'),null);
 await report(core,inspect,ok(inspect,{running:true,events:[]}));assert.equal((await lease(core)).command.action,'prompt');
});

test('a foreign input before a steering message invalidates the child result too',async t=>{
 const {core}=await setup(t),{job,prompt}=await createdAndPrompted(core);
 const follow=await core.call('owner','harness_followup_task',{job_id:job.job_id,task:'Correct the scope',request_id:'steer-with-foreign',mode:'steer'}),next=await lease(core);await report(core,next,ok(next,{accepted:true}));
 await core.call('owner','harness_get_task',{job_id:follow.job_id});const inspect=await lease(core);
 const events=[...completed(prompt).slice(0,2),{type:'user/message',seq:3,turn:3,message_id:'a8f6fed7-5186-4912-a254-206f92363924',source_rpc_id:'foreign-human',source_kind:'user'},...completed(next,{startSeq:4}).slice(1)];
 await report(core,inspect,ok(inspect,{running:false,events}));assert.equal(core.job(follow.job_id).status,'unknown');assert.equal(core.job(follow.job_id).reason,'native_external_input');assert.equal(core.job(follow.job_id).result,null);
});

test('task stages distinguish admission, observed work, questions, approvals and reconciliation',async t=>{
 const {core,advance}=await setup(t),{job,prompt}=await createdAndPrompted(core);assert.equal(core.job(job.job_id).stage,'queued');
 await core.call('owner','harness_get_task',{job_id:job.job_id});let inspect=await lease(core);await report(core,inspect,ok(inspect,{running:true,events:completed(prompt).slice(0,2)}));assert.equal(core.job(job.job_id).stage,'running');
 advance(2100);inspect=await lease(core);await report(core,inspect,ok(inspect,{running:true,pending_approvals:1,events:[]}));assert.equal(core.job(job.job_id).stage,'waiting_for_approval');
 advance(2100);inspect=await lease(core);await report(core,inspect,ok(inspect,{running:true,user_question_count:1,events:[]}));assert.equal(core.job(job.job_id).stage,'waiting_for_answer');
 advance(2100);await lease(core);advance(61000);assert.equal((await core.call('owner','harness_get_task',{job_id:job.job_id})).stage,'needs_reconcile');
});

for(const mode of ['queue','steer'])test(`${mode} continuation never settles using a different native delivery turn`,async t=>{
 const {core}=await setup(t),{job}=await createdAndPrompted(core);const follow=await core.call('owner','harness_followup_task',{job_id:job.job_id,task:'Continue in the requested mode',request_id:`mode-proof-${mode}`,mode});const next=await lease(core);await report(core,next,ok(next,{accepted:true,parent_turn:3}));
 await core.call('owner','harness_get_task',{job_id:follow.job_id});const inspect=await lease(core),events=completed(next).map(event=>({...event,turn:mode==='queue'?3:4}));await report(core,inspect,ok(inspect,{running:false,events}));
 assert.equal(core.job(follow.job_id).status,'unknown');assert.equal(core.job(follow.job_id).reason,'native_followup_turn_mismatch');assert.equal(core.job(follow.job_id).result,null);
});

test('waiting elsewhere in an owned session does not label an unconsumed queued instruction as executing',async t=>{
 const {core}=await setup(t),{job}=await createdAndPrompted(core);await core.call('owner','harness_get_task',{job_id:job.job_id});const inspect=await lease(core);await report(core,inspect,ok(inspect,{running:true,pending_approvals:1,user_question_count:1,events:[]}));assert.equal(core.job(job.job_id).stage,'queued');
});
