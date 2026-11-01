import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCompatibility} from '../scripts/check-compatibility.mjs';
const root=new URL('../',import.meta.url);
const official={name:'@deepseek-ai/dsh',versions:['0.2.1-rc.1','0.2.1-rc.2','0.2.1-rc.3','0.2.1-rc.4','0.2.1-rc.5'],'dist-tags':{latest:'0.2.1-rc.5'}};
test('compatibility gate reconciles the exact verified declarations with official SDK discovery',async()=>{
 const result=await validateCompatibility({root,official});assert.equal(result.latestOfficial,'0.2.1-rc.5');assert.deepEqual(result.verifiedSdks,official.versions.slice(1));
});
test('new official rc or stable release fails closed before publication',async()=>{
 for(const version of ['0.2.1-rc.6','0.2.1','0.2.2-rc.1'])await assert.rejects(validateCompatibility({root,official:{...official,versions:[...official.versions,version],'dist-tags':{latest:version}}}),/unverified official SDK/);
});
test('empty or malformed official SDK discovery cannot be treated as no change',async()=>{
 for(const value of [null,{}, {...official,versions:[]},{...official,name:'third-party'},{...official,'dist-tags':{}}])await assert.rejects(validateCompatibility({root,official:value}),/official SDK discovery/);
});

test('recorded alpha stays unsupported while discovery remains reviewable',async()=>{const result=await validateCompatibility({root,official:{...official,versions:[...official.versions,'0.2.2-alpha.2']}});assert.equal(result.verifiedSdks.includes('0.2.2-alpha.2'),false);await assert.rejects(validateCompatibility({root,official:{...official,versions:[...official.versions,'0.2.2-alpha.3']}}),/unverified official SDK/);});
