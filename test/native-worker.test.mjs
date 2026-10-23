import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createNativeWorker} from '../management-plugin/src/native-worker.js';
import {managementClientFactory} from '../management-plugin/src/client.js';
import {z} from 'zod';

const SID='dsh_dot_00000000-0000-4000-8000-000000000001',RID='00000000-0000-4000-8000-000000000002';
const command=(action,extra={})=>({command_id:'native_command_one',action,job_id:'native_job_one',workspace_id:'workspace-one',session_id:SID,request_id:RID,...extra});
function fixture(action,extra={}){
 const calls=[],reports=[],diagnostics=[],state={now:Date.now(),exists:action!=='create',running:false,records:[],inbox:{'next-turn':[],'next-step':[]},...extra};
 const ok=value=>({ok:true,value});
 const remote={workspace:{async *follow(){calls.push(['workspace']);if(state.expireDuringRead)state.now+=120000;yield{type:'baseline',value:{items:[{workspaceId:'workspace-one',path:'/workspace/project',title:state.workspaceTitle,sessionIds:state.exists?[SID]:[]}]}};}},session:{
  async list(){calls.push(['list']);if(state.failList)return{ok:false,error:{code:state.failList,message:'private message synthetic-secret',details:{secret:'private details'}}};return ok({items:state.exists?[{sessionId:SID,cwd:'/workspace/project',running:state.running,updatedAt:state.updatedAt}]:[]});},
  async create(args){if(state.strictArity&&arguments.length!==1)throw Error('Official create accepts exactly one argument');calls.push(['create',args]);state.exists=true;return ok({sessionId:state.returnId??SID});},
  async *follow(args){calls.push(['follow',args]);yield{type:'snapshot',header:{id:SID,cwd:state.cwd??'/workspace/project'},cursor:50,records:state.records,hasMore:state.hasMore===true,projections:{asOfSeq:50,values:{title:state.sessionTitle,inbox:state.inbox,userQuestions:{active:state.questions??[]}}}};},
  async page(args){calls.push(['page',args]);return ok(state.pages?.shift()??{records:[],hasMore:false});},
  async prompt(args){calls.push(['prompt',args]);return ok({accepted:true});},
  async cancel(args){if(state.strictArity&&arguments.length!==1)throw Error('Official cancel accepts exactly one argument');calls.push(['cancel',args]);return ok({accepted:true});},
  async updateQueue(args){if(state.strictArity&&arguments.length!==1)throw Error('Official updateQueue accepts exactly one argument');calls.push(['updateQueue',args]);state.inbox={'next-turn':[],'next-step':[]};return ok({accepted:true});},
 }};
 let offered=true,failReport=0,terminalReport=false,overviewCalls=0;
 const cmd=command(action,extra.command??{}),token='synthetic-claim-capability-0123456789',lease='synthetic-lease-capability-0123456789';
 const fetchImpl=async(url,options)=>{calls.push(['http',url,options]);const body=JSON.parse(options.body);assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,`Bearer ${url.endsWith('claim')?token:lease}`);assert.equal(Object.hasOwn(options.headers,'Origin'),false);
  if(url.endsWith('claim')){assert.deepEqual(Object.keys(body).sort(),['claim_token','client_id','command_id']);offered=false;return{ok:true,json:async()=>({result:{command:cmd,lease_token:lease,expires_at:new Date(state.now+60000).toISOString()}})};}
  reports.push(body);if(failReport-->0)throw Error('synthetic transport private detail');if(terminalReport){terminalReport=false;return{ok:false,status:403,json:async()=>({error:{code:'NATIVE_DENIED',message:'fixed'}})};}return{ok:true,json:async()=>({result:{accepted:true}})};
 };
 const worker=createNativeWorker({remote,overview:async()=>{overviewCalls++;return ok({native_control:offered?{command_id:cmd.command_id,claim_token:token}:null,...Object.hasOwn(state,'workerUrl')?{native_worker_url:state.workerUrl}:{}});},fetchImpl,location:{protocol:'dsh-app:',hostname:'app'},randomUUID:()=>RID,now:()=>state.now,diagnostic:(...value)=>diagnostics.push(value)});
 return{worker,calls,reports,diagnostics,state,overviewCalls:()=>overviewCalls,failNextReport(){failReport=1;},expireNextReport(){terminalReport=true;}};
}
const event=(type,seq,data)=>({type:'event',event:{type,seq,data}});
const taskEvents=(requestId=RID)=>[
 event('turn/start',1,{turn:4}),event('user/message',2,{id:'00000000-0000-4000-8000-000000000003',role:'user',content:[{type:'text',text:'private prompt'}],source:{kind:'user',rpcId:requestId,principal:'private'}}),
 event('tool/result',3,{secret:'private-tool-secret'}),event('assistant/message',4,{turn:4,message:{content:[{type:'text',text:'Done'}]},interrupted:false}),event('turn/end',5,{turn:4,reason:{kind:'completed'}}),
];

