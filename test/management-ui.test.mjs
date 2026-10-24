import {test} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {create,act} from 'react-test-renderer';
import {z} from 'zod';
import {createManagementUI,managementClientFactory} from '../management-plugin/src/client.js';
import {createManagementRemote} from '../management-plugin/src/remote.js';
const text=node=>typeof node==='string'||typeof node==='number'?String(node):Array.isArray(node)?node.map(text).join(''):node?.type==='style'?'':text(node?.children??[]);
const button=(tree,label)=>tree.root.findAllByType('button').find(node=>text(node.props.children)===label);
const overview={management_protocol:{version:2,features:{task_filters:true,archive:true,followup:true,worker_poll:true}},connection:{state:'local_ready',read_backend:'online',task_backend:'online',worker_backend:'online',cloud_state:'not_verified'},admission:{paused:false},scope:{task:'native_workspace'},audit:{events_total:4,jobs_total:1,retention_limit:500},recent_events:[]};
const job={job_id:'j1',task:'检查交付文件',workspace_id:'w1',workspace_name:'演示项目',session_id:'s1',session_name:'文件检查',status:'running',last_activity_at:'2026-10-22T12:00:00Z',request_id:'req1'};
async function mount(t,adapter,options){let tree;await act(async()=>{tree=create(React.createElement(createManagementUI(React,adapter)),options);});t.after(async()=>{await act(async()=>tree.unmount());});return tree;}
const pages=items=>({items,total:items.length,next_offset:null});
test('first connection checks an actual workspace before account setup and cancellation does not start it',async t=>{
 let ready=false;const calls=[],setup={mode:'managed',phase:'setup_required',services:{},actions:{},connection_setup:{phase:'idle',actions:{start:true},verification:{}}};
 const tree=await mount(t,{supports:()=>true,ensureWorkspace:async()=>{calls.push('workspace');return ready;},async call(tool){calls.push(tool);if(tool==='manager_overview')throw{code:'dot-management/unavailable'};if(tool==='manager_setup_status')return setup;if(tool==='manager_setup_connect_start')return{phase:'preparing',actions:{},verification:{}};throw Error(tool);}});
 await act(async()=>button(tree,'连接我的 Dot').props.onClick());assert.ok(calls.includes('workspace'));assert.equal(calls.includes('manager_setup_connect_start'),false);assert.match(text(tree.toJSON()),/选择.*项目文件夹/);
 ready=true;await act(async()=>button(tree,'连接我的 Dot').props.onClick());assert.equal(calls.filter(x=>x==='manager_setup_connect_start').length,1);
});
test('verification approval offers the exact native self-test session instead of only the official browser',async t=>{
 const opened=[],task={job_id:'native_job_wait',session_id:'dsh_dot_wait',status:'running',pending_approvals:1,user_question_count:0};const setup={mode:'managed',phase:'running',services:{},actions:{},connection_setup:{phase:'verifying',waiting_for:'harness_approval',message:'验证任务正在等待你的审批。',verification_task:task,actions:{open:true,cancel:true},verification:{}}};
 const tree=await mount(t,{supports:()=>true,canOpenSession:()=>true,openSession:async value=>opened.push(value.session_id),async call(tool){if(tool==='manager_overview')return overview;if(tool==='manager_setup_status')return setup;if(tool==='manager_jobs')return pages([]);throw Error(tool);}});
 assert.ok(button(tree,'打开验证任务，处理审批'));await act(async()=>button(tree,'打开验证任务，处理审批').props.onClick());assert.deepEqual(opened,['dsh_dot_wait']);
});
test('native first-use preparation uses the public workspace registry and only the user-picked path',async()=>{
 const calls=[],navigation={current:{pickDirectory:async()=>{calls.push('pick');return'/chosen/project';}}},registry={current:{list:{getSnapshot:()=>({phase:'ready',state:'idle',items:[]})},create:async input=>{calls.push(input);return{workspaceId:'w-new',path:input.path};}}};
 const api=managementClientFactory(name=>({react:React,zod:{z}}[name]),createManagementRemote,()=>()=>null);const adapter=api.createNativeAdapter({},navigation,registry);
 assert.equal(await adapter.ensureWorkspace(),true);assert.deepEqual(calls,['pick',{path:'/chosen/project'}]);
 navigation.current.pickDirectory=async()=>null;assert.equal(await adapter.ensureWorkspace(),false);assert.equal(calls.length,2);
 registry.current.list.getSnapshot=()=>({phase:'ready',state:'idle',items:[{workspaceId:'existing',path:'/existing'}]});navigation.current.pickDirectory=async()=>{throw Error('must not pick');};assert.equal(await adapter.ensureWorkspace(),true);
});

test('a list failure retains the healthy overview and selected task; stale detail disables mutation',async t=>{
 let fail=false,selected={...job,result:'上次保存结果'};
 const tree=await mount(t,{async call(tool){if(tool==='manager_overview')return overview;if(tool==='manager_jobs'){if(fail)throw {code:'dot-management/busy'};return pages([selected]);}if(tool==='manager_job'){if(fail)throw {code:'dot-management/unavailable'};return{job:selected};}throw new Error(tool);}});
 await act(async()=>button(tree,'任务').props.onClick());
 await act(async()=>button(tree,job.task).props.onClick());
 fail=true;await act(async()=>button(tree,'刷新').props.onClick());
 assert.match(text(tree.toJSON()),/本机已就绪/);assert.match(text(tree.toJSON()),/任务列表.*上次/);assert.match(text(tree.toJSON()),/上次保存结果/);assert.match(text(tree.toJSON()),/最近成功更新/);
 assert.equal(button(tree,'暂停接入').props.disabled,false);assert.equal(button(tree,'取消任务').props.disabled,true);
});

test('refresh preserves selection and brings its new state and question text into view',async t=>{
 let selected={...job,result:'旧结果'};
 const tree=await mount(t,{async call(tool){if(tool==='manager_overview')return overview;if(tool==='manager_jobs')return pages([selected]);if(tool==='manager_job')return{job:selected};throw new Error(tool);},openSession:async()=>{}});
 await act(async()=>button(tree,'任务').props.onClick());await act(async()=>button(tree,job.task).props.onClick());
 selected={...job,pending_approvals:1,user_question_count:1,questions:[{id:'q1',question:'选择哪个目录？',options:[{label:'输出目录',description:'保留源文件'}],state:'open'}]};
 await act(async()=>button(tree,'刷新').props.onClick());
 assert.match(text(tree.toJSON()),/任务详情/);assert.match(text(tree.toJSON()),/选择哪个目录？/);assert.match(text(tree.toJSON()),/输出目录/);assert.match(text(tree.toJSON()),/需要你处理/);assert.match(text(tree.toJSON()),/演示项目/);
});

test('automatic refresh is bounded to one request at a time and stops on unmount',async t=>{
 t.mock.timers.enable({apis:['setInterval']});let hold=false,active=0,max=0,calls=0;const deferred=Promise.withResolvers();
 const tree=await mount(t,{async call(tool){calls++;active++;max=Math.max(max,active);try{if(hold)await deferred.promise;return tool==='manager_overview'?overview:pages([]);}finally{active--;}}});
 hold=true;await act(async()=>{t.mock.timers.tick(10000);});assert.equal(active,1);const during=calls;
 await act(async()=>{t.mock.timers.tick(40000);});assert.equal(calls,during);assert.equal(max,1);
 hold=false;await act(async()=>deferred.resolve());await act(async()=>tree.unmount());const stopped=calls;t.mock.timers.tick(10000);assert.equal(calls,stopped);
});

