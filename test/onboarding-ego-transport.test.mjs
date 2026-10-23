import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createEgoTransport} from '../management-plugin/src/onboarding-ego-transport.js';
import {buildPluginPhaseScript} from '../management-plugin/src/onboarding-ego-plugin.js';

const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const regular={isFile:()=>true,isSymbolicLink:()=>false,mode:0o100755,uid:process.getuid?.()??0};
const privateText='sk-synthetic-private-secret https://auth.openai.com/log-in?code=private-oauth';
const markerOf=script=>JSON.parse(script.match(/const __receiptMarker = ("[^\n]+?");/)[1]);
const safeFailure=(failure,code)=>{assert.equal(failure.code,code);assert.doesNotMatch(JSON.stringify(failure)+failure.message,/synthetic-private|private-oauth|https?:|auth\.openai/);return true;};
function fixture({execute,space,taskSpace,takeOverTaskSpace,claimTaskSpace,...options}={}){
 const calls=[],kills=[];
 const pages=[{label:'p1'}],defaultSpace=space??{spaceId:110,page:label=>({label}),pages:async()=>pages,newPage:async()=>{const page={label:`p${pages.length+1}`,goto:async url=>{page.url=url;}};pages.push(page);return page;}};
 const spawnImpl=(command,args,spawnOptions)=>{
  const child=new EventEmitter();child.pid=81001;child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.stdin=new EventEmitter();child.kill=signal=>{kills.push({pid:child.pid,signal});return true;};
  const call={command,args,spawnOptions,child};calls.push(call);
  child.stdin.end=script=>{
   call.script=script;
   queueMicrotask(async()=>{
    const write=value=>child.stdout.emit('data',Buffer.from(value));
    const output={log:(...values)=>write(values.map(String).join(' ')+'\n')};
    try{
     if(execute)await execute({child,script,write,output,space:defaultSpace});
     else{await new AsyncFunction('taskSpace','takeOverTaskSpace','claimTaskSpace','console',script)(taskSpace??(async()=>defaultSpace),takeOverTaskSpace??(async()=>defaultSpace),claimTaskSpace??(async()=>defaultSpace),output);child.emit('close',0,null);}
    }catch(failure){child.stderr.emit('data',Buffer.from(failure.message));child.emit('close',1,null);}
   });
  };
  return child;
 };
 const transport=createEgoTransport({executablePath:'/synthetic/ego-browser',spawnImpl,killGroupImpl:(pid,signal)=>kills.push({pid,signal}),lstatImpl:async()=>regular,realpathImpl:async path=>path,...options});
 return{transport,calls,kills,pages,space:defaultSpace};
}
const run=(transport,options={})=>transport.run({spaceId:110,pageLabel:'p1',script:'return {ready:true};',...options});

test('uses absolute executable with nodejs on stdin, no shell, and scopes the round to the supplied existing page',async()=>{
 const seen=[];const f=fixture({taskSpace:async id=>{seen.push(id);return{page:label=>{seen.push(label);return{label};}};}});
 assert.deepEqual(await run(f.transport),{ready:true});assert.deepEqual(seen,[110,'p1']);
 assert.equal(f.calls[0].command,'/synthetic/ego-browser');assert.deepEqual(f.calls[0].args,['nodejs']);
 assert.equal(f.calls[0].spawnOptions.shell,false);assert.deepEqual(f.calls[0].spawnOptions.stdio,['pipe','pipe','pipe']);
 assert.doesNotMatch(f.calls[0].script,/claimTaskSpace|newPage|launchPersistentContext|chromium|playwright/);
});

test('emit caches one receipt and the wrapper emits only one random marked result',async()=>{
 const f=fixture();assert.deepEqual(await run(f.transport,{script:'emit({status:"waiting",step:"platform_login",patch:{tunnel_intent:true}});'}),{status:'waiting',step:'platform_login',patch:{tunnel_intent:true}});
 await run(f.transport);assert.notEqual(markerOf(f.calls[0].script),markerOf(f.calls[1].script));
 for(const script of ['emit({ready:true}); emit({ready:true});','emit({ready:true}); return {ready:true};'])await assert.rejects(run(f.transport,{script}),e=>safeFailure(e,'ONBOARDING_PAGE_CHANGED'));
});

