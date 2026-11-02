import assert from 'node:assert/strict';
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