test('create uses registered workspace and exact persisted identity without dispatching prompt',async()=>{
 const f=fixture('create');await f.worker.poll();assert.deepEqual(f.calls.find(x=>x[0]==='create')[1],{workspaceId:'workspace-one',sessionId:SID});assert.equal(f.calls.some(x=>x[0]==='prompt'),false);assert.deepEqual(f.reports[0].result,{ok:true,session_id:SID,workspace_id:'workspace-one',cwd:'/workspace/project'});f.worker.close();
});

test('managed worker uses the trusted per-runtime endpoint and pins pending reports to their lease endpoint',async()=>{
 const f=fixture('prompt',{workerUrl:'http://127.0.0.1:43117/native/',command:{task:'Once'}});f.failNextReport();await f.worker.poll();f.state.workerUrl='http://127.0.0.1:43118/native/';await f.worker.poll();
 assert.deepEqual(f.calls.filter(x=>x[0]==='http').map(x=>x[1]),['http://127.0.0.1:43117/native/claim','http://127.0.0.1:43117/native/report','http://127.0.0.1:43117/native/report']);assert.equal(f.calls.filter(x=>x[0]==='prompt').length,1);f.worker.close();
});
test('worker rejects malformed or non-loopback supplied endpoints without fetching or native mutation',async()=>{
 for(const workerUrl of ['https://127.0.0.1:43117/native/','http://localhost:43117/native/','http://127.0.0.1:0/native/','http://127.0.0.1:65536/native/','http://127.0.0.1:43117/native/?extra=1','http://127.0.0.1:43117/native/../rpc','http://user@127.0.0.1:43117/native/',null]){
  const f=fixture('create',{workerUrl});await f.worker.poll();assert.equal(f.calls.length,0,String(workerUrl));f.worker.close();
 }
});
test('create reconciles an existing session rather than creating a duplicate',async()=>{const f=fixture('create',{exists:true});await f.worker.poll();assert.equal(f.calls.some(x=>x[0]==='create'),false);assert.equal(f.reports[0].result.ok,true);f.worker.close();});
test('unexpected create identity fails closed',async()=>{const f=fixture('create',{returnId:'other'});await f.worker.poll();assert.deepEqual(f.reports[0].result,{ok:false,error_code:'IDENTITY_MISMATCH'});assert.equal(f.calls.some(x=>x[0]==='prompt'),false);f.worker.close();});
test('prompt uses stable request ID and normal native queue after verifying workspace/header binding',async()=>{
 const f=fixture('prompt',{command:{task:'Do the requested work',expected_cwd:'/workspace/project'}});await f.worker.poll();assert.deepEqual(f.calls.find(x=>x[0]==='prompt')[1],{sessionId:SID,requestId:RID,mode:'queue',content:[{type:'text',text:'Do the requested work'}]});assert.equal(f.reports[0].result.accepted,true);f.worker.close();
 const g=fixture('prompt',{cwd:'/other',command:{task:'Never execute',expected_cwd:'/workspace/project'}});await g.worker.poll();assert.equal(g.calls.some(x=>x[0]==='prompt'),false);assert.equal(g.reports[0].result.error_code,'IDENTITY_MISMATCH');g.worker.close();
});
test('inspect normalizes direct user messages by the native turn and omits raw tool/private payloads',async()=>{
 const f=fixture('inspect',{records:taskEvents(),questions:[{secret:'private question'}]});await f.worker.poll();const r=f.reports[0].result;assert.equal(r.events.length,4);assert.deepEqual(r.events[1],{type:'user/message',seq:2,turn:4,message_id:'00000000-0000-4000-8000-000000000003',source_rpc_id:RID,source_kind:'user'});assert.equal(r.events[2].text,'Done');assert.equal(r.events[3].reason,'completed');assert.equal(r.user_question_count,1);assert.doesNotMatch(JSON.stringify(r),/private/);f.worker.close();
});
test('a report timeout retries only its identical body and never reexecutes the mutation',async()=>{
 const f=fixture('prompt',{command:{task:'Once'}});f.failNextReport();await f.worker.poll();await f.worker.poll();assert.equal(f.calls.filter(x=>x[0]==='prompt').length,1);assert.equal(f.reports.length,2);assert.deepEqual(f.reports[0],f.reports[1]);f.worker.close();
});
test('cancel never cancels a foreign active turn; removes only its exact queued occurrence',async()=>{
 const f=fixture('cancel',{running:true,records:taskEvents('foreign').slice(0,-1)});await f.worker.poll();assert.equal(f.calls.some(x=>x[0]==='cancel'),false);assert.deepEqual(f.reports[0].result,{ok:false,error_code:'IDENTITY_MISMATCH'});f.worker.close();
 const g=fixture('cancel',{inbox:{'next-turn':[{id:'queued-owned',source:{kind:'user',rpcId:RID},content:[{type:'text',text:'private'}]}],'next-step':[]}});await g.worker.poll();assert.deepEqual(g.calls.find(x=>x[0]==='updateQueue')[1],{sessionId:SID,itemId:'queued-owned',action:{kind:'remove'}});assert.equal(g.reports[0].result.removed_request_id,RID);g.worker.close();
});
test('cancel requests only an exact correlated active native turn',async()=>{const f=fixture('cancel',{running:true,records:taskEvents().slice(0,-1)});await f.worker.poll();assert.deepEqual(f.calls.find(x=>x[0]==='cancel')[1],{sessionId:SID});assert.equal(f.reports[0].result.cancel_requested,true);f.worker.close();});
test('dispose stops the global worker without cancelling native work; non-native locations are inert',async()=>{
 const f=fixture('inspect');f.worker.close();await f.worker.poll();assert.equal(f.calls.length,0);
 const worker=createNativeWorker({remote:{},overview:()=>{throw Error('must be inert');},location:{protocol:'https:',hostname:'example.com'}});worker.start();await worker.poll();worker.close();
});
test('invalid command fields and unknown workspace fail without native mutation',async()=>{
 const f=fixture('prompt',{command:{task:'task',url:'https://example.com'}});await f.worker.poll();assert.deepEqual(f.reports[0].result,{ok:false,error_code:'INVALID_COMMAND'});assert.equal(f.calls.some(x=>x[0]==='prompt'),false);f.worker.close();
 const g=fixture('prompt',{command:{task:'task',workspace_id:'missing'}});await g.worker.poll();assert.deepEqual(g.reports[0].result,{ok:false,error_code:'WORKSPACE_UNAVAILABLE'});g.worker.close();
});
test('an expired or restart-invalidated report lease releases the worker to inspect without replaying its mutation',async()=>{
 const f=fixture('prompt',{command:{task:'Once'}});f.expireNextReport();await f.worker.poll();await f.worker.poll();assert.equal(f.calls.filter(x=>x[0]==='prompt').length,1);assert.equal(f.overviewCalls(),2);f.worker.close();
});
test('bounded assistant text explicitly records truncation',async()=>{
 const records=taskEvents();records[3].event.data.message.content[0].text='字'.repeat(17000);const f=fixture('inspect',{records});await f.worker.poll();const assistant=f.reports[0].result.events.find(e=>e.type==='assistant/message');assert.equal(Array.from(assistant.text).length,16000);assert.equal(assistant.text_truncated,true);f.worker.close();
});
test('native factory starts a renderer-scoped worker without opening the management page and closes it with its scope',async()=>{
 const previous=globalThis.location;globalThis.location={protocol:'dsh-app:',hostname:'app'};
 try{
  const lifecycle=[],disposers=[],injections=[],React={createElement(){}};
  const ctx={remote:{$mount:async()=>{},dotDshManagement:{overview:async()=>({ok:true,value:{}})}},slots:{inject:(_name,callback)=>callback(),register(){}},inject:async(services,callback)=>{injections.push(services);return callback(ctx);},effect:callback=>disposers.push(callback())};
  const api=managementClientFactory(name=>({react:React,zod:{z}}[name]),undefined,()=>()=>null,options=>{assert.equal(options.remote,ctx.remote);return{start(){lifecycle.push('start');},close(){lifecycle.push('close');}};});
  await api.apply(ctx);assert.deepEqual(injections,[['remote.dotDshManagement'],['uiWorkspace'],['workspaces'],['remote.workspace','remote.session']]);assert.deepEqual(lifecycle,['start']);for(const dispose of disposers)dispose();assert.deepEqual(lifecycle,['start','close']);
 }finally{if(previous===undefined)delete globalThis.location;else globalThis.location=previous;}
});
test('a message-aligned opening pages back for the turn anchor before correlating the user request',async()=>{
 const records=taskEvents(),f=fixture('inspect',{records:records.slice(1),hasMore:true,pages:[{records:records.slice(0,1),hasMore:false}]});await f.worker.poll();assert.equal(f.calls.filter(x=>x[0]==='page').length,1);assert.equal(f.calls.find(x=>x[0]==='page')[1].throughSeq,50);assert.equal(f.reports[0].result.events.find(e=>e.type==='user/message').turn,4);f.worker.close();
});
test('history without a trustworthy anchor fails closed and never advances a task using unrelated events',async()=>{
 const f=fixture('inspect',{records:taskEvents().slice(1)});await f.worker.poll();assert.deepEqual(f.reports[0].result,{ok:false,error_code:'HISTORY_UNAVAILABLE'});f.worker.close();
 const g=fixture('inspect',{records:taskEvents('foreign')});await g.worker.poll();assert.deepEqual(g.reports[0].result.events,[]);g.worker.close();
});
test('prompt refuses a foreign or manually taken over active turn before adding new work',async()=>{
 const f=fixture('prompt',{running:true,records:taskEvents('foreign').slice(0,-1),command:{task:'Do not mix with manual work'}});await f.worker.poll();assert.equal(f.calls.some(x=>x[0]==='prompt'),false);assert.deepEqual(f.reports[0].result,{ok:false,error_code:'IDENTITY_MISMATCH'});f.worker.close();
});
test('lease expiry during native reads prevents every later mutation',async()=>{
 for(const action of ['create','prompt','cancel']){
  const f=fixture(action,{expireDuringRead:true,records:taskEvents().slice(0,-1),command:{...action==='prompt'?{task:'never execute'}:{}}});await f.worker.poll();assert.equal(f.calls.some(x=>['create','prompt','cancel','updateQueue'].includes(x[0])),false);assert.deepEqual(f.reports[0].result,{ok:false,error_code:'NATIVE_TIMEOUT'});f.worker.close();
 }
});
test('native diagnostics retain only a fixed stage and allowlisted code without private failures',async()=>{
 const f=fixture('create',{failList:'gateway/service-unavailable'});await f.worker.poll();assert.deepEqual(f.diagnostics,[['session.list','gateway/service-unavailable']]);assert.doesNotMatch(JSON.stringify(f.diagnostics),/private|synthetic-secret/);f.worker.close();
 const g=fixture('create',{failList:'private-unrecognized-code'});await g.worker.poll();assert.deepEqual(g.diagnostics,[['session.list','native/failed']]);g.worker.close();
});
test('official non-cancellable create, cancel and updateQueue receive only their single request argument',async()=>{
 for(const [action,extra]of [['create',{}],['cancel',{running:true,records:taskEvents().slice(0,-1)}],['cancel',{inbox:{'next-turn':[{id:'queued-owned',source:{kind:'user',rpcId:RID}}],'next-step':[]}}]]){
  const f=fixture(action,{strictArity:true,...extra});await f.worker.poll();assert.equal(f.reports[0].result.ok,true);f.worker.close();
 }
});