test('archive updates selected detail and archive filter without treating archive as cancellation',async t=>{
 let selected={...job,status:'succeeded'},calls=[];const deferred=Promise.withResolvers();
 const tree=await mount(t,{async call(tool,args){calls.push({tool,args});if(tool==='manager_overview')return overview;if(tool==='manager_jobs')return pages(Boolean(args.archived)===Boolean(selected.archived)?[selected]:[]);if(tool==='manager_job')return{job:selected};if(tool==='manager_archive'){await deferred.promise;selected={...selected,archived:args.archived};return{job:selected};}throw new Error(tool);}});
 await act(async()=>button(tree,'任务').props.onClick());await act(async()=>button(tree,job.task).props.onClick());
 await act(async()=>{void button(tree,'归档任务').props.onClick();});assert.equal(button(tree,'归档任务').props.disabled,true);
 await act(async()=>deferred.resolve());assert.equal(calls.filter(c=>c.tool==='manager_archive').length,1);assert.ok(button(tree,'取消归档'));
 await act(async()=>tree.root.findByProps({'aria-label':'记录范围'}).props.onChange({target:{value:'archived'}}));
 assert.equal(calls.filter(c=>c.tool==='manager_jobs').at(-1).args.archived,true);assert.equal(calls.some(c=>c.tool==='manager_cancel'),false);
});

test('running followup offers queue and steer, sends stable request id and prevents duplicate submits',async t=>{
 const calls=[],deferred=Promise.withResolvers();let selected=job;
 const tree=await mount(t,{async call(tool,args){if(tool==='manager_overview')return overview;if(tool==='manager_jobs')return pages([selected]);if(tool==='manager_job')return{job:selected};if(tool==='manager_followup'){calls.push(args);await deferred.promise;selected={...job,job_id:'j2',status:'accepted',task:args.task};return{job:selected};}throw new Error(tool);}});
 await act(async()=>button(tree,'任务').props.onClick());await act(async()=>button(tree,job.task).props.onClick());
 await act(async()=>tree.root.findByProps({'aria-label':'补充要求'}).props.onChange({target:{value:'保留原文件并写入检查报告'}}));
 await act(async()=>tree.root.findByProps({'aria-label':'发送方式'}).props.onChange({target:{value:'steer'}}));
 await act(async()=>{void button(tree,'发送补充要求').props.onClick();});assert.equal(button(tree,'发送补充要求').props.disabled,true);
 assert.equal(calls.length,1);assert.equal(calls[0].mode,'steer');assert.match(calls[0].request_id,/^[A-Za-z0-9_-]{1,100}$/);
 await act(async()=>deferred.resolve());assert.match(text(tree.toJSON()),/保留原文件并写入检查报告/);
});

test('first-use settings expose local preparation and cloud handoff as distinct steps',async t=>{
 const calls=[],setup={mode:'managed',phase:'setup_required',checks:[],services:{reader:'stopped',manager:'stopped',tunnel:'external_setup_required'},account:{state:'unverified'},actions:{prepare:true,start:false,stop:false},handoff:{steps:['在 Dot 中授权自己的连接。']}};
 const tree=await mount(t,{supports:()=>true,async call(tool){calls.push(tool);if(tool==='manager_setup_status')return setup;if(tool==='manager_overview')throw{code:'dot-management/unavailable'};if(tool==='manager_setup_prepare')return{...setup,phase:'prepared',actions:{prepare:false,start:true,stop:false}};throw new Error(tool);}});
 await act(async()=>button(tree,'连接设置').props.onClick());assert.match(text(tree.toJSON()),/云端状态待核实/);assert.ok(button(tree,'准备本机连接'));
 await act(async()=>button(tree,'准备本机连接').props.onClick());assert.ok(calls.includes('manager_setup_prepare'));assert.ok(button(tree,'启动本机服务'));await act(async()=>button(tree,'总览').props.onClick());assert.match(text(tree.toJSON()),/可复制给 Dot/);
});

test('native factory uses the published uiWorkspace openSession service without gating main slots on it',async()=>{
 const opened=[],registrations=[],callbacks=[];const remote={dotDshManagement:{},$mount:async()=>{}};
 const ctx={remote,slots:{inject:(_name,fn)=>fn(),register:(options,component)=>registrations.push({options,component})},inject(services,fn){if(services[0]==='remote.dotDshManagement')return fn(ctx);callbacks.push({services,fn});}};
 let adapter;const api=managementClientFactory(name=>({react:React,zod:{z}}[name]),createManagementRemote,(_react,a)=>{adapter=a;return()=>null;});await api.apply(ctx);
 assert.equal(registrations.some(r=>r.options.name==='main'),true);const navigation=callbacks.find(c=>c.services.includes('uiWorkspace'));assert.ok(navigation);
 navigation.fn({uiWorkspace:{openSession:id=>opened.push(id)}});await adapter.openSession(job);assert.deepEqual(opened,['s1']);
});

test('strict remote descriptors support filters, worker polling, setup and owned actions',()=>{
 const methods=createManagementRemote(z).methods;
 assert.equal(methods.jobs.schema.safeParse({archived:true,workspace_id:'w1',request_id:'req1'}).success,true);
 assert.equal(methods.followup.schema.safeParse({job_id:'j1',task:'补充',request_id:'req2',mode:'steer'}).success,true);
 assert.equal(methods.archive.schema.safeParse({job_id:'j1',archived:false}).success,true);
 for(const name of ['workerPoll','setupStatus','setupPrepare','setupStart','setupStop'])assert.equal(methods[name].schema.safeParse({}).success,true);
});

test('queued stage is not labelled running and remains distinguishable from human waiting',async t=>{
 const selected={...job,status:'running',stage:'queued',mode:'queue'};
 const tree=await mount(t,{async call(tool){if(tool==='manager_overview')return overview;if(tool==='manager_jobs')return pages([selected]);if(tool==='manager_job')return{job:selected};throw new Error(tool);}});
 await act(async()=>button(tree,'任务').props.onClick());assert.match(text(tree.toJSON()),/等待执行/);
 await act(async()=>button(tree,job.task).props.onClick());assert.equal(button(tree,'发送补充要求'),undefined);
});

test('closing detail while an archive is pending does not reopen it when the operation finishes',async t=>{
 const deferred=Promise.withResolvers();let selected={...job,status:'succeeded'};
 const tree=await mount(t,{async call(tool,args){if(tool==='manager_overview')return overview;if(tool==='manager_jobs')return pages([selected]);if(tool==='manager_job')return{job:selected};if(tool==='manager_archive'){await deferred.promise;selected={...selected,archived:args.archived};return{job:selected};}throw new Error(tool);}});
 await act(async()=>button(tree,'任务').props.onClick());await act(async()=>button(tree,job.task).props.onClick());await act(async()=>{void button(tree,'归档任务').props.onClick();});
 await act(async()=>button(tree,'关闭详情').props.onClick());await act(async()=>deferred.resolve());assert.doesNotMatch(text(tree.toJSON()),/任务详情/);
});