test('only the exact marker is parsed; unrelated stdout and stderr diagnostics are not returned',async()=>{
 const f=fixture({execute:async({child,script,write})=>{write(privateText+'\n');child.stderr.emit('data',Buffer.from(privateText));write('__DSH_EGO_RECEIPT_other__:{"ok":true,"receipt":{"ready":false}}\n');write(markerOf(script)+'{"ok":true,"receipt":{"ready":true}}\n');child.emit('close',0,null);}});
 assert.deepEqual(await run(f.transport),{ready:true});
});

test('real CLI layout accepts the sole console receipt on stderr after an Ego update notice',async()=>{
 const f=fixture({execute:async({child,script})=>{child.stderr.emit('data',Buffer.from('[ego-browser] update available\n'+privateText+'\n'));child.stderr.emit('data',Buffer.from(markerOf(script)+'{"ok":true,"receipt":{"status":"prepared"}}\n'));child.emit('close',0,null);}});
 assert.deepEqual(await run(f.transport),{status:'prepared'});
});

test('stderr marker survives chunk boundaries and a final line without newline',async()=>{
 const f=fixture({execute:async({child,script,write})=>{write(privateText+'\n');const value=Buffer.from('更新提示\r\n'+markerOf(script)+'{"ok":true,"receipt":{"status":"prepared"}}');for(let at=0;at<value.length;at+=7)child.stderr.emit('data',value.subarray(at,at+7));child.emit('close',0,null);}});
 assert.deepEqual(await run(f.transport),{status:'prepared'});
});

test('duplicate nonce markers across stdout and stderr are rejected even when receipts agree',async()=>{
 const f=fixture({execute:async({child,script,write})=>{const receipt=markerOf(script)+'{"ok":true,"receipt":{"status":"prepared"}}\n';write(receipt);child.stderr.emit('data',Buffer.from(receipt));child.emit('close',0,null);}});
 await assert.rejects(run(f.transport),failure=>safeFailure(failure,'ONBOARDING_PAGE_CHANGED'));
});

test('stderr accepts only a whole exact nonce line and sanitizes malformed receipts',async()=>{
 for(const make of [marker=>'prefix '+marker+'{"ok":true,"receipt":{"ready":true}}\n',marker=>marker+'{"ok":true,"receipt":{"token":"sk-synthetic-private-secret"}}\n',marker=>marker+'{invalid private-oauth}\n']){
  const f=fixture({execute:async({child,script})=>{child.stderr.emit('data',Buffer.from(make(markerOf(script))));child.emit('close',0,null);}});await assert.rejects(run(f.transport),failure=>safeFailure(failure,'ONBOARDING_PAGE_CHANGED'));
 }
 const split=fixture({execute:async({child,script,write})=>{const marker=markerOf(script);write(marker.slice(0,20));child.stderr.emit('data',Buffer.from(marker.slice(20)+'{"ok":true,"receipt":{"ready":true}}'));child.emit('close',0,null);}});await assert.rejects(run(split.transport),failure=>safeFailure(failure,'ONBOARDING_PAGE_CHANGED'));
});

test('credentials and arbitrary page text are rejected before the wrapper prints a receipt',async()=>{
 for(const script of ['return {token:"sk-synthetic-private-secret"};','return {patch:{runtime_key:"sk-synthetic-private-secret"}};','return {status:"https://auth.openai.com/log-in?code=private-oauth"};','return {patch:{plugin_absence_fingerprint:"sk-synthetic-private-secret"}};']){
  const f=fixture();await assert.rejects(run(f.transport,{script}),e=>safeFailure(e,'ONBOARDING_PAGE_CHANGED'));
 }
});

test('valid provider patches retain only typed state fields and bounded identifiers',async()=>{
 const patch={installation_id:'a'.repeat(32),tunnel_name:'dsh-dot-'+'a'.repeat(32),plugin_name:'DeepSeek Harness · aaaaaaaa',tunnel_id:'tunnel_1234567890abcdef',organization_id:'org-1234567890abcdef',workspace_id:'12345678-1234-1234-1234-123456789abc',plugin_id:'plugin_asdk_app_1234567890abcdef',key_saved:true,plugin_connected:true,verification_pending_request:null,verification_request_ids:['dsh_connect_'+'b'.repeat(32)],plugin_absence_fingerprint:'plugin_asdk_app_1234567890abcdef|plugin_asdk_app_1234567890abcdff',plugin_absence_since:12};
 assert.deepEqual(await run(fixture().transport,{script:`return {status:"ready",patch:${JSON.stringify(patch)}};`}),{status:'ready',patch});
 for(const bad of [{plugin_id:privateText},{verification_request_ids:['not-a-request']},{plugin_absence_since:-1},{unknown:true}])await assert.rejects(run(fixture().transport,{script:`return {patch:${JSON.stringify(bad)}};`}),e=>safeFailure(e,'ONBOARDING_PAGE_CHANGED'));
});

