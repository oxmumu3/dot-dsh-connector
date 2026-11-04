import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const defaultRoot=fileURLToPath(new URL('../',import.meta.url));
function parts(version){
 const match=typeof version==='string'&&version.match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
 assert.ok(match,'Invalid official SDK discovery version');
 return [Number(match[1]),Number(match[2]),Number(match[3]),match[4]?.split('.')];
}
function compare(left,right){
 const a=parts(left),b=parts(right);
 for(let i=0;i<3;i++)if(a[i]!==b[i])return a[i]-b[i];
 if(!a[3]||!b[3])return a[3]?-1:b[3]?1:0;
 for(let i=0;i<Math.max(a[3].length,b[3].length);i++){
  const x=a[3][i],y=b[3][i];if(x===y)continue;if(x===undefined)return -1;if(y===undefined)return 1;
  const xn=/^\d+$/.test(x),yn=/^\d+$/.test(y);if(xn&&yn)return Number(x)-Number(y);if(xn!==yn)return xn?-1:1;return x<y?-1:1;
 }
 return 0;
}
/** An unavailable, malformed or newer official release always fails this gate. */
export async function validateCompatibility({root=defaultRoot,official}={}){
 root=root instanceof URL?fileURLToPath(root):resolve(root);
 const json=async name=>JSON.parse(await readFile(join(root,name),'utf8'));
 const [manifest,pkg,native,lock,shrink]=await Promise.all(['compatibility.json','package.json','management-plugin/package.json','package-lock.json','npm-shrinkwrap.json'].map(json));
 const {VERIFIED_SDK_VERSIONS,SDK_PROFILES}=await import(pathToFileURL(join(root,'management-plugin/src/compatibility.js')).href);
 assert.equal(manifest.schemaVersion,1);assert.equal(manifest.package,native.name);assert.equal(manifest.version,pkg.version);assert.equal(native.version,pkg.version);
 assert.deepEqual(manifest.verifiedSdks,[...VERIFIED_SDK_VERSIONS]);assert.ok(manifest.verifiedSdks.includes(manifest.latestOfficial));
 assert.deepEqual(manifest.sdkProfiles,SDK_PROFILES,'SDK runtime profiles must match exact reviewed declarations');
 assert.equal(manifest.latestOfficial,[...manifest.verifiedSdks].sort(compare).at(-1),'Expected the most recent verified SDK, independently of the latest dist-tag');
 const range=manifest.verifiedSdks.join(' || ');
 assert.equal(pkg.engines.dsh,range);assert.equal(native.engines.dsh,range);assert.equal(pkg.peerDependencies['@deepseek-ai/dsh-llm'],range);
 assert.equal(native.peerDependencies['@deepseek-ai/dsh-typert-protocol'],range);assert.equal(native.dependencies['@deepseek-ai/dsh-typert-protocol'],undefined,'Protocol must be supplied by the selected Host');
 assert.equal(native.peerDependencies['@deepseek-ai/cordis'],[...new Set(Object.values(SDK_PROFILES).map(profile=>profile.cordis))].join(' || '));
 for(const value of [lock,shrink]){assert.equal(value.version,pkg.version);assert.equal(value.packages[''].version,pkg.version);assert.equal(value.packages[''].engines.dsh,range);assert.equal(value.packages[''].peerDependencies['@deepseek-ai/dsh-llm'],range);}
 const versions=Array.isArray(official?.versions)?official.versions:Object.keys(official?.versions??{}),latest=official?.['dist-tags']?.latest;
 assert.ok(official?.name===manifest.officialPackage&&versions.length&&typeof latest==='string'&&versions.includes(latest),'Invalid official SDK discovery');
 assert.ok(Array.isArray(manifest.observedOfficialVersions)&&manifest.observedOfficialVersions.length>0,'An audited official version snapshot is required');
 const observed=new Set(manifest.observedOfficialVersions);assert.equal(observed.size,manifest.observedOfficialVersions.length);
 for(const version of observed)parts(version);
 for(const version of [...manifest.verifiedSdks,...Object.keys(manifest.knownUnsupported??{})])assert.ok(observed.has(version),'Admission must refer to an observed official version');
 for(const version of versions){parts(version);assert.ok(observed.has(version),`unverified official SDK ${version}; audit and rerun the public SDK and official Host gates before extending support`);}
 assert.ok(manifest.verifiedSdks.includes(latest),`unverified official SDK ${latest}`);
 return {package:native.name,version:pkg.version,verifiedSdks:manifest.verifiedSdks,latestOfficial:latest,actualLatest:latest,mostRecentVerified:manifest.latestOfficial,sdkProfiles:manifest.sdkProfiles};
}
export async function checkCompatibility(){
 let official;
 if(process.env.DSH_OFFICIAL_VERSIONS_FILE)official=JSON.parse(await readFile(process.env.DSH_OFFICIAL_VERSIONS_FILE,'utf8'));
 else{
  const response=await fetch('https://registry.npmjs.org/@deepseek-ai%2fdsh',{signal:AbortSignal.timeout(15000)});
  assert.equal(response.status,200,'Official SDK discovery unavailable');official=await response.json();
 }
 return validateCompatibility({official});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(await checkCompatibility()));