test('worker poll falls back to legacy overview only for unavailable method envelopes',async t=>{
 const prior=globalThis.location;globalThis.location={protocol:'dsh-app:',hostname:'app'};t.after(()=>{if(prior===undefined)delete globalThis.location;else globalThis.location=prior;});
 let poll,calls=[],result={ok:false,error:{code:'dot-management/invalid-request'}};
 const ctx={remote:{$mount:async()=>{},dotDshManagement:{workerPoll:async()=>{calls.push('workerPoll');return result;},overview:async()=>{calls.push('overview');return{ok:true,value:{native_control:null}};}}},effect:()=>{},slots:{inject:(_name,fn)=>fn(),register:()=>{}},inject(services,fn){if(services[0]==='uiWorkspace')return;return fn(ctx);}};
 await managementClientFactory(name=>({react:React,zod:{z}}[name]),createManagementRemote,()=>()=>null,options=>{poll=options.overview;return{start(){},close(){}};}).apply(ctx);
 assert.deepEqual(await poll(),{ok:true,value:{native_control:null}});assert.deepEqual(calls,['workerPoll','overview']);
 calls=[];result={ok:false,error:{code:'dot-management/denied'}};assert.deepEqual(await poll(),result);assert.deepEqual(calls,['workerPoll']);
});

test('legacy fixture tasks do not offer native-only archive or continuation',async t=>{
 const selected={job_id:'legacy_job',task:'旧测试任务',project_id:'fixture',status:'succeeded'};
 const tree=await mount(t,{async call(tool){if(tool==='manager_overview')return{...overview,scope:{task:'fixture_only'}};if(tool==='manager_jobs')return pages([selected]);if(tool==='manager_job')return{job:selected};throw new Error(tool);}});
 await act(async()=>button(tree,'任务').props.onClick());await act(async()=>button(tree,selected.task).props.onClick());assert.equal(Boolean(button(tree,'归档任务')),false);assert.equal(Boolean(button(tree,'继续任务')),false);
});

test('a cached detail read keeps its earlier successful update time and labels the stale state',async t=>{
 let cached=false;
 const tree=await mount(t,{async call(tool){if(tool==='manager_overview')return overview;if(tool==='manager_jobs')return pages([job]);if(tool==='manager_job')return{job,cached};throw new Error(tool);}});
 await act(async()=>button(tree,'任务').props.onClick());await act(async()=>button(tree,job.task).props.onClick());
 cached=true;await act(async()=>button(tree,'刷新').props.onClick());assert.match(text(tree.toJSON()),/所选任务.*当前显示上次保存的数据/);assert.equal(button(tree,'取消任务').props.disabled,true);
});

test('legacy protocol hides new filters and mutations while retaining status search and cancellation',async t=>{
 const legacy={...overview,management_protocol:{version:1,features:{task_filters:false,archive:false,followup:false,worker_poll:false}}},calls=[];
 const tree=await mount(t,{async call(tool,args){calls.push({tool,args});if(tool==='manager_overview')return legacy;if(tool==='manager_jobs')return pages([job]);if(tool==='manager_job')return{job};throw new Error(tool);}});
 await act(async()=>button(tree,'任务').props.onClick());const args=calls.find(call=>call.tool==='manager_jobs').args;assert.equal(Object.hasOwn(args,'archived'),false);
 for(const label of ['项目','记录范围','请求编号'])assert.equal(tree.root.findAllByProps({'aria-label':label}).length,0);
 assert.equal(tree.root.findAllByProps({'aria-label':'状态'}).length,1);assert.equal(tree.root.findAllByProps({'aria-label':'搜索当前页'}).length,1);
 await act(async()=>button(tree,job.task).props.onClick());assert.equal(Boolean(button(tree,'发送补充要求')),false);assert.ok(button(tree,'取消任务'));assert.match(text(tree.toJSON()),/兼容模式/);
});

test('settings distinguish externally managed, unknown and stopped services',async t=>{
 let setup={mode:'external',phase:'external',checks:[],services:{reader:'external',manager:'unknown'},account:{state:'unverified'},actions:{},handoff:{steps:[]}};
 const tree=await mount(t,{supports:()=>true,async call(tool){if(tool==='manager_overview')return overview;if(tool==='manager_setup_status')return setup;throw new Error(tool);}});
 await act(async()=>button(tree,'连接设置').props.onClick());assert.match(text(tree.toJSON()),/读取服务外部管理/);assert.match(text(tree.toJSON()),/管理服务运行状态待核实/);
 setup={...setup,services:{reader:'stopped',manager:'running'}};await act(async()=>button(tree,'刷新').props.onClick());assert.match(text(tree.toJSON()),/读取服务已停止/);assert.match(text(tree.toJSON()),/管理服务已启动/);
});

const cloudOverview=(clock,connection={},extra={})=>({...overview,...extra,connection:{...overview.connection,cloud_state:'online',cloud_checked_at:new Date(clock).toISOString(),cloud_last_connected_at:new Date(clock-1000).toISOString(),cloud_last_interaction_at:'2026-09-01T12:00:00.000Z',cloud_source:'official_tunnel_health',...connection}});
const headerText=tree=>tree.root.findByType('header').findAllByType('p').map(node=>text(node.props.children)).join('');

test('fresh cloud health stays online while idle or paused, with activity shown separately in settings',async t=>{
 const clock=Date.parse('2026-10-22T12:00:00.000Z');t.mock.method(Date,'now',()=>clock);
 const value=cloudOverview(clock,{}, {admission:{paused:true}});
 const tree=await mount(t,{async call(){return value;}});
 assert.match(headerText(tree),/云端通道在线/);assert.doesNotMatch(headerText(tree),/尚未验证|云端通道离线/);
 assert.ok(button(tree,'恢复接入'));
 await act(async()=>button(tree,'连接设置').props.onClick());
 assert.equal((text(tree.toJSON()).match(/云端通道在线/g)??[]).length,2);
 assert.match(text(tree.toJSON()),/最近云端交互/);assert.match(text(tree.toJSON()),/2026\/9\/1/);
 assert.match(text(tree.toJSON()),/账号授权.*任务.*成功/);
});

test('cloud health distinguishes offline, unknown, unconfigured and older services without inventing success',async t=>{
 const clock=Date.parse('2026-10-22T12:00:00.000Z');t.mock.method(Date,'now',()=>clock);
 for(const [name,connection,expected]of[
  ['offline',{cloud_state:'offline'},/云端通道离线/],
  ['unknown',{cloud_state:'unknown'},/云端状态待核实/],
  ['unconfigured',{cloud_state:'not_configured',cloud_source:'none'},/尚未关联隧道状态/],
  ['old backend',{cloud_state:undefined,cloud_source:undefined},/当前服务未提供云端实时状态/],
  ['legacy placeholder',{cloud_state:'not_verified',cloud_source:undefined},/当前服务未提供云端实时状态/],
 ])await t.test(name,async t=>{
  const tree=await mount(t,{async call(){return cloudOverview(clock,connection);}});
  assert.match(headerText(tree),expected);assert.doesNotMatch(headerText(tree),/云端通道在线/);
  assert.match(headerText(tree),/本机已就绪/);
 });
});