for(const mode of ['queue','steer'])test(`active ${mode} uses the native mode only while the exact parent owns the live turn`,async()=>{
 const parent='00000000-0000-4000-8000-000000000007';
 const f=fixture('prompt',{running:true,records:taskEvents(parent).slice(0,-1),command:{task:'Continue safely',mode,parent_request_id:parent}});await f.worker.poll();
 assert.equal(f.reports[0].result.ok,true);assert.equal(f.reports[0].result.parent_turn,4);assert.equal(f.calls.find(x=>x[0]==='prompt')[1].mode,mode);assert.equal(f.calls.find(x=>x[0]==='prompt')[1].requestId,RID);f.worker.close();
 for(const extra of [{running:false,records:taskEvents(parent)},{running:true,records:taskEvents('foreign').slice(0,-1)}]){
  const g=fixture('prompt',{...extra,command:{task:'Must not run',mode,parent_request_id:parent}});await g.worker.poll();assert.equal(g.calls.some(x=>x[0]==='prompt'),false);assert.equal(g.reports[0].result.error_code,'IDENTITY_MISMATCH');g.worker.close();
 }
});

test('inspection returns verified native titles, activity and bounded actionable questions without raw projection data',async()=>{
 const f=fixture('inspect',{workspaceTitle:'Project title',sessionTitle:'Session title',updatedAt:Date.parse('2026-10-22T13:00:00Z'),records:taskEvents(),questions:[{callId:'question-call',state:'open',secret:'not-returned',questions:[{id:'choice',question:'Which action?',header:'Choose',detail:'Details',multiSelect:true,options:[{label:'Continue',description:'Proceed safely'}]}]}]});
 await f.worker.poll();const r=f.reports[0].result;assert.equal(r.workspace_name,'Project title');assert.equal(r.session_name,'Session title');assert.equal(r.last_activity_at,'2026-10-22T13:00:00.000Z');assert.equal(r.questions[0].question,'Which action?');assert.equal(r.questions[0].call_id,'question-call');assert.equal(r.questions[0].multi_select,true);assert.equal(r.questions_truncated,false);assert.doesNotMatch(JSON.stringify(r),/not-returned/);f.worker.close();
});

