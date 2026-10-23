import test from 'node:test';import assert from 'node:assert/strict';
const OWNER='owner';const JOB='job_00000000-0000-4000-8000-000000000001';
const job={job_id:JOB,project_id:'fixture',status:'running',session_id:'dsh_dot_00000000-0000-4000-8000-000000000002',message_id:'00000000-0000-4000-8000-000000000003',turn:1,result:null,result_truncated:false,reason:null,created_at:'2026-10-19T00:00:00.000Z',finished_at:null,context_sources:[],acceptance:'unverified'};
function memory(){let paused=false;const events=[],jobs=new Map();return{events,jobs,async begin(e){const id='event-'+events.length;events.push({...e,id,outcome:'pending'});return id;},async finish(id,p){Object.assign(events.find(e=>e.id===id),p);if(p.job)jobs.set(p.job.job_id,p.job);},async setPaused(v){paused=v;return{paused};},overview(){return{paused,recording_since:'2026-10-19T00:00:00.000Z',events_total:events.length,events_retained:events.length,jobs_total:jobs.size,retention_limit:500,last_event_at:null};},listEvents(){return{items:events,total:events.length,offset:0,next_offset:null};},listJobs(){return{items:[...jobs.values()],total:jobs.size,offset:0,next_offset:null};},job(id){if(!jobs.has(id))throw new Error('Unknown job');return jobs.get(id);},async importJobs(rows){for(const r of rows)if(r.principal===OWNER)jobs.set(r.job_id,r);return{imported:jobs.size,skipped:0};},async close(){}};}
async function api(){const m=await import('../src/management.js').catch(()=>({}));assert.equal(typeof m.createManagement,'function','audited management service required');return m;}
async function service(options={}){const {createManagement}=await api();const audit=options.audit??memory(),calls=[];const forward=options.forward??(async(tool,args)=>{calls.push({tool,args});if(tool==='harness_status')return{source:'existing_harness_persisted',workspaces:2};if(tool==='list_projects')return{projects:[{id:'fixture'}]};if(tool==='start_task'||tool==='get_task'||tool==='cancel_task')return{...job,status:tool==='cancel_task'?'cancel_requested':job.status};return{text:'private body sk-synthetic-should-not-be-retained',source_bytes:48,sha256_redacted:'a'.repeat(64),eof:true,source:'existing_harness_persisted'};});return{audit,calls,...await createManagement({audit,forward,principal:OWNER,...options})};}