test('untrustworthy or stale cloud evidence cannot render a current online claim',async t=>{
 const clock=Date.parse('2026-10-22T12:00:00.000Z');t.mock.method(Date,'now',()=>clock);
 for(const [name,connection]of[
  ['expired check',{cloud_checked_at:new Date(clock-35001).toISOString()}],
  ['future check',{cloud_checked_at:new Date(clock+5001).toISOString()}],
  ['missing check',{cloud_checked_at:undefined}],
  ['malformed check',{cloud_checked_at:'not a date'}],
  ['unrecognized source',{cloud_source:'page_poll'}],
 ])await t.test(name,async t=>{
  const tree=await mount(t,{async call(){return cloudOverview(clock,connection);}});
  assert.match(headerText(tree),/云端状态待核实/);assert.doesNotMatch(headerText(tree),/云端通道在线/);
  assert.match(headerText(tree),/最近连通/);
 });
});

test('an overview failure removes the current online label but preserves its last known cloud times',async t=>{
 const clock=Date.parse('2026-10-22T12:00:00.000Z');t.mock.method(Date,'now',()=>clock);let fail=false;
 const tree=await mount(t,{async call(){if(fail)throw{code:'dot-management/unavailable'};return cloudOverview(clock);}});
 assert.match(headerText(tree),/云端通道在线/);
 fail=true;await act(async()=>button(tree,'刷新').props.onClick());
 assert.match(headerText(tree),/云端状态待核实/);assert.doesNotMatch(headerText(tree),/云端通道在线/);
 assert.match(headerText(tree),/最近连通.*2026\/10\/22/);assert.match(headerText(tree),/最近云端交互.*2026\/9\/1/);
});

test('automatic refresh renders cloud disconnection and recovery without user refresh',async t=>{
 t.mock.timers.enable({apis:['setInterval']});let clock=Date.parse('2026-10-22T12:00:00.000Z'),state='online';t.mock.method(Date,'now',()=>clock);
 const tree=await mount(t,{async call(){return cloudOverview(clock,{cloud_state:state});}});
 assert.match(headerText(tree),/云端通道在线/);
 state='offline';clock+=10000;await act(async()=>t.mock.timers.tick(10000));assert.match(headerText(tree),/云端通道离线/);
 state='online';clock+=10000;await act(async()=>t.mock.timers.tick(10000));assert.match(headerText(tree),/云端通道在线/);
});

test('the current cloud label expires even while an automatic overview request remains in flight',async t=>{
 t.mock.timers.enable({apis:['setInterval']});let clock=Date.parse('2026-10-22T12:00:00.000Z'),hold=false;const pending=Promise.withResolvers();t.mock.method(Date,'now',()=>clock);
 const tree=await mount(t,{async call(){if(hold)return pending.promise;return cloudOverview(clock);}});
 assert.match(headerText(tree),/云端通道在线/);
 try{
  hold=true;clock+=10000;await act(async()=>t.mock.timers.tick(10000));
  clock+=30000;await act(async()=>t.mock.timers.tick(30000));
  assert.match(headerText(tree),/云端状态待核实/);assert.doesNotMatch(headerText(tree),/云端通道在线/);assert.match(headerText(tree),/最近连通/);
 }finally{await act(async()=>pending.resolve(cloudOverview(clock)));}
});

test('returning to a hidden page expires old cloud evidence before its resumed request finishes',async t=>{
 const previous=globalThis.document,document=Object.assign(new EventTarget(),{visibilityState:'visible'});globalThis.document=document;
 t.mock.timers.enable({apis:['setInterval']});let clock=Date.parse('2026-10-22T12:00:00.000Z'),calls=0,hold=false;const pending=Promise.withResolvers();t.mock.method(Date,'now',()=>clock);
 const tree=await mount(t,{async call(){calls++;if(hold)return pending.promise;return cloudOverview(clock);}});
 t.after(()=>{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;});
 try{
  document.visibilityState='hidden';clock+=40000;await act(async()=>t.mock.timers.tick(40000));assert.equal(calls,1);
  hold=true;document.visibilityState='visible';await act(async()=>document.dispatchEvent(new Event('visibilitychange')));
  assert.equal(calls,2);assert.match(headerText(tree),/云端状态待核实/);assert.doesNotMatch(headerText(tree),/云端通道在线/);
 }finally{await act(async()=>pending.resolve(cloudOverview(clock)));}
});

const connectView=(phase='idle',extra={})=>({phase,step:phase==='idle'?'start':'account',message:phase==='idle'?'首次连接后，就可以从 Dot 派任务。':'请在浏览器登录自己的账号。',actions:{start:phase==='idle',resume:false,cancel:phase!=='idle',open:phase==='login'},verification:{tunnel_online:false,chatgpt_connected:false,dot_read:false,task_complete:false},...extra});
const managedSetup=connection_setup=>({mode:'managed',phase:'prepared',checks:[],services:{reader:'running',manager:'running'},actions:{prepare:false,start:false,stop:true},connection_setup});

test('missing Ego and first-run setup present one explicit primary continuation',async t=>{
 let state=connectView('blocked',{message:'连接窗口需要 Ego。',actions:{start:false,resume:true,cancel:true,open:false},error:{code:'EGO_BROWSER_UNAVAILABLE',message:'连接窗口需要 Ego。'}});const calls=[];
 const tree=await mount(t,{supports:()=>true,async call(tool){calls.push(tool);if(tool==='manager_overview')return overview;if(tool==='manager_jobs')return pages([]);if(tool==='manager_setup_status')return managedSetup(state);if(tool==='manager_setup_connect_status')return state;if(tool==='manager_setup_connect_resume')return state=connectView('blocked',{message:'请完成 Ego 首次设置；无需导入其他浏览器的数据。',waiting_for:'browser_setup',actions:{start:false,resume:true,cancel:true,open:false},error:{code:'EGO_SETUP_REQUIRED',message:'请完成 Ego 首次设置；无需导入其他浏览器的数据。'}});throw Error(tool);}});
 const install=button(tree,'安装 Ego 并继续');assert.ok(install);assert.match(install.props.className,/dm-primary/);assert.equal(button(tree,'重试连接'),undefined);await act(async()=>install.props.onClick());assert.equal(calls.filter(x=>x==='manager_setup_connect_resume').length,1);
 const next=button(tree,'我已完成，继续连接');assert.ok(next);assert.match(next.props.className,/dm-primary/);assert.match(text(tree.toJSON()),/无需导入/);assert.doesNotMatch(text(tree.toJSON()),/其他步骤会自动继续/);assert.equal(button(tree,'打开连接窗口'),undefined);
});

test('first connection is a primary native action and duplicate start clicks coalesce',async t=>{
 let state=connectView(),calls=[];const pending=Promise.withResolvers();
 const tree=await mount(t,{supports:()=>true,async call(tool,args){calls.push({tool,args});if(tool==='manager_overview')throw{code:'dot-management/unavailable'};if(tool==='manager_setup_status')return managedSetup(state);if(tool==='manager_setup_connect_status')return state;if(tool==='manager_setup_connect_start'){await pending.promise;return state=connectView('preparing',{message:'正在准备本机连接。',actions:{start:false,resume:false,cancel:true,open:false}});}throw Error(tool);}});
 assert.match(text(tree.toJSON()),/本机准备.*登录与授权.*验证连接/);assert.ok(button(tree,'连接我的 Dot'));
 await act(async()=>{void button(tree,'连接我的 Dot').props.onClick();void button(tree,'连接我的 Dot').props.onClick();});
 assert.equal(button(tree,'连接我的 Dot').props.disabled,true);assert.equal(calls.filter(x=>x.tool==='manager_setup_connect_start').length,1);
 await act(async()=>pending.resolve());assert.match(text(tree.toJSON()),/正在准备本机连接/);assert.ok(button(tree,'取消本次连接'));
 assert.deepEqual(calls.find(x=>x.tool==='manager_setup_connect_start').args,{});
});

