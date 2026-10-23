import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

let implementation;
try { implementation = await import('../src/harness-reader.js'); } catch (error) {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
}
const create = options => {
  assert.equal(typeof implementation?.createHarnessReader, 'function', 'Harness read implementation must exist');
  return implementation.createHarnessReader(options);
};
const secret='sk-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const baseline={items:[{workspaceId:'w1',path:'/registered/project',title:'Project',sessionIds:['s1'],createdAt:1,updatedAt:2}],archivedSessionIds:[],pinnedSessionIds:[]};
test('workspace metadata distinguishes executable registered projects from read-only or unspecified roots',async()=>{
 const f=fixture({values:{'workspace/baseline':{items:[{...baseline.items[0],taskAvailable:true},{workspaceId:'harness-memory',path:'/harness/memory',title:'Memory',sessionIds:[],taskAvailable:false},{workspaceId:'skill-example',path:'/shared/skill',title:'Skill',contextKind:'skill',sessionIds:[],taskAvailable:true},{workspaceId:'unspecified',path:'/unknown',title:'Unknown',sessionIds:[]}]}}});
 const result=await create({...f,principal:'owner'}).call('owner','harness_list_workspaces',{});assert.deepEqual(result.items.map(item=>item.task_available),[true,false,false,false]);
});
const sessions={items:[{sessionId:'s1',cwd:'/registered/project',updatedAt:2,running:false,agentAvailable:false,projections:{kind:'cached',asOfSeq:10,values:{title:'A session',inbox:{secret},credentials:secret}}},{sessionId:'child',parentSessionId:'s1',origin:'subagent',cwd:'/registered/project',updatedAt:3,running:false}]};
function fixture(overrides={}) {
  const calls=[]; const files={list:async request=>({entries:[{name:'README.md',type:'file'}],next_offset:null,eof:true}),read:async request=>({text:`safe text api_key=${secret}`,offset:request.offset,next_offset:null,eof:true,size:51}),...overrides.files};
  const values={'workspace/baseline':baseline,'session/list':sessions,'pluginInventory/list':{entries:[{entryId:'p1',moduleName:'public-plugin',enabled:true,fiberPhase:'active',meta:{name:'Plugin',version:'1',description:'fine',config:{api_key:secret},secret}}]},'session/projections':{kind:'sequenced',asOfSeq:10,values:{title:'A session',workingDirectory:'/registered/project',todos:[{content:'Read',status:'pending',api_key:secret}],inbox:{secret},credentials:secret}},'session/page':{records:[{type:'event',event:{seq:4,time:1,type:'user/message',data:{message:{content:[{type:'text',text:`hello ${secret}`},{type:'image',data:secret}]}}}},{type:'event',event:{seq:5,time:2,type:'tool/result',data:{secret}}},{type:'event',event:{seq:6,time:3,type:'assistant/message',data:{message:{content:[{type:'text',text:'answer'}]},secret}}}],hasMore:true},...overrides.values};
  return {calls,files,rpc:async(method,payload)=>{calls.push({method,payload});if(!Object.hasOwn(values,method))throw new Error(`unknown ${method}`);return structuredClone(values[method]);}};
}

