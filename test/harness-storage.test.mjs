import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath,symlink,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {zstdCompressSync} from 'node:zlib';
let implementation;
try{implementation=await import('../src/harness-storage.js');}catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;}
const create=options=>{assert.equal(typeof implementation?.createHarnessStorage,'function','Readonly storage adapter must exist');const adapter=implementation.createHarnessStorage(options);const rpc=adapter.rpc;adapter.rpc=async(...args)=>{try{return await rpc(...args);}catch(error){if(process.env.HARNESS_FIXTURE_DIAGNOSTIC){for(let cause=error;cause;cause=cause.cause)console.error(cause.stack);}throw error;}};return adapter;};
async function fixture(t){
 const home=await realpath(await mkdtemp(join(tmpdir(),'dot-dsh-storage-test-')));t.after(()=>rm(home,{recursive:true,force:true}));
 for(const name of ['storages','sessions','memory','skills','project'])await mkdir(join(home,name));
 await writeFile(join(home,'storages/workspace.json'),JSON.stringify({unit:{name:'workspace',version:2},global:{initialized:true,workspaceIds:['w1'],archivedSessionIds:[],pinnedSessionIds:[]},tables:{workspaces:{w1:{path:join(home,'project'),title:'Fixture project',sessionIds:['s1','old'],createdAt:'2026-10-19T00:00:00Z',updatedAt:'2026-10-19T00:01:00Z'}}}}));
 async function session(id,version=4,events=[],options={}){
  const path=join(home,'sessions','--fixture--',id);await mkdir(path,{recursive:true});
  const header={type:'session',version,id,createdAt:1,cwd:join(home,'project'),delegationDepth:0,...(version>=2?{isSeeded:false}:{}),...options.header};
  const lines=[header,...events].map(value=>JSON.stringify(value)+'\n');
  let bytes=options.zstd?Buffer.concat(lines.map(value=>zstdCompressSync(Buffer.from(value)))):Buffer.from(lines.join(''));
  if(options.tail)bytes=Buffer.concat([bytes,Buffer.from(options.tail)]);
  const file=join(path,`session${version?'.v'+version:''}.jsonl${options.zstd?'.zstd':''}`);await writeFile(file,bytes);return file;
 }
 return{home,session};
}
const event=(seq,type,data)=>({seq,time:seq+2,type,data});
const user=(seq,text)=>event(seq,'user/message',{turn:'turn1',message:{id:'m'+seq,source:{kind:'user'},content:[{type:'text',text}]}});