test('login and grant waits can reopen, resume and cancel without guessing account success',async t=>{
 let state=connectView('login',{waiting_for:'login',message:'请登录自己的 OpenAI 账号。',actions:{start:false,resume:true,cancel:true,open:true}});const calls=[];
 const tree=await mount(t,{supports:()=>true,async call(tool,args){calls.push({tool,args});if(tool==='manager_overview')return overview;if(tool==='manager_jobs')return pages([]);if(tool==='manager_setup_status')return managedSetup(state);if(tool==='manager_setup_connect_status')return state;if(tool==='manager_setup_connect_open')return state;if(tool==='manager_setup_connect_resume')return state=connectView('authorize',{message:'请在官方页面确认工具授权。',waiting_for:'authorization',actions:{start:false,resume:true,cancel:true,open:true}});if(tool==='manager_setup_connect_cancel')return state=connectView('cancelled',{message:'本次连接已取消；已有任务和连接保留。',actions:{start:false,resume:true,cancel:false,open:false}});throw Error(tool);}});
 assert.match(text(tree.toJSON()),/请登录自己的 OpenAI 账号/);assert.doesNotMatch(text(tree.toJSON()),/连接验证已完成/);
 await act(async()=>button(tree,'打开连接窗口').props.onClick());assert.equal(calls.filter(x=>x.tool==='manager_setup_connect_open').length,1);
 await act(async()=>button(tree,'继续连接').props.onClick());assert.match(text(tree.toJSON()),/请在官方页面确认工具授权/);
 await act(async()=>button(tree,'取消本次连接').props.onClick());assert.match(text(tree.toJSON()),/本次连接已取消/);assert.ok(button(tree,'重试连接'));
 assert.equal(calls.some(x=>x.tool==='manager_set_paused'||x.tool==='manager_cancel'),false);
});

test('cloud health and partial wizard checks never impersonate a completed first connection',async t=>{
 let state=connectView('verifying',{message:'等待 Harness 完成验证任务。',verification:{tunnel_online:true,chatgpt_connected:true,dot_read:true,task_complete:false}});
 const tree=await mount(t,{supports:()=>true,async call(tool){if(tool==='manager_overview')return cloudOverview(Date.now());if(tool==='manager_jobs')return pages([]);if(tool==='manager_setup_status')return managedSetup(state);if(tool==='manager_setup_connect_status')return state;throw Error(tool);}});
 assert.match(text(tree.toJSON()),/云端通道在线/);assert.doesNotMatch(text(tree.toJSON()),/连接验证已完成/);assert.match(text(tree.toJSON()),/等待 Harness 完成验证任务/);
 state=connectView('ready',{message:'连接验证已完成。',actions:{start:false,resume:false,cancel:false,open:true},verification:{tunnel_online:true,chatgpt_connected:true,dot_read:true,task_complete:true}});
 await act(async()=>button(tree,'刷新').props.onClick());assert.match(text(tree.toJSON()),/连接验证已完成/);
});

test('visible active connection polls its own status every two seconds without overlapping',async t=>{
 t.mock.timers.enable({apis:['setInterval']});let state=connectView('login'),hold=false,active=0,max=0,calls=0;const pending=Promise.withResolvers();
 const tree=await mount(t,{supports:()=>true,async call(tool){if(tool==='manager_overview')return overview;if(tool==='manager_jobs')return pages([]);if(tool==='manager_setup_status')return managedSetup(state);if(tool==='manager_setup_connect_status'){calls++;active++;max=Math.max(max,active);try{if(hold)await pending.promise;return state;}finally{active--;}}throw Error(tool);}});
 hold=true;await act(async()=>t.mock.timers.tick(2000));assert.equal(active,1);const before=calls;
 await act(async()=>t.mock.timers.tick(6000));assert.equal(calls,before);assert.equal(max,1);
 state=connectView('authorize',{message:'请确认授权。'});await act(async()=>pending.resolve());assert.match(text(tree.toJSON()),/请确认授权/);
 await act(async()=>tree.unmount());const last=calls;t.mock.timers.tick(4000);assert.equal(calls,last);
});

test('external deployments keep their current connection and offer no replacement wizard',async t=>{
 const state={mode:'external',phase:'external',services:{reader:'external',manager:'external'},actions:{},connection_setup:connectView('external',{message:'保留已有连接',actions:{start:false,resume:false,cancel:false,open:false}})};
 const tree=await mount(t,{supports:()=>true,async call(tool){if(tool==='manager_overview')return overview;if(tool==='manager_jobs')return pages([job]);if(tool==='manager_setup_status')return state;if(tool==='manager_setup_connect_status')return state.connection_setup;throw Error(tool);}});
 assert.equal(Boolean(button(tree,'连接我的 Dot')),false);assert.match(text(tree.toJSON()),/已有连接已保留，可以直接从 Dot 派任务/);
 await act(async()=>button(tree,'连接设置').props.onClick());assert.equal(Boolean(button(tree,'连接我的 Dot')),false);assert.match(text(tree.toJSON()),/外部管理/);
});

test('first connection remote descriptors accept only empty owner setup inputs',()=>{
 const methods=createManagementRemote(z).methods;
 for(const operation of ['Status','Start','Resume','Cancel','Open','Renew','RestartKey','Reopen']){
  const entry=methods['setupConnect'+operation];assert.ok(entry,operation);assert.equal(entry.tool,'manager_setup_connect_'+operation.toLowerCase());assert.equal(entry.schema.safeParse({}).success,true);assert.equal(entry.schema.safeParse({url:'https://example.test',token:'not allowed'}).success,false);
 }
});

test('recreating authorization is offered only by the recovery capability and never starts first connection',async t=>{
 let offered=false,supportedAction=true,workspaceChecks=0;const calls=[];
 const state=()=>connectView('blocked',{purpose:'key-renewal',error:{code:'ONBOARDING_KEY_RECOVERY'},actions:{restart_key:offered,cancel:true}});
 const tree=await mount(t,{supports:tool=>tool!=='manager_setup_connect_restartkey'||supportedAction,ensureWorkspace:async()=>{workspaceChecks++;return true;},async call(tool){calls.push(tool);if(tool==='manager_overview')return cloudOverview(Date.now());if(tool==='manager_jobs')return pages([]);if(tool==='manager_setup_status')return managedSetup(state());if(tool==='manager_setup_connect_restartkey')return connectView('authorize',{purpose:'key-renewal',actions:{cancel:true},message:'请在官方页面确认新的授权。'});throw Error(tool);}});
 assert.equal(button(tree,'重新创建授权'),undefined);offered=true;supportedAction=false;await act(async()=>button(tree,'刷新').props.onClick());assert.equal(button(tree,'重新创建授权'),undefined);
 supportedAction=true;await act(async()=>button(tree,'刷新').props.onClick());const restart=button(tree,'重新创建授权');assert.ok(restart);await act(async()=>{void restart.props.onClick();void restart.props.onClick();});assert.equal(calls.filter(x=>x==='manager_setup_connect_restartkey').length,1);assert.equal(workspaceChecks,0);assert.equal(calls.includes('manager_setup_connect_start'),false);assert.equal(button(tree,'连接我的 Dot'),undefined);assert.match(text(tree.toJSON()),/确认新的授权/);
});