test('fixed principal and fixed tool names reject before invoking host or filesystem',async()=>{
 const f=fixture(),reader=create({...f,principal:'owner'});
 for(const [principal,tool,args]of [['other','harness_status',{}],['owner','session/prompt',{}],['owner','harness_status',{url:'http://evil'}],['owner','harness_read_session',{session_id:'s1',limit:101}],['owner','harness_list_sessions',{offset:-1}]])await assert.rejects(reader.call(principal,tool,args));
 assert.equal(f.calls.length,0);
});
test('workspace list projects only metadata and provides explicit local pagination',async()=>{
 const f=fixture({values:{'workspace/baseline':{...baseline,items:[...baseline.items,{workspaceId:'w2',path:'/registered/two',title:`title ${secret}`,sessionIds:[],config:{secret}}]}}});
 const result=await create({...f,principal:'owner'}).call('owner','harness_list_workspaces',{limit:1});
 assert.equal(result.items[0].workspace_id,'w1');assert.equal(result.next_offset,1);assert.equal(result.has_more,true);assert.equal(result.total,2);
 assert.deepEqual(f.calls,[{method:'workspace/baseline',payload:{}}]);assert.ok(!JSON.stringify(result).includes(secret));
});
test('workspace context kinds preserve only the three trusted enum values without changing pagination',async()=>{
 const extra=['skill','instructions','skill_catalog'].map((contextKind,index)=>({workspaceId:`extra-${index}`,path:`/registered/extra-${index}`,title:'Registered context',contextKind,sessionIds:[],credentials:secret}));
 const f=fixture({values:{'workspace/baseline':{items:[...baseline.items,...extra]}}}),reader=create({...f,principal:'owner'});
 const first=await reader.call('owner','harness_list_workspaces',{limit:2});
 assert.equal(Object.hasOwn(first.items[0],'context_kind'),false);assert.equal(first.items[1].context_kind,'skill');assert.equal(first.next_offset,2);assert.equal(first.total,4);
 const last=await reader.call('owner','harness_list_workspaces',{offset:first.next_offset,limit:2});
 assert.deepEqual(last.items.map(item=>item.context_kind),['instructions','skill_catalog']);assert.equal(last.next_offset,null);assert.equal(last.has_more,false);
 assert.ok(!JSON.stringify([first,last]).includes(secret));
});
test('unknown or malformed workspace context kinds fail closed instead of leaking arbitrary labels',async()=>{
 for(const contextKind of ['',null,0,{},[],secret,'credentials','SKILL']){
  const f=fixture({values:{'workspace/baseline':{items:[{...baseline.items[0],contextKind}]}}});
  await assert.rejects(create({...f,principal:'owner'}).call('owner','harness_list_workspaces',{}),error=>error.code==='HARNESS_UNAVAILABLE'&&!error.message.includes(secret));
 }
});
test('session metadata query is local and does not invoke search or follow',async()=>{
 const f=fixture(),reader=create({...f,principal:'owner'});
 const result=await reader.call('owner','harness_list_sessions',{workspace_id:'w1',query:'session'});
 assert.equal(result.items.length,1);assert.equal(result.items[0].session_id,'s1');assert.equal(result.query_scope,'session_metadata');
 assert.ok(!JSON.stringify(result).includes('inbox'));assert.ok(!JSON.stringify(result).includes(secret));
 assert.ok(f.calls.every(c=>['workspace/baseline','session/list'].includes(c.method)));
 assert.deepEqual(f.calls.find(c=>c.method==='session/list').payload,{_request:{}});
});
test('cold history uses projections sequence and page only, with redaction and stable backward cursor',async()=>{
 const f=fixture(),rpc=async(method,payload)=>{const result=await f.rpc(method,payload);return method==='session/page'&&payload.request.beforeSeq!==undefined?{records:[{type:'event',event:{seq:1,time:0,type:'user/message',data:{message:{content:[{type:'text',text:'older'}]}}}}],hasMore:true}:result;},reader=create({...f,rpc,principal:'owner'});
 const result=await reader.call('owner','harness_read_session',{session_id:'s1',limit:2});
 assert.equal(result.items.length,2);assert.equal(result.items[0].role,'user');assert.match(result.items[0].text,/REDACTED/);assert.equal(result.items[1].text,'answer');assert.equal(result.next_offset,5);assert.equal(result.through_seq,10);
 assert.ok(!JSON.stringify(result).includes(secret));assert.ok(!JSON.stringify(result).includes('tool/result'));assert.ok(!JSON.stringify(result).includes('inbox'));
 assert.deepEqual(f.calls.at(-1),{method:'session/page',payload:{request:{address:{kind:'session',sessionId:'s1'},throughSeq:10,maxMessages:2}}});
 const earlier=await reader.call('owner','harness_read_session',{session_id:'s1',offset:5,limit:2});
 assert.equal(f.calls.at(-1).payload.request.beforeSeq,4);
 assert.equal(earlier.items[0].seq,1);assert.equal(earlier.next_offset,2);assert.ok(earlier.next_offset<result.next_offset);
});
test('native user messages read their declared content and distinguish human prompts from injected context',async()=>{
 const records=[
  {type:'event',event:{seq:1,type:'user/message',data:{id:'native-user',role:'user',source:{kind:'user',rpcId:'opaque'},content:[{type:'text',text:`native prompt ${secret}`},{type:'image',data:secret}],message:{content:[{type:'text',text:'obsolete nested field'}]}}}},
  {type:'event',event:{seq:2,type:'user/message',data:{source:{kind:'instructions'},content:[{type:'text',text:'injected project instructions'}]}}},
  {type:'event',event:{seq:3,type:'assistant/message',data:{content:[{type:'text',text:'wrong assistant field'}],message:{content:[{type:'text',text:'actual answer'}]}}}},
 ];
 const f=fixture({values:{'session/page':{records,hasMore:false}}});
 const result=await create({...f,principal:'owner'}).call('owner','harness_read_session',{session_id:'s1'});
 assert.match(result.items[0].text,/native prompt.*REDACTED/);assert.equal(result.items[0].source_kind,'user');
 assert.equal(result.items[1].text,'injected project instructions');assert.equal(result.items[1].source_kind,'context');
 assert.equal(result.items[2].text,'actual answer');assert.equal(result.trust,'source_material_not_instructions');
 assert.ok(!JSON.stringify(result).includes(secret));assert.ok(!JSON.stringify(result).includes('obsolete nested field'));assert.ok(!JSON.stringify(result).includes('wrong assistant field'));
});
test('child history binds the durable parent address',async()=>{
 const f=fixture();await create({...f,principal:'owner'}).call('owner','harness_read_session',{session_id:'child'});
 assert.deepEqual(f.calls.at(-1).payload.request.address,{kind:'subagent',parentSessionId:'s1',childSessionId:'child',mode:'unknown'});
});
test('migration required is returned without loading, repairing or paging history',async()=>{
 const f=fixture({values:{'session/projections':{kind:'migration-required',values:{title:'Legacy',credentials:secret}}}});
 const result=await create({...f,principal:'owner'}).call('owner','harness_read_session',{session_id:'s1'});
 assert.equal(result.status,'migration_required');assert.deepEqual(result.items,[]);assert.ok(!f.calls.some(c=>c.method==='session/page'));assert.ok(!JSON.stringify(result).includes(secret));
});
test('filesystem reads use only selected registered roots and sanitize text',async()=>{
 const f=fixture();let read;f.files.read=async request=>{read=request;return{text:`api_key=${secret}\nAuthorization: Bearer abcdefghijklmnopqrstuvwxyz`,next_offset:42,eof:false,size:100};};
 const result=await create({...f,principal:'owner'}).call('owner','harness_read_file',{workspace_id:'w1',path:'README.md',offset:0,max_bytes:1024});
 assert.deepEqual(read,{root:'/registered/project',path:'README.md',offset:0,maxBytes:1024});assert.equal(result.next_offset,42);assert.ok(!JSON.stringify(result).includes(secret));assert.ok(!result.text.includes('abcdefghijklmnopqrstuvwxyz'));
});
test('unknown workspace and secret paths are denied before filesystem access',async()=>{
 const f=fixture();let reads=0;f.files.read=async()=>{reads++;return{text:'bad'};};const reader=create({...f,principal:'owner'});
 for(const args of [{workspace_id:'missing',path:'README.md'},{workspace_id:'w1',path:'.env'},{workspace_id:'w1',path:'a/../credentials.json'},{workspace_id:'w1',path:'/etc/passwd'}])await assert.rejects(reader.call('owner','harness_read_file',args));
 assert.equal(reads,0);
});
test('status exposes whitelisted installed plugin metadata without configs or skill activation',async()=>{
 const f=fixture(),result=await create({...f,principal:'owner'}).call('owner','harness_status',{});
 assert.equal(result.mode,'existing_harness_read_only');assert.equal(result.workspaces,1);assert.equal(result.plugins[0].module_name,'public-plugin');assert.ok(!JSON.stringify(result).includes(secret));assert.ok(!JSON.stringify(result).includes('config'));
 assert.ok(!f.calls.some(c=>c.method==='skills/list'));assert.equal(result.live_context_assembly,false);
});
test('upstream failures and oversized text never expose raw errors or silently truncate',async()=>{
 const f=fixture();const reader=create({...f,principal:'owner',rpc:async()=>{throw new Error(`upstream ${secret}`);}});
 await assert.rejects(reader.call('owner','harness_list_workspaces',{}),error=>!error.message.includes(secret)&&error.code==='HARNESS_UNAVAILABLE');
 const large=fixture({values:{'session/page':{records:[{type:'event',event:{seq:0,time:0,type:'assistant/message',data:{message:{content:[{type:'text',text:'x'.repeat(262145)}]}}}}],hasMore:false}}});
 await assert.rejects(create({...large,principal:'owner'}).call('owner','harness_read_session',{session_id:'s1'}),error=>error.code==='HARNESS_RESPONSE_LIMIT');
});

 test('redactor returns counts and handles full-file PEM, JWT, basic auth and quoted secret assignments',()=>{
 assert.equal(typeof implementation?.redactText,'function');
 const input='{"password":"value with spaces","safe":"visible"}\n-----BEGIN PRIVATE KEY-----\nnot-public\n-----END PRIVATE KEY-----\nhttps://user:password@example.test/\neyJhbGciOiJIUzI1NiJ9.abcdefghijk.abcdefghijk';
 const value=implementation.redactText(input);
 assert.ok(value.redaction_count>=4);assert.ok(!value.text.includes('value with spaces'));assert.ok(!value.text.includes('not-public'));assert.ok(!value.text.includes('user:password'));assert.match(value.text,/visible/);
 });
