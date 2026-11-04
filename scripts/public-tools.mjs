const NATIVE_EXECUTOR='@deepseek-ai/dsh-tool-executor-native';

// In 0.2.2-rc.1 the public Tools service no longer accepts `mode` and
// requires a separate executor. Older verified SDKs retain their native mode.
export function publicToolPackages(sdkVersion){
 return sdkVersion==='0.2.2-rc.1'?[NATIVE_EXECUTOR]:[];
}

export async function mountPublicTools(ctx,{Tools,sdkVersion,load}){
 const packages=publicToolPackages(sdkVersion);
 await ctx.plugin(Tools,packages.length?{}:{mode:'native'});
 for(const name of packages)await ctx.plugin(await load(name));
}