test('a missing connection window offers only explicit reopen and sends the scoped recovery action',async t=>{
 let offered=false,supportedAction=true,workspaceChecks=0;const calls=[];
 const state=()=>connectView('blocked',{purpose:'key-renewal',error:{code:'ONBOARDING_EGO_SPACE_MISSING'},actions:{reopen:offered,resume:true,open:true,cancel:true}});
 const tree=await mount(t,{supports:tool=>tool!=='manager_setup_connect_reopen'||supportedAction,ensureWorkspace:async()=>{workspaceChecks++;return true;},async call(tool){calls.push(tool);if(tool==='manager_overview')return cloudOverview(Date.now());if(tool==='manager_jobs')return pages([]);if(tool==='manager_setup_status')return managedSetup(state());if(tool==='manager_setup_connect_reopen')return connectView('authorize',{purpose:'key-renewal',actions:{resume:true,cancel:true,open:true},message:'连接窗口已重新打开，请完成官方确认。'});throw Error(tool);}});
 assert.equal(button(tree,'重新打开连接窗口'),undefined);offered=true;supportedAction=false;await act(async()=>button(tree,'刷新').props.onClick());assert.equal(button(tree,'重新打开连接窗口'),undefined);
 supportedAction=true;await act(async()=>button(tree,'刷新').props.onClick());assert.equal(Boolean(button(tree,'继续更新')),false);assert.equal(Boolean(button(tree,'打开连接窗口')),false);
 const reopen=button(tree,'重新打开连接窗口');assert.ok(reopen);assert.match(reopen.props.className,/dm-primary/);await act(async()=>reopen.props.onClick());assert.equal(calls.filter(x=>x==='manager_setup_connect_reopen').length,1);assert.equal(workspaceChecks,0);assert.equal(calls.includes('manager_setup_connect_start'),false);assert.equal(calls.includes('manager_setup_connect_resume'),false);assert.equal(button(tree,'连接我的 Dot'),undefined);assert.match(text(tree.toJSON()),/重新打开，请完成官方确认/);
});

test('credential settings show unknown expiry without inventing a date and require renewal capability',async t=>{
 const state=connectView('ready',{credential:{state:'unknown',expiry_source:'unknown',renewal_pending:false},actions:{renew:true},verification:{tunnel_online:true,chatgpt_connected:true,dot_read:true,task_complete:true}});
 let allowed=false;const calls=[];
 const tree=await mount(t,{supports:tool=>tool!=='manager_setup_connect_renew'||allowed,async call(tool){calls.push(tool);if(tool==='manager_overview')return cloudOverview(Date.now());if(tool==='manager_jobs')return pages([]);if(tool==='manager_setup_status')return managedSetup(state);throw Error(tool);}});
 await act(async()=>button(tree,'连接设置').props.onClick());assert.match(text(tree.toJSON()),/有效期未记录/);assert.doesNotMatch(text(tree.toJSON()),/预计到期|天后到期/);assert.equal(button(tree,'更新连接授权'),undefined);
 allowed=true;await act(async()=>button(tree,'刷新').props.onClick());assert.ok(button(tree,'更新连接授权'));assert.equal(calls.includes('manager_setup_connect_renew'),false);
});

test('expiring authorization offers one renewal action and renewal continuation keeps the old connection intact',async t=>{
 let state=connectView('ready',{credential:{state:'expiring',expiry_source:'estimated',expires_at:'2026-11-01T12:00:00Z',days_remaining:3,renewal_pending:false},actions:{renew:true,resume:true},verification:{tunnel_online:true,chatgpt_connected:true,dot_read:true,task_complete:true}});
 const calls=[],pending=Promise.withResolvers();let workspaceChecks=0;
 const tree=await mount(t,{supports:()=>true,ensureWorkspace:async()=>{workspaceChecks++;return true;},async call(tool){calls.push(tool);if(tool==='manager_overview')return cloudOverview(Date.now());if(tool==='manager_jobs')return pages([]);if(tool==='manager_setup_status')return managedSetup(state);if(tool==='manager_setup_connect_renew'){await pending.promise;return state=connectView('blocked',{purpose:'key-renewal',message:'请在官方页面确认更新。',waiting_for:'authorization',credential:{state:'expiring',expiry_source:'estimated',days_remaining:3,renewal_pending:true},actions:{renew:false,resume:true,cancel:true,open:true},error:{code:'ONBOARDING_EGO_HANDOFF'}});}if(tool==='manager_setup_connect_resume')return state;if(tool==='manager_setup_connect_cancel')return state=connectView('ready',{message:'已暂缓更新，原连接保留。',credential:{state:'expiring',expiry_source:'estimated',days_remaining:3,renewal_pending:true},actions:{renew:true},verification:{tunnel_online:true,chatgpt_connected:true,dot_read:true,task_complete:true}});throw Error(tool);}});
 assert.match(text(tree.toJSON()),/连接授权预计 3 天后到期/);const renew=button(tree,'更新连接授权');assert.ok(renew);
 await act(async()=>{void renew.props.onClick();void renew.props.onClick();});assert.equal(calls.filter(x=>x==='manager_setup_connect_renew').length,1);assert.equal(renew.props.disabled,true);
 await act(async()=>pending.resolve());assert.ok(button(tree,'继续更新'));assert.ok(button(tree,'暂不更新'));assert.equal(button(tree,'更新连接授权'),undefined);assert.equal(button(tree,'取消本次连接'),undefined);assert.doesNotMatch(text(tree.toJSON()),/首次连接后|连接一次，之后/);
 await act(async()=>button(tree,'继续更新').props.onClick());assert.equal(workspaceChecks,0);assert.equal(calls.filter(x=>x==='manager_setup_connect_resume').length,1);
 await act(async()=>button(tree,'暂不更新').props.onClick());assert.equal(calls.filter(x=>x==='manager_setup_connect_cancel').length,1);assert.equal(calls.includes('manager_setup_stop'),false);assert.equal(calls.includes('manager_set_paused'),false);assert.match(text(tree.toJSON()),/连接验证已完成/);
});

test('expired credentials warn while valid credentials stay quiet and unsupported hosts never offer renewal',async t=>{
 let state=connectView('ready',{credential:{state:'valid',expiry_source:'estimated',expires_at:'2026-11-22T12:00:00Z',days_remaining:30,renewal_pending:false},actions:{renew:true},verification:{tunnel_online:true,chatgpt_connected:true,dot_read:true,task_complete:true}});
 const tree=await mount(t,{supports:()=>true,async call(tool){if(tool==='manager_overview')return cloudOverview(Date.now());if(tool==='manager_jobs')return pages([]);if(tool==='manager_setup_status')return managedSetup(state);throw Error(tool);}});
 assert.equal(button(tree,'更新连接授权'),undefined);assert.doesNotMatch(text(tree.toJSON()),/授权预计已到期|授权即将到期/);
 await act(async()=>button(tree,'连接设置').props.onClick());assert.match(text(tree.toJSON()),/预计到期/);assert.ok(button(tree,'更新连接授权'));
 state={...state,credential:{state:'expired',expiry_source:'estimated',expires_at:'2026-10-01T12:00:00Z',days_remaining:0,renewal_pending:false}};await act(async()=>button(tree,'总览').props.onClick());assert.match(text(tree.toJSON()),/连接授权预计已到期/);assert.ok(button(tree,'更新连接授权'));
 state={...state,credential:undefined,actions:{}};await act(async()=>button(tree,'连接设置').props.onClick());assert.equal(button(tree,'更新连接授权'),undefined);assert.doesNotMatch(text(tree.toJSON()),/预计到期/);
});

