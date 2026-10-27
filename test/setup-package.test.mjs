import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,realpath,mkdir,writeFile,readFile,rm,symlink} from 'node:fs/promises';import {join,resolve} from 'node:path';import {tmpdir} from 'node:os';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {pathToFileURL,fileURLToPath} from 'node:url';
import {buildManagementPackage} from '../scripts/build-management-package.mjs';
import {createAdminAdapter} from '../management-plugin/index.js';
import {runtimePreflight} from '../management-plugin/src/setup-runtime.js';
const exec=promisify(execFile),root=fileURLToPath(new URL('..',import.meta.url));
async function temp(t){const base=await realpath(await mkdtemp(join(tmpdir(),'dot-package-')));t.after(()=>rm(base,{recursive:true,force:true}));return base;}
test('runtime preflight reports unsupported platform, SDK, Python and absent Desktop profile separately',async()=>{
 const checks=await runtimePreflight({dshHome:'/nonexistent-synthetic-dsh',platform:'linux',nodeVersion:'22.13.0',checkSdk:async()=> '0.1.0',checkPython:async()=>{throw Error('private failure');}});
 assert.deepEqual(checks.map(c=>[c.id,c.ok]),[['platform',false],['node',false],['sdk',false],['python',false],['profile',false]]);assert.doesNotMatch(JSON.stringify(checks),/private failure/);
});
test('one native archive contains runtime code, preserves package identity and starts actual owned services from a temporary extraction',async t=>{
 const base=await temp(t);await buildManagementPackage();
 const packed=JSON.parse((await exec('npm',['pack','./management-plugin','--pack-destination',base,'--json'],{cwd:root,maxBuffer:1024*1024})).stdout)[0];
 const names=packed.files.map(file=>file.path);for(const path of ['runtime/scripts/management.mjs','runtime/scripts/harness-read.mjs','runtime/scripts/mcp.mjs','runtime/src/management.js','src/setup-runtime.js','scripts/mcp-managed.mjs','THIRD_PARTY_NOTICES.md'])assert.ok(names.includes(path),path);
 assert.equal(names.some(path=>/admin\.key|channel\.key|config\.json|runtime\.lock/.test(path)),false);
 await exec('tar',['-xzf',join(base,packed.filename),'-C',base]);const installed=join(base,'package');await symlink(resolve(root,'node_modules'),join(installed,'node_modules'));
 const manifest=JSON.parse(await readFile(join(installed,'package.json'),'utf8'));assert.equal(manifest.name,'@oxmumu3/dot-dsh-management');assert.equal(manifest.author,'牛村木木山');assert.equal(manifest.dependencies['@modelcontextprotocol/sdk'],'1.32.1');assert.equal(manifest.dependencies['dot-dsh-connector'],undefined);
 const rootManifest=JSON.parse(await readFile(join(root,'package.json'),'utf8'));assert.equal(rootManifest.dsh,undefined);
 const {createManagedRuntime}=await import(pathToFileURL(join(installed,'src/setup-runtime.js')).href);const dshHome=join(base,'harness');await mkdir(join(dshHome,'profiles','desktop'),{recursive:true});await mkdir(join(dshHome,'storages'));
 const runtime=createManagedRuntime({dshHome,dataDir:join(base,'private'),ports:{reader:0,gateway:0,admin:0,worker:0},preflight:async()=>[{id:'synthetic-profile',ok:true,message:'Temporary fixture'}]});t.after(()=>runtime.close());
 const started=await runtime.start();assert.equal(started.phase,'running',JSON.stringify(started));const adapter=await createAdminAdapter(await runtime.adminReference());t.after(()=>adapter.close());
 const overview=await adapter.call('manager_overview',{include_control:false});assert.equal(overview.scope.task,'native_workspace');assert.equal(overview.connection.cloud_state,'not_configured');
 const before=await readFile(join(base,'private','config.json'),'utf8');await runtime.stop();assert.equal((await runtime.status()).services.manager,'stopped');assert.equal(JSON.parse(before).principal,JSON.parse(await readFile(join(base,'private','config.json'),'utf8')).principal);
});