test('key capture nonce crosses only as an exact non-secret 32-hex patch field',async()=>{
 const nonce='ab12'.repeat(8);const f=fixture();
 assert.deepEqual(await run(f.transport,{script:`return {status:"draft",step:"key_confirm",patch:{key_intent:true,key_capture_nonce:${JSON.stringify(nonce)}}};`}),{status:'draft',step:'key_confirm',patch:{key_intent:true,key_capture_nonce:nonce}});
 for(const value of [null,'a'.repeat(31),'a'.repeat(33),'A'.repeat(32),'sk-synthetic-private-secret',privateText])await assert.rejects(run(f.transport,{script:`return {patch:{key_capture_nonce:${JSON.stringify(value)}}};`}),failure=>safeFailure(failure,'ONBOARDING_PAGE_CHANGED'));
 await assert.rejects(run(f.transport,{script:`return {key_capture_nonce:${JSON.stringify(nonce)}};`}),{code:'ONBOARDING_PAGE_CHANGED'});
});

test('actual plugin phase receipts fit the transport schema without a browser',async()=>{
 const pluginName='DeepSeek Harness · aaaaaaaa',pluginId='plugin_asdk_app_1234567890abcdef',tunnelId='tunnel_1234567890abcdef';
 const cases=[
  {url:'https://chatgpt.com/settings/plugins-settings/'+pluginId,observed:{title:true,uninstall:true,association:true},state:{plugin_id:pluginId},expected:{status:'connected',plugin_id:pluginId,plugin_name:pluginName,connected:true,patch:{plugin_id:pluginId,plugin_connected:true}}},
  {url:'https://chatgpt.com/plugins',observed:{},expected:{status:'pending',step:'plugin_list_loading',patch:{plugin_absence_fingerprint:null,plugin_absence_since:null}}},
  {url:'about:blank',allowNavigate:true,expected:{status:'pending',step:'plugin_page',navigated:true}}
 ];
 for(const item of cases){
  const page={url:async()=>item.url,evaluate:async()=>item.observed,goto:async url=>assert.equal(url,'https://chatgpt.com/plugins')};
  const f=fixture({space:{page:()=>page}});
  const script=buildPluginPhaseScript({pluginName,tunnelId,state:item.state,allowNavigate:item.allowNavigate});
  assert.deepEqual(await run(f.transport,{script}),item.expected);
 }
});

test('outer decoder rejects absent, malformed, duplicate, or invalid marked receipts',async()=>{
 for(const output of [marker=>'no receipt\n',marker=>marker+'{invalid}\n',marker=>(marker+'{"ok":true,"receipt":{"ready":true}}\n').repeat(2),marker=>marker+'{"ok":true,"receipt":{"token":"sk-synthetic-private-secret"}}\n',marker=>marker+'{"ok":true,"receipt":[],"body":"private-oauth"}\n']){
  const f=fixture({execute:async({child,script,write})=>{write(output(markerOf(script)));child.emit('close',0,null);}});await assert.rejects(run(f.transport),e=>safeFailure(e,'ONBOARDING_PAGE_CHANGED'));
 }
});

test('official shim resolves only into the official Ego install roots and launches the checked canonical file',async()=>{
 const homeDirectory='/synthetic/home',shim=homeDirectory+'/.local/bin/ego-browser',target='/Applications/ego lite.app/Contents/Frameworks/ego Framework.framework/Versions/0.6.0.12/Helpers/ego-browser';
 const f=fixture({homeDirectory,executablePath:undefined,lstatImpl:async path=>path===shim?{isSymbolicLink:()=>true}: {...regular,mode:0o100775},realpathImpl:async()=>target});
 assert.deepEqual(await run(f.transport),{ready:true});assert.equal(f.calls[0].command,target);
 for(const illegal of ['/tmp/ego-browser','/Applications/ego lite.app/Contents-evil/ego-browser',homeDirectory+'/.local/share/ego-other/ego-browser']){
  const bad=fixture({homeDirectory,executablePath:undefined,lstatImpl:async()=>({isSymbolicLink:()=>true}),realpathImpl:async()=>illegal});await assert.rejects(run(bad.transport),e=>safeFailure(e,'EGO_BROWSER_UNAVAILABLE'));assert.equal(bad.calls.length,0);
 }
});