test('the worker control loop uses the dedicated poll method without requesting a full overview',async()=>{
 let polls=0,overviews=0;const worker=createNativeWorker({remote:{dotDshManagement:{workerPoll:async()=>{polls++;return{ok:true,value:{native_control:null}};},overview:async()=>{overviews++;return{ok:true,value:{}};}}},location:{protocol:'dsh-app:',hostname:'app'},randomUUID:()=>RID});
 await worker.poll();worker.close();assert.equal(polls,1);assert.equal(overviews,0);
});

test('a manually mixed active turn fails closed even when the last message matches the supplied parent',async()=>{
 const parent='00000000-0000-4000-8000-000000000007',records=taskEvents(parent).slice(0,-1);records.splice(1,0,event('user/message',1.5,{id:'00000000-0000-4000-8000-000000000008',source:{kind:'user',rpcId:'foreign'}}));records.forEach((record,i)=>record.event.seq=i+1);
 const f=fixture('prompt',{running:true,records,command:{task:'Never mix',mode:'steer',parent_request_id:parent,owned_request_ids:[parent,RID]}});await f.worker.poll();assert.equal(f.calls.some(x=>x[0]==='prompt'),false);assert.equal(f.reports[0].result.error_code,'IDENTITY_MISMATCH');f.worker.close();
});