test('tab keyboard navigation follows the selected panel and retains visible focus',async t=>{
 const tree=await mount(t,{async call(tool){return tool==='manager_overview'?overview:pages([]);}});const tabs=tree.root.findAllByProps({role:'tab'});let prevented=0,focused=-1;
 assert.equal(typeof tabs[0].props.onKeyDown,'function');
 await act(async()=>tabs[0].props.onKeyDown({key:'ArrowRight',preventDefault(){prevented++;},currentTarget:{parentElement:{querySelectorAll:()=>tabs.map((_,index)=>({focus(){focused=index;}}))}}}));
 assert.equal(prevented,1);assert.equal(focused,1);assert.equal(tree.root.findAllByProps({role:'tab'})[1].props['aria-selected'],true);
});

test('a new connection has a neutral header and does not offer admission controls before linking',async t=>{
 for(const phase of ['idle','preparing','login'])await t.test(phase,async t=>{
  const state=managedSetup(connectView(phase));
  const firstOverview={...overview,connection:{state:'offline',cloud_state:'not_configured',cloud_source:'none'},audit:{events_total:0,jobs_total:0},recent_events:[]};
  const tree=await mount(t,{supports:()=>true,async call(tool){if(tool==='manager_overview')return firstOverview;if(tool==='manager_jobs')return pages([]);if(tool==='manager_setup_status')return state;if(tool==='manager_setup_connect_status')return state.connection_setup;throw Error(tool);}});
  const header=headerText(tree);
  assert.match(header,phase==='idle'?/尚未连接/:/正在连接/);
  assert.doesNotMatch(header,/离线|云端状态待核实|尚未关联隧道/);
  assert.equal(button(tree,'暂停接入'),undefined);
  assert.match(text(tree.toJSON()),/首次连接完成后，可在这里暂停新的读取与任务请求/);
 });
});

test('opening a task scrolls and focuses its detail once; refresh preserves reading focus and close returns to the task',async t=>{
 let focused=0,scrolled=0,returned=0,selected=job;
 const trigger={isConnected:true,focus(){returned++;}};
 const heading={focus(options){assert.equal(options.preventScroll,true);focused++;},scrollIntoView(options){assert.equal(options.block,'start');assert.equal(options.behavior,'auto');scrolled++;}};
 const tree=await mount(t,{async call(tool){if(tool==='manager_overview')return overview;if(tool==='manager_jobs')return pages([selected]);if(tool==='manager_job')return{job:selected};throw Error(tool);}},{createNodeMock:element=>element.type==='h2'&&element.props.children==='任务详情'?heading:null});
 await act(async()=>button(tree,'任务').props.onClick());
 await act(async()=>button(tree,job.task).props.onClick({currentTarget:trigger}));
 assert.equal(tree.root.findAllByType('h2').find(node=>text(node.props.children)==='任务详情').props.tabIndex,-1);
 assert.equal(scrolled,1);assert.equal(focused,1);assert.equal(returned,0);
 selected={...job,result:'刷新后的结果'};
 await act(async()=>button(tree,'刷新').props.onClick());
 assert.match(text(tree.toJSON()),/刷新后的结果/);assert.equal(scrolled,1);assert.equal(focused,1);
 await act(async()=>button(tree,'关闭详情').props.onClick());
 assert.equal(returned,1);assert.doesNotMatch(text(tree.toJSON()),/任务详情/);
});

test('the first verification keeps admission controls hidden until every check finishes even when partial evidence arrives',async t=>{
 let state=connectView('verifying',{verification:{tunnel_online:true,chatgpt_connected:true,dot_read:true,task_complete:false}});
 const firstOverview={...overview,connection:{state:'connected',worker_backend:'online',cloud_state:'online',cloud_source:'official_tunnel_health',cloud_checked_at:new Date().toISOString()},audit:{events_total:0,jobs_total:0},recent_events:[]};
 const tree=await mount(t,{supports:()=>true,async call(tool){if(tool==='manager_overview')return firstOverview;if(tool==='manager_jobs')return pages([]);if(tool==='manager_setup_status')return managedSetup(state);if(tool==='manager_setup_connect_status')return state;throw Error(tool);}});
 assert.equal(Boolean(button(tree,'暂停接入')),false);assert.match(headerText(tree),/正在连接/);
 firstOverview.connection.cloud_last_connected_at=new Date().toISOString();firstOverview.audit.events_total=2;firstOverview.audit.jobs_total=1;
 await act(async()=>button(tree,'刷新').props.onClick());
 assert.equal(Boolean(button(tree,'暂停接入')),false);assert.match(headerText(tree),/正在连接/);
 state=connectView('ready',{verification:{tunnel_online:true,chatgpt_connected:true,dot_read:true,task_complete:true}});
 await act(async()=>button(tree,'刷新').props.onClick());
 assert.ok(button(tree,'暂停接入'));assert.match(text(tree.toJSON()),/连接验证已完成/);
});

test('closing a task opened from the overview restores focus to its surviving task row',async t=>{
 let returned=0;
 const row={isConnected:true,focus(){returned++;}};
 const tree=await mount(t,{supports:()=>true,async call(tool){if(tool==='manager_overview')return overview;if(tool==='manager_jobs')return pages([job]);if(tool==='manager_job')return{job};if(tool==='manager_setup_status')return{mode:'external'};throw Error(tool);}},{createNodeMock:element=>element.type==='button'&&element.props.className==='dm-link'&&element.props.children===job.task?row:null});
 await act(async()=>button(tree,job.session_name).props.onClick({currentTarget:{isConnected:false,focus(){assert.fail('the overview trigger no longer exists');}}}));
 await act(async()=>button(tree,'关闭详情').props.onClick());
 assert.equal(returned,1);
});

test('the overview leads with the session title and keeps existing external deployment details in diagnostics',async t=>{
 const item={...job,session_name:'按要求回复验收文本',task:'逐项阅读项目说明，然后严格按要求返回验收文本，不修改任何文件；这里是完整任务要求。'};
 const deploymentMessage='保留已有连接：由外部进程管理现有端口与部署。';
 const tree=await mount(t,{supports:()=>true,async call(tool){if(tool==='manager_overview')return overview;if(tool==='manager_jobs')return pages([item]);if(tool==='manager_job')return{job:item};if(tool==='manager_setup_status')return{mode:'external',phase:'external',services:{reader:'external',manager:'external'},connection_setup:connectView('external',{message:deploymentMessage})};throw Error(tool);}});
 assert.ok(button(tree,item.session_name));assert.doesNotMatch(text(tree.toJSON()),/这里是完整任务要求|由外部进程管理现有端口与部署/);
 const preserved=tree.root.findAllByType('p').find(node=>text(node.props.children)==='已有连接已保留，可以直接从 Dot 派任务。');
 assert.equal(preserved?.props.className,'dm-native-note');
 await act(async()=>button(tree,item.session_name).props.onClick());assert.match(text(tree.toJSON()),/这里是完整任务要求/);
 await act(async()=>button(tree,'连接设置').props.onClick());
 const diagnostics=tree.root.findByProps({className:'dm-diagnostics'});assert.match(text(diagnostics),/由外部进程管理现有端口与部署/);
});


