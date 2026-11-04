import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runtimePreflight} from '../management-plugin/src/setup-runtime.js';
test('runtime preflight accepts verified rc.2 through rc.5, and rejects unverified runtimes',async t=>{
 const home=await realpath(await mkdtemp(join(tmpdir(),'dot-rc3-synthetic-')));t.after(()=>rm(home,{recursive:true,force:true}));await mkdir(join(home,'profiles','desktop'),{recursive:true});await mkdir(join(home,'storages'));
 for(const [version,expected]of [['0.2.1-rc.2',true],['0.2.1-rc.3',true],['0.2.1-rc.4',true],['0.2.1-rc.5',true],['0.2.2-rc.1',true],['0.2.1-rc.6',false],['0.2.1',false],['0.2.2-rc.2',false],['0.2.2-alpha.2',false],['0.2.2-alpha.3',false],['0.2.2-alpha.4',false]]){const checks=await runtimePreflight({dshHome:home,platform:'darwin',nodeVersion:'24.21.0',checkSdk:async()=>version,checkPython:async()=>{}});assert.equal(checks.find(row=>row.id==='sdk').ok,expected,version);}
});
test('SDK-specific Node floors preserve legacy Node22 while rejecting rc.1 on an older runtime',async t=>{
 const home=await realpath(await mkdtemp(join(tmpdir(),'dot-sdk-node-floor-')));t.after(()=>rm(home,{recursive:true,force:true}));await mkdir(join(home,'profiles','desktop'),{recursive:true});await mkdir(join(home,'storages'));
 for(const [sdk,nodeVersion,ok]of [['0.2.1-rc.5','22.14.0',false],['0.2.1-rc.5','22.15.0',true],['0.2.1-rc.5','24.22.2',true],['0.2.2-rc.1','22.22.0',false],['0.2.2-rc.1','24.8.9',false],['0.2.2-rc.1','24.9.0',true],['0.2.2-rc.1','24.22.2',true]]){
  const checks=await runtimePreflight({dshHome:home,platform:'darwin',nodeVersion,checkSdk:async()=>sdk,checkPython:async()=>{}});assert.equal(checks.find(row=>row.id==='node').ok,ok,sdk+' '+nodeVersion);
 }
});