test('read metadata is durable before forwarding and excludes body/query secrets',async()=>{const audit=memory();let began=false;const m=await service({audit,forward:async()=>{assert.equal(audit.events.length,1);assert.equal(audit.events[0].outcome,'pending');began=true;return{text:'private secret body',items:[{text:'private body'}],source_bytes:19,eof:true,source:'existing_harness_persisted'};}});const result=await m.channel.call(OWNER,'harness_read_file',{workspace_id:'w',path:'README.md',query:'secret-search'});assert.equal(began,true);assert.equal(result.text,'private secret body');const saved=JSON.stringify(audit.events);assert.ok(!saved.includes('private secret body'));assert.ok(!saved.includes('secret-search'));assert.equal(audit.events[0].summary.source_bytes,19);assert.equal(audit.events[0].outcome,'succeeded');});
test('pause blocks reads/new tasks but permits owned task status and cancellation',async()=>{const m=await service();await m.audit.importJobs([{...job,principal:OWNER}]);await m.admin.call(OWNER,'manager_set_paused',{paused:true});const before=m.calls.length;await assert.rejects(m.channel.call(OWNER,'harness_read_file',{workspace_id:'w',path:'README.md'}),e=>e.code==='CONNECTOR_PAUSED');await assert.rejects(m.channel.call(OWNER,'start_task',{project_id:'fixture',task:'safe',request_id:'r'}),e=>e.code==='CONNECTOR_PAUSED');assert.equal(m.calls.length,before);assert.equal((await m.channel.call(OWNER,'get_task',{job_id:JOB})).job_id,JOB);assert.equal((await m.admin.call(OWNER,'manager_cancel',{job_id:JOB})).job.status,'cancel_requested');await m.admin.call(OWNER,'manager_set_paused',{paused:false});assert.equal((await m.channel.call(OWNER,'harness_status',{})).workspaces,2);});
test('admin tools, foreign owner, arbitrary arguments and unknown jobs fail before forwarding',async()=>{const m=await service();for(const [tool,args]of [['manager_job',{job_id:'foreign'}],['manager_cancel',{job_id:'foreign'}],['manager_set_paused',{paused:true,url:'http://example.com'}],['manager_overview',{root:'/'}]])await assert.rejects(m.admin.call(OWNER,tool,args));await assert.rejects(m.channel.call(OWNER,'manager_overview',{}));await assert.rejects(m.admin.call('foreign','manager_overview',{}));assert.equal(m.calls.length,0);});
test('audit persistence failure blocks dispatch; uncertain downstream result stays unknown',async()=>{const audit=memory();audit.begin=async()=>{throw new Error('disk private error');};let calls=0;const m=await service({audit,forward:async()=>{calls++;}});await assert.rejects(m.channel.call(OWNER,'harness_status',{}),e=>e.code==='AUDIT_UNAVAILABLE');assert.equal(calls,0);const n=await service({forward:async()=>{throw Object.assign(new Error('private upstream details'),{code:'REQUEST_TIMEOUT'});}});await assert.rejects(n.channel.call(OWNER,'harness_status',{}),e=>e.code==='REQUEST_TIMEOUT');assert.equal(n.audit.events[0].outcome,'unknown');assert.ok(!JSON.stringify(n.audit.events).includes('private upstream'));});
test('manager overview reports both backend reachability and bounded current grants',async()=>{const m=await service();const view=await m.admin.call(OWNER,'manager_overview',{});assert.equal(view.connection.state,'connected');assert.equal(view.scope.read,'owner_harness_persisted');assert.equal(view.scope.task,'fixture_only');assert.equal(view.scope.credential_files,false);assert.equal(view.scope.live_memory,false);assert.equal(view.admission.paused,false);});
test('cloud status is observed independently of admin, worker and gateway activity',async()=>{
 let state='unknown';const checked='2026-10-22T00:00:00.000Z',interaction='2026-10-21T23:00:00.000Z';
 const cloudStatus={read:async()=>({state,source:'official_tunnel_health',reason:state==='online'?'healthy':'probe_unavailable',checked_at:checked,last_connected_at:state==='online'?checked:null,last_interaction_at:interaction}),close(){}};
 const m=await service({cloudStatus});
 try{await m.audit.importJobs([{...job,principal:OWNER}]);await m.admin.call(OWNER,'manager_job',{job_id:JOB});await m.admin.call(OWNER,'manager_worker_poll',{});await m.channel.call(OWNER,'harness_read_file',{workspace_id:'w',path:'README.md'});const unknown=await m.admin.call(OWNER,'manager_overview',{});assert.equal(unknown.connection.cloud_state,'unknown');state='online';const online=await m.admin.call(OWNER,'manager_overview',{});assert.equal(online.connection.cloud_state,'online');assert.equal(online.connection.cloud_checked_at,checked);assert.equal(online.connection.cloud_last_interaction_at,interaction);const status=await m.channel.call(OWNER,'harness_status',{});assert.equal(status.cloud_connection.state,'online');assert.equal(status.cloud_connection.last_interaction_at,interaction);state='offline';await m.admin.call(OWNER,'manager_set_paused',{paused:true});assert.equal((await m.admin.call(OWNER,'manager_overview',{})).connection.cloud_state,'offline');}finally{await m.close();}
});
test('observed task snapshots and explicit owned import are available without replay',async()=>{let loads=0;const m=await service({loadJobs:async()=>{loads++;return[{...job,principal:OWNER,task:'read fixture'}];}});const list=await m.admin.call(OWNER,'manager_jobs',{});assert.equal(list.items.length,1);const detail=await m.admin.call(OWNER,'manager_job',{job_id:JOB});assert.equal(detail.job.job_id,JOB);assert.ok(loads>0);assert.equal(m.calls.some(c=>c.tool==='start_task'),false);});
test('overlapping management reads queue instead of turning worker overlap into access denial',async()=>{const entered=Promise.withResolvers(),release=Promise.withResolvers();let loads=0;const m=await service({loadJobs:async()=>{if(++loads===2)entered.resolve();await release.promise;return[];}});const first=m.admin.call(OWNER,'manager_jobs',{}),second=m.admin.call(OWNER,'manager_jobs',{});await entered.promise;let settled=false;const third=m.admin.call(OWNER,'manager_jobs',{}).finally(()=>{settled=true;});third.catch(()=>{});await new Promise(resolve=>setImmediate(resolve));try{assert.equal(loads,2);assert.equal(settled,false);release.resolve();const views=await Promise.all([first,second,third]);assert.equal(views.length,3);assert.equal(loads,3);}finally{release.resolve();await Promise.allSettled([first,second,third]);await m.close();}});
test('job list returns summaries rather than all retained result bodies',async()=>{const m=await service();await m.audit.importJobs([{...job,principal:OWNER,result:'private retained result',task:'synthetic request'}]);const result=await m.admin.call(OWNER,'manager_jobs',{});assert.equal(result.items[0].task,'synthetic request');assert.equal(Object.hasOwn(result.items[0],'result'),false);assert.ok(!JSON.stringify(result).includes('private retained result'));});

