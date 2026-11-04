import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {VERIFIED_SDK_VERSIONS,sdkCordisVersion} from '../../management-plugin/src/compatibility.js';
export async function verifyHostMatrix({directory,sdks}={}){
 assert.ok(Array.isArray(sdks)&&sdks.length>0&&new Set(sdks).size===sdks.length&&sdks.every(sdk=>VERIFIED_SDK_VERSIONS.includes(sdk)),'Invalid exact Host SDK matrix');
 const results=[];let archive;
 for(const sdk of sdks){
  const proof=JSON.parse(await readFile(join(directory,sdk,'host-proof.json'),'utf8'));
  assert.equal(proof.sdk,sdk,'Host proof SDK mismatch');
  for(const field of ['passed','ownerEnforced','pinnedProtocolErrorRoundTrip','onlyOwnHostExited'])assert.equal(proof[field],true,sdk+' '+field);
  for(const field of ['productionProfileUsed','compatibilityOverride'])assert.equal(proof[field],false,sdk+' '+field);
  assert.equal(proof.installedAbi?.protocol?.version,sdk,'Host protocol mismatch');assert.equal(proof.installedAbi?.cordis?.version,sdkCordisVersion(sdk),'Host Cordis mismatch');
  assert.ok(Number.isSafeInteger(proof.installedFileCount)&&proof.installedFileCount>0,'Missing installed file proof');assert.match(proof.tarballSha256,/^[a-f0-9]{64}$/);
  archive??=proof.tarballSha256;assert.equal(proof.tarballSha256,archive,'Host archive mismatch');
  for(const field of ['loopback','nonLoopbackDenied','customLookupDenied','nonNodeChildDenied'])assert.equal(proof.network?.[field],true,sdk+' network '+field);
  for(const stage of ['first','restarted','removed'])assert.equal(proof.lifecycle?.[stage]?.passed,true,sdk+' lifecycle '+stage);
  assert.equal(proof.lifecycle.first.lifecycle?.disabled,true);assert.equal(proof.lifecycle.first.lifecycle?.reenabled,true);assert.equal(proof.lifecycle.removed.removed,true);assert.equal(proof.lifecycle.officialCliUninstalled,true);
  results.push({sdk,passed:true,installedFileCount:proof.installedFileCount,tarballSha256:archive});
 }
 return {passed:true,sdks,tarballSha256:archive,results};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const root=fileURLToPath(new URL('../../',import.meta.url)),manifest=JSON.parse(await readFile(join(root,'compatibility.json'),'utf8')),directory=resolve(process.argv[2]);
 const result=await verifyHostMatrix({directory,sdks:manifest.verifiedSdks});await writeFile(join(directory,'matrix-proof.json'),JSON.stringify({...result,source:process.env.GITHUB_SHA??null},null,2)+'\n');console.log(JSON.stringify(result));
}