test('missing, relative, non-executable, world-writable, and untrusted symlink executables cannot spawn',async()=>{
 const cases=[{executablePath:'ego-browser'},{lstatImpl:async()=>{throw new Error(privateText);}},{lstatImpl:async()=>({...regular,mode:0o100644})},{lstatImpl:async()=>({...regular,mode:0o100777})},{lstatImpl:async()=>({...regular,isFile:()=>false})},{lstatImpl:async()=>({isSymbolicLink:()=>true}),realpathImpl:async()=>'/tmp/ego-browser'}];
 for(const options of cases){const f=fixture(options);await assert.rejects(run(f.transport),e=>safeFailure(e,'EGO_BROWSER_UNAVAILABLE'));assert.equal(f.calls.length,0);}
});

test('new binding creates or resumes its stable named space and returns the actual original page only',async()=>{
 const names=[];const f=fixture({taskSpace:async name=>{names.push(name);return{spaceId:53,pages:async()=>[{label:'p1'}],newPage:()=>{assert.fail('must not create a second page');}};}});
 assert.deepEqual(await f.transport.createBinding({name:'DSH connection · installation-1'}),{spaceId:53,platformPage:'p1'});assert.deepEqual(names,['DSH connection · installation-1']);
 assert.doesNotMatch(f.calls[0].script,/claimTaskSpace|takeOverTaskSpace|newPage|goto/);
 const ambiguous=fixture({space:{spaceId:53,pages:async()=>[{label:'p1'},{label:'p2'}]}});await assert.rejects(ambiguous.transport.createBinding({name:'existing-space'}),{code:'ONBOARDING_PAGE_CHANGED'});
});

test('explicit page creation returns its real label before any navigation can fail',async()=>{
 const f=fixture();assert.deepEqual(await f.transport.createPage({spaceId:110,kind:'connection'}),{pageLabel:'p2'});assert.equal(f.pages[1].url,undefined);
 assert.deepEqual(await f.transport.createVerificationPage({spaceId:110}),{pageLabel:'p3'});assert.equal(f.pages[2].url,undefined);
 for(const call of f.calls)assert.doesNotMatch(call.script,/page\.goto/);
 await assert.rejects(f.transport.createPage({spaceId:110,kind:'https://attacker.invalid'}),{code:'ONBOARDING_PAGE_CHANGED'});assert.equal(f.calls.length,2);
});