test('a stalled reader cannot prevent a native worker from receiving its next offer',async()=>{
 const stalled=Promise.withResolvers();let offers=0,m,waiting,deadline;
 try{
  m=await service({forward:tool=>tool==='harness_status'?stalled.promise:Promise.reject(new Error('fixture disabled')),nativeTasks:{overview:()=>({jobs_total:0,last_worker_seen_at:new Date().toISOString()}),offer:async()=>{offers++;return{command_id:'synthetic-offer'};}}});
  const started=Date.now();waiting=m.admin.call(OWNER,'manager_overview',{});
  const view=await Promise.race([waiting,new Promise((_,reject)=>{deadline=setTimeout(()=>reject(new Error('health blocked native offer')),2200);})]);
  assert.ok(Date.now()-started<2000);assert.equal(view.connection.state,'partial');assert.equal(view.connection.task_backend,'online');assert.equal(view.connection.read_backend,'offline');assert.equal(view.native_control.command_id,'synthetic-offer');assert.equal(offers,1);
 }finally{clearTimeout(deadline);stalled.reject(new Error('synthetic late failure'));await waiting?.catch(()=>{});await m?.close();}
});

test('dedicated native polling stays available while two UI requests are waiting',async()=>{
 const release=Promise.withResolvers(),entered=Promise.withResolvers();let loads=0,offers=0;
 const m=await service({loadJobs:async()=>{if(++loads===2)entered.resolve();await release.promise;return[];},nativeTasks:{overview:()=>({jobs_total:0,last_worker_seen_at:null}),offer:async()=>{offers++;return{command_id:'owned-offer'};}}});
 const first=m.admin.call(OWNER,'manager_jobs',{}),second=m.admin.call(OWNER,'manager_jobs',{});let timer;
 try{await entered.promise;const result=await Promise.race([m.admin.call(OWNER,'manager_worker_poll',{}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('worker blocked by UI')),400);})]);assert.equal(result.native_control.command_id,'owned-offer');assert.equal(offers,1);assert.equal(loads,2);}
 finally{clearTimeout(timer);release.resolve();await Promise.allSettled([first,second]);await m.close();}
});

test('native readiness requires recent worker evidence and never claims a verified cloud link',async t=>{
 let clock=Date.parse('2026-10-22T00:00:00Z');t.mock.method(Date,'now',()=>clock);
 const m=await service({nativeTasks:{overview:()=>({jobs_total:0,last_worker_seen_at:null}),offer:async()=>null}});
 try{const before=await m.admin.call(OWNER,'manager_overview',{});assert.equal(before.connection.task_backend,'offline');assert.equal(before.connection.worker_backend,'not_seen');assert.equal(before.connection.cloud_state,'not_configured');
 await m.admin.call(OWNER,'manager_worker_poll',{});const ready=await m.admin.call(OWNER,'manager_overview',{});assert.equal(ready.connection.task_backend,'online');assert.equal(ready.connection.worker_backend,'online');
 const status=await m.channel.call(OWNER,'harness_status',{});assert.equal(status.capabilities.native_tasks.configured,true);assert.equal(status.capabilities.native_tasks.ready,true);
 clock+=31000;const stale=await m.admin.call(OWNER,'manager_overview',{});assert.equal(stale.connection.worker_backend,'stale');assert.equal(stale.connection.task_backend,'offline');}
 finally{await m.close();}
});

