import test from 'node:test';
import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {createMcpServer} from '../src/mcp.js';
import {createManagement} from '../src/management.js';
import {createAuditStore} from '../src/audit-store.js';
import {mkdtemp,realpath,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const JOB='native_job_00000000-0000-4000-8000-000000000001',OWNER='owner';
async function clientFor(t,options){
 const server=createMcpServer(options),client=new Client({name:'interaction-contract',version:'1'}),[a,b]=InMemoryTransport.createLinkedPair();
 t.after(async()=>{await client.close();await server.close();});await server.connect(b);await client.connect(a);return client;
}
function audit(){let paused=false;const events=[];return{events,async begin(value){events.push(value);return String(events.length-1);},async finish(id,value){Object.assign(events[Number(id)],value);},overview(){return{paused,events_total:events.length,events_retained:events.length,jobs_total:0,retention_limit:500};},async setPaused(value){paused=value;return{paused};}};}

test('remote question and single-approval tools are explicitly effectful and opt in with native execution',async t=>{
 const c=await clientFor(t,{fixtureTasks:false,harnessRead:true,harnessExecution:true,call:async()=>({})});
 const tools=(await c.listTools()).tools;
 for(const name of ['harness_answer_question','harness_decide_approval']){
  const tool=tools.find(x=>x.name===name);assert.ok(tool,name);
  assert.equal(tool.annotations.readOnlyHint,false);assert.equal(tool.annotations.openWorldHint,true);
  assert.equal(tool.annotations.idempotentHint,true);assert.equal(tool.annotations.destructiveHint,true);
  assert.match(tool.description,/user/i);assert.match(tool.description,/specific|exact/i);
 }
 const read=await clientFor(t,{fixtureTasks:false,harnessRead:true,call:async()=>({})});
 assert.equal((await read.listTools()).tools.some(x=>x.name==='harness_decide_approval'),false);
});

test('structured question answers and one exact approval decision cross real MCP transport unchanged',async t=>{
 const calls=[],c=await clientFor(t,{fixtureTasks:false,harnessExecution:true,call:async(tool,args)=>{calls.push({tool,args});return{job_id:JOB,status:'accepted'};}});
 const question={job_id:JOB,interaction_id:'question:exact',request_id:'answer-one',answers:[{id:'format',selected:['Markdown'],custom:'Keep the table.'}]};
 const approval={job_id:JOB,interaction_id:'approval:exact',request_id:'approve-one',decision:'allow_once'};
 for(const [name,args]of [['harness_answer_question',question],['harness_decide_approval',approval]]){
  const result=await c.callTool({name,arguments:args});assert.notEqual(result.isError,true);
 }
 assert.deepEqual(calls,[{tool:'harness_answer_question',args:question},{tool:'harness_decide_approval',args:approval}]);
});

test('allow-all, self-asserted human proof, extra fields and control characters never reach backend',async t=>{
 const calls=[],c=await clientFor(t,{fixtureTasks:false,harnessExecution:true,call:async(...args)=>{calls.push(args);return{};}});
 const base={job_id:JOB,interaction_id:'approval:exact',request_id:'same',decision:'allow_once'};
 for(const args of [{...base,decision:'allow_all'},{...base,user_confirmed:true},{...base,session_id:'foreign'},{...base,interaction_id:'bad\nidentity'}]){
  const outcome=await c.callTool({name:'harness_decide_approval',arguments:args}).then(value=>({value}),error=>({error}));
  assert.ok(outcome.error||outcome.value?.isError===true);
 }
 assert.equal(calls.length,0);
});

test('a bounded twenty-question batch fits the MCP input element budget',async t=>{
 const calls=[],c=await clientFor(t,{fixtureTasks:false,harnessExecution:true,call:async(...args)=>{calls.push(args);return{job_id:JOB,status:'accepted'};}});
 const answers=Array.from({length:20},(_,i)=>({id:`q${i}`,selected:Array.from({length:12},(_,j)=>`option${j}`)}));
 const result=await c.callTool({name:'harness_answer_question',arguments:{job_id:JOB,interaction_id:'batch',request_id:'twenty',answers}});
 assert.notEqual(result.isError,true);assert.equal(calls.length,1);
});
test('option labels are exact question content and may contain a line break',async t=>{
 const calls=[],c=await clientFor(t,{fixtureTasks:false,harnessExecution:true,call:async(...args)=>{calls.push(args);return{job_id:JOB,status:'accepted'};}});
 const label='Markdown\n保留标题';
 const result=await c.callTool({name:'harness_answer_question',arguments:{job_id:JOB,interaction_id:'multiline',request_id:'exact-label',answers:[{id:'format',selected:[label]}]}});
 assert.notEqual(result.isError,true);assert.equal(calls[0][1].answers[0].selected[0],label);
});

test('pause prevents execution-resuming replies and allows an explicit rejection of a pending operation',async()=>{
 const log=audit(),calls=[],manager=await createManagement({audit:log,principal:OWNER,forward:async()=>{throw Error('unexpected forward');},nativeTasks:{async call(owner,tool,args){calls.push({owner,tool,args});return{job_id:JOB,status:'accepted'};},async close(){}}});
 try{
  await manager.admin.call(OWNER,'manager_set_paused',{paused:true});
  const base={job_id:JOB,interaction_id:'one',request_id:'decision'};
  await assert.rejects(manager.channel.call(OWNER,'harness_decide_approval',{...base,decision:'allow_once'}),e=>e.code==='CONNECTOR_PAUSED');
  await assert.rejects(manager.channel.call(OWNER,'harness_answer_question',{...base,answers:[{id:'q',selected:[],custom:'yes'}]}),e=>e.code==='CONNECTOR_PAUSED');
  assert.equal((await manager.channel.call(OWNER,'harness_decide_approval',{...base,decision:'deny'})).status,'accepted');
  assert.equal(calls.length,1);assert.equal(calls[0].args.decision,'deny');
 }finally{await manager.close();}
});

test('management records interaction identity and decision metadata without retaining the answer or native reason',async()=>{
 const log=audit(),secret='private-answer-never-audit',manager=await createManagement({audit:log,principal:OWNER,forward:async()=>{throw Error('unexpected forward');},nativeTasks:{async call(){return{job_id:JOB,operation_id:'native_command_00000000-0000-4000-8000-000000000002',interaction_id:'question:one',status:'accepted',reason:secret};},async close(){}}});
 try{
  await manager.channel.call(OWNER,'harness_answer_question',{job_id:JOB,interaction_id:'question:one',request_id:'answer-one',answers:[{id:'q',selected:[],custom:secret}]});
  assert.equal(log.events[0].selectors.interaction_id,'question:one');
  assert.equal(log.events[0].request_id,'answer-one');assert.equal(log.events[0].summary.status,'accepted');
  assert.doesNotMatch(JSON.stringify(log.events),new RegExp(secret));
 }finally{await manager.close();}
});

test('the real durable audit accepts both interaction tools and reopens without storing answer content',async t=>{
 const home=await realpath(await mkdtemp(join(tmpdir(),'dot-interaction-audit-')));t.after(()=>rm(home,{recursive:true,force:true}));
 const directory=join(home,'audit'),log=await createAuditStore({directory,principal:OWNER}),calls=[],secret='private-answer-keep-out-of-audit';
 const manager=await createManagement({audit:log,principal:OWNER,forward:async()=>{throw Error('unexpected forward');},nativeTasks:{async call(owner,tool,args){calls.push({owner,tool,args});return{job_id:JOB,status:'accepted'};},async close(){}}});
 try{
  await manager.channel.call(OWNER,'harness_answer_question',{job_id:JOB,interaction_id:'question:durable',request_id:'answer-durable',answers:[{id:'q',selected:[],custom:secret}]});
  await manager.channel.call(OWNER,'harness_decide_approval',{job_id:JOB,interaction_id:'approval:durable',request_id:'reject-durable',decision:'deny'});
  assert.equal(calls.length,2);assert.equal(log.listEvents({}).items.length,2);
 }finally{await manager.close();await log.close();}
 const reopened=await createAuditStore({directory,principal:OWNER});
 try{
  const rows=reopened.listEvents({}).items;assert.equal(rows.length,2);assert.ok(rows.every(x=>x.outcome==='succeeded'));
  assert.ok(rows.some(x=>x.selectors.interaction_id==='approval:durable'&&x.selectors.decision==='deny'));
  assert.doesNotMatch(await readFile(join(directory,'connector-manager-state.json'),'utf8'),new RegExp(secret));
 }finally{await reopened.close();}
});