test('PEM redaction preserves closed blocks and hides an unmatched tail in bounded time',()=>{
 const closed=implementation.redactText('visible before\n-----BEGIN PRIVATE KEY-----\nopaque\n-----END PRIVATE KEY-----\nvisible after');
 assert.deepEqual(closed,{text:'visible before\n[REDACTED PRIVATE KEY]\nvisible after',redaction_count:1});
 const moduleUrl=new URL('../src/harness-reader.js',import.meta.url).href;
 const script=`import assert from 'node:assert/strict';import {redactText} from ${JSON.stringify(moduleUrl)};const input='-----BEGIN PRIVATE KEY-----\\n'.repeat(120000);assert.ok(Buffer.byteLength(input)<4*1024*1024);assert.deepEqual(redactText(input),{text:'[REDACTED PRIVATE KEY]',redaction_count:1});`;
 const child=spawnSync(process.execPath,['--max-old-space-size=128','--input-type=module','-e',script],{encoding:'utf8',timeout:3000,killSignal:'SIGKILL',maxBuffer:4096});
 assert.equal(child.error,undefined,child.error?.message);assert.equal(child.status,0,child.stderr);
});
 test('metadata is never silently sliced when it exceeds page-independent caps',async()=>{
 const todos=Array.from({length:101},(_,i)=>({content:'task'+i,status:'pending'}));
 const f=fixture({values:{'session/projections':{kind:'sequenced',asOfSeq:10,values:{todos}}}});
 const result=await create({...f,principal:'owner'}).call('owner','harness_read_session',{session_id:'s1'});
 assert.equal(result.context.todos.length,101);
 });

