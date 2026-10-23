import test from 'node:test';
import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {createMcpServer} from '../src/mcp.js';
import {createManagement} from '../src/management.js';

const OWNER='native-owner',JOB='native_job_00000000-0000-4000-8000-000000000001';
async function mcp(t,options){const server=createMcpServer(options),client=new Client({name:'native-dispatch-test',version:'1'}),[a,b]=InMemoryTransport.createLinkedPair();t.after(async()=>{await client.close();await server.close();});await server.connect(b);await client.connect(a);return client;}
function audit(){let paused=false;const events=[];return{events,async begin(value){events.push(value);return String(events.length-1);},async finish(id,value){Object.assign(events[Number(id)],value);},overview(){return{paused,events_total:events.length,events_retained:events.length,jobs_total:0,retention_limit:500};},async setPaused(value){paused=value;return{paused};},listEvents(){return{items:[],total:0,offset:0,next_offset:null};},listJobs(){return{items:[],total:0,offset:0,next_offset:null};},job(){throw new Error('not a legacy job');}};}
test('native execution MCP tools are opt-in and describe normal file/command effects',async t=>{
 const calls=[];const client=await mcp(t,{harnessRead:true,harnessExecution:true,call:async(tool,args)=>{calls.push({tool,args});return{job_id:JOB,status:'accepted'};}});
 const tools=(await client.listTools()).tools;
 for(const name of ['harness_start_task','harness_get_task','harness_followup_task','harness_cancel_task','harness_list_tasks','harness_archive_task'])assert.ok(tools.some(x=>x.name===name),name);
 assert.equal(tools.find(x=>x.name==='harness_start_task').annotations.readOnlyHint,false);
 assert.equal(tools.find(x=>x.name==='harness_start_task').annotations.openWorldHint,true);
 assert.match(tools.find(x=>x.name==='harness_start_task').description,/approval|approvals/i);
 await client.callTool({name:'harness_start_task',arguments:{workspace_id:'normal-workspace',task:'Create a file and run the project check.',request_id:'same-request'}});
 assert.deepEqual(calls,[{tool:'harness_start_task',args:{workspace_id:'normal-workspace',task:'Create a file and run the project check.',request_id:'same-request'}}]);
 const legacy=await mcp(t,{call:async()=>({})});assert.equal((await legacy.listTools()).tools.length,5);
 const nativeOnly=await mcp(t,{fixtureTasks:false,harnessRead:true,harnessExecution:true,call:async()=>({})});assert.equal((await nativeOnly.listTools()).tools.length,12);
});
test('normal tasks share admission and metadata audit without being forced into the old fixture job schema',async()=>{
 const log=audit(),calls=[],nativeJob={job_id:JOB,project_id:'normal-workspace',workspace_id:'normal-workspace',status:'accepted',message_id:null,session_id:'owned-native-session',task:'write project file',result:null,created_at:'2026-10-22T00:00:00.000Z',finished_at:null,acceptance:'unverified'};
 const nativeTasks={async call(owner,tool,args){assert.equal(owner,OWNER);calls.push({tool,args});return{...nativeJob,status:tool==='harness_cancel_task'?'cancel_requested':'accepted'};},async offer(){return{command_id:'one-command',claim_token:'synthetic-capability-01234567890123456789'};},async jobs(){return{items:[nativeJob],total:1,offset:0,next_offset:null};},async job(id){return id===JOB?nativeJob:null;},overview(){return{enabled:true,jobs_total:1};}};
 const manager=await createManagement({audit:log,principal:OWNER,nativeTasks,forward:async tool=>tool==='harness_status'?{}:{projects:[]}});
 const started=await manager.channel.call(OWNER,'harness_start_task',{workspace_id:'normal-workspace',task:'write project file',request_id:'request-a'});
 assert.equal(started.job_id,JOB);assert.equal(log.events[0].outcome,'succeeded');assert.equal(Object.hasOwn(log.events[0],'job'),false);
 await manager.admin.call(OWNER,'manager_set_paused',{paused:true});
 await assert.rejects(manager.channel.call(OWNER,'harness_followup_task',{job_id:JOB,task:'continue',request_id:'request-b'}),e=>e.code==='CONNECTOR_PAUSED');
 assert.equal((await manager.channel.call(OWNER,'harness_get_task',{job_id:JOB})).job_id,JOB);
 assert.equal((await manager.admin.call(OWNER,'manager_cancel',{job_id:JOB})).job.status,'cancel_requested');
 const view=await manager.admin.call(OWNER,'manager_overview',{});assert.equal(view.scope.task,'native_workspace');assert.equal(view.native_control.command_id,'one-command');
 const rows=await manager.admin.call(OWNER,'manager_jobs',{});assert.equal(rows.total,1);assert.equal(rows.items[0].job_id,JOB);assert.equal(Object.hasOwn(rows.items[0],'result'),false);
 assert.ok(calls.some(x=>x.tool==='harness_cancel_task'));
});
test('the public channel never exposes owner-only worker capabilities',async()=>{
 const log=audit(),manager=await createManagement({audit:log,principal:OWNER,forward:async()=>({}),nativeTasks:{async call(){throw new Error('unexpected');},async offer(){throw new Error('owner-only');}}});
 await assert.rejects(manager.channel.call(OWNER,'manager_overview',{}));
 await assert.rejects(manager.admin.call('foreign','manager_overview',{}));
 assert.equal(log.events.length,0);
});

 test('native task discovery, archival and active mode survive MCP validation',async t=>{
 const calls=[],client=await mcp(t,{fixtureTasks:false,harnessExecution:true,call:async(name,args)=>{calls.push({name,args});return{};}});
 const tools=(await client.listTools()).tools;assert.equal(tools.find(t=>t.name==='harness_list_tasks').annotations.readOnlyHint,true);assert.equal(tools.find(t=>t.name==='harness_archive_task').annotations.readOnlyHint,false);
 const filters={workspace_id:'registered-project',request_id:'lost-receipt',status:'cancelled',archived:true,offset:2,limit:10};
 await client.callTool({name:'harness_list_tasks',arguments:filters});await client.callTool({name:'harness_archive_task',arguments:{job_id:JOB,archived:false}});await client.callTool({name:'harness_followup_task',arguments:{job_id:JOB,request_id:'active-follow',task:'Refine this task',mode:'steer'}});
 assert.equal(calls.length,3);assert.deepEqual(calls[0].args,filters);assert.equal(calls[2].args.mode,'steer');
 });
