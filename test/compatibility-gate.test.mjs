import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCompatibility} from '../scripts/check-compatibility.mjs';
const root=new URL('../',import.meta.url);
const official={name:'@deepseek-ai/dsh',versions:['0.2.1-rc.1','0.2.1-rc.2','0.2.1-rc.3','0.2.1-rc.4','0.2.1-rc.5','0.2.2-rc.1'],'dist-tags':{latest:'0.2.1-rc.5'}};
test('compatibility gate reconciles the exact verified declarations with official SDK discovery',async()=>{
 const result=await validateCompatibility({root,official});assert.equal(result.latestOfficial,'0.2.2-rc.1');assert.deepEqual(result.verifiedSdks,official.versions.slice(1));
});
test('new official rc or stable release fails closed before publication',async()=>{
 for(const version of ['0.2.1-rc.6','0.2.1','0.2.2-rc.2'])await assert.rejects(validateCompatibility({root,official:{...official,versions:[...official.versions,version],'dist-tags':{latest:version}}}),/unverified official SDK/);
});
test('empty or malformed official SDK discovery cannot be treated as no change',async()=>{
 for(const value of [null,{}, {...official,versions:[]},{...official,name:'third-party'},{...official,'dist-tags':{}}])await assert.rejects(validateCompatibility({root,official:value}),/official SDK discovery/);
});

test('reviewed alpha releases remain unsupported without blocking the verified latest channel',async()=>{
 const alphas=['0.2.2-alpha.2','0.2.2-alpha.3'];
 const result=await validateCompatibility({root,official:{...official,versions:[...official.versions,...alphas],'dist-tags':{...official['dist-tags'],alpha:'0.2.2-alpha.3'}}});
 assert.equal(result.latestOfficial,'0.2.2-rc.1');
 for(const version of alphas)assert.equal(result.verifiedSdks.includes(version),false);
});
test('an unreviewed alpha still fails closed and reviewed alphas cannot become latest',async()=>{
 await assert.rejects(validateCompatibility({root,official:{...official,versions:[...official.versions,'0.2.2-alpha.4']}}),/unverified official SDK 0\.2\.2-alpha\.4/);
 for(const version of ['0.2.2-alpha.2','0.2.2-alpha.3'])await assert.rejects(validateCompatibility({root,official:{...official,versions:[...official.versions,version],'dist-tags':{latest:version}}}),/unverified official SDK/);
});

test('the published desktop RC is admitted independently of the older npm latest CLI',async()=>{
 const result=await validateCompatibility({root,official:{...official,versions:[...official.versions,'0.2.2-alpha.2','0.2.2-alpha.3','0.2.2-rc.1'],'dist-tags':{latest:'0.2.1-rc.5',next:'0.2.2-rc.1',alpha:'0.2.2-alpha.3'}},desktop:{version:'0.2.2-rc.1'}});
 assert.ok(result.verifiedSdks.includes('0.2.2-rc.1'));assert.equal(result.registryLatest,'0.2.1-rc.5');assert.equal(result.latestOfficial,'0.2.2-rc.1');
});
test('a newer desktop outside the verified matrix cannot pass via an older CLI latest',async()=>{
 await assert.rejects(validateCompatibility({root,official,desktop:{version:'0.2.2-rc.2'}}),/unverified official desktop/);
});

test('desktop feed rejects duplicate versions and unbalanced YAML quotes',async()=>{
 const {readOfficialDesktop}=await import('../scripts/check-compatibility.mjs');
 for(const body of ['version: "0.2.2-rc.1\n','version: 0.2.2-rc.1\nversion: 0.2.2-rc.999\n'])await assert.rejects(readOfficialDesktop({fetchImpl:async()=>({status:200,text:async()=>body})}),/desktop/);
 assert.equal((await readOfficialDesktop({fetchImpl:async()=>({status:200,text:async()=>"version: '0.2.2-rc.1'\n"})})).version,'0.2.2-rc.1');
});
test('a registry tag cannot refer to a missing or malformed SDK version',async()=>{
 for(const next of ['0.2.2-rc.999','not-a-version'])await assert.rejects(validateCompatibility({root,official:{...official,'dist-tags':{...official['dist-tags'],next}}}),/official SDK discovery/);
});
