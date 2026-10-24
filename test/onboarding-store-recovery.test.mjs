import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,realpath,rm,chmod,open,stat,readFile,writeFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {createOnboardingStore} from '../management-plugin/src/onboarding-store.js';

const moduleURL=new URL('../management-plugin/src/onboarding-store.js',import.meta.url).href;
const darwin={skip:process.platform!=='darwin',timeout:60000};
async function fixture(t){const root=await realpath(await mkdtemp(join(tmpdir(),'dsh-store-recovery-')));await chmod(root,0o700);t.after(()=>rm(root,{recursive:true,force:true}));return{root,directory:join(root,'onboarding')};}
function child(t,{directory,guardPath,mode='store',gate=false}){
 const source=
  'const started=Date.now();const send=(stage,extra={})=>process.send({stage,ms:Date.now()-started,...extra});send("started");'+
  'const {createOnboardingStore}=await import('+JSON.stringify(moduleURL)+');send("imported");'+
  'let handle,store;const acquire=async()=>{try{'+
  (mode==='guard'?'const {open}=await import("node:fs/promises");const {constants}=await import("node:fs");handle=await open('+JSON.stringify(guardPath)+',constants.O_RDWR|constants.O_CREAT|constants.O_NOFOLLOW|constants.O_NONBLOCK|0x20,0o600);':
   'store=createOnboardingStore({directory:'+JSON.stringify(directory)+'});await store.acquire();send("acquired");await store.update({activated:true});')+
  'send("ready");}catch(e){send("error",{code:e.code,message:e.message});process.exitCode=1;process.disconnect();}};'+
  'process.on("message",async message=>{if(message==="start")await acquire();if(message==="close"){await store?.close();await handle?.close();send("closed");process.exit(0);}});'+
  (gate?'send("waiting");':'await acquire();');
 const cp=spawn(process.execPath,['--input-type=module','-e',source],{stdio:['ignore','pipe','pipe','ipc']});const messages=[],waiters=[];let stderr='',ended;
 cp.stderr.on('data',b=>{stderr+=b;});cp.stdout.resume();
 cp.on('message',message=>{messages.push(message);for(const w of [...waiters])if(w.predicate(message)){clearTimeout(w.timer);waiters.splice(waiters.indexOf(w),1);w.resolve(message);}});
 cp.on('error',error=>{for(const w of waiters.splice(0)){clearTimeout(w.timer);w.reject(error);}});
 const exited=new Promise(resolve=>cp.on('exit',(code,signal)=>{ended={code,signal};for(const w of waiters.splice(0)){clearTimeout(w.timer);w.reject(new Error('Child exited before stage: '+JSON.stringify({ended,messages,stderr})));}resolve(ended);}));
 t.after(async()=>{if(!ended){cp.kill('SIGKILL');await exited;}});
 return{cp,messages,exited,wait(predicate,timeout=45000){const prior=messages.find(predicate);if(prior)return Promise.resolve(prior);if(ended)return Promise.reject(new Error('Child already exited: '+JSON.stringify({ended,messages,stderr})));return new Promise((resolve,reject)=>{const w={predicate,resolve,reject,timer:setTimeout(()=>{waiters.splice(waiters.indexOf(w),1);reject(new Error('Child stage timeout: '+JSON.stringify({messages,stderr})));},timeout)};waiters.push(w);});}};
}

test('Darwin guard is exclusive across processes and SIGKILL releases the same inode',darwin,async t=>{
 const f=await fixture(t),guardPath=join(f.root,'guard'),owner=child(t,{guardPath,mode:'guard'});await owner.wait(m=>m.stage==='ready');const prior=await stat(guardPath);
 await assert.rejects(open(guardPath,constants.O_RDWR|constants.O_NOFOLLOW|constants.O_NONBLOCK|0x20),e=>['EAGAIN','EWOULDBLOCK'].includes(e.code));
 owner.cp.kill('SIGKILL');assert.equal((await owner.exited).signal,'SIGKILL');const next=await open(guardPath,constants.O_RDWR|constants.O_NOFOLLOW|constants.O_NONBLOCK|0x20);try{assert.equal((await next.stat()).ino,prior.ino);}finally{await next.close();}t.diagnostic(JSON.stringify(owner.messages));
});

test('actual store survives owner SIGKILL and preserves its state and installation identity',darwin,async t=>{
 const f=await fixture(t),owner=child(t,{directory:f.directory});await owner.wait(m=>m.stage==='ready');const prior=await readFile(join(f.directory,'state.json'),'utf8'),guardBefore=await stat(join(f.directory,'setup.guard')),oldLock=JSON.parse(await readFile(join(f.directory,'setup.lock'),'utf8'));
 const contender=createOnboardingStore({directory:f.directory});await assert.rejects(contender.acquire(),{code:'ONBOARDING_LOCKED'});await contender.close();
 owner.cp.kill('SIGKILL');await owner.exited;assert.throws(()=>process.kill(owner.cp.pid,0),{code:'ESRCH'});
 const recovered=createOnboardingStore({directory:f.directory});try{await recovered.acquire();assert.equal(await readFile(join(f.directory,'state.json'),'utf8'),prior);assert.equal((await recovered.read()).activated,true);assert.equal((await stat(join(f.directory,'setup.guard'))).ino,guardBefore.ino);const next=JSON.parse(await readFile(join(f.directory,'setup.lock'),'utf8'));assert.notEqual(next.instance,oldLock.instance);assert.equal(next.pid,process.pid);}finally{await recovered.close();}t.diagnostic(JSON.stringify(owner.messages));
});

test('two real processes racing to recover a dead owner admit exactly one new lock',darwin,async t=>{
 const f=await fixture(t),seed=child(t,{directory:f.directory});await seed.wait(m=>m.stage==='ready');seed.cp.kill('SIGKILL');await seed.exited;
 const candidates=[child(t,{directory:f.directory,gate:true}),child(t,{directory:f.directory,gate:true})];await Promise.all(candidates.map(c=>c.wait(m=>m.stage==='waiting')));for(const c of candidates)c.cp.send('start');
 const result=await Promise.all(candidates.map(c=>c.wait(m=>m.stage==='ready'||m.stage==='error')));assert.equal(result.filter(m=>m.stage==='ready').length,1);assert.equal(result.find(m=>m.stage==='error').code,'ONBOARDING_LOCKED');const winner=candidates[result.findIndex(m=>m.stage==='ready')];assert.equal(JSON.parse(await readFile(join(f.directory,'setup.lock'),'utf8')).pid,winner.cp.pid);winner.cp.send('close');assert.equal((await winner.exited).code,0);await assert.rejects(stat(join(f.directory,'setup.lock')),{code:'ENOENT'});assert.ok(await stat(join(f.directory,'setup.guard')));for(const c of candidates)t.diagnostic(JSON.stringify(c.messages));
});

test('malformed owner nonce is never coerced into a trusted recoverable lock',darwin,async t=>{const f=await fixture(t),owner=child(t,{directory:f.directory});await owner.wait(m=>m.stage==='ready');owner.cp.kill('SIGKILL');await owner.exited;const lockPath=join(f.directory,'setup.lock'),old=JSON.parse(await readFile(lockPath,'utf8'));const malformed=JSON.stringify({...old,instance:[old.instance]})+'\n';await writeFile(lockPath,malformed,{mode:0o600});const next=createOnboardingStore({directory:f.directory});try{await assert.rejects(next.acquire(),{code:'ONBOARDING_LOCKED'});assert.equal(await readFile(lockPath,'utf8'),malformed);}finally{await next.close();}});
