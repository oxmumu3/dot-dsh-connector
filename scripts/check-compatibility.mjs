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
export async function validateCompatibility({root=defaultRoot,official,desktop}={}){
 root=root instanceof URL?fileURLToPath(root):resolve(root);
 const json=async name=>JSON.parse(await readFile(join(root,name),'utf8'));
 const [manifest,pkg,native,lock,shrink]=await Promise.all(['compatibility.json','package.json','management-plugin/package.json','package-lock.json','npm-shrinkwrap.json'].map(json));
 const {VERIFIED_SDK_VERSIONS}=await import(pathToFileURL(join(root,'management-plugin/src/compatibility.js')).href);
 assert.equal(manifest.schemaVersion,1);assert.equal(manifest.package,native.name);assert.equal(manifest.version,pkg.version);assert.equal(native.version,pkg.version);
 assert.deepEqual(manifest.verifiedSdks,[...VERIFIED_SDK_VERSIONS]);assert.ok(manifest.verifiedSdks.includes(manifest.latestOfficial));
 const range=manifest.verifiedSdks.join(' || ');
 assert.equal(pkg.engines.dsh,range);assert.equal(native.engines.dsh,range);assert.equal(pkg.peerDependencies['@deepseek-ai/dsh-llm'],range);
 assert.equal(native.peerDependencies['@deepseek-ai/dsh-typert-protocol'],range);
 for(const [name,value]of Object.entries(native.peerDependencies))if(name.startsWith('@deepseek-ai/dsh-'))assert.equal(value,range,'Unverified SDK peer '+name);
 assert.equal(native.peerDependencies['@deepseek-ai/cordis'],'~4.0.5 || ~4.1.0');
 assert.equal(native.dependencies['@deepseek-ai/dsh-typert-protocol'],undefined,'Host must supply the matching protocol peer');
 for(const value of [lock,shrink]){assert.equal(value.version,pkg.version);assert.equal(value.packages[''].version,pkg.version);assert.equal(value.packages[''].engines.dsh,range);assert.equal(value.packages[''].peerDependencies['@deepseek-ai/dsh-llm'],range);}
 const versions=Array.isArray(official?.versions)?official.versions:Object.keys(official?.versions??{}),latest=official?.['dist-tags']?.latest;
 assert.ok(official?.name===manifest.officialPackage&&versions.length&&typeof latest==='string'&&versions.includes(latest),'Invalid official SDK discovery');
 for(const version of versions){parts(version);assert.ok(compare(version,manifest.verifiedSdks[0])<=0||manifest.verifiedSdks.includes(version)||Object.hasOwn(manifest.knownUnsupported??{},version),`unverified official SDK ${version}; audit and rerun the public SDK and official Host gates before extending support`);}
 for(const tagged of Object.values(official['dist-tags'])){assert.ok(typeof tagged==='string'&&versions.includes(tagged),'Invalid official SDK discovery tag');try{parts(tagged);}catch{assert.fail('Invalid official SDK discovery tag');}}
 assert.ok(manifest.verifiedSdks.includes(latest),`unverified official SDK ${latest}`);
 if(desktop!==undefined)assert.ok(typeof desktop?.version==='string'&&manifest.verifiedSdks.includes(desktop.version),`unverified official desktop ${desktop?.version}`);
 return {package:native.name,version:pkg.version,verifiedSdks:manifest.verifiedSdks,latestOfficial:desktop?.version??manifest.latestOfficial,registryLatest:latest,registryNext:official['dist-tags'].next??null};
}
export async function readOfficialDesktop({fetchImpl=globalThis.fetch}={}){
 const url='https://download.deepseek.com/dsh-desk/feeds/mac-arm64/nightly-mac.yml';
 const response=await fetchImpl(url,{signal:AbortSignal.timeout(30000)});assert.equal(response.status,200,'Official desktop feed unavailable');
 const body=await response.text();assert.ok(body.length<=65536,'Official desktop feed exceeds bound');
 const lines=body.split(/\r?\n/).filter(line=>/^version:/.test(line));assert.equal(lines.length,1,'Official desktop version must be unique');
 const match=lines[0].match(/^version:[ \t]*(?:"([^"\r\n]+)"|'([^'\r\n]+)'|([0-9][0-9A-Za-z.+-]*))[ \t]*$/);assert.ok(match,'Official desktop version unavailable');const version=match[1]??match[2]??match[3];parts(version);
 return {version,source:url};
}
export async function checkCompatibility(){
 let official;
 if(process.env.DSH_OFFICIAL_VERSIONS_FILE)official=JSON.parse(await readFile(process.env.DSH_OFFICIAL_VERSIONS_FILE,'utf8'));
 else{
  const response=await fetch('https://registry.npmjs.org/@deepseek-ai%2fdsh',{signal:AbortSignal.timeout(15000)});
  assert.equal(response.status,200,'Official SDK discovery unavailable');official=await response.json();
 }
 const desktop=process.env.DSH_OFFICIAL_VERSIONS_FILE?undefined:await readOfficialDesktop();
 return validateCompatibility({official,desktop});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(await checkCompatibility()));