test('redactor removes opaque secret/private_key values, complete auth/cookie lines and database URI userinfo',()=>{
 const input='token=opaque-token\nsecret=opaque-secret\nprivate_key=opaque-private\nAuthorization: Basic dXNlcjpwYXNz\nCookie: first=opaque-cookie; second=opaque-cookie2\npostgres://user:opaque-uri@database.test/x';
 const value=implementation.redactText(input);
 for(const secret of ['opaque-token','opaque-secret','opaque-private','dXNlcjpwYXNz','opaque-cookie','opaque-uri'])assert.ok(!value.text.includes(secret),secret);
});
test('file hash and directory omissions remain explicit and every result identifies its source',async()=>{
 const f=fixture({files:{read:async()=>({text:'safe',offset:0,next_offset:null,eof:true,size:4,source_bytes:9,sha256_redacted:'a'.repeat(64),redaction_count:1}),list:async()=>({entries:[],offset:0,next_offset:null,eof:true,total:0,omitted_secret_names:2})}}),reader=create({...f,principal:'owner'});
 const file=await reader.call('owner','harness_read_file',{workspace_id:'w1',path:'README.md'});
 assert.equal(file.sha256_redacted,'a'.repeat(64));assert.equal(file.source_bytes,9);assert.equal(file.source,'existing_harness_persisted');assert.ok(Number.isFinite(Date.parse(file.read_at)));
 const directory=await reader.call('owner','harness_list_directory',{workspace_id:'w1'});assert.equal(directory.total,0);assert.equal(directory.omitted_secret_names,2);
});

test('inline Basic authentication and quoted cookie headers never leave credential suffixes',()=>{
 const input=`curl -H 'Authorization: Basic dXNlcjpzeW50aGV0aWM=' -H "Cookie: first=opaque-one; second=opaque-two" https://example.test\nProxy-Authorization: Basic cHJveHk6c2VjcmV0\nSet-Cookie: session=opaque-three; Path=/; HttpOnly`;
 const result=implementation.redactText(input);
 for(const value of ['dXNlcjpzeW50aGV0aWM=','opaque-one','opaque-two','cHJveHk6c2VjcmV0','opaque-three'])assert.ok(!result.text.includes(value),value);
 assert.ok(result.redaction_count>=4);assert.match(result.text,/https:\/\/example\.test/);
});

