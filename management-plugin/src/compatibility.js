/** Exact profiles admitted only with matching public SDK and official Host proofs. */
export const SDK_PROFILES=Object.freeze(Object.fromEntries([
 ...['0.2.1-rc.2','0.2.1-rc.3','0.2.1-rc.4','0.2.1-rc.5'].map(sdk=>[sdk,{node:'22.22.0',minimumNode:'22.15.0',cordis:'4.0.5'}]),
 ['0.2.2-rc.1',{node:'24.22.2',minimumNode:'24.9.0',cordis:'4.1.0'}],
].map(([sdk,profile])=>[sdk,Object.freeze(profile)])));
export const VERIFIED_SDK_VERSIONS=Object.freeze(Object.keys(SDK_PROFILES));
export function nodeSupportsSdk(sdk,nodeVersion){
 const profile=SDK_PROFILES[sdk];if(!profile||!/^\d+\.\d+\.\d+$/.test(nodeVersion??''))return false;
 const actual=nodeVersion.split('.').map(Number),minimum=profile.minimumNode.split('.').map(Number);
 for(let index=0;index<3;index++)if(actual[index]!==minimum[index])return actual[index]>minimum[index];
 return true;
}
