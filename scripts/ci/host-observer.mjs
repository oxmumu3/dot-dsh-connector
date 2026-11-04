import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
export const name='management-ci-host-proof';
export const inject=['loader','pluginManager','typertGateway'];
export function apply(ctx,config){
 const receive=async message=>{
  if(message?.action!=='proof')return;const result={action:'proof',syntheticHome:true,realAccounts:false,desktopOnboardingVerified:false};
  try{
   await ctx.loader.await();const manager=ctx.get('pluginManager'),bundles=await manager.listBundles(),plugins=await manager.listPlugins();
   const bundle=bundles.find(item=>item.name===config.package),plugin=plugins.find(item=>item.moduleName===config.package);
   assert.equal(bundle?.version,config.version);assert.equal(bundle?.enabled,true);assert.equal(plugin?.fiberPhase,'active');
   result.bundle={version:bundle.version,enabled:bundle.enabled,phase:plugin.fiberPhase};
   // Resolve through the running official Host's profile hooks, exactly as the
   // installed native plugin does. Never force a nested legacy SDK into it.
   const require=createRequire(join(config.installedPackageRoot,'package.json'));
   const protocolPath=require.resolve('@deepseek-ai/dsh-typert-protocol/package.json'),cordisPath=require.resolve('@deepseek-ai/cordis/package.json');
   const protocol=JSON.parse(await readFile(protocolPath,'utf8')),cordis=JSON.parse(await readFile(cordisPath,'utf8'));
   const protocolCordisPath=createRequire(protocolPath).resolve('@deepseek-ai/cordis/package.json');
   assert.equal(protocol.version,config.sdk,'Installed plugin resolved a different SDK protocol');assert.equal(cordis.version,config.cordis,'Installed plugin resolved a different Cordis profile');
   assert.equal(await realpath(cordisPath),await realpath(protocolCordisPath),'Protocol and native plugin resolved different Cordis instances');
   const pluginCordis=await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')).href);
   assert.equal(ctx.root.constructor,pluginCordis.Context,'Native plugin Cordis Context is not the running Host Context');
   result.installedSdk={protocol:protocol.version,cordis:cordis.version,sameCordisInstance:true,sameHostContext:true};
   const listeners=process._getActiveHandles().filter(handle=>typeof handle.address==='function'&&typeof handle.getConnections==='function').map(handle=>handle.address()).filter(address=>address&&typeof address==='object');
   assert.ok(listeners.some(address=>address.address==='127.0.0.1'),'Own Host has no loopback listener');assert.ok(listeners.every(address=>['127.0.0.1','::1'].includes(address.address)),'Own Host bound an unexpected interface');result.listenAddresses=[...new Set(listeners.map(address=>address.address))];
   const peer={principal:{kind:'owner'},signal:new AbortController().signal,interactions:'none'};
   const value=await ctx.typertGateway.invoke({namespace:'dotDshManagement',method:'setupStatus',args:{request:{}},peer});
   assert.equal(value.mode,'managed');assert.equal(value.services.reader,'stopped');assert.equal(value.services.manager,'stopped');assert.equal(value.account.state,'unverified');
   result.remote={mode:value.mode,phase:value.phase,services:value.services,account:value.account.state};
   await assert.rejects(ctx.typertGateway.invoke({namespace:'dotDshManagement',method:'overview',args:{request:{}},peer:{...peer,principal:{kind:'external'}}}),error=>error.code==='dot-management/denied'||/access denied/.test(error.message));
   await assert.rejects(ctx.typertGateway.invoke({namespace:'dotDshManagement',method:'overview',args:{request:{}},peer}),error=>error.code==='dot-management/unavailable');
   result.ownerEnforced=true;result.pinnedProtocolErrorRoundTrip=true;result.passed=true;
  }catch(error){result.passed=false;result.error=String(error?.stack??error).slice(0,1600);}
  process.send?.(result);
 };
 ctx.effect(()=>{process.on('message',receive);return()=>process.off('message',receive);});
}
