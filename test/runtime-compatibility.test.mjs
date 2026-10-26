import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runtimePreflight} from '../management-plugin/src/setup-runtime.js';
test('runtime preflight accepts verified rc.2 and rc.3, and rejects unverified runtimes',async t=>{
 const home=await realpath(await mkdtemp(join(tmpdir(),'dot-rc3-synthetic-')));t.after(()=>rm(home,{recursive:true,force:true}));await mkdir(join(home,'profiles','desktop'),{recursive:true});await mkdir(join(home,'storages'));
 for(const [version,expected]of [['0.2.1-rc.2',true],['0.2.1-rc.3',true],['0.2.1-rc.4',false],['0.2.1',false]]){const checks=await runtimePreflight({dshHome:home,platform:'darwin',nodeVersion:'24.21.0',checkSdk:async()=>version,checkPython:async()=>{}});assert.equal(checks.find(row=>row.id==='sdk').ok,expected,version);}
});
