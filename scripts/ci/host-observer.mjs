import assert from 'node:assert/strict';
import {inspectInstalledAbi} from './run-host.mjs';
export const name='management-ci-host-proof';
export const inject=['loader','pluginManager','typertGateway'];
export async function inspectHost(ctx,config,{cycle=false,removed=false}={}){
 await ctx.loader.await();const manager=ctx.get('pluginManager');
 const state=async()=>({bundle:(await manager.listBundles()).find(item=>item.name===config.package),plugin:(await manager.listPlugins()).find(item=>item.moduleName===config.package)});
 const active=async()=>{const {bundle,plugin}=await state();assert.equal(bundle?.version,config.version);assert.equal(bundle?.enabled,true);assert.equal(plugin?.fiberPhase,'active');return{version:bundle.version,enabled:bundle.enabled,phase:plugin.fiberPhase};};
 const listeners=process._getActiveHandles().filter(handle=>typeof handle.address==='function'&&typeof handle.getConnections==='function').map(handle=>handle.address()).filter(address=>address&&typeof address==='object');
 assert.ok(listeners.some(address=>address.address==='127.0.0.1'),'Own Host has no loopback listener');assert.ok(listeners.every(address=>['127.0.0.1','::1'].includes(address.address)),'Own Host bound an unexpected interface');
 const result={listenAddresses:[...new Set(listeners.map(address=>address.address))]};
 if(removed){const current=await state();assert.equal(current.bundle,undefined,'Uninstalled bundle still listed');assert.equal(current.plugin,undefined,'Uninstalled plugin still loaded');return{...result,removed:true,passed:true};}
 if(config.installedPackageRoot)result.installedAbi=await inspectInstalledAbi(config.installedPackageRoot,{sdk:config.sdk,cordisVersion:config.cordisVersion});
 result.bundle=await active();
 if(cycle){
  const disabled=await manager.setBundleEnabled(config.package,false);assert.equal(disabled.application,'applied','Bundle disable did not apply');await ctx.loader.await();const current=await state();assert.equal(current.bundle?.enabled,false,'Bundle remained enabled');assert.notEqual(current.plugin?.fiberPhase,'active','Disabled plugin remained active');
  const enabled=await manager.setBundleEnabled(config.package,true);assert.equal(enabled.application,'applied','Bundle enable did not apply');await ctx.loader.await();result.bundle=await active();result.lifecycle={disabled:true,reenabled:true};
 }
 const peer={principal:{kind:'owner'},signal:new AbortController().signal,interactions:'none'};
 const value=await ctx.typertGateway.invoke({namespace:'dotDshManagement',method:'setupStatus',args:{request:{}},peer});
 assert.equal(value.mode,'managed');assert.equal(value.services.reader,'stopped');assert.equal(value.services.manager,'stopped');assert.equal(value.account.state,'unverified');
 result.remote={mode:value.mode,phase:value.phase,services:value.services,account:value.account.state};
 await assert.rejects(ctx.typertGateway.invoke({namespace:'dotDshManagement',method:'overview',args:{request:{}},peer:{...peer,principal:{kind:'external'}}}),error=>error.code==='dot-management/denied'||/access denied/.test(error.message));
 await assert.rejects(ctx.typertGateway.invoke({namespace:'dotDshManagement',method:'overview',args:{request:{}},peer}),error=>error.code==='dot-management/unavailable');
 return{...result,ownerEnforced:true,pinnedProtocolErrorRoundTrip:true,passed:true};
}
export function apply(ctx,config){
 const receive=async message=>{
  if(message?.action!=='proof')return;const result={action:'proof',syntheticHome:true,realAccounts:false,desktopOnboardingVerified:false};
  try{
   Object.assign(result,await inspectHost(ctx,config,{cycle:message.mode==='cycle',removed:message.mode==='removed'}));
  }catch(error){result.passed=false;result.error=String(error?.stack??error).slice(0,1600);}
  process.send?.(result);
 };
 ctx.effect(()=>{process.on('message',receive);return()=>process.off('message',receive);});
}
