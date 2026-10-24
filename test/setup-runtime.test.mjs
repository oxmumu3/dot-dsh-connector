import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,mkdir,rm,readFile,writeFile,stat,chmod,symlink,link,access} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:net';
import {execFile,spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
const setup=await import('../management-plugin/src/setup-runtime.js').catch(()=>({}));
async function fixture(t){
 const base=await realpath(await mkdtemp(join(tmpdir(),'dot-setup-'))),dshHome=join(base,'harness'),dataDir=join(base,'private');
 await mkdir(join(dshHome,'profiles','desktop'),{recursive:true});await mkdir(join(dshHome,'storages'));
 t.after(()=>rm(base,{recursive:true,force:true}));
 return{base,dshHome,dataDir};
}
const supported=async()=>[{id:'runtime',ok:true,message:'Synthetic supported runtime'}];
function ownedServices(){let starts=0,closes=0;return{get starts(){return starts;},get closes(){return closes;},launchRead:async()=>{starts++;return{url:'http://127.0.0.1:31471/rpc',close:async()=>{closes++;}};},launchManager:async()=>{starts++;return{gatewayUrl:'http://127.0.0.1:31472/rpc',adminUrl:'http://127.0.0.1:31473/rpc',nativeWorkerUrl:'http://127.0.0.1:31474',close:async()=>{closes++;}};}};}
function runtime(options,extra={}){assert.equal(typeof setup.createManagedRuntime,'function');return setup.createManagedRuntime({...options,preflight:supported,checkPorts:async()=>{},...extra});}
async function listen(port){const server=createServer();await new Promise((done,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',done);});return{port:server.address().port,close:()=>new Promise(done=>server.close(done))};}
function actualListeners(){return{launchRead:async({config})=>{const r=await listen(config.port);return{url:`http://127.0.0.1:${r.port}/rpc`,close:r.close};},launchManager:async({config})=>{const resources=[];try{for(const key of ['gatewayPort','adminPort','workerPort'])resources.push(await listen(config[key]));return{gatewayUrl:`http://127.0.0.1:${resources[0].port}/rpc`,adminUrl:`http://127.0.0.1:${resources[1].port}/rpc`,nativeWorkerUrl:`http://127.0.0.1:${resources[2].port}`,close:()=>Promise.all(resources.map(r=>r.close()))};}catch(error){await Promise.all(resources.map(r=>r.close()));throw error;}}};}
test('an actual crashed runtime releases its kernel guard and resumes its exact stale owner record',async t=>{
 if(process.platform!=='darwin')return t.skip('Darwin kernel owner lock');
 const f=await fixture(t),script=`import {createServer} from 'node:net';import {createManagedRuntime} from ${JSON.stringify(new URL('../management-plugin/src/setup-runtime.js',import.meta.url).href)};const listen=${listen.toString()};const actualListeners=${actualListeners.toString()};const runtime=createManagedRuntime({...${JSON.stringify(f)},preflight:async()=>[{id:'synthetic',ok:true,message:'synthetic'}],...actualListeners()});const value=await runtime.start();process.send({phase:value.phase});setInterval(()=>{},1000);`;
 const child=spawn(process.execPath,['--input-type=module','-e',script],{stdio:['ignore','ignore','pipe','ipc']});let diagnostics='';child.stderr.on('data',data=>{diagnostics=(diagnostics+data).slice(-4096);});
 t.after(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');});
 const message=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Synthetic child startup timeout: '+diagnostics)),30000);child.once('message',value=>{clearTimeout(timer);resolve(value);});child.once('exit',code=>{clearTimeout(timer);reject(Error('Synthetic child exited '+code+': '+diagnostics));});child.once('error',error=>{clearTimeout(timer);reject(error);});});assert.equal(message.phase,'running');
 const original=JSON.parse(await readFile(join(f.dataDir,'config.json'),'utf8')),key=await readFile(join(f.dataDir,'channel.key'),'utf8');
 const successor=runtime(f,{...actualListeners(),checkPorts:undefined});t.after(()=>successor.close());assert.equal((await successor.status()).error.code,'STATE_LOCKED');
 const exited=once(child,'exit');child.kill('SIGKILL');await exited;
 const stale=JSON.parse(await readFile(join(f.dataDir,'runtime.lock'),'utf8'));assert.equal(stale.pid,child.pid);
 assert.equal((await successor.status()).phase,'prepared');assert.equal((await successor.resume()).phase,'running');
 assert.equal(JSON.parse(await readFile(join(f.dataDir,'config.json'),'utf8')).principal,original.principal);assert.equal(await readFile(join(f.dataDir,'channel.key'),'utf8'),key);
 assert.notEqual(JSON.parse(await readFile(join(f.dataDir,'runtime.lock'),'utf8')).pid,child.pid);
 const guard=await stat(join(f.dataDir,'runtime.guard'));await successor.close();assert.equal((await stat(join(f.dataDir,'runtime.guard'))).ino,guard.ino);await assert.rejects(access(join(f.dataDir,'runtime.lock')));
});
test('runtime stale recovery refuses live owners, malformed owner fields and linked lock files unchanged',async t=>{
 if(process.platform!=='darwin')return t.skip('Darwin kernel owner lock');
 const dead=spawn(process.execPath,['-e','process.exit(0)'],{stdio:'ignore'});await once(dead,'exit');
 const base={instance:'a'.repeat(32),pid:dead.pid,started_at:'2026-01-01T00:00:00.000Z'};
 for(const [name,value,kind]of [['live',{...base,pid:process.pid}],['array-instance',{...base,instance:['a'.repeat(32)]}],['extra',{...base,extra:true}],['bad-time',{...base,started_at:'yesterday'}],['missing-time',{instance:base.instance,pid:base.pid}],['linked',base,'symlink'],['hard-linked',base,'hardlink']])await t.test(name,async t=>{
  const f=await fixture(t),services=ownedServices(),r=runtime(f,services);t.after(()=>r.close());await r.prepare();
  const file=join(f.dataDir,'runtime.lock'),content=JSON.stringify(value),target=join(f.base,'foreign-lock');
  if(kind){await writeFile(target,content,{mode:0o600});if(kind==='symlink')await symlink(target,file);else await link(target,file);}else await writeFile(file,content,{mode:0o600});
  assert.equal((await r.resume()).error.code,'STATE_LOCKED');assert.equal((await r.start()).error.code,'STATE_LOCKED');assert.equal(services.starts,0);assert.equal(await readFile(file,'utf8'),content);
 });
});
test('runtime guard paths are never repaired, followed or replaced',async t=>{
 if(process.platform!=='darwin')return t.skip('Darwin kernel owner lock');
 for(const kind of ['symlink','hardlink','permissive'])await t.test(kind,async t=>{
  const f=await fixture(t),services=ownedServices();await mkdir(f.dataDir,{mode:0o700});const target=join(f.base,'foreign-guard'),file=join(f.dataDir,'runtime.guard');await writeFile(target,'foreign',{mode:0o600});
  if(kind==='symlink')await symlink(target,file);else if(kind==='hardlink')await link(target,file);else await writeFile(file,'foreign',{mode:0o644});
  const r=runtime(f,services);t.after(()=>r.close());assert.equal((await r.start()).error.code,'STATE_LOCKED');assert.equal(services.starts,0);assert.equal(await readFile(file,'utf8'),'foreign');assert.equal(await readFile(target,'utf8'),'foreign');await assert.rejects(access(join(f.dataDir,'config.json')));
 });
});
test('failed private configuration preparation releases its kernel ownership for a later valid attempt',async t=>{
 if(process.platform!=='darwin')return t.skip('Darwin kernel owner lock');
 const f=await fixture(t),one=runtime(f,ownedServices());t.after(()=>one.close());assert.equal((await one.prepare()).phase,'prepared');
 const path=join(f.dataDir,'config.json'),original=await readFile(path,'utf8'),guard=await stat(join(f.dataDir,'runtime.guard'));await writeFile(path,'invalid',{mode:0o600});
 assert.equal((await one.prepare()).phase,'blocked');await assert.rejects(access(join(f.dataDir,'runtime.lock')));await writeFile(path,original,{mode:0o600});
 const two=runtime(f,ownedServices());t.after(()=>two.close());assert.equal((await two.start()).phase,'running');assert.equal((await stat(join(f.dataDir,'runtime.guard'))).ino,guard.ino);assert.equal((await one.start()).error.code,'STATE_LOCKED');assert.equal((await two.status()).phase,'running');
});
test('default managed setup atomically allocates ports and resumes even after a previous port is taken',async t=>{
 const f=await fixture(t),one=runtime(f,{...actualListeners(),checkPorts:undefined});t.after(()=>one.close());await one.prepare();
 const initial=JSON.parse(await readFile(join(f.dataDir,'config.json'),'utf8'));assert.equal(initial.automaticPorts,true);assert.deepEqual(initial.ports,{reader:0,gateway:0,admin:0,worker:0});
 assert.equal((await one.start()).phase,'running');const before=JSON.parse(await readFile(join(f.dataDir,'config.json'),'utf8'));assert.ok(Object.values(before.ports).every(port=>port>0));assert.equal(new Set(Object.values(before.ports)).size,4);
 assert.equal((await setup.managedMcpEnvironment(f.dataDir)).DOT_DSH_BRIDGE_URL,`http://127.0.0.1:${before.ports.gateway}/rpc`);assert.equal(await one.nativeWorkerReference(),`http://127.0.0.1:${before.ports.worker}/native/`);await one.close();
 const foreign=await listen(before.ports.gateway);t.after(()=>foreign.close());const two=runtime(f,{...actualListeners(),checkPorts:undefined});t.after(()=>two.close());assert.equal((await two.resume()).phase,'running');
 const after=JSON.parse(await readFile(join(f.dataDir,'config.json'),'utf8'));assert.notEqual(after.ports.gateway,before.ports.gateway);assert.equal(after.principal,before.principal);assert.equal((await setup.managedMcpEnvironment(f.dataDir)).DOT_DSH_BRIDGE_URL,`http://127.0.0.1:${after.ports.gateway}/rpc`);
});
test('partial managed startup never publishes incomplete allocated ports or a worker endpoint',async t=>{
 const f=await fixture(t),r=runtime(f,{...actualListeners(),launchManager:async()=>{throw Error('partial');}});t.after(()=>r.close());await r.prepare();const before=await readFile(join(f.dataDir,'config.json'),'utf8');assert.equal((await r.start()).phase,'blocked');assert.equal(await readFile(join(f.dataDir,'config.json'),'utf8'),before);await assert.rejects(r.nativeWorkerReference(),{code:'SETUP_REQUIRED'});
});
test('explicit ephemeral port requests stay ephemeral across reload while published ports remain concrete',async t=>{
 const f=await fixture(t),one=runtime(f,{...actualListeners(),ports:{reader:0,gateway:0,admin:0,worker:0},checkPorts:undefined});t.after(()=>one.close());assert.equal((await one.start()).phase,'running');const before=JSON.parse(await readFile(join(f.dataDir,'config.json'),'utf8'));assert.equal(before.automaticPorts,false);assert.ok(before.ports.gateway>0);await one.close();
 const foreign=await listen(before.ports.gateway);t.after(()=>foreign.close());const two=runtime(f,{...actualListeners(),checkPorts:undefined});t.after(()=>two.close());assert.equal((await two.resume()).phase,'running');assert.notEqual(JSON.parse(await readFile(join(f.dataDir,'config.json'),'utf8')).ports.gateway,before.ports.gateway);
});
test('fresh setup is explicit, creates only private connector files, and is idempotent',async t=>{
 const f=await fixture(t),r=runtime(f);t.after(()=>r.close());
 assert.equal((await r.status()).phase,'setup_required');await assert.rejects(access(f.dataDir));
 assert.equal((await r.prepare()).phase,'prepared');const original=await readFile(join(f.dataDir,'config.json'),'utf8');
 assert.equal((await stat(f.dataDir)).mode&0o777,0o700);
 for(const name of ['config.json','channel.key','admin.key'])assert.equal((await stat(join(f.dataDir,name))).mode&0o777,0o600);
 await r.prepare();assert.equal(await readFile(join(f.dataDir,'config.json'),'utf8'),original);
 const status=await r.status();assert.equal(status.account.state,'unverified');assert.equal(status.services.tunnel,'external_setup_required');assert.doesNotMatch(JSON.stringify(status),/channel\.key|admin\.key/);
});
test('failed preflight leaves no prepared state or credentials',async t=>{
 const f=await fixture(t),r=runtime(f,{preflight:async()=>[{id:'python',ok:false,message:'Python 3.10+ required'}]});t.after(()=>r.close());
 assert.equal((await r.prepare()).phase,'blocked');await assert.rejects(access(f.dataDir));
});
test('repeated and concurrent start acquire resources once; stop preserves records and is repeatable',async t=>{
 const f=await fixture(t),services=ownedServices(),r=runtime(f,services);t.after(()=>r.close());
 await r.prepare();const values=await Promise.all([r.start(),r.start()]);assert.equal(values[0].phase,'running');assert.equal(values[1].phase,'running');assert.equal(services.starts,2);
 await writeFile(join(f.dataDir,'record-evidence'),'retained',{mode:0o600});await r.stop();await r.stop();assert.equal(services.closes,2);assert.equal(await readFile(join(f.dataDir,'record-evidence'),'utf8'),'retained');
 await r.start();await r.close();assert.equal(services.closes,4);await assert.rejects(access(join(f.dataDir,'runtime.lock')));
});
test('unknown runtime lock is reported and neither removed nor adopted',async t=>{
 const f=await fixture(t),services=ownedServices(),r=runtime(f,services);t.after(()=>r.close());await r.prepare();
 await writeFile(join(f.dataDir,'runtime.lock'),'unknown owner',{mode:0o600});const result=await r.start();assert.equal(result.phase,'blocked');assert.equal(result.error.code,'STATE_LOCKED');assert.equal(services.starts,0);
 await r.stop();assert.equal(await readFile(join(f.dataDir,'runtime.lock'),'utf8'),'unknown owner');
});
test('partial service startup closes owned reader and releases only own lock',async t=>{
 const f=await fixture(t),services=ownedServices(),r=runtime(f,{...services,launchManager:async()=>{throw new Error('secret startup failure');}});t.after(()=>r.close());await r.prepare();
 const result=await r.start();assert.equal(result.phase,'blocked');assert.equal(services.closes,1);assert.doesNotMatch(JSON.stringify(result),/secret startup failure/);await assert.rejects(access(join(f.dataDir,'runtime.lock')));
});
test('stop never removes a replaced runtime lock',async t=>{
 const f=await fixture(t),r=runtime(f,ownedServices());t.after(()=>r.close());await r.prepare();await r.start();
 await rm(join(f.dataDir,'runtime.lock'));await writeFile(join(f.dataDir,'runtime.lock'),'foreign replacement',{mode:0o600});await r.stop();assert.equal(await readFile(join(f.dataDir,'runtime.lock'),'utf8'),'foreign replacement');
});
test('setup refuses permissive and linked state or tokens without repairing them',async t=>{
 const f=await fixture(t);await mkdir(f.dataDir,{mode:0o755});const r=runtime(f);t.after(()=>r.close());assert.equal((await r.prepare()).phase,'blocked');assert.equal((await stat(f.dataDir)).mode&0o777,0o755);
 await chmod(f.dataDir,0o700);await r.prepare();const token=join(f.dataDir,'admin.key');await rm(token);await writeFile(join(f.base,'foreign'),'x'.repeat(48),{mode:0o600});await symlink(join(f.base,'foreign'),token);
 assert.equal((await r.start()).phase,'blocked');assert.equal(await readFile(join(f.base,'foreign'),'utf8'),'x'.repeat(48));
});
test('busy loopback port blocks startup without talking to or terminating its owner',async t=>{
 const f=await fixture(t);let connections=0;const server=createServer(()=>{connections++;});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const services=ownedServices(),r=runtime(f,{...services,ports:{reader:server.address().port,gateway:0,admin:0,worker:0},checkPorts:undefined});t.after(()=>r.close());await r.prepare();const result=await r.start();assert.equal(result.error.code,'PORT_IN_USE');assert.equal(services.starts,0);assert.equal(connections,0);assert.equal(server.listening,true);
});
test('close during startup waits for acquired resources and prevents late online state',async t=>{
 const f=await fixture(t),services=ownedServices();let release;const gate=new Promise(resolve=>release=resolve);const r=runtime(f,{...services,launchRead:async()=>{await gate;return services.launchRead();}});await r.prepare();const starting=r.start();await new Promise(resolve=>setImmediate(resolve));const closing=r.close();release();await Promise.all([starting,closing]);assert.equal(services.closes,services.starts);assert.notEqual((await r.status()).phase,'running');
});
test('MCP handoff reads own channel token without echoing it in command or setup status',async t=>{
 const f=await fixture(t),r=runtime(f);t.after(()=>r.close());await r.prepare();const token=await readFile(join(f.dataDir,'channel.key'),'utf8');const env=await setup.managedMcpEnvironment(f.dataDir);
 assert.equal(env.DOT_DSH_TOKEN,token.trim());assert.equal(env.DOT_DSH_FIXTURE_TASKS,'disabled');assert.doesNotMatch(JSON.stringify(await r.status()),new RegExp(token.trim()));
});
test('plugin reload resumes only an explicitly activated installation; explicit stop clears intent',async t=>{
 const f=await fixture(t),one=runtime(f,ownedServices());await one.prepare();await one.close();
 const services=ownedServices(),two=runtime(f,services);assert.equal((await two.resume()).phase,'prepared');assert.equal(services.starts,0);await two.start();await two.close();
 const three=runtime(f,services);assert.equal((await three.resume()).phase,'running');await three.stop();await three.close();
 const four=runtime(f,services);t.after(()=>four.close());assert.equal((await four.resume()).phase,'prepared');
});
test('a second runtime reports an unknown owner lock without claiming services stopped or allowing start',async t=>{
 const f=await fixture(t),first=runtime(f,ownedServices());t.after(()=>first.close());await first.start();
 const second=runtime(f,ownedServices());t.after(()=>second.close());const state=await second.status();assert.equal(state.phase,'blocked');assert.equal(state.error.code,'STATE_LOCKED');assert.equal(state.services.manager,'unknown');assert.equal(state.actions.start,false);
 assert.equal((await second.prepare()).error.code,'STATE_LOCKED');await second.stop();assert.equal((await second.status()).error.code,'STATE_LOCKED');assert.equal((await first.status()).phase,'running');
});
test('explicit stop clears restart intent before closing services while its ownership lock is held',async t=>{
 const f=await fixture(t),seen=[],second=runtime(f,ownedServices());t.after(()=>second.close());
 const first=runtime(f,{launchRead:async()=>({url:'http://127.0.0.1:31471/rpc',close:async()=>{}}),launchManager:async()=>({gatewayUrl:'http://127.0.0.1:31472/rpc',adminUrl:'http://127.0.0.1:31473/rpc',nativeWorkerUrl:'http://127.0.0.1:31474',close:async()=>{
  seen.push({activated:JSON.parse(await readFile(join(f.dataDir,'config.json'),'utf8')).activated,lockExists:await access(join(f.dataDir,'runtime.lock')).then(()=>true,()=>false),competingStart:(await second.start()).phase});
 }})});t.after(()=>first.close());await first.start();await first.stop();
 assert.deepEqual(seen,[{activated:false,lockExists:true,competingStart:'blocked'}]);assert.equal((await second.start()).phase,'running');assert.equal(JSON.parse(await readFile(join(f.dataDir,'config.json'),'utf8')).activated,true);
});
test('a runtime with cached configuration but no ownership cannot clear restart intent',async t=>{
 const f=await fixture(t),first=runtime(f,ownedServices());await first.start();await first.close();
 const second=runtime(f,ownedServices());t.after(()=>second.close());assert.equal((await second.status()).phase,'prepared');await second.stop();assert.equal(JSON.parse(await readFile(join(f.dataDir,'config.json'),'utf8')).activated,true);
});
test('stop closes owned services but does not change restart intent after lock ownership is replaced',async t=>{
 const f=await fixture(t),services=ownedServices(),r=runtime(f,services);t.after(()=>r.close());await r.start();await rm(join(f.dataDir,'runtime.lock'));await writeFile(join(f.dataDir,'runtime.lock'),'new owner',{mode:0o600});const before=await readFile(join(f.dataDir,'config.json'),'utf8');
 const result=await r.stop();assert.equal(result.error.code,'STATE_LOCKED');assert.equal(services.closes,2);assert.equal(await readFile(join(f.dataDir,'config.json'),'utf8'),before);assert.equal(await readFile(join(f.dataDir,'runtime.lock'),'utf8'),'new owner');
});
test('prepared cloud health reference is passed to owned manager and survives lifecycle writes',async t=>{
 const f=await fixture(t),cloudHealthFile=join(f.base,'registered-tunnel.url'),seen=[],services=ownedServices();
 const r=runtime({...f,cloudHealthFile},{...services,launchManager:async options=>{seen.push(options.config);return services.launchManager(options);}});t.after(()=>r.close());
 assert.equal((await r.prepare()).phase,'prepared');
 assert.equal(JSON.parse(await readFile(join(f.dataDir,'config.json'),'utf8')).cloudHealthFile,cloudHealthFile);
 await assert.rejects(access(cloudHealthFile));
 assert.equal((await r.start()).phase,'running');assert.equal(seen[0].cloudHealthFile,cloudHealthFile);
 await r.stop();assert.equal(JSON.parse(await readFile(join(f.dataDir,'config.json'),'utf8')).cloudHealthFile,cloudHealthFile);
 await r.close();
 const next=runtime(f,{...services,launchManager:async options=>{seen.push(options.config);return services.launchManager(options);}});t.after(()=>next.close());
 assert.equal((await next.start()).phase,'running');assert.equal(seen.at(-1).cloudHealthFile,cloudHealthFile);
});
test('changing cloud health reference requires the existing owned runtime to stop',async t=>{
 const f=await fixture(t),firstFile=join(f.base,'first.url'),secondFile=join(f.base,'second.url'),services=ownedServices();
 const first=runtime({...f,cloudHealthFile:firstFile},services);t.after(()=>first.close());await first.start();
 const original=await readFile(join(f.dataDir,'config.json'),'utf8'),channel=await readFile(join(f.dataDir,'channel.key'),'utf8');
 const second=runtime({...f,cloudHealthFile:secondFile},services);t.after(()=>second.close());
 assert.equal((await second.prepare()).error.code,'STATE_LOCKED');assert.equal(await readFile(join(f.dataDir,'config.json'),'utf8'),original);assert.equal(services.closes,0);
 await first.stop();assert.equal((await second.prepare()).phase,'prepared');
 assert.equal(JSON.parse(await readFile(join(f.dataDir,'config.json'),'utf8')).cloudHealthFile,secondFile);
 assert.equal(await readFile(join(f.dataDir,'channel.key'),'utf8'),channel);await assert.rejects(access(join(f.dataDir,'runtime.lock')));
});
test('cloud health reference must be a canonical absolute path before preparing state',async t=>{
 const f=await fixture(t),r=runtime({...f,cloudHealthFile:'relative/tunnel.url'});t.after(()=>r.close());
 assert.equal((await r.prepare()).error?.code,'PRIVATE_STATE_REQUIRED');await assert.rejects(access(f.dataDir));
});
test('CLI prepare accepts an explicit cloud health URL file reference',async t=>{
 const f=await fixture(t),script=fileURLToPath(new URL('../management-plugin/scripts/setup.mjs',import.meta.url));
 const result=await new Promise(resolve=>execFile(process.execPath,[script,'prepare','--dsh-home',f.dshHome,'--data-dir',f.dataDir,'--cloud-health-file',join(f.base,'registered.url')],{env:{PATH:process.env.PATH??'/usr/bin:/bin'},timeout:15000,maxBuffer:65536},(error,stdout,stderr)=>resolve({error,stdout,stderr})));
 assert.match(result.stdout,/^\s*\{/,'recognised prepare arguments must return runtime JSON, including an explicit preflight refusal');
 const value=JSON.parse(result.stdout);assert.ok(['prepared','blocked'].includes(value.phase));
 if(value.phase==='prepared')assert.equal(JSON.parse(await readFile(join(f.dataDir,'config.json'),'utf8')).cloudHealthFile,join(f.base,'registered.url'));
});
test('onboarding gets a trusted private reference and registers fixed health before starting manager',async t=>{
 const f=await fixture(t),services=ownedServices(),seen=[],r=runtime(f,{...services,launchManager:async options=>{seen.push(options.config);return services.launchManager();}});t.after(()=>r.close());await r.prepare();
 assert.equal(typeof r.onboardingReference,'function');assert.equal(typeof r.setCloudHealthFile,'function');
 const reference=await r.onboardingReference();assert.equal(reference.directory,join(f.dataDir,'onboarding'));assert.match(reference.mcpCommand,/mcp-managed\.mjs/);assert.doesNotMatch(JSON.stringify(reference),/admin\.key|channel\.key/);
 const fixed=join(reference.directory,'health.url');await r.setCloudHealthFile(fixed);assert.equal(JSON.parse(await readFile(join(f.dataDir,'config.json'),'utf8')).cloudHealthFile,fixed);await r.start();assert.equal(seen[0].cloudHealthFile,fixed);await r.setCloudHealthFile(fixed);assert.equal(services.closes,0);
 await assert.rejects(r.setCloudHealthFile(join(f.base,'another.url')),{code:'SETUP_RUNNING'});assert.equal(services.closes,0);assert.equal((await r.status()).phase,'running');
});
test('onboarding health registration does not take a foreign runtime lock or redirect its state',async t=>{
 const f=await fixture(t),r=runtime(f,ownedServices());t.after(()=>r.close());await r.prepare();await writeFile(join(f.dataDir,'runtime.lock'),'foreign',{mode:0o600});
 assert.equal(typeof r.setCloudHealthFile,'function');const original=await readFile(join(f.dataDir,'config.json'),'utf8');await assert.rejects(r.setCloudHealthFile(join(f.dataDir,'onboarding','health.url')),{code:'STATE_LOCKED'});assert.equal(await readFile(join(f.dataDir,'config.json'),'utf8'),original);assert.equal(await readFile(join(f.dataDir,'runtime.lock'),'utf8'),'foreign');
});
test('trusted onboarding reference remains selected when a managed legacy health option was supplied',async t=>{
 const f=await fixture(t),seen=[],services=ownedServices(),r=runtime({...f,cloudHealthFile:join(f.base,'old-official.url')},{...services,launchManager:async options=>{seen.push(options.config.cloudHealthFile);return services.launchManager();}});t.after(()=>r.close());await r.prepare();
 const fixed=join(f.dataDir,'onboarding','health.url');await r.setCloudHealthFile(fixed);assert.equal((await r.start()).phase,'running');assert.equal(seen[0],fixed);assert.equal(JSON.parse(await readFile(join(f.dataDir,'config.json'),'utf8')).cloudHealthFile,fixed);
});
for(const [label,executable,electron] of [['ordinary Node',process.execPath,false],['Harness embedded Node','/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness',true]]){
 test('exact MCP entry starts with an empty GUI PATH using '+label,async t=>{
  try{await stat(executable);}catch{t.skip('Host executable unavailable');return;}
  const f=await fixture(t),r=runtime(f,{env:{PATH:''},nodeExecutable:executable,nodeElectron:electron});t.after(()=>r.close());await r.prepare();const reference=await r.onboardingReference();
  const [{Client},{StdioClientTransport}]=await Promise.all([import('@modelcontextprotocol/sdk/client/index.js'),import('@modelcontextprotocol/sdk/client/stdio.js')]);
  const client=new Client({name:'dot-dsh-entry-test',version:'1'}),transport=new StdioClientTransport({command:'/bin/sh',args:['-c',reference.mcpCommand],env:{PATH:''},stderr:'ignore'});
  try{await client.connect(transport,{timeout:30000});const result=await client.listTools(undefined,{timeout:5000});assert.ok(result.tools.some(tool=>tool.name==='harness_start_task'));assert.ok(result.tools.some(tool=>tool.name==='harness_list_workspaces'));assert.equal(client.getServerVersion().name,'dot-dsh-connector');}
  finally{await client.close();}
  assert.ok(reference.mcpCommand.includes(executable));if(electron)assert.match(reference.mcpCommand,/ELECTRON_RUN_AS_NODE=1/);
 });
}
test('exact MCP entry is verified before onboarding can receive a usable reference',async t=>{
 const f=await fixture(t);let checked=0;const r=runtime(f,{checkMcp:async()=>{checked++;throw Error('raw-host-entry-failure');}});t.after(()=>r.close());await r.prepare();
 await assert.rejects(r.onboardingReference(),error=>error.code==='MCP_ENTRY_UNAVAILABLE'&&!error.message.includes('raw-host'));assert.equal(checked,1);
});
test('default preflight uses Harness bundled Python when the GUI has an empty PATH',async t=>{
 const python='/Applications/DeepSeek Harness.app/Contents/Resources/runtime/primary-runtime/dependencies/python/bin/python3.12';try{await stat(python);}catch{t.skip('Bundled Python unavailable');return;}
 const f=await fixture(t),moduleUrl=new URL('../management-plugin/src/setup-runtime.js',import.meta.url).href;
 const source=`const {runtimePreflight,SUPPORTED}=await import(${JSON.stringify(moduleUrl)});const checks=await runtimePreflight({dshHome:${JSON.stringify(f.dshHome)},platform:'darwin',checkSdk:async()=>SUPPORTED.sdk});console.log(JSON.stringify(checks));`;
 const result=await new Promise((resolve,reject)=>execFile(process.execPath,['--input-type=module','--eval',source],{env:{PATH:''},timeout:30000,maxBuffer:65536},(error,stdout)=>error?reject(error):resolve(JSON.parse(stdout))));assert.equal(result.find(check=>check.id==='python').ok,true);
});
for(const [label,executable,electron] of [['ordinary Node',process.execPath,false],['Harness embedded Node','/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness',true]]){
 test('default SDK preflight reads installed public metadata using '+label,async t=>{
  const archive='/Applications/DeepSeek Harness.app/Contents/Resources/app.asar';
  try{await stat(executable);await stat(archive);}catch{t.skip('Installed Harness distribution unavailable');return;}
  const f=await fixture(t),moduleUrl=new URL('../management-plugin/src/setup-runtime.js',import.meta.url).href;
  const source=`const {runtimePreflight}=await import(${JSON.stringify(moduleUrl)});const before=process.noAsar;const checks=await runtimePreflight({dshHome:${JSON.stringify(f.dshHome)},checkPython:async()=>{}});console.log(JSON.stringify({checks,noAsarUnchanged:process.noAsar===before}));`;
  const result=await new Promise((resolve,reject)=>execFile(executable,['--input-type=module','--eval',source],{env:{PATH:'',...(electron?{ELECTRON_RUN_AS_NODE:'1'}:{})},timeout:15000,maxBuffer:65536},(error,stdout)=>error?reject(error):resolve(JSON.parse(stdout))));
  assert.equal(result.checks.find(check=>check.id==='sdk').ok,true,JSON.stringify(result.checks));
  assert.equal(result.noAsarUnchanged,true);
 });
}