test('known credential paths are refused before any file backend call',async()=>{
 const f=fixture();let reads=0,lists=0;f.files.read=async()=>{reads++;return{text:'bad'};};f.files.list=async()=>{lists++;return{entries:[]};};
 const reader=create({...f,principal:'owner'});
 for(const path of ['.kube/config','.git-credentials','.pypirc','.pgpass','.codex/config.toml','.openclaw/config.json','id_rsa','id_ed25519','client.pem','database.sqlite3','settings.local.json']){
  await assert.rejects(reader.call('owner','harness_read_file',{workspace_id:'w1',path}),error=>error.code==='HARNESS_DENIED',path);
  await assert.rejects(reader.call('owner','harness_list_directory',{workspace_id:'w1',path}),error=>error.code==='HARNESS_DENIED',path);
 }
 assert.equal(reads,0);assert.equal(lists,0);
});

test('session pages must stay strictly before the requested boundary and make backward progress',async()=>{
 const f=fixture(),reader=create({...f,principal:'owner'});
 const first=await reader.call('owner','harness_read_session',{session_id:'s1',limit:2});
 await assert.rejects(reader.call('owner','harness_read_session',{session_id:'s1',offset:first.next_offset,limit:2}),error=>error.code==='HARNESS_UNAVAILABLE');
 for(const hasMore of [undefined,'true']){
  const malformed=fixture({values:{'session/page':{records:[],hasMore}}});
  await assert.rejects(create({...malformed,principal:'owner'}).call('owner','harness_read_session',{session_id:'s1'}),error=>error.code==='HARNESS_UNAVAILABLE');
 }
 const max=Number.MAX_SAFE_INTEGER,overflow=fixture({values:{'session/projections':{kind:'sequenced',asOfSeq:max,values:{}},'session/page':{records:[{type:'event',event:{seq:max,type:'user/message',data:{message:{content:[]}}}}],hasMore:true}}});
 await assert.rejects(create({...overflow,principal:'owner'}).call('owner','harness_read_session',{session_id:'s1'}),error=>error.code==='HARNESS_UNAVAILABLE');
});

test('directory EOF derives from cursor and total and each response identifies persisted material',async()=>{
 const f=fixture({files:{list:async request=>request.offset?{entries:[{name:'second.md',type:'file'}],offset:1,next_offset:null,total:2}:{entries:[{name:'first.md',type:'file'}],offset:0,next_offset:1,total:2}}}),reader=create({...f,principal:'owner'});
 const first=await reader.call('owner','harness_list_directory',{workspace_id:'w1',limit:1});
 assert.equal(first.eof,false);assert.equal(first.has_more,true);assert.equal(first.total,2);
 const last=await reader.call('owner','harness_list_directory',{workspace_id:'w1',offset:first.next_offset,limit:1});
 assert.equal(last.eof,true);assert.equal(last.has_more,false);assert.equal(last.next_offset,null);
 for(const result of [first,last,await reader.call('owner','harness_status',{})]){assert.equal(result.source,'existing_harness_persisted');assert.ok(Number.isFinite(Date.parse(result.read_at)));}
 const incomplete=fixture({files:{list:async()=>({entries:[],offset:0,next_offset:null,total:2})}});
 await assert.rejects(create({...incomplete,principal:'owner'}).call('owner','harness_list_directory',{workspace_id:'w1'}),error=>error.code==='HARNESS_UNAVAILABLE');
});

test('real descriptor file adapter and reader preserve complete redaction, fingerprints and directory EOF',async t=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'dot-reader-file-contract-')));t.after(()=>rm(root,{recursive:true,force:true}));
 await writeFile(join(root,'README.md'),`first ${secret} 中文 last`);await writeFile(join(root,'.env'),'SYNTHETIC SECRET FILE');
 const {createHarnessFiles}=await import('../src/harness-files.js');
 const f=fixture({values:{'workspace/baseline':{items:[{workspaceId:'w1',path:root,title:'Synthetic fixture',sessionIds:[]}]}}});
 const reader=create({...f,files:createHarnessFiles({redact:implementation.redactText}),principal:'owner'});
 const directory=await reader.call('owner','harness_list_directory',{workspace_id:'w1',limit:1});
 assert.deepEqual(directory.entries.map(entry=>entry.name),['README.md']);assert.equal(directory.total,1);assert.equal(directory.eof,true);assert.equal(directory.has_more,false);
 let offset=0,combined='',fingerprint;
 for(let i=0;i<20;i++){
  const page=await reader.call('owner','harness_read_file',{workspace_id:'w1',path:'README.md',offset,max_bytes:8});
  assert.match(page.sha256_redacted,/^[a-f0-9]{64}$/);fingerprint??=page.sha256_redacted;assert.equal(page.sha256_redacted,fingerprint);assert.equal(page.source,'existing_harness_persisted');combined+=page.text;
  if(page.eof){assert.equal(page.next_offset,null);break;}
  assert.ok(page.next_offset>offset);offset=page.next_offset;
 }
 assert.equal(combined,'first [REDACTED] 中文 last');assert.ok(!combined.includes(secret));
});

