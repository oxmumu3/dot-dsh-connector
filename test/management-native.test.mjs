import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,writeFile,chmod,symlink,rm,readFile,open,stat,mkdir} from 'node:fs/promises';
import {join,resolve,dirname,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {runInNewContext} from 'node:vm';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {z} from 'zod';

const native = await import('../management-plugin/index.js').catch(()=>({}));
const remote = await import('../management-plugin/src/remote.js').catch(()=>({}));
const ui = await import('../management-plugin/src/client.js').catch(()=>({}));
const expectedMethods={
 overview:'manager_overview',events:'manager_events',jobs:'manager_jobs',job:'manager_job',
 setPaused:'manager_set_paused',cancel:'manager_cancel',workerPoll:'manager_worker_poll',
 archive:'manager_archive',followup:'manager_followup',
 setupStatus:'manager_setup_status',setupPrepare:'manager_setup_prepare',setupStart:'manager_setup_start',setupStop:'manager_setup_stop',
 setupConnectStatus:'manager_setup_connect_status',setupConnectStart:'manager_setup_connect_start',setupConnectResume:'manager_setup_connect_resume',setupConnectCancel:'manager_setup_connect_cancel',setupConnectOpen:'manager_setup_connect_open',
};

async function fixture(t){
 const directory=await realpath(await mkdtemp(join(tmpdir(),'dot-management-native-')));
 t.after(()=>rm(directory,{recursive:true,force:true}));
 const tokenFile=join(directory,'admin.key'),token='test-admin-'+ 'x'.repeat(48);
 await writeFile(tokenFile,token,{mode:0o600});return {directory,tokenFile,token};
}

test('native management is a separate inert plugin and never imports the task executor',async()=>{
 assert.equal(typeof native.apply,'function');
 assert.equal(await native.apply({},{enabled:false,tokenFile:'/not/read'}),undefined);
 assert.deepEqual(native.inject,['typert']);
 const source=await readFile(new URL('../management-plugin/index.js',import.meta.url),'utf8');
 assert.doesNotMatch(source,/from ['"].*(?:executor|isolated-host|\/index\.js)['"]/);
 assert.doesNotMatch(source,/\b(?:agents|tools|sessions|agentDefaultModel)\b/);
});

test('admin adapter reads only an explicitly selected private token file and fixes the backend route',async t=>{
 const {tokenFile,token}=await fixture(t);const requests=[];
 const adapter=await native.createAdminAdapter({tokenFile,fetchImpl:async(url,options)=>{
  requests.push({url,options});return new Response(JSON.stringify({result:{paused:true}}),{headers:{'content-type':'application/json'}});
 }});
 assert.deepEqual(await adapter.call('manager_set_paused',{paused:true}),{paused:true});
 assert.equal(requests[0].url,'http://127.0.0.1:31473/rpc');
 assert.equal(requests[0].options.headers.authorization,`Bearer ${token}`);
 assert.equal(requests[0].options.redirect,'error');
 assert.deepEqual(JSON.parse(requests[0].options.body),{tool:'manager_set_paused',args:{paused:true}});
 assert.doesNotMatch(JSON.stringify(adapter),/test-admin|admin\.key|31473/);
 await assert.rejects(adapter.call('start_task',{}),/invalid/i);
 await assert.rejects(adapter.call('manager_overview',{url:'https://example.com'}),/invalid/i);
 assert.equal(requests.length,1);await adapter.close();
 await assert.rejects(adapter.call('manager_overview',{}),/unavailable/i);
});

test('token validation refuses links, permissive permissions, non-files and oversized contents',async t=>{
 const {directory,tokenFile}=await fixture(t);
 const link=join(directory,'linked.key');await symlink(tokenFile,link);
 await assert.rejects(native.createAdminAdapter({tokenFile:link}),/private token/i);
 await chmod(tokenFile,0o644);await assert.rejects(native.createAdminAdapter({tokenFile}),/private token/i);
 await assert.rejects(native.createAdminAdapter({tokenFile:directory}),/private token/i);
 await chmod(tokenFile,0o600);await writeFile(tokenFile,'a'.repeat(4097));
 await assert.rejects(native.createAdminAdapter({tokenFile}),/private token/i);
 await assert.rejects(native.createAdminAdapter({tokenFile:'relative.key'}),/configuration/i);
});

test('admin adapter bounds responses and never forwards raw credential-bearing backend failures',async t=>{
 const {tokenFile,token}=await fixture(t);
 for(const response of [
  new Response(JSON.stringify({error:{code:'INTERNAL_ERROR',message:`private failure ${token}`}}),{status:500}),
  new Response('x'.repeat(1024*1024+1)),
  new Response('not json'),
  new Response(JSON.stringify({result:{},unexpected:true})),
 ]){
  const adapter=await native.createAdminAdapter({tokenFile,fetchImpl:async()=>response});
  await assert.rejects(adapter.call('manager_overview',{}),error=>{
   assert.doesNotMatch(error.message,/test-admin|private failure|unexpected|not json/);return /unavailable|failed/i.test(error.message);
  });await adapter.close();
 }
});

test('native Remote descriptors declare strict management methods with fixed mapping',()=>{
 assert.equal(typeof remote.createManagementRemote,'function');
 const contribution=remote.createManagementRemote(z);
 assert.equal(contribution.package,'dot-dsh-management');
 assert.deepEqual(contribution.descriptors.map(d=>d.method),Object.keys(expectedMethods));
 assert.deepEqual(Object.fromEntries(Object.entries(contribution.methods).map(([method,{tool}])=>[method,tool])),expectedMethods);
 for(const descriptor of contribution.descriptors){
  assert.equal(descriptor.id,`dot-dsh-management#dotDshManagement/${descriptor.method}`);
  assert.equal(descriptor.namespace,'dotDshManagement');assert.equal(descriptor.service,'dotDshManagement');
  assert.equal(descriptor.parameters.length,1);assert.equal(descriptor.parameters[0].wire,'request');
  assert.equal(descriptor.parameters[0].codec.mode,'strict');
  assert.equal(descriptor.parameters[0].codec.create().safeParse({url:'https://example.com'}).success,false);
  if(descriptor.method.startsWith('setup'))assert.deepEqual(descriptor.parameters[0].codec.create().parse({}),{});
 }
 assert.deepEqual(contribution.descriptors[1].parameters[0].codec.create().parse({offset:0,limit:25,category:'read'}),{offset:0,limit:25,category:'read'});
 assert.equal(contribution.descriptors[4].parameters[0].codec.create().safeParse({paused:'yes'}).success,false);
});

test('native browser factory mounts its own Remote contribution and registers an isolated main panel',async()=>{
 assert.equal(typeof ui.managementClientFactory,'function');
 const mounted=[],registrations=[],calls=[],injections=[];
 const React={createElement:(type,props,...children)=>({type,props,children})};
 const api=ui.managementClientFactory(name=>({react:React,zod:{z}}[name]));
 const namespace=Object.fromEntries(['overview','events','jobs','job','setPaused','cancel'].map(method=>[method,async request=>{calls.push({method,request});return{ok:true,value:{paused:false}};}]));
 const ctx={inject:(services,callback)=>{injections.push(services);if(services[0]==='uiWorkspace'||services[0]==='workspaces')return;assert.deepEqual(services,['remote.dotDshManagement']);return Promise.resolve(callback(ctx));},remote:{$mount:async c=>{mounted.push(c);return()=>{};},dotDshManagement:namespace},slots:{
  inject:(name,register)=>register(),register:(options,component)=>{registrations.push({options,component});return()=>{};}
 }};
 await api.apply(ctx);
 assert.equal(mounted.length,1);assert.equal(mounted[0].descriptors.length,18);
 assert.deepEqual(mounted[0].descriptors.map(d=>d.method),Object.keys(expectedMethods));
 assert.equal(registrations.find(r=>r.options.name==='main').options.key,'dot-management');
 assert.equal(registrations.find(r=>r.options.name==='sidebar.panellist').options.id,'dot-management');
 assert.deepEqual(api.inject,['slots','remote']);
 assert.deepEqual(injections,[['remote.dotDshManagement'],['uiWorkspace'],['workspaces']]);
 const adapter=api.createNativeAdapter(ctx.remote);assert.deepEqual(await adapter.call('manager_set_paused',{paused:true}),{paused:false});
 assert.deepEqual(calls,[{method:'setPaused',request:{paused:true}}]);
 await assert.rejects(adapter.call('start_task',{}),/invalid/i);
});

test('optional native workspace services may arrive late without blocking the panel and their disposers invalidate only their own references',async()=>{
 const callbacks=new Map(),registrations=[],opened=[],React={createElement(){}};let adapter;
 const ctx={remote:{$mount:async()=>{},dotDshManagement:{}},inject(services,callback){if(services[0]==='remote.dotDshManagement')return callback(ctx);callbacks.set(services.join(','),callback);},slots:{inject:(_name,callback)=>callback(),register:options=>registrations.push(options)}};
 await ui.managementClientFactory(name=>({react:React,zod:{z}}[name]),undefined,(_react,value)=>{adapter=value;return()=>null;}).apply(ctx);
 assert.ok(registrations.some(item=>item.name==='main'));assert.ok(registrations.some(item=>item.name==='sidebar.panellist'));assert.equal(adapter.canOpenSession(),false);await assert.rejects(adapter.ensureWorkspace(),/unavailable/i);
 const navDisposers=[],workspaceDisposers=[],first={list:{getSnapshot:()=>({phase:'ready',state:'idle',items:[{workspaceId:'w1',path:'/chosen/project'}]})},create:async()=>{throw Error('existing project must not be created');}};
 callbacks.get('uiWorkspace')({uiWorkspace:{openSession:id=>opened.push(id),pickDirectory:async()=>{throw Error('existing project must not show picker');}},effect:callback=>navDisposers.push(callback())});
 callbacks.get('workspaces')({workspaces:first,effect:callback=>workspaceDisposers.push(callback())});assert.equal(await adapter.ensureWorkspace(),true);await adapter.openSession({session_id:'owned-session'});assert.deepEqual(opened,['owned-session']);
 const second={...first};callbacks.get('workspaces')({workspaces:second,effect:callback=>workspaceDisposers.push(callback())});workspaceDisposers[0]();assert.equal(await adapter.ensureWorkspace(),true);workspaceDisposers[1]();await assert.rejects(adapter.ensureWorkspace(),/unavailable/i);assert.equal(adapter.canOpenSession(),true);navDisposers[0]();assert.equal(adapter.canOpenSession(),false);await assert.rejects(adapter.openSession({session_id:'owned-session'}),/unavailable/i);
});

test('workspace preparation waits for a real baseline and releases its subscription before opening the user picker',async()=>{
 let snapshot={phase:'pending',state:'loading',items:[]},notify,unsubscribed=0,picks=0,created=0;
 const registry={current:{list:{getSnapshot:()=>snapshot,subscribe:callback=>{notify=callback;return()=>unsubscribed++;}},create:async()=>{created++;}}};
 const navigation={current:{pickDirectory:async()=>{picks++;return null;}}};
 const adapter=ui.managementClientFactory(name=>({react:{},zod:{z}}[name])).createNativeAdapter({},navigation,registry);let settled=false;const pending=adapter.ensureWorkspace().then(value=>{settled=true;return value;});await Promise.resolve();assert.equal(settled,false);assert.equal(picks,0);
 snapshot={phase:'ready',state:'idle',items:[]};notify();assert.equal(await pending,false);assert.equal(unsubscribed,1);assert.equal(picks,1);assert.equal(created,0);
});

test('workspace preparation never adopts a folder after its native services were disposed during selection',async()=>{
 let release,picks=0,created=0;const picker=new Promise(resolve=>release=resolve),navigation={current:{pickDirectory:async()=>{picks++;return picker;}}},registry={current:{list:{getSnapshot:()=>({phase:'ready',state:'idle',items:[]})},create:async input=>{created++;return{workspaceId:'late',path:input.path};}}};
 const adapter=ui.managementClientFactory(name=>({react:{},zod:{z}}[name])).createNativeAdapter({},navigation,registry),pending=adapter.ensureWorkspace();assert.equal(picks,1);registry.current=null;navigation.current=null;release('/chosen/project');await assert.rejects(pending,/unavailable/i);assert.equal(created,0);
});

test('built client uses the official loader and only the scoped native bridge without Node or admin credentials',async()=>{
 const {buildManagementUi}=await import('../scripts/build-management-ui.mjs');
 const first=await buildManagementUi(),second=await buildManagementUi();assert.equal(first.sha256,second.sha256);
 const source=await readFile(new URL('../management-plugin/lib/client.js',import.meta.url),'utf8');
 assert.doesNotMatch(source,/node:|tokenFile|31473|document\.cookie|localStorage|sessionStorage/);
 assert.deepEqual([...new Set(source.match(/http:\/\/127\.0\.0\.1:\d+[^'"`\s]*/g))],['http://127.0.0.1:31474/native/']);
 assert.match(source,/credentials:'omit'/);assert.match(source,/redirect:'error'/);
 let registration;runInNewContext(source,{window:{__ModuleLoader__:{load:value=>{registration=value;}}}});
 assert.equal(registration.id,'dot-dsh-management');assert.equal(typeof registration.factory,'function');
 const manifest=JSON.parse(await readFile(new URL('../management-plugin/package.json',import.meta.url),'utf8'));
 assert.equal(manifest.name,'dot-dsh-management');assert.equal(manifest.dsh.client.platform,'web');
 assert.equal(manifest.exports['./client'],'./lib/client.js');
 assert.equal(manifest.exports['.'],'./index.js');
});

/** Temporary public npm distribution only, never application profile or user content. */
async function nativeSdk(t){
 const source='/Applications/DeepSeek Harness.app/Contents/Resources/app.asar';
 try{await stat(source);}catch{t.skip('Public DSH 0.2.1-rc.2 native runtime unavailable');return;}
 const directory=await mkdtemp(join(tmpdir(),'dot-management-public-sdk-'));
 t.after(()=>rm(directory,{recursive:true,force:true}));
 const archive=await open(source,'r');
 try{
  const first=Buffer.alloc(16);await archive.read(first,0,16,0);
  const size=first.readUInt32LE(12);if(size<2||size>32*1024*1024)throw new Error('Unexpected public SDK archive');
  const header=Buffer.alloc(size);await archive.read(header,0,size,16);
  const tree=JSON.parse(header.toString('utf8')),dataStart=8+first.readUInt32LE(4);
  const lookup=path=>path.split('/').reduce((node,part)=>node?.files?.[part],tree);
  const bytes=async(path,node=lookup(path))=>{
   if(!node||node.link||node.size>32*1024*1024)throw new Error('Unexpected public package file');
   if(node.unpacked)return readFile(`${source}.unpacked/${path}`);
   const value=Buffer.alloc(node.size);await archive.read(value,0,value.length,dataStart+Number(node.offset));return value;
  };
  const copied=new Set();
  const copyTree=async(path,node)=>{
   const destination=resolve(directory,path.slice(4));
   if(!destination.startsWith(`${directory}${sep}`)||node.link)throw new Error('Unexpected public package path');
   if(node.files){await mkdir(destination,{recursive:true});for(const [key,value]of Object.entries(node.files))await copyTree(`${path}/${key}`,value);}
   else{await mkdir(dirname(destination),{recursive:true});await writeFile(destination,await bytes(path,node));}
  };
  const copyPackage=async name=>{
   if(copied.has(name))return;copied.add(name);
   const prefix=`dsh/node_modules/${name}`,node=lookup(prefix);if(!node)throw new Error('Public SDK dependency unavailable');
   const pkg=JSON.parse((await bytes(`${prefix}/package.json`)).toString('utf8'));await copyTree(prefix,node);
   for(const dependency of Object.keys({...pkg.dependencies,...pkg.peerDependencies})){
    if(pkg.peerDependenciesMeta?.[dependency]?.optional&&!Object.hasOwn(pkg.dependencies??{},dependency))continue;
    if(!lookup(`${prefix}/node_modules/${dependency}`))await copyPackage(dependency);
   }
  };
  for(const name of ['@deepseek-ai/cordis','@deepseek-ai/dsh-typert-protocol','@deepseek-ai/dsh-typert-registry','@deepseek-ai/dsh-api-gateway','@deepseek-ai/dsh-client-connection'])await copyPackage(name);
  await writeFile(join(directory,'package.json'),JSON.stringify({type:'module',private:true}));
  const require=createRequire(join(directory,'package.json'));
  return {load:name=>import(pathToFileURL(require.resolve(name)).href),async loadManagement(){
   // Preserve the actual exported plugin lifecycle, resolving its public SDK
   // dependencies from this isolated distribution rather than any user profile.
   const files=['index.js','src/remote.js','src/setup-runtime.js','src/onboarding-runtime.js','src/onboarding-store.js','src/onboarding-tunnel.js','src/onboarding-browser.js','runtime/src/python-runtime.js','package.json'];
   for(const path of files){
    const destination=join(directory,'management-plugin',path);
    await mkdir(dirname(destination),{recursive:true});
    // Copy the runtime helper from repository source, without requiring generated package output.
    const source=path==='runtime/src/python-runtime.js'?'../src/python-runtime.js':`../management-plugin/${path}`;
    await writeFile(destination,await readFile(new URL(source,import.meta.url)));
   }
   return import(pathToFileURL(join(directory,'management-plugin/index.js')).href);
  }};
 }finally{await archive.close();}
}

test('actual Cordis loader keeps the complete management plugin active through an owner Remote request',async t=>{
 const sdk=await nativeSdk(t);if(!sdk)return;
 const [{Context},{default:Registry},{default:Gateway},plugin]=await Promise.all([
  sdk.load('@deepseek-ai/cordis'),sdk.load('@deepseek-ai/dsh-typert-registry'),sdk.load('@deepseek-ai/dsh-api-gateway'),sdk.loadManagement(),
 ]);
 const {tokenFile,token}=await fixture(t),host=new Context(),requests=[];let callSignal;
 t.after(()=>host.fiber.dispose());
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  assert.equal(url,'http://127.0.0.1:31473/rpc');
  assert.equal(options.headers.authorization,`Bearer ${token}`);
  assert.ok(options.signal instanceof AbortSignal);
  callSignal=options.signal;
  requests.push(JSON.parse(options.body));
  return new Response(JSON.stringify({result:{connection:{state:'connected'},synthetic:true}}));
 });
 host.provide('remoteAccess',{decide:()=>({kind:'allow'})});
 await host.plugin(Registry);await host.plugin(Gateway,{websocketHeartbeatIntervalMs:2000,streamInboxBytes:262144});
 // Do not wrap apply or discard its result: Cordis validates that return value.
 await host.plugin(plugin,{enabled:true,tokenFile});
 const peer={principal:{kind:'owner'},signal:new AbortController().signal,interactions:'none'};
 assert.deepEqual(await host.typertGateway.invoke({namespace:'dotDshManagement',method:'overview',args:{request:{}},peer}),{connection:{state:'connected'},synthetic:true,management_protocol:{version:1,features:{task_filters:false,archive:false,followup:false,worker_poll:false}},native_control:null});
 assert.deepEqual(requests,[{tool:'manager_overview',args:{}}]);
 assert.equal(host.get('agents'),undefined);assert.equal(host.get('sessions'),undefined);
 await host.fiber.dispose();
 assert.equal(host.get('dotDshManagement'),undefined);
 assert.equal(callSignal.aborted,true);
 assert.equal(requests.length,1);
});

test('actual Cordis loader accepts an inert management plugin without reading a token or mounting a service',async t=>{
 const sdk=await nativeSdk(t);if(!sdk)return;
 const [{Context},{default:Registry},plugin]=await Promise.all([sdk.load('@deepseek-ai/cordis'),sdk.load('@deepseek-ai/dsh-typert-registry'),sdk.loadManagement()]);
 const host=new Context();t.after(()=>host.fiber.dispose());
 await host.plugin(Registry);
 await host.plugin(plugin,{enabled:false,tokenFile:'/must-not-read'});
 assert.equal(host.get('dotDshManagement'),undefined);
});

test('management failures survive actual Gateway dispatch, JSON and the official Connection parser',async t=>{
 const sdk=await nativeSdk(t);if(!sdk)return;
 const [{Context},{default:Registry},{default:Gateway},protocol,connectionApi]=await Promise.all([
  sdk.load('@deepseek-ai/cordis'),sdk.load('@deepseek-ai/dsh-typert-registry'),sdk.load('@deepseek-ai/dsh-api-gateway'),sdk.load('@deepseek-ai/dsh-typert-protocol'),sdk.load('@deepseek-ai/dsh-client-connection/client'),
 ]);
 const host=new Context(),client=new Context(),secret='synthetic-backend-private-failure';let peer,adapterCalls=0,wireCalls=0;
 t.after(async()=>{await client.fiber.dispose();await host.fiber.dispose();});
 host.provide('remoteAccess',{decide:()=>({kind:'allow'})});
 await host.plugin(Registry);await host.plugin(Gateway,{websocketHeartbeatIntervalMs:2000,streamInboxBytes:262144});
 await host.plugin({name:'management-failure-wire-test',inject:['typert'],async apply(scope){
  await native.mountManagement(scope,{async call(){adapterCalls++;throw new Error(secret);}},protocol);
 }});
 connectionApi.installConnection(client,{interactions:'none',transport:{fetch:async(url,options)=>{
  assert.equal(url,'api/dotDshManagement/overview');assert.equal(options.method,'POST');assert.ok(options.signal instanceof AbortSignal);
  const request=JSON.parse(options.body);assert.equal(request.type,'client-request');assert.equal(request.method,'dotDshManagement/overview');wireCalls++;
  const result=await host.typertGateway.dispatchRpc(request.method,request.payload,options.signal,peer);
  // A Response performs the real JSON boundary; omitted details must not be
  // concealed by a stand-in returning an already-decoded {ok,error} object.
  return new Response(JSON.stringify({type:'server-response',rpcId:request.rpcId,result}),{headers:{'content-type':'application/json'}});
 }}});
 for(const [label,principal,request,code]of [
  ['owner rejection',{kind:'external'},{},'dot-management/denied'],
  ['backend failure',{kind:'owner'},{},'dot-management/unavailable'],
  ['strict input rejection',{kind:'owner'},{url:'https://synthetic.invalid'},'gateway/input-invalid'],
 ])await t.test(label,async()=>{
  peer={principal,signal:new AbortController().signal,interactions:'none'};
  const value=await client.connection.rpc.call('/api','dotDshManagement/overview',{args:{request}},new AbortController().signal);
  assert.equal(value.ok,false);assert.equal(value.error.code,code);
  if(code.startsWith('dot-management/'))assert.deepEqual(value.error.details,{});
  assert.doesNotMatch(JSON.stringify(value),new RegExp(secret));
 });
 assert.equal(adapterCalls,1);assert.equal(wireCalls,3);
});

test('actual public Typert Gateway dispatches the isolated management namespace and enforces strict inputs and owner identity',async t=>{
 const sdk=await nativeSdk(t);if(!sdk)return;
 const [{Context},{default:Registry},{default:Gateway},protocol,clientApi]=await Promise.all([
  sdk.load('@deepseek-ai/cordis'),sdk.load('@deepseek-ai/dsh-typert-registry'),sdk.load('@deepseek-ai/dsh-api-gateway'),sdk.load('@deepseek-ai/dsh-typert-protocol'),sdk.load('@deepseek-ai/dsh-api-gateway/client'),
 ]);
 const host=new Context(),client=new Context();
 t.after(async()=>{await client.fiber.dispose();await host.fiber.dispose();});
 host.provide('remoteAccess',{decide:()=>({kind:'allow'})});
 await host.plugin(Registry);await host.plugin(Gateway,{websocketHeartbeatIntervalMs:2000,streamInboxBytes:262144});
 const calls=[],adapter={call:async(tool,args)=>{calls.push({tool,args});return{paused:args.paused??false};}};
 await host.plugin({name:'native-management-test-owner',inject:['typert'],async apply(scope){await native.mountManagement(scope,adapter,protocol);}});
 const peer={principal:{kind:'owner'},signal:new AbortController().signal,interactions:'none'};
 assert.deepEqual(await host.typertGateway.invoke({namespace:'dotDshManagement',method:'setPaused',args:{request:{paused:true}},peer}),{paused:true});
 assert.deepEqual(calls,[{tool:'manager_set_paused',args:{paused:true}}]);
 await assert.rejects(host.typertGateway.invoke({namespace:'dotDshManagement',method:'overview',args:{request:{url:'https://example.com'}},peer}),error=>error.code==='gateway/input-invalid');
 await assert.rejects(host.typertGateway.invoke({namespace:'dotDshManagement',method:'overview',args:{request:{}},peer:{...peer,principal:{kind:'external'}}}),error=>error.code==='dot-management/denied');
 assert.equal(calls.length,1);
 await client.plugin(Registry);
 client.provide('connection',{interactions:'none',isLoopback:true,generation:{getSnapshot:()=>undefined},rpc:{
  open(){throw new Error('No stream expected');},
  async call(route,endpoint,payload){assert.equal(route,'/api');const [namespace,method]=endpoint.split('/');return{ok:true,value:await host.typertGateway.invoke({namespace,method,args:payload.args,peer})};},
 }});
 await client.plugin(clientApi);await client.remote.$mount(remote.createManagementRemote(z));
 assert.deepEqual(await client.remote.dotDshManagement.setPaused({paused:false}),{ok:true,value:{paused:false}});
 assert.deepEqual(calls[1],{tool:'manager_set_paused',args:{paused:false}});
 assert.equal(host.get('agents'),undefined);assert.equal(host.get('sessions'),undefined);
});

function componentRuntime(){
 const require=createRequire(process.env.DSH_UI_TEST_MODULES?join(resolve(process.env.DSH_UI_TEST_MODULES),'package.json'):new URL('../package.json',import.meta.url));
 return {React:require('react'),...require('react-test-renderer')};
}
const syntheticOverview={connection:{state:'connected',task_backend:'online',read_backend:'online',checked_at:'2026-10-19T12:00:00Z'},admission:{paused:false},audit:{events_total:2,events_retained:2,jobs_total:40,retention_limit:500,recording_since:'2026-10-19T11:00:00Z'},recent_events:[]};
const nodeText=node=>typeof node==='string'||typeof node==='number'?String(node):Array.isArray(node)?node.map(nodeText).join(''):node?.type==='style'?'':nodeText(node?.children??[]);
const button=(tree,label)=>tree.root.findAllByType('button').find(node=>nodeText(node.props.children)===label);

test('React page keeps labelled stale overview while failed filters leave unrelated controls usable',async t=>{
 const {React,create,act}=componentRuntime();let mode='good',tree;const pending=Promise.withResolvers();
 const event={id:'event_old',tool:'harness_read_file',category:'read',selectors:{path:'old-synthetic.md'},outcome:'succeeded',created_at:'2026-10-19T12:00:00Z'};
 const adapter={async call(tool,args){
  if(mode==='offline')throw new Error('synthetic offline');
  if(tool==='manager_overview')return syntheticOverview;
  if(tool==='manager_events'){if(args.category==='task')return pending.promise;return{items:[event],total:1,offset:0,next_offset:null};}
  throw new Error('Unexpected synthetic tool');
 }};
 const Page=ui.createManagementUI(React,adapter);
 t.after(()=>{if(tree)act(()=>tree.unmount());});
 await act(async()=>{tree=create(React.createElement(Page));});
 assert.match(nodeText(tree.toJSON()),/已开放/);assert.equal(button(tree,'暂停接入').props.disabled,false);
 mode='offline';await act(async()=>{button(tree,'刷新').props.onClick();});
 assert.match(nodeText(tree.toJSON()),/已开放/);assert.match(nodeText(tree.toJSON()),/上次成功数据/);
 assert.equal(button(tree,'暂停接入').props.disabled,true);
 mode='good';await act(async()=>{button(tree,'访问记录').props.onClick();});
 assert.match(nodeText(tree.toJSON()),/old-synthetic\.md/);
 await act(async()=>{tree.root.findByProps({'aria-label':'类型'}).props.onChange({target:{value:'task'}});});
 assert.doesNotMatch(nodeText(tree.toJSON()),/old-synthetic\.md|当前 1/);
 assert.equal(button(tree,'暂停接入').props.disabled,false);
 await act(async()=>{pending.reject(new Error('Synthetic filter failed'));});
 assert.doesNotMatch(nodeText(tree.toJSON()),/old-synthetic\.md/);
 assert.equal(button(tree,'暂停接入').props.disabled,false);
});

test('React pagination invalidates an earlier in-flight task detail before it can appear on the new page',async t=>{
 const {React,create,act}=componentRuntime();let tree;const pending=Promise.withResolvers();
 const first={job_id:'job_first',task:'第一页任务',status:'running',project_id:'fixture'},second={job_id:'job_second',task:'第二页任务',status:'succeeded',project_id:'fixture'};
 const adapter={async call(tool,args){
  if(tool==='manager_overview')return syntheticOverview;
  if(tool==='manager_jobs')return{items:[args.offset===20?second:first],total:40,offset:args.offset,next_offset:args.offset===20?null:20};
  if(tool==='manager_job')return pending.promise;
  throw new Error('Unexpected synthetic tool');
 }};
 const Page=ui.createManagementUI(React,adapter);t.after(()=>{if(tree)act(()=>tree.unmount());});
 await act(async()=>{tree=create(React.createElement(Page));});
 await act(async()=>{button(tree,'任务').props.onClick();});
 await act(async()=>{void button(tree,'第一页任务').props.onClick();});
 await act(async()=>{button(tree,'下一页').props.onClick();});
 await act(async()=>{pending.resolve({job:{...first,result:'迟到的旧详情'}});});
 assert.match(nodeText(tree.toJSON()),/第二页任务/);assert.doesNotMatch(nodeText(tree.toJSON()),/迟到的旧详情|任务详情/);
});

test('React cached task detail is labelled as the last saved state and cannot cancel without a fresh read',async t=>{
 const {React,create,act}=componentRuntime();let tree;
 const job={job_id:'job_cached',task:'缓存任务',status:'running',project_id:'fixture',acceptance:'unverified'};
 const adapter={async call(tool){
  if(tool==='manager_overview')return syntheticOverview;
  if(tool==='manager_jobs')return{items:[job],total:1,offset:0,next_offset:null};
  if(tool==='manager_job')return{job,cached:true,refresh_error:'BACKEND_OFFLINE'};
  throw new Error('Unexpected synthetic control');
 }};
 const Page=ui.createManagementUI(React,adapter);t.after(()=>{if(tree)act(()=>tree.unmount());});
 await act(async()=>{tree=create(React.createElement(Page));});
 assert.doesNotMatch(nodeText(tree.toJSON()),/最多保留最近 500 条调用、100 项任务/);
 await act(async()=>{button(tree,'任务').props.onClick();});
 await act(async()=>{await button(tree,'缓存任务').props.onClick();});
 assert.match(nodeText(tree.toJSON()),/这是上次保存的任务状态，当前未能刷新/);
 assert.equal(button(tree,'取消任务').props.disabled,true);
});

test('public native bundle exposes setup using the actual Cordis row field without connection configuration',async()=>{const patch=await readFile(new URL('../management-plugin/cordis.patch.yml',import.meta.url),'utf8');assert.match(patch,/\bdisabled:\s*false\b/);assert.doesNotMatch(patch,/\b(?:enabled|tokenFile|dshHome|dataDir):/);});

test('actual Cordis loader exposes no-token setup in a fresh temporary profile without starting local services',async t=>{
 const sdk=await nativeSdk(t);if(!sdk)return;
 const [{Context},{default:Registry},{default:Gateway},plugin]=await Promise.all([sdk.load('@deepseek-ai/cordis'),sdk.load('@deepseek-ai/dsh-typert-registry'),sdk.load('@deepseek-ai/dsh-api-gateway'),sdk.loadManagement()]);
 const directory=await realpath(await mkdtemp(join(tmpdir(),'dot-managed-native-')));t.after(()=>rm(directory,{recursive:true,force:true}));
 const host=new Context();t.after(()=>host.fiber.dispose());host.provide('remoteAccess',{decide:()=>({kind:'allow'})});
 await host.plugin(Registry);await host.plugin(Gateway,{websocketHeartbeatIntervalMs:2000,streamInboxBytes:262144});
 await host.plugin(plugin,{dshHome:directory,dataDir:join(directory,'management')});
 const peer={principal:{kind:'owner'},signal:new AbortController().signal,interactions:'none'};
 const value=await host.typertGateway.invoke({namespace:'dotDshManagement',method:'setupStatus',args:{request:{}},peer});
 assert.equal(value.mode,'managed');assert.ok(['setup_required','blocked'].includes(value.phase));assert.equal(value.services.reader,'stopped');assert.equal(value.services.manager,'stopped');assert.equal(value.account.state,'unverified');
 assert.equal(host.get('agents'),undefined);assert.equal(host.get('sessions'),undefined);
});
