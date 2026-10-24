import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,writeFile,readFile,rm,mkdir,stat,chmod,link,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {spawnOwnedTunnel,stopOwnedTunnel} from '../management-plugin/src/onboarding-tunnel-supervisor.js';
import {createTunnelRuntime} from '../management-plugin/src/onboarding-tunnel.js';

const runtimeURL=new URL('../management-plugin/src/onboarding-tunnel.js',import.meta.url).href;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const alive=pid=>{try{process.kill(pid,0);return true;}catch(e){if(e.code==='ESRCH')return false;throw e;}};
async function until(check,ms=60000){const end=Date.now()+ms;do{if(await check())return;await sleep(25);}while(Date.now()<end);throw new Error('Timed out waiting for isolated process fixture.');}
async function events(directory){try{return(await readFile(join(directory,'events.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));}catch(e){if(e.code==='ENOENT')return[];throw e;}}
async function fixture(t,{termDelay=50,ignoreTerm=false}={}){
 const root=await realpath(await mkdtemp(join(tmpdir(),'dsh-tunnel-lifeline-'))),directory=join(root,'owned'),key=join(root,'runtime.key'),binary=join(root,'fixture-child.mjs'),hostFile=join(root,'fixture-host.mjs');
 await mkdir(directory,{mode:0o700});await writeFile(key,'synthetic-runtime-key',{mode:0o600});
 await writeFile(binary,`#!${process.execPath}\nimport {appendFileSync} from 'node:fs';import {dirname,join} from 'node:path';const directory=dirname(process.argv[process.argv.indexOf('--health.url-file')+1]);const emit=kind=>appendFileSync(join(directory,'events.jsonl'),JSON.stringify({kind,pid:process.pid,at:Date.now()})+'\\n',{mode:0o600});emit('start');process.on('exit',()=>emit('exit'));process.on('SIGTERM',()=>{emit('term');${ignoreTerm?'':`setTimeout(()=>process.exit(0),${termDelay});`}});setInterval(()=>{},1000);\n`,{mode:0o700});
 await writeFile(hostFile,`import {createTunnelRuntime} from ${JSON.stringify(runtimeURL)};import {readFile,writeFile} from 'node:fs/promises';const [directory,key,binary,ready]=process.argv.slice(2);const initial=(await readFile(directory+'/events.jsonl','utf8').catch(()=>'' )).split('\\n').filter(Boolean).length;const runtime=createTunnelRuntime({directory,installationId:'a'.repeat(32),install:async()=>({binary}),pollMs:25,probe:async()=>{const entries=(await readFile(directory+'/events.jsonl','utf8')).trim().split('\\n').filter(Boolean).slice(initial).map(JSON.parse);if(!entries.some(e=>e.kind==='start'))throw new Error('not ready');return{healthy:true,ready:true};}});await runtime.start({tunnel_id:'synthetic-tunnel',runtimeKeyFile:key,mcpCommand:'synthetic command'});await writeFile(ready,'ready');process.on('SIGTERM',async()=>{await runtime.close();process.exit(0);});setInterval(()=>{},1000);\n`,{mode:0o600});
 const hosts=[];
 t.after(async()=>{for(const host of hosts)if(host.exitCode===null&&host.signalCode===null)host.kill('SIGKILL');for(const event of await events(directory))if(event.kind==='start'&&alive(event.pid))try{process.kill(event.pid,'SIGKILL');}catch{}await sleep(100);await rm(root,{recursive:true,force:true});});
 return{root,directory,binary,hosts,async launch(name){const ready=join(root,name+'.ready'),host=spawn(process.execPath,[hostFile,directory,key,binary,ready],{stdio:['ignore','ignore','pipe']});let errors='';host.stderr.on('data',b=>{errors+=b;});host.errors=()=>errors;hosts.push(host);await until(async()=>{if(host.exitCode!==null||host.signalCode!==null)throw new Error('Fixture host failed: '+errors);try{return(await readFile(ready,'utf8'))==='ready';}catch{return false;}});return host;}};
}

test('Host SIGKILL stops only its own Tunnel child through the supervisor lifeline',{skip:process.platform!=='darwin',timeout:120000},async t=>{
 const f=await fixture(t),unrelated=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});t.after(()=>unrelated.kill('SIGKILL'));
 const host=await f.launch('first'),owned=(await events(f.directory)).find(e=>e.kind==='start').pid;
 assert.equal(alive(owned),true);host.kill('SIGKILL');await until(()=>host.signalCode==='SIGKILL');
 await until(()=>!alive(owned),5000);
 assert.equal(alive(unrelated.pid),true,'unrelated child must remain alive');
});

test('normal Host close waits for its owned child to exit',{skip:process.platform!=='darwin',timeout:120000},async t=>{
 const f=await fixture(t),host=await f.launch('first'),owned=(await events(f.directory)).find(e=>e.kind==='start').pid;
 host.kill('SIGTERM');await until(()=>host.exitCode===0);assert.equal(alive(owned),false);
 assert.deepEqual((await events(f.directory)).map(e=>e.kind),['start','term','exit']);
});

test('lifeline escalates only its stubborn child and reaps it',{skip:process.platform!=='darwin',timeout:120000},async t=>{
 const f=await fixture(t,{ignoreTerm:true}),host=await f.launch('first'),owned=(await events(f.directory)).find(e=>e.kind==='start').pid;
 host.kill('SIGKILL');await until(()=>!alive(owned),7000);
 assert.ok((await events(f.directory)).some(e=>e.kind==='term'));
});

test('permanent guard prevents new child until crashed Host child has exited',{skip:process.platform!=='darwin',timeout:120000},async t=>{
 const f=await fixture(t,{termDelay:600}),one=await f.launch('first'),guard=await stat(join(f.directory,'tunnel.guard'));
 const healthFile=join(f.directory,'health.url');await writeFile(healthFile,'http://127.0.0.1:39002\n',{mode:0o600});
 const launching=f.launch('second');await sleep(200);assert.equal((await events(f.directory)).filter(e=>e.kind==='start').length,1);
 assert.equal(await readFile(healthFile,'utf8'),'http://127.0.0.1:39002\n');
 one.kill('SIGKILL');const two=await launching;const recorded=await events(f.directory),started=recorded.filter(e=>e.kind==='start');
 assert.equal(started.length,2);assert.ok(recorded.findIndex(e=>e.kind==='exit'&&e.pid===started[0].pid)<recorded.findIndex(e=>e.kind==='start'&&e.pid===started[1].pid));
 assert.equal(alive(started[0].pid),false);assert.equal(alive(started[1].pid),true);
 assert.equal((await stat(join(f.directory,'tunnel.guard'))).ino,guard.ino);
 await assert.rejects(readFile(healthFile,'utf8'),{code:'ENOENT'});
 two.kill('SIGTERM');await until(()=>two.exitCode===0);
});

test('a live installation owner blocks a second child with a bounded failure',{skip:process.platform!=='darwin',timeout:120000},async t=>{
 const f=await fixture(t),one=await f.launch('first'),guard=await stat(join(f.directory,'tunnel.guard'));
 const healthFile=join(f.directory,'health.url');await writeFile(healthFile,'http://127.0.0.1:39001\n',{mode:0o600});
 await assert.rejects(f.launch('second'),/Fixture host failed/);
 assert.equal(one.exitCode,null);assert.equal((await events(f.directory)).filter(e=>e.kind==='start').length,1);
 assert.equal(await readFile(healthFile,'utf8'),'http://127.0.0.1:39001\n','a rejected second start must preserve the live owner health file');
 assert.equal((await stat(join(f.directory,'tunnel.guard'))).ino,guard.ino);
});

test('early EOF while another helper owns the guard never starts a late child',{skip:process.platform!=='darwin',timeout:120000},async t=>{
 const f=await fixture(t),one=await f.launch('first'),helper=spawnOwnedTunnel(f.binary,['--health.url-file',join(f.directory,'health.url')],{ownerDirectory:f.directory,env:{PATH:process.env.PATH}});
 helper.on('error',()=>{});assert.equal(stopOwnedTunnel(helper),true);await until(()=>helper.exitCode!==null||helper.signalCode!==null);
 one.kill('SIGTERM');await until(()=>one.exitCode===0);await sleep(100);
 assert.equal((await events(f.directory)).filter(e=>e.kind==='start').length,1);
});

test('waiting for the previous owner never probes its stale health as the new child',{skip:process.platform!=='darwin',timeout:120000},async t=>{
 const f=await fixture(t);await f.launch('first');let probes=0;
 let spawned=false;const runtime=createTunnelRuntime({directory:f.directory,installationId:'b'.repeat(32),install:async()=>({binary:f.binary}),spawnImpl:(...args)=>{const child=spawnOwnedTunnel(...args);spawned=true;return child;},pollMs:10,probe:async()=>{probes++;return{healthy:true,ready:true};}});t.after(()=>runtime.close());
 const starting=runtime.start({tunnel_id:'synthetic-tunnel',runtimeKeyFile:join(f.root,'runtime.key'),mcpCommand:'synthetic command'});starting.catch(()=>{});
 await until(()=>spawned);assert.equal(probes,0,'old health must not be accepted before this helper starts its own child');
 await runtime.close();await assert.rejects(starting);
});

test('unsafe guard files fail closed without changing foreign targets',{skip:process.platform!=='darwin',timeout:180000},async t=>{
 for(const kind of ['symlink','hardlink','permissions'])await t.test(kind,async sub=>{
  const f=await fixture(sub),foreign=join(f.root,'foreign'),guard=join(f.directory,'tunnel.guard');await writeFile(foreign,'preserve',{mode:0o600});
  if(kind==='symlink')await symlink(foreign,guard);else if(kind==='hardlink')await link(foreign,guard);else{await writeFile(guard,'',{mode:0o600});await chmod(guard,0o644);}
  await assert.rejects(f.launch('bad'),/Fixture host failed/);
  assert.deepEqual(await events(f.directory),[]);assert.equal(await readFile(foreign,'utf8'),'preserve');
 });
});