test('persisted history snapshot facts survive the whitelist and page facts override projection hints',async()=>{
 const snapshot={format_version:4,read_at:'2026-10-19T12:00:00.000Z',torn_tail_omitted:true,live_memory_included:false,inherited_event_count:2,includes_inherited_events:true,history_semantics:'persisted_source_log'};
 const f=fixture({values:{'session/projections':{kind:'sequenced',asOfSeq:10,values:{},persisted_snapshot:{...snapshot,torn_tail_omitted:false,read_at:'2026-10-19T11:59:59.000Z'}},'session/page':{records:[],hasMore:false,persisted_snapshot:{...snapshot,credentials:secret,raw_header:{authorization:secret}}}}});
 const result=await create({...f,principal:'owner'}).call('owner','harness_read_session',{session_id:'s1'});
 assert.deepEqual(result.persisted_snapshot,snapshot);assert.ok(!JSON.stringify(result).includes(secret));assert.equal(result.source,'existing_harness_persisted');
 const fallback=fixture({values:{'session/projections':{kind:'migration-required',values:{},persisted_snapshot:snapshot}}});
 assert.deepEqual((await create({...fallback,principal:'owner'}).call('owner','harness_read_session',{session_id:'s1'})).persisted_snapshot,snapshot);
});

test('persisted snapshot metadata cannot claim live memory or contradictory inheritance',async()=>{
 for(const persisted_snapshot of [{live_memory_included:true},{format_version:-1},{inherited_event_count:-1},{inherited_event_count:0,includes_inherited_events:true},{read_at:secret}]){
  const f=fixture({values:{'session/projections':{kind:'sequenced',asOfSeq:10,values:{},persisted_snapshot}}});
  await assert.rejects(create({...f,principal:'owner'}).call('owner','harness_read_session',{session_id:'s1'}),error=>error.code==='HARNESS_UNAVAILABLE'&&!error.message.includes(secret));
 }
});

test('persisted plugin manifests do not invent enabled state or expose unreviewed metadata',async()=>{
 const inventory={source:'persisted_manifest',entries:[{moduleName:'installed-plugin',meta:{name:'Installed plugin',version:'1.2.3-rc.1+build.2',description:'DO NOT EXPORT DESCRIPTION',credentials:secret}},{moduleName:'explicit-false',enabled:false},{moduleName:'explicit-true',enabled:true},{moduleName:'not-a-boolean',enabled:'true',meta:{name:'Other',version:'file:/DO_NOT_EXPORT_PATH'}}]};
 const f=fixture({values:{'pluginInventory/list':inventory}}),result=await create({...f,principal:'owner'}).call('owner','harness_status',{});
 assert.equal(result.plugins_source,'persisted_manifest');assert.equal(Object.hasOwn(result.plugins[0],'enabled'),false);assert.equal(result.plugins[1].enabled,false);assert.equal(result.plugins[2].enabled,true);assert.equal(Object.hasOwn(result.plugins[3],'enabled'),false);
 assert.deepEqual(result.plugins[0].metadata,{name:'Installed plugin',version:'1.2.3-rc.1+build.2'});assert.deepEqual(result.plugins[3].metadata,{name:'Other'});
 for(const value of [secret,'DO NOT EXPORT DESCRIPTION','DO_NOT_EXPORT_PATH'])assert.ok(!JSON.stringify(result).includes(value));
 const unknown=fixture({values:{'pluginInventory/list':{source:secret,entries:[]}}});
 assert.equal(Object.hasOwn(await create({...unknown,principal:'owner'}).call('owner','harness_status',{}),'plugins_source'),false);
});
