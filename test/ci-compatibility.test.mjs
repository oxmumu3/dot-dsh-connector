import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {carrierDependencies,cleanEnvironment,assertSdk,workflowMatrix} from '../scripts/ci/compatibility.mjs';
const manifest=JSON.parse(await readFile(new URL('../compatibility.json',import.meta.url),'utf8'));
test('matrix follows the exact reviewed manifest and refuses unknown SDK input',()=>{
 assert.deepEqual(workflowMatrix(manifest),{sdk:manifest.verifiedSdks});
 for(const version of ['0.2.1-rc.6','0.2.2-alpha.2','0.2.2-alpha.3','0.2.2-alpha.4','latest','rc.5'])assert.throws(()=>assertSdk(version,manifest),/unverified SDK/);
});
test('carriers pin actual public contracts and all admitted package versions',()=>{
 const deps=carrierDependencies('0.2.1-rc.5',manifest);
 for(const name of ['dsh-agent-loop','dsh-api-gateway','dsh-client-connection','dsh-typert-registry','dsh-session-format-v0-to-v1','dsh-session-format-v1-to-v2','dsh-session-format-v2-to-v3','dsh-session-format-v3-to-v4'])assert.equal(deps['@deepseek-ai/'+name],'0.2.1-rc.5');
 assert.equal(deps['@deepseek-ai/cordis'],'4.0.5');assert.equal(deps['@deepseek-ai/dsh'],undefined);
 assert.equal(carrierDependencies('0.2.1-rc.5',manifest,true)['@deepseek-ai/dsh'],'0.2.1-rc.5');
 assert.equal(carrierDependencies('0.2.1-rc.5',manifest,true).pnpm,'11.28.5');
});
test('child processes receive synthetic paths without inherited keys or GitHub tokens',()=>{
 const env=cleanEnvironment('/synthetic/home',{PATH:'/node:/usr/bin',OPENAI_API_KEY:'private',GITHUB_TOKEN:'private',DSH_HOME:'/private/daily'});
 assert.equal(env.HOME,'/synthetic/home');assert.equal(env.DSH_HOME,'/synthetic/home/dsh');assert.equal(env.OPENAI_API_KEY,undefined);assert.equal(env.GITHUB_TOKEN,undefined);assert.equal(env.PATH,'/node:/usr/bin');
});
test('reusable gate and release preserve source, permissions and artifact binding',async()=>{
 const workflow=await readFile(new URL('../.github/workflows/compatibility.yml',import.meta.url),'utf8'),release=await readFile(new URL('../.github/workflows/npm-release.yml',import.meta.url),'utf8');
 for(const text of ['workflow_call:','pull_request:','schedule:','verified','fromJSON','macos-14','ubuntu-24.04'])assert.ok(workflow.includes(text),text);
 assert.match(workflow,/cron:.*0 3,15 \* \* \*/);assert.doesNotMatch(workflow,/id-token:\s*write|secrets:\s*inherit/);
 assert.match(release,/uses: \.\/\.github\/workflows\/compatibility.yml/);assert.match(release,/needs: compatibility/);assert.match(release,/COMPATIBILITY_SOURCE_SHA/);assert.match(release,/source_commit.*GITHUB_SHA/);assert.match(release,/permissions:\n\s+id-token: write/);
});

test('runtime sandbox explicitly admits bind while preserving network and privilege isolation',async()=>{
 const host=await readFile(new URL('../scripts/ci/run-host.mjs',import.meta.url),'utf8'),runner=await readFile(new URL('../scripts/ci/run-sandbox.py',import.meta.url),'utf8'),release=await readFile(new URL('../.github/workflows/npm-release.yml',import.meta.url),'utf8');
 assert.ok(host.includes('(allow network-bind (local ip "localhost:*"))'));assert.ok(runner.includes('(allow network-bind (local ip "localhost:*"))'));assert.ok(runner.includes('--no-new-privs'));assert.ok(release.indexOf('Recheck official SDK discovery immediately before packing')<release.indexOf('Pack and validate the exact release artifact'));
});

test('the current desktop carrier uses Cordis 4.1 while older SDKs keep Cordis 4.0',()=>{
 assert.equal(carrierDependencies('0.2.2-rc.1',manifest,true)['@deepseek-ai/cordis'],'4.1.0');
 assert.equal(carrierDependencies('0.2.2-rc.1',manifest)['@deepseek-ai/dsh-tool-executor-native'],'0.2.2-rc.1');
 assert.equal(carrierDependencies('0.2.1-rc.5',manifest)['@deepseek-ai/dsh-tool-executor-native'],undefined);
 assert.equal(carrierDependencies('0.2.1-rc.5',manifest,true)['@deepseek-ai/cordis'],'4.0.5');
});