test('restored transport labels earlier verification and offers explicit recheck without claiming a fresh task',async t=>{
 const state=connectView('ready',{message:'已恢复本机连接。',last_verified_at:'2026-10-22T12:00:00Z',verification_source:'saved_receipt',actions:{start:false,resume:true,cancel:false,open:false},verification:{tunnel_online:true,chatgpt_connected:true,dot_read:true,task_complete:true}});
 const calls=[];const tree=await mount(t,{supports:()=>true,async call(tool){calls.push(tool);if(tool==='manager_overview')return cloudOverview(Date.now());if(tool==='manager_jobs')return pages([]);if(tool==='manager_setup_status')return managedSetup(state);if(tool==='manager_setup_connect_status')return state;if(tool==='manager_setup_connect_resume')return state;throw Error(tool);}});
 assert.match(text(tree.toJSON()),/连接已恢复.*上次完整验证/);assert.doesNotMatch(text(tree.toJSON()),/连接验证已完成/);
 await act(async()=>button(tree,'连接设置').props.onClick());assert.match(text(tree.toJSON()),/上次已确认/);assert.ok(button(tree,'重新验证连接'));
 await act(async()=>button(tree,'重新验证连接').props.onClick());assert.equal(calls.filter(x=>x==='manager_setup_connect_resume').length,1);
});

test('a restored channel awaiting its first real call keeps tasks visible and labels saved proof honestly',async t=>{
 const state=connectView('restoring',{message:'连接通道已启动，等待 Dot 的首次调用。',last_verified_at:'2026-10-22T12:00:00Z',verification_source:'saved_receipt',actions:{start:false,resume:true,cancel:true,open:false},verification:{tunnel_online:false,chatgpt_connected:true,dot_read:true,task_complete:true}});
 const tree=await mount(t,{supports:()=>true,async call(tool){if(tool==='manager_overview')return cloudOverview(Date.now(),{cloud_state:'unknown',cloud_reason:'awaiting_first_call'});if(tool==='manager_jobs')return pages([job]);if(tool==='manager_setup_status')return managedSetup(state);if(tool==='manager_setup_connect_status')return state;throw Error(tool);}});
 assert.match(headerText(tree),/通道已启动.*等待首次调用/);assert.doesNotMatch(headerText(tree),/云端通道在线/);
 assert.match(text(tree.toJSON()),/可以直接向 Dot 派任务/);assert.match(text(tree.toJSON()),/上次完整验证/);assert.doesNotMatch(text(tree.toJSON()),/连接验证已完成|首次连接向导|重新验证连接|正在检查已有连接/);
 assert.ok(button(tree,job.session_name));
 await act(async()=>button(tree,'连接设置').props.onClick());assert.ok(button(tree,'重新验证连接'));assert.ok(button(tree,'暂停连接'));assert.match(text(tree.toJSON()),/上次已确认/);assert.equal(tree.root.findAllByProps({className:'dm-steps'}).length,0);
});

test('pending transport restoration automatically follows a real call without another user action',async t=>{
 t.mock.timers.enable({apis:['setInterval']});let ready=false;
 const state=()=>connectView(ready?'ready':'restoring',{message:ready?'连接已恢复。':'连接通道已启动，等待 Dot 的首次调用。',last_verified_at:'2026-10-22T12:00:00Z',verification_source:'saved_receipt',actions:{resume:true,open:false},verification:{tunnel_online:ready,chatgpt_connected:true,dot_read:true,task_complete:true}});
 const tree=await mount(t,{supports:()=>true,async call(tool){if(tool==='manager_overview')return cloudOverview(Date.now(),{cloud_state:ready?'online':'unknown',cloud_reason:ready?'healthy':'awaiting_first_call'});if(tool==='manager_jobs')return pages([]);if(tool==='manager_setup_status')return managedSetup(state());if(tool==='manager_setup_connect_status')return state();throw Error(tool);}});
 assert.match(text(tree.toJSON()),/等待首次调用/);ready=true;await act(async()=>t.mock.timers.tick(2000));assert.match(text(tree.toJSON()),/连接已恢复.*上次完整验证/);assert.doesNotMatch(text(tree.toJSON()),/连接验证已完成/);
});

test('pending restoration respects paused admission, empty task history and failed status refresh',async t=>{
 let fail=false;const state=connectView('restoring',{last_verified_at:'2026-10-22T12:00:00Z',verification_source:'saved_receipt',actions:{resume:true},verification:{tunnel_online:false,chatgpt_connected:true,dot_read:true,task_complete:true}});
 const tree=await mount(t,{supports:()=>true,async call(tool){if(tool==='manager_overview'){if(fail)throw{code:'dot-management/unavailable'};return {...cloudOverview(Date.now(),{cloud_state:'unknown',cloud_reason:'awaiting_first_call'}),admission:{paused:true}};}if(tool==='manager_jobs')return pages([]);if(tool==='manager_setup_status')return managedSetup(state);if(tool==='manager_setup_connect_status')return state;throw Error(tool);}});
 assert.match(text(tree.toJSON()),/恢复接入后/);assert.doesNotMatch(text(tree.toJSON()),/可以直接向 Dot 派任务|完成首次连接后/);
 fail=true;await act(async()=>button(tree,'刷新').props.onClick());assert.match(text(tree.toJSON()),/暂时无法核实当前连接状态/);assert.match(text(tree.toJSON()),/本机连接状态.*暂时无法读取/);assert.doesNotMatch(text(tree.toJSON()),/可以直接向 Dot 派任务|云端通道在线/);
 await act(async()=>button(tree,'连接设置').props.onClick());assert.doesNotMatch(text(tree.toJSON()),/连接已启动，可以向 Dot 派任务/);
});

test('Ego human handoff keeps key instructions and makes Continue the primary action',async t=>{
 const calls=[],state=managedSetup(connectView('blocked',{step:'key_confirm',waiting_for:'authorization',message:'创建后保留“Save your key／保存密钥”窗口，回到这里点“继续连接”；无需复制密钥。',actions:{start:false,open:true,resume:true,cancel:true},error:{code:'ONBOARDING_EGO_HANDOFF',message:'等待本人完成官方确认。'}}));
 const tree=await mount(t,{supports:()=>true,async call(tool){calls.push(tool);if(tool==='manager_overview')return overview;if(tool==='manager_jobs')return pages([]);if(tool==='manager_setup_status')return state;if(tool==='manager_setup_connect_status')return state.connection_setup;if(tool==='manager_setup_connect_resume')return connectView('preparing');throw Error(tool);}});
 assert.match(text(tree.toJSON()),/保留.*保存密钥/);const next=button(tree,'继续连接');assert.ok(next);assert.match(next.props.className,/dm-primary/);assert.doesNotMatch(button(tree,'打开连接窗口').props.className,/dm-primary/);assert.equal(button(tree,'重试连接'),undefined);assert.doesNotMatch(text(tree.toJSON()),/其他步骤会自动继续/);assert.match(text(tree.root.findAllByType('li').find(n=>n.props.className==='dm-step'&&n.props['data-current']).findByType('strong').props.children),/登录与授权/);
 await act(async()=>next.props.onClick());assert.equal(calls.filter(x=>x==='manager_setup_connect_resume').length,1);
});