test('closing releases queued management requests before loading any additional data',async()=>{
 const entered=Promise.withResolvers(),release=Promise.withResolvers();let loads=0;
 const m=await service({loadJobs:async()=>{if(++loads===2)entered.resolve();await release.promise;return[];}});
 const first=m.admin.call(OWNER,'manager_jobs',{}),second=m.admin.call(OWNER,'manager_jobs',{});await entered.promise;
 let settled=false;const queued=m.admin.call(OWNER,'manager_jobs',{}).finally(()=>{settled=true;});queued.catch(()=>{});
 try{await new Promise(resolve=>setImmediate(resolve));assert.equal(settled,false);await m.close();await assert.rejects(queued,e=>e.code==='MANAGEMENT_DENIED');assert.equal(loads,2);}finally{release.resolve();await Promise.allSettled([first,second]);}
});

test('modern overview reads never consume worker offers',async()=>{
 let offers=0;const m=await service({nativeTasks:{overview:()=>({jobs_total:0,last_worker_seen_at:null}),offer:async()=>{offers++;return{command_id:'offer'};}}});
 try{const view=await m.admin.call(OWNER,'manager_overview',{include_control:false});assert.equal(view.native_control,null);assert.equal(offers,0);const control=await m.admin.call(OWNER,'manager_worker_poll',{});assert.equal(control.native_control.command_id,'offer');assert.equal(offers,1);}finally{await m.close();}
});

test('management pagination keeps total and older native tasks beyond the first 100',async()=>{
 const rows=Array.from({length:240},(_,i)=>({...job,job_id:`native_job_00000000-0000-4000-8000-${String(i).padStart(12,'0')}`,workspace_id:'native-workspace',request_id:`r${i}`,created_at:new Date(Date.parse('2026-10-22T00:00:00Z')-i*1000).toISOString(),archived:false,result:'do not include full results'}));
 const m=await service({nativeTasks:{jobs:({offset=0,limit=20})=>({items:rows.slice(offset,offset+limit),total:rows.length,next_offset:offset+limit<rows.length?offset+limit:null})}});
 try{await m.audit.importJobs([{...job,principal:OWNER}]);const second=await m.admin.call(OWNER,'manager_jobs',{offset:120,limit:20});assert.equal(second.total,241);assert.equal(second.items.length,20);assert.equal(second.items[0].job_id,rows[120].job_id);assert.equal(second.next_offset,140);assert.equal(Object.hasOwn(second.items[0],'result'),false);const last=await m.admin.call(OWNER,'manager_jobs',{offset:240,limit:20});assert.equal(last.items[0].job_id,JOB);assert.equal(last.next_offset,null);}finally{await m.close();}
});

test('overview health checks share one in-flight probe and a short cache, then refresh their evidence',async t=>{
 let clock=Date.parse('2026-10-22T00:00:00.000Z');t.mock.method(Date,'now',()=>clock);
 const release=Promise.withResolvers(),calls=[];let healthy=true;
 const m=await service({forward:async tool=>{calls.push(tool);await release.promise;if(!healthy)throw new Error('synthetic offline');return{};}});
 try{
  const first=m.admin.call(OWNER,'manager_overview',{}),second=m.admin.call(OWNER,'manager_overview',{});
  await new Promise(resolve=>setImmediate(resolve));release.resolve();const views=await Promise.all([first,second]);assert.equal(calls.length,2);assert.equal(views[0].connection.checked_at,views[1].connection.checked_at);
  const cached=await m.admin.call(OWNER,'manager_overview',{});assert.equal(calls.length,2);assert.equal(cached.connection.state,'connected');
  healthy=false;clock+=5001;const refreshed=await m.admin.call(OWNER,'manager_overview',{});assert.equal(calls.length,4);assert.equal(refreshed.connection.state,'offline');assert.notEqual(refreshed.connection.checked_at,cached.connection.checked_at);
 }finally{release.resolve();await m.close();}
});

test('closing management releases pending health probes without issuing a native offer or exposing late failures',async()=>{
 const stalled=Promise.withResolvers();let offers=0,waiting,deadline;
 const m=await service({forward:()=>stalled.promise,nativeTasks:{overview:()=>({jobs_total:0}),offer:async()=>{offers++;return null;}}});
 try{
  waiting=m.admin.call(OWNER,'manager_overview',{});await new Promise(resolve=>setImmediate(resolve));await m.close();
  await Promise.race([assert.rejects(waiting,e=>e.code==='MANAGEMENT_DENIED'),new Promise((_,reject)=>{deadline=setTimeout(()=>reject(new Error('close did not release health probe')),500);})]);assert.equal(offers,0);
 }finally{clearTimeout(deadline);stalled.reject(new Error('synthetic late private failure'));await waiting?.catch(()=>{});await m.close();}
});
