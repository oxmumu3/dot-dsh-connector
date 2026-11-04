import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import * as observer from '../scripts/ci/host-observer.mjs';
import * as host from '../scripts/ci/run-host.mjs';

const config={package:'@oxmumu3/dot-dsh-management',version:'0.6.0-preview.synthetic'};
const listener=createServer();before(()=>new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve)));after(()=>new Promise(resolve=>listener.close(resolve)));
function fixture({removed=false,ignoreDisable=false}={}){
 let enabled=!removed;const calls=[];
 const manager={
  async listBundles(){return removed?[]:[{name:config.package,version:config.version,enabled}];},
  async listPlugins(){return removed?[]:[{moduleName:config.package,fiberPhase:enabled?'active':'disabled'}];},
  async setBundleEnabled(name,next){calls.push([name,next]);if(!ignoreDisable||next)enabled=next;return{application:'applied'};},
 };
 const gateway={async invoke({method,peer}){if(peer.principal.kind==='external')throw Object.assign(Error('access denied'),{code:'dot-management/denied'});if(method==='overview')throw Object.assign(Error('unavailable'),{code:'dot-management/unavailable'});return{mode:'managed',phase:'blocked',services:{reader:'stopped',manager:'stopped'},account:{state:'unverified'}};}};
 const ctx={loader:{await:async()=>{}},get:name=>name==='pluginManager'?manager:gateway,typertGateway:gateway};
 return{ctx,calls};
}
test('official Host proof cycles only its bundle and verifies the loaded state after reactivation',async()=>{
 assert.equal(typeof observer.inspectHost,'function','lifecycle observer is not implemented');
 const f=fixture(),proof=await observer.inspectHost(f.ctx,config,{cycle:true});
 assert.deepEqual(f.calls,[[config.package,false],[config.package,true]]);
 assert.equal(proof.bundle.phase,'active');assert.equal(proof.lifecycle.disabled,true);assert.equal(proof.lifecycle.reenabled,true);assert.equal(proof.pinnedProtocolErrorRoundTrip,true);
});
test('a successful enablement response cannot replace actual disabled-state observation',async()=>{
 assert.equal(typeof observer.inspectHost,'function','lifecycle observer is not implemented');
 const f=fixture({ignoreDisable:true});await assert.rejects(observer.inspectHost(f.ctx,config,{cycle:true}));
 assert.equal(f.calls.length,1);
});
test('post-uninstall Host proof requires both bundle and plugin to be absent',async()=>{
 assert.equal(typeof observer.inspectHost,'function','lifecycle observer is not implemented');
 const clean=fixture({removed:true}),proof=await observer.inspectHost(clean.ctx,config,{removed:true});assert.equal(proof.removed,true);
 const retained=fixture();await assert.rejects(observer.inspectHost(retained.ctx,config,{removed:true}));assert.deepEqual(retained.calls,[]);
});
test('installed ABI checks resolve from the installed plugin and reject a nested old protocol',async()=>{
 assert.equal(typeof host.inspectInstalledAbi,'function','installed ABI verification is not implemented');
 const root=await mkdtemp(join(tmpdir(),'dsh-installed-abi-fixture-'));
 try{
  await writeFile(join(root,'package.json'),JSON.stringify({name:'synthetic-installed-plugin',version:'1.0.0'}));
  for(const [name,version]of [['@deepseek-ai/cordis','4.1.0'],['@deepseek-ai/dsh-typert-protocol','0.2.2-rc.1']]){
   const path=join(root,'node_modules',name);await mkdir(path,{recursive:true});await writeFile(join(path,'package.json'),JSON.stringify({name,version,main:'index.js'}));await writeFile(join(path,'index.js'),'module.exports={};');
  }
  const result=await host.inspectInstalledAbi(root,{sdk:'0.2.2-rc.1',cordisVersion:'4.1.0'});assert.equal(result.protocol.version,'0.2.2-rc.1');assert.equal(result.cordis.version,'4.1.0');
  await writeFile(join(root,'node_modules/@deepseek-ai/dsh-typert-protocol/package.json'),JSON.stringify({name:'@deepseek-ai/dsh-typert-protocol',version:'0.2.1-rc.2',main:'index.js'}));
  await assert.rejects(host.inspectInstalledAbi(root,{sdk:'0.2.2-rc.1',cordisVersion:'4.1.0'}),/protocol ABI/);
 }finally{await rm(root,{recursive:true,force:true});}
});
