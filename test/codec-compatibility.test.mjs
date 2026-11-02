import '../scripts/ci/preload.mjs';
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import {mkdtemp,mkdir,writeFile,readFile,realpath,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {publicCodecFixture} from '../scripts/ci/codec-fixture.mjs';
const carrier=process.env.DSH_TEST_SDK_ROOT;
assert.ok(carrier,'An explicitly acquired public SDK carrier is required; never read installed Desktop');
const dependencyRoot=join(carrier,'node_modules'),sdk=JSON.parse(await readFile(join(dependencyRoot,'@deepseek-ai/dsh-session-format-v0-to-v1/package.json'))).version;
const base=await realpath(await mkdtemp(join(tmpdir(),'public-management-codecs-')));after(()=>rm(base,{recursive:true,force:true}));
// The sole seam replaces the physical public distribution file. Product loader,
// dependency-graph validation, official codecs and descriptor-safe reads stay real.
let selected;const originalOpen=fs.open;
fs.open=(path,...args)=>{if(String(path)==='/Applications/DeepSeek Harness.app/Contents/Resources/app.asar'){assert.ok(selected);return originalOpen(selected,...args);}return originalOpen(path,...args);};syncBuiltinESMExports();
after(()=>{fs.open=originalOpen;syncBuiltinESMExports();});
const {createHarnessStorage}=await import(process.env.DSH_TEST_CODEC_MODULE?pathToFileURL(process.env.DSH_TEST_CODEC_MODULE).href:new URL('../src/harness-storage.js',import.meta.url).href);
async function fixture(variant){
 const home=join(base,variant),project=join(home,'project'),id='synthetic-session';
 for(const path of ['storages','sessions/--fixture--/'+id,'project'])await mkdir(join(home,path),{recursive:true});
 await writeFile(join(home,'storages/workspace.json'),JSON.stringify({unit:{name:'workspace',version:2},global:{initialized:true,workspaceIds:['w1'],archivedSessionIds:[],pinnedSessionIds:[]},tables:{workspaces:{w1:{path:project,title:'Synthetic',sessionIds:[id],createdAt:'2026-11-01T00:00:00Z',updatedAt:'2026-11-01T00:00:00Z'}}}}));
 await writeFile(join(home,'sessions/--fixture--/'+id+'/session.v4.jsonl'),JSON.stringify({type:'session',version:4,id,createdAt:1,cwd:project,delegationDepth:0,isSeeded:false})+'\n'+JSON.stringify({seq:0,time:2,type:'user/message',data:{turn:'t1',message:{id:'m1',source:{kind:'user'},content:[{type:'text',text:'Synthetic public codec record'}]}}})+'\n');
 selected=join(base,variant+'.asar');const provenance=await publicCodecFixture({dependencyRoot,sdk,output:selected,variant});
 return{adapter:createHarnessStorage({dshHome:home}),project,provenance};
}
for(const variant of ['exact','nested-exact'])test('actual official SDK codecs decode synthetic persisted headers and message pages: '+variant,async()=>{
 const {adapter,project,provenance}=await fixture(variant);try{
  const sessions=await adapter.rpc('session/list',{_request:{}});assert.equal(sessions.items.length,1);assert.equal(sessions.items[0].sessionId,'synthetic-session');assert.equal(sessions.items[0].cwd,project);
  const page=await adapter.rpc('session/page',{request:{address:{kind:'session',sessionId:'synthetic-session'},throughSeq:0,maxMessages:1}});assert.equal(page.records.length,1);assert.equal(page.records[0].event.data.message.content[0].text,'Synthetic public codec record');assert.equal(page.persisted_snapshot.live_memory_included,false);assert.equal(provenance.privateStateIncluded,false);
 }finally{await adapter.close();}
});
for(const variant of ['unknown','mixed','nested-unknown','nested-mixed'])test('codec loader rejects '+variant+' SDK metadata before decoding persisted records',async()=>{
 const {adapter,provenance}=await fixture(variant);try{assert.ok(provenance.metadataOnlyChanges.length);await assert.rejects(adapter.rpc('session/list',{_request:{}}),{code:'HARNESS_UNAVAILABLE'});}finally{await adapter.close();}
});