test('workspace registry and exact memory/skills virtual roots use only persisted read metadata',async t=>{
 const f=await fixture(t),adapter=create({dshHome:f.home});t.after(()=>adapter.close());
 const result=await adapter.rpc('workspace/baseline',{});
 assert.deepEqual(result.items.map(item=>item.workspaceId),['w1','harness-memory','harness-skills']);assert.equal(result.items[0].path,join(f.home,'project'));assert.equal(result.items[1].path,join(f.home,'memory'));assert.equal(result.items[1].sessionIds.length,0);assert.deepEqual(result.items.map(item=>item.taskAvailable),[true,false,false]);
});
test('session list decodes only released headers and does not parse message bodies',async t=>{
 const f=await fixture(t);await f.session('s1',4,[],{tail:'bad committed body\n'});await f.session('old',0,[],{zstd:true});
 const adapter=create({dshHome:f.home});t.after(()=>adapter.close());const result=await adapter.rpc('session/list',{_request:{}});
 assert.equal(result.items.length,2);assert.ok(result.items.every(item=>!Object.hasOwn(item,'agentAvailable')&&!Object.hasOwn(item,'running')&&!Object.hasOwn(item,'blank')));
});
test('real official pure codecs read v0 and v4 history without migration or writes',async t=>{
 const previousAsarSetting=process.noAsar;
 const f=await fixture(t),events=[event(0,'session/title',{title:'Fixture title'}),user(1,'hello'),event(2,'assistant/message',{turn:'turn1',step:'step1',message:{id:'a2',content:[{type:'text',text:'answer'}]}})];
 const current=await f.session('s1',4,events,{zstd:true});const old=await f.session('old',0,[user(0,'legacy')],{zstd:true});
 const before=await Promise.all([readFile(current),readFile(old)]);const adapter=create({dshHome:f.home});t.after(()=>adapter.close());
 for(const id of ['s1','old']){
  const projection=await adapter.rpc('session/projections',{request:{sessionId:id}});assert.equal(projection.kind,'sequenced');
  const result=await adapter.rpc('session/page',{request:{address:{kind:'session',sessionId:id},throughSeq:projection.asOfSeq,maxMessages:1}});
  assert.equal(result.records.at(-1).event.data.message.content[0].text,id==='s1'?'answer':'legacy');
 }
 assert.deepEqual(await Promise.all([readFile(current),readFile(old)]),before);
 assert.equal(process.noAsar,previousAsarSetting,'Archive loading must not change Electron global ASAR behavior');
});
test('fresh committed append is visible and pagination is a decreasing exclusive sequence cut',async t=>{
 const f=await fixture(t);const file=await f.session('s1',4,[user(0,'one'),user(1,'two'),user(2,'three')]);const adapter=create({dshHome:f.home});t.after(()=>adapter.close());
 const page=await adapter.rpc('session/page',{request:{address:{kind:'session',sessionId:'s1'},throughSeq:2,maxMessages:1}});assert.equal(page.records[0].event.seq,2);assert.equal(page.hasMore,true);
 const older=await adapter.rpc('session/page',{request:{address:{kind:'session',sessionId:'s1'},throughSeq:2,beforeSeq:2,maxMessages:1}});assert.equal(older.records[0].event.seq,1);
 await writeFile(file,JSON.stringify(user(3,'four'))+'\n',{flag:'a'});assert.equal((await adapter.rpc('session/projections',{request:{sessionId:'s1'}})).asOfSeq,3);
});
test('torn final plaintext or zstd append is omitted without repair and clearly identified',async t=>{
 const f=await fixture(t);const file=await f.session('s1',4,[user(0,'one')],{tail:'{"type":"user/message"'});await f.session('old',0,[user(0,'old')],{zstd:true,tail:zstdCompressSync(Buffer.from(JSON.stringify(user(1,'incomplete'))+'\n')).subarray(0,9)});
 const before=await readFile(file),adapter=create({dshHome:f.home});t.after(()=>adapter.close());
 for(const id of ['s1','old']){const result=await adapter.rpc('session/projections',{request:{sessionId:id}});assert.equal(result.asOfSeq,0);assert.equal(result.persisted_snapshot.torn_tail_omitted,true);}
 assert.deepEqual(await readFile(file),before);
});
test('unknown methods, named arguments, foreign child addresses and missing ids fail closed',async t=>{
 const f=await fixture(t);await f.session('s1',4,[user(0,'one')]);const adapter=create({dshHome:f.home});t.after(()=>adapter.close());
 for(const [method,args]of [['session/prompt',{}],['session/list',{request:{}}],['session/projections',{request:{sessionId:'missing'}}],['session/page',{request:{address:{kind:'subagent',parentSessionId:'evil',childSessionId:'s1',mode:'unknown'},throughSeq:0,maxMessages:1}}]])await assert.rejects(adapter.rpc(method,args));
});
test('symlink session directories, linked generation files and noncanonical home are denied',async t=>{
 const f=await fixture(t);const file=await f.session('s1',4,[user(0,'one')]);const outside=join(f.home,'external');await mkdir(outside);await symlink(outside,join(f.home,'sessions','--fixture--','linked'));
 const adapter=create({dshHome:f.home});t.after(()=>adapter.close());assert.equal((await adapter.rpc('session/list',{_request:{}})).items.length,1);
 await rm(file);await symlink(join(f.home,'storages/workspace.json'),file);await assert.rejects(adapter.rpc('session/projections',{request:{sessionId:'s1'}}));
 const linked=join(f.home,'alias');await symlink(f.home,linked);const invalid=create({dshHome:linked});t.after(()=>invalid.close());await assert.rejects(invalid.rpc('workspace/baseline',{}));
});

 test('listing uses lifecycle-bound title cache only and never leaks unknown cache projections',async t=>{
 const f=await fixture(t);await f.session('s1',4,[]);await mkdir(join(f.home,'storages/session_projcache/sessions'),{recursive:true});
 const cache=join(f.home,'storages/session_projcache/sessions/s1.json');
 await writeFile(cache,JSON.stringify({version:7,record:{identity:{formatVersion:4,createdAt:1,cwd:join(f.home,'project'),isSeeded:false,inheritedEventCount:0},rows:{title:{ver:1,seq:9,val:'Cached title'},inbox:{ver:1,seq:9,val:'private secret'}}}}));
 const adapter=create({dshHome:f.home});t.after(()=>adapter.close());
 const result=await adapter.rpc('session/list',{_request:{}});assert.equal(result.items[0].projections.values.title,'Cached title');assert.ok(!JSON.stringify(result).includes('private secret'));
 await writeFile(cache,JSON.stringify({version:7,record:{identity:{formatVersion:4,createdAt:2,cwd:join(f.home,'project'),isSeeded:false},rows:{title:{ver:1,seq:9,val:'Foreign lifecycle'}}}}));
 assert.equal((await adapter.rpc('session/list',{_request:{}})).items[0].projections,undefined);
 });

 test('seeded fork reads its physically copied prefix and explicitly reports inheritance without loading parent',async t=>{
 const f=await fixture(t);await f.session('fork',0,[user(0,'copied parent message'),user(1,'own fork message')],{header:{seedLength:1,parentSession:'absent-parent'}});
 const adapter=create({dshHome:f.home});t.after(()=>adapter.close());
 const projection=await adapter.rpc('session/projections',{request:{sessionId:'fork'}});
 assert.equal(projection.persisted_snapshot.inherited_event_count,1);assert.equal(projection.persisted_snapshot.includes_inherited_events,true);assert.equal(projection.persisted_snapshot.live_memory_included,false);
 const page=await adapter.rpc('session/page',{request:{address:{kind:'session',sessionId:'fork'},throughSeq:1,maxMessages:10}});
 assert.equal(page.records.length,2);assert.equal(page.persisted_snapshot.history_semantics,'persisted_source_log');
 });