test('handoff yields only the bound space once and performs no further browser operation',async()=>{
 let handoffs=0,selected;const f=fixture({taskSpace:async id=>{selected=id;return{spaceId:id,handOff:async()=>{handoffs++;}};}});
 assert.deepEqual(await f.transport.handOffBinding({spaceId:110}),{spaceId:110,handed_off:true});assert.equal(selected,110);assert.equal(handoffs,1);
 assert.doesNotMatch(f.calls[0].script,/claimTaskSpace|takeOverTaskSpace|newPage|\.page\(|\.goto\(|snapshot/);
 await assert.rejects(f.transport.handOffBinding({spaceId:0}),{code:'ONBOARDING_PAGE_CHANGED'});assert.equal(handoffs,1);
});

test('finish keeps only requested extant pages and performs no page operation after completion',async()=>{
 const operations=[];const space={spaceId:110,pages:async()=>{operations.push('pages');return[{label:'p1'},{label:'p2'},{label:'p4'}];},finish:async({keep})=>operations.push(['finish',keep])};
 const f=fixture({space});assert.deepEqual(await f.transport.finishBinding({spaceId:110,keep:['p1','p4','p8']}),{spaceId:110,finished:true});
 assert.deepEqual(operations,['pages',['finish',['p1','p4']]]);assert.doesNotMatch(f.calls[0].script,/claimTaskSpace|newPage|\.close\(|snapshot/);
 await assert.rejects(f.transport.finishBinding({spaceId:110,keep:['p4','p4']}),{code:'ONBOARDING_PAGE_CHANGED'});assert.equal(f.calls.length,1);
});

test('finished space recovery claims its exact numeric id and preserves existing managed labels without adopting tabs',async()=>{
 const claimed=[];const f=fixture({taskSpace:async()=>{assert.fail('must use claim for finished space');},claimTaskSpace:async id=>{claimed.push(id);return{spaceId:id,tabs:async()=>[{label:'p5',url:'private-page-data'},{targetId:'user-owned',url:'private-page-data'}]};}});
 assert.deepEqual(await f.transport.claimBinding({spaceId:110}),{spaceId:110,claimed:true,protectedPages:['p5']});assert.deepEqual(claimed,[110]);
 assert.doesNotMatch(f.calls[0].script,/takeOverTaskSpace|newPage|adopt\(|goto\(/);
});

test('explicit resume keeps an already-owned space unchanged and takes over only an identified handoff',async()=>{
 const owned=fixture({taskSpace:async id=>({spaceId:id}),takeOverTaskSpace:async()=>{assert.fail('owned space must not be taken over again');}});
 assert.deepEqual(await owned.transport.resumeBinding({spaceId:110}),{spaceId:110,resumed:true});
 const seen=[];const handoff=fixture({taskSpace:async()=>{throw Object.assign(new Error(privateText),{code:'EGO_USER_CONTROL'});},takeOverTaskSpace:async id=>{seen.push(id);return{spaceId:id};}});
 assert.deepEqual(await handoff.transport.resumeBinding({spaceId:110}),{spaceId:110,resumed:true});assert.deepEqual(seen,[110]);assert.doesNotMatch(handoff.calls[0].script,/claimTaskSpace|newPage|snapshot/);
 for(const code of ['EGO_TASK_SPACE_INACTIVE','EGO_TASK_SPACE_USER_OWNED','EGO_TASK_SPACE_NAME_IN_USE','UNKNOWN_ERROR']){
  let takeovers=0;const blocked=fixture({taskSpace:async()=>{throw Object.assign(new Error(privateText),{code});},takeOverTaskSpace:async()=>{takeovers++;}});
  await assert.rejects(blocked.transport.resumeBinding({spaceId:110}),e=>safeFailure(e,'ONBOARDING_EGO_CONTROL'));assert.equal(takeovers,0);
 }
 const rejected=fixture({taskSpace:async()=>{throw Object.assign(new Error(privateText),{code:'EGO_USER_CONTROL'});},takeOverTaskSpace:async()=>{throw new Error(privateText);}});
 await assert.rejects(rejected.transport.resumeBinding({spaceId:110}),e=>safeFailure(e,'ONBOARDING_EGO_CONTROL'));
});

test('persisted explicit handoff takes over even when taskSpace could return a handle without control',async()=>{
 let controlled=false,handleReads=0,takeovers=0;
 const space={spaceId:110,page:()=>({url:async()=>{if(!controlled)throw Object.assign(new Error('User controls this page.'),{code:'EGO_USER_CONTROL'});return'about:blank';}})};
 const f=fixture({taskSpace:async()=>{handleReads++;return space;},takeOverTaskSpace:async id=>{assert.equal(id,110);takeovers++;controlled=true;return space;}});
 assert.deepEqual(await f.transport.resumeBinding({spaceId:110,handedOff:true}),{spaceId:110,resumed:true});
 assert.equal(handleReads,0);assert.equal(takeovers,1);
 assert.deepEqual(await run(f.transport,{script:'await page.url(); return {ready:true};'}),{ready:true});assert.equal(handleReads,1);
 assert.doesNotMatch(f.calls[0].script,/claimTaskSpace|newPage|\.page\(/);
 const blocked=fixture({takeOverTaskSpace:async()=>{throw new Error(privateText);}});
 await assert.rejects(blocked.transport.resumeBinding({spaceId:110,handedOff:true}),failure=>safeFailure(failure,'ONBOARDING_EGO_CONTROL'));
 await assert.rejects(f.transport.resumeBinding({spaceId:110,handedOff:'true'}),{code:'ONBOARDING_PAGE_CHANGED'});assert.equal(takeovers,1);
});

test('browser control loss and unknown errors are sanitized without source cause or stack',async()=>{
 for(const [code,expected]of [['EGO_TASK_SPACE_NAME_IN_USE','ONBOARDING_EGO_CONTROL'],['EGO_USER_CONTROL','ONBOARDING_EGO_CONTROL'],['UNRECOGNIZED_PRIVATE_TEXT','ONBOARDING_PAGE_CHANGED']]){
  const f=fixture({taskSpace:async()=>{throw Object.assign(new Error(privateText),{code,mayHaveLateEffects:true,executionStopped:true});}});
  await assert.rejects(run(f.transport),failure=>{safeFailure(failure,expected);assert.equal(failure.mayHaveLateEffects,true);assert.equal(failure.executionStopped,true);assert.equal(failure.cause,undefined);return true;});
 }
});

test('unknown in-phase exceptions can have late effects but known business errors and pre-phase failures cannot',async()=>{
 const cases=[
  {script:'throw new Error("sk-synthetic-private-secret");',late:true,code:'ONBOARDING_PAGE_CHANGED'},
  {script:'throw Object.assign(new Error("private-oauth"),{code:"EGO_ACTION_UNCERTAIN"});',late:true,code:'ONBOARDING_PAGE_CHANGED'},
  {script:'throw Object.assign(new Error("private-oauth"),{code:"ONBOARDING_KEY_RECOVERY"});',late:false,code:'ONBOARDING_KEY_RECOVERY'},
  {script:'throw Object.assign(new Error("private-oauth"),{code:"ONBOARDING_AUTH_BROWSER_REJECTED"});',late:false,code:'ONBOARDING_AUTH_BROWSER_REJECTED'},
  {script:'throw Object.assign(new Error("private-oauth"),{code:"EGO_USER_CONTROL"});',late:false,code:'ONBOARDING_EGO_CONTROL'}
 ];
 for(const item of cases)await assert.rejects(run(fixture().transport,{script:item.script}),failure=>{safeFailure(failure,item.code);assert.equal(failure.mayHaveLateEffects===true,item.late);return true;});
 const before=fixture({taskSpace:async()=>{throw new Error(privateText);}});
 await assert.rejects(run(before.transport),failure=>{safeFailure(failure,'ONBOARDING_PAGE_CHANGED');assert.equal(failure.mayHaveLateEffects,undefined);return true;});
});

test('stdout and stderr have independent byte bounds and kill only the owned process group',async()=>{
 for(const stream of ['stdout','stderr']){
  const f=fixture({maxOutputBytes:256,execute:async({child})=>child[stream].emit('data',Buffer.alloc(257,'x'))});
  await assert.rejects(run(f.transport),failure=>{safeFailure(failure,'ONBOARDING_EGO_OUTPUT_LIMIT');assert.equal(failure.mayHaveLateEffects,true);return true;});
  assert.deepEqual(f.kills,[{pid:process.platform==='win32'?81001:-81001,signal:'SIGTERM'}]);
 }
});

test('pre-abort never starts a child; in-flight abort and timeout mark potentially late effects',async()=>{
 const before=fixture();await assert.rejects(run(before.transport,{signal:AbortSignal.abort()}),{name:'AbortError'});assert.equal(before.calls.length,0);
 const controller=new AbortController();const during=fixture({execute:async()=>{controller.abort();}});
 await assert.rejects(run(during.transport,{signal:controller.signal}),failure=>failure.name==='AbortError'&&failure.mayHaveLateEffects===true);assert.equal(during.kills.length,1);
 const late=fixture({execute:async()=>{}});await assert.rejects(run(late.transport,{timeoutMs:5}),failure=>{safeFailure(failure,'ONBOARDING_EGO_TIMEOUT');assert.equal(failure.mayHaveLateEffects,true);return true;});assert.equal(late.kills.length,1);
});

test('spawn failures, stdin errors, and nonzero exits never expose diagnostics',async()=>{
 const cases=[{spawnImpl:()=>{throw new Error(privateText);}},{execute:async({child})=>child.stdin.emit('error',new Error(privateText))},{execute:async({child})=>{child.stderr.emit('data',Buffer.from(privateText));child.emit('close',2,null);}},{execute:async({child})=>child.emit('error',new Error(privateText))}];
 for(const options of cases)await assert.rejects(run(fixture(options).transport),failure=>safeFailure(failure,'EGO_BROWSER_UNAVAILABLE'));
});

test('rounds cannot overlap and invalid arguments cannot start a browser command',async()=>{
 const controller=new AbortController();const f=fixture({execute:async()=>{}});const first=run(f.transport,{signal:controller.signal});
 await assert.rejects(run(f.transport),{code:'ONBOARDING_EGO_BUSY'});controller.abort();await assert.rejects(first,{name:'AbortError'});
 const invalid=fixture();for(const values of [{spaceId:0},{spaceId:'110);bad()'},{pageLabel:'p1;bad()'},{script:'x'.repeat(131073)},{timeoutMs:60001}])await assert.rejects(run(invalid.transport,values),{code:'ONBOARDING_PAGE_CHANGED'});assert.equal(invalid.calls.length,0);
});
