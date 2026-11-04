import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {proveHostNetwork} from '../scripts/ci/host-network-proof.mjs';
import {cleanEnvironment} from '../scripts/ci/compatibility.mjs';

async function fixture(t,profile){
 const out=await mkdtemp(join(tmpdir(),'dsh-host-network-proof-'));
 t.after(()=>rm(out,{recursive:true,force:true}));
 const sandbox=join(out,'network.sb');await writeFile(sandbox,profile);
 return {sandbox,out,cwd:out,env:cleanEnvironment(out)};
}
const options={skip:process.platform!=='darwin'};
const loopbackProfile='(version 1)\n(allow default)\n(deny network*)\n(allow network-bind (local ip "localhost:*"))\n(allow network-inbound (local ip "localhost:*"))\n(allow network-outbound (remote ip "localhost:*"))\n';
async function expectNetworkProof(t,fixture_){
 try{return await proveHostNetwork(fixture_);}
 catch(error){
  for(const name of ['network-environment.json','network-failure.json']){
   const report=await readFile(join(fixture_.out,name),'utf8').catch(()=>null);
   if(report)t.diagnostic(name+': '+report);
  }
  throw error;
 }
}
test('real macOS network gate still verifies loopback, address-based denial and child isolation',options,async t=>{
 const profile=loopbackProfile;
 const fixture_=await fixture(t,profile),proof=await expectNetworkProof(t,fixture_);
 assert.equal(proof.loopbackListenAddress,'127.0.0.1');assert.equal(proof.nonLoopbackDenied,true);assert.equal(proof.customLookupDenied,true);assert.equal(proof.nonNodeChildDenied,true);
 const environment=JSON.parse(await readFile(join(fixture_.out,'network-environment.json'),'utf8'));
 assert.equal(environment.sandboxSha256,createHash('sha256').update(profile).digest('hex'));
 assert.equal(environment.baseline.ipv4.bound,true);assert.equal(environment.baseline.ipv4.listened,true);
 await assert.rejects(access(join(fixture_.out,'network-failure.json')));
});
test('loopback denial stays a failed gate and preserves bounded diagnostics',options,async t=>{
 const fixture_=await fixture(t,'(version 1)\n(allow default)\n(deny network*)\n');
 await assert.rejects(proveHostNetwork(fixture_),/EPERM|EACCES/);
 const failure=JSON.parse(await readFile(join(fixture_.out,'network-failure.json'),'utf8'));
 assert.equal(failure.gatePassed,false);assert.equal(failure.baseline.ipv4.listened,true);
 assert.equal(failure.sandboxLoopback.ipv4.bound,false);assert.ok(['bind','listen'].includes(failure.sandboxLoopback.ipv4.stage));
 assert.match(failure.stderr,/EPERM|EACCES/);assert.ok(failure.stderr.length<=8192);
 await assert.rejects(access(join(fixture_.out,'network-proof.json')));
});
test('reusing an output directory cannot retain an earlier success or failure proof',options,async t=>{
 const fixture_=await fixture(t,loopbackProfile);
 await expectNetworkProof(t,fixture_);
 await writeFile(fixture_.sandbox,'(version 1)\n(allow default)\n(deny network*)\n');
 await assert.rejects(proveHostNetwork(fixture_),/EPERM|EACCES/);
 await assert.rejects(access(join(fixture_.out,'network-proof.json')));
 await access(join(fixture_.out,'network-failure.json'));
 await writeFile(fixture_.sandbox,loopbackProfile);
 await expectNetworkProof(t,fixture_);
 await assert.rejects(access(join(fixture_.out,'network-failure.json')));
});