test('approved legacy whole-unit cache supplies lifecycle-bound title hints without rewriting the newer cache tree',async t=>{
 const f=await fixture(t);await f.session('s1',4,[]);await mkdir(join(f.home,'storages/session_projcache/sessions'),{recursive:true});
 await writeFile(join(f.home,'storages/session_projcache/sessions/other.json'),JSON.stringify({version:7,record:{identity:{createdAt:999},rows:{}}}));
 const file=join(f.home,'storages/session_projcache.json'),body=JSON.stringify({unit:{name:'session_projcache',version:3},global:null,tables:{sessions:{s1:{identity:{createdAt:1,cwd:join(f.home,'project')},rows:{title:{ver:1,seq:8,val:'Legacy searchable title'},inbox:{ver:1,seq:8,val:'MUST_NOT_APPEAR'}}}}}});
 await writeFile(file,body);const adapter=create({dshHome:f.home});t.after(()=>adapter.close());
 const result=await adapter.rpc('session/list',{_request:{}});assert.equal(result.items[0].projections?.values.title,'Legacy searchable title');assert.equal(result.items[0].title_source,'legacy_cache_hint');assert.ok(!JSON.stringify(result).includes('MUST_NOT_APPEAR'));assert.equal(await readFile(file,'utf8'),body);
});
test('title-only predecessor hints allow missing formatVersion but reject foreign lifecycles and future formats',async t=>{
 const f=await fixture(t);await f.session('s1',4,[]);await mkdir(join(f.home,'storages/session_projcache/sessions'),{recursive:true});const file=join(f.home,'storages/session_projcache/sessions/s1.json');
 const value={version:7,record:{identity:{createdAt:1,cwd:join(f.home,'project')},rows:{title:{ver:1,seq:3,val:'Predecessor title'}}}};await writeFile(file,JSON.stringify(value));
 const adapter=create({dshHome:f.home});t.after(()=>adapter.close());assert.equal((await adapter.rpc('session/list',{_request:{}})).items[0].projections?.values.title,'Predecessor title');
 value.record.identity.createdAt=2;await writeFile(file,JSON.stringify(value));assert.equal((await adapter.rpc('session/list',{_request:{}})).items[0].projections,undefined);
 value.record.identity.createdAt=1;value.record.identity.formatVersion=5;await writeFile(file,JSON.stringify(value));assert.equal((await adapter.rpc('session/list',{_request:{}})).items[0].projections,undefined);
});
test('physical user/assistant events with official string append operations obey exact page limits without losing older messages',async t=>{
 const f=await fixture(t);const events=Array.from({length:17},(_,seq)=>({...user(seq,'message '+seq),surfaceOp:'append'}));await f.session('s1',4,events);
 const adapter=create({dshHome:f.home});t.after(()=>adapter.close());let beforeSeq;const seen=[];
 for(let index=0;index<4;index++){
  const result=await adapter.rpc('session/page',{request:{address:{kind:'session',sessionId:'s1'},throughSeq:16,...beforeSeq===undefined?{}:{beforeSeq},maxMessages:5}});
  const messages=result.records.filter(row=>['user/message','assistant/message'].includes(row.event.type));assert.ok(messages.length<=5);seen.push(...messages.map(row=>row.event.seq));
  if(!result.hasMore)break;beforeSeq=result.records[0].event.seq;
 }
 assert.equal(seen.length,17);assert.equal(new Set(seen).size,17);assert.deepEqual(seen.slice().sort((a,b)=>a-b),Array.from({length:17},(_,i)=>i));
});