test('oversized question lists are bounded as a whole and explicitly marked truncated',async()=>{
 const questions=Array.from({length:20},(_,i)=>({id:`question-${i}`,question:'问'.repeat(2000),detail:'细'.repeat(4000),options:Array.from({length:12},()=>({label:'选'.repeat(300),description:'描'.repeat(1000)}))}));
 const f=fixture('inspect',{records:taskEvents(),questions:[{callId:'call-many',state:'open',questions}]});await f.worker.poll();const r=f.reports[0].result;assert.equal(r.ok,true);assert.ok(r.questions.length>0);assert.equal(r.questions_truncated,true);assert.ok(Buffer.byteLength(JSON.stringify(r.questions))<=40000);f.worker.close();
});

test('cancel refuses earlier manual input even when the last active message is connector-owned',async()=>{
 const records=taskEvents().slice(0,-1);records.splice(1,0,event('user/message',1.5,{id:'00000000-0000-4000-8000-000000000009',source:{kind:'user',rpcId:'foreign'}}));records.forEach((record,i)=>record.event.seq=i+1);
 const f=fixture('cancel',{running:true,records});await f.worker.poll();assert.equal(f.calls.some(x=>x[0]==='cancel'),false);assert.equal(f.reports[0].result.error_code,'IDENTITY_MISMATCH');f.worker.close();
});

test('cancelling an original task refuses a newer active steering child while the child remains cancellable',async()=>{
 const parent='00000000-0000-4000-8000-000000000007',records=taskEvents(parent).slice(0,-1);records.push(event('user/message',6,{id:'00000000-0000-4000-8000-000000000008',source:{kind:'user',rpcId:RID}}));
 const child=fixture('cancel',{running:true,records,command:{owned_request_ids:[parent,RID]}});await child.worker.poll();assert.equal(child.reports[0].result.ok,true);assert.equal(child.calls.filter(x=>x[0]==='cancel').length,1);child.worker.close();
 const original=fixture('cancel',{running:true,records,command:{request_id:parent,owned_request_ids:[parent,RID]}});await original.worker.poll();assert.equal(original.calls.some(x=>x[0]==='cancel'),false);assert.equal(original.reports[0].result.error_code,'IDENTITY_MISMATCH');original.worker.close();
});
