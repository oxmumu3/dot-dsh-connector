import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,readFile,writeFile,stat,symlink,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createFileStore} from '../src/store.js';
async function fixture(t){const root=await realpath(await mkdtemp(join(tmpdir(),'dot-store-')));t.after(()=>rm(root,{recursive:true,force:true}));return root;}
test('durable store is private, exclusive and survives clean reopen',async t=>{
 const root=await fixture(t),dir=join(root,'state');const store=await createFileStore(dir);t.after(()=>store.close());
 assert.equal(await store.load(),null);await store.save({version:1,jobs:[]});
 assert.equal((await stat(join(dir,'state.json'))).mode&0o777,0o600);
 await assert.rejects(createFileStore(dir),/locked/);await store.close();
 const again=await createFileStore(dir);assert.deepEqual(await again.load(),{version:1,jobs:[]});await again.close();
});
test('corrupt state and symlink state are never overwritten by load',async t=>{
 const root=await fixture(t),dir=join(root,'state');const store=await createFileStore(dir);await store.close();
 await writeFile(join(dir,'state.json'),'broken');
 const broken=await createFileStore(dir);await assert.rejects(broken.load());await broken.close();assert.equal(await readFile(join(dir,'state.json'),'utf8'),'broken');
 await rm(join(dir,'state.json'));await writeFile(join(root,'outside'),'secret');await symlink(join(root,'outside'),join(dir,'state.json'));
 const linked=await createFileStore(dir);await assert.rejects(linked.load());await linked.close();assert.equal(await readFile(join(root,'outside'),'utf8'),'secret');
});
test('all 100 maximum public task/result records fit durable storage',async t=>{
 const root=await fixture(t),store=await createFileStore(join(root,'state'));t.after(()=>store.close());
 const state={version:1,jobs:Array.from({length:100},(_,i)=>({job_id:`job_${i}`,task:'山'.repeat(2000),result:'山'.repeat(8000),context_sources:Array.from({length:6},()=>({path:'文'.repeat(300),sha256:'a'.repeat(64)}))}))};
 await store.save(state);assert.deepEqual(await store.load(),state);await store.close();
});