test('installed manifest inventory exposes only package names and plain semver with no live-state inference',async t=>{
 const f=await fixture(t);await mkdir(join(f.home,'profiles/desktop'),{recursive:true});
 await writeFile(join(f.home,'profiles/desktop/package.json'),JSON.stringify({dependencies:{'@deepseek-ai/public-test':'0.2.1-rc.2','owner-plugin':'file:/private/not-exported?token=DO_NOT_EXPOSE','another-plugin':'^1.2.3'},scripts:{start:'DO_NOT_EXPOSE'},api_key:'DO_NOT_EXPOSE'}));
 const adapter=create({dshHome:f.home});t.after(()=>adapter.close());const result=await adapter.rpc('pluginInventory/list',{});
 assert.equal(result.source,'persisted_manifest');assert.deepEqual(result.entries.map(entry=>entry.moduleName),['@deepseek-ai/public-test','another-plugin','owner-plugin']);
 assert.equal(result.entries[0].meta.version,'0.2.1-rc.2');assert.equal(result.entries[1].meta,undefined);assert.ok(result.entries.every(entry=>!Object.hasOwn(entry,'enabled')&&!Object.hasOwn(entry,'fiberPhase')));assert.ok(!JSON.stringify(result).includes('DO_NOT_EXPOSE'));assert.ok(!JSON.stringify(result).includes('/private'));
});

test('trusted extra canonical roots append metadata with explicit context kinds without changing the original registry',async t=>{
 const f=await fixture(t);const skill=join(f.home,'one-skill'),instructions=join(f.home,'instructions');await mkdir(skill);await mkdir(instructions);
 const registry=join(f.home,'storages/workspace.json'),before=await readFile(registry);
 const extraWorkspaces=[{workspaceId:'global-skill-one',path:skill,title:'One skill',contextKind:'skill',sessionIds:[]},{workspaceId:'global-instructions',path:instructions,title:'Instructions',contextKind:'instructions',sessionIds:[]}];
 const adapter=create({dshHome:f.home,extraWorkspaces});t.after(()=>adapter.close());extraWorkspaces[0].path='/untrusted-later-mutation';
 const result=await adapter.rpc('workspace/baseline',{});assert.equal(result.items.length,5);assert.equal(result.items[3].path,skill);assert.equal(result.items[3].contextKind,'skill');assert.equal(result.items[4].contextKind,'instructions');assert.deepEqual(result.items[3].sessionIds,[]);assert.deepEqual(await readFile(registry),before);
});
test('extra workspace inputs reject foreign fields, duplicate ids or paths, sessions and unsupported roots',async t=>{
 const f=await fixture(t),base={workspaceId:'global-skill',path:join(f.home,'project'),title:'Skill',contextKind:'skill',sessionIds:[]};
 for(const extraWorkspaces of [[{...base,config:'not allowed'}],[base,{...base,path:join(f.home,'memory')}],[base,{...base,workspaceId:'other'}],[{...base,sessionIds:['s1']}],[{...base,contextKind:'arbitrary'}],[{...base,path:'relative'}],[{...base,path:f.home+'/../outside'}],Array.from({length:101},(_,i)=>({...base,workspaceId:'extra-'+i,path:f.home+'/extra-'+i}))])assert.throws(()=>create({dshHome:f.home,extraWorkspaces}));
 const collision=create({dshHome:f.home,extraWorkspaces:[{...base,workspaceId:'w1'}]});t.after(()=>collision.close());await assert.rejects(collision.rpc('workspace/baseline',{}));
 const linked=join(f.home,'linked-skill');await symlink(join(f.home,'skills'),linked);const noncanonical=create({dshHome:f.home,extraWorkspaces:[{...base,path:linked}]});t.after(()=>noncanonical.close());await assert.rejects(noncanonical.rpc('workspace/baseline',{}));
});
