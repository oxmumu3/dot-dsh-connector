import {readdir,readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('..',import.meta.url));
async function walk(dir){const result=[];for(const entry of await readdir(join(root,dir),{withFileTypes:true})){const path=join(dir,entry.name);if(entry.isDirectory())result.push(...await walk(path));else result.push(path);}return result;}
const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
assert.equal(pkg.name,'dot-dsh-connector');assert.equal(pkg.version,'0.6.0-preview.12');
const files=['index.js',...await walk('src'),...await walk('scripts'),'management-plugin/index.js',...await walk('management-plugin/src'),...await walk('management-plugin/scripts')];
for(const path of files.filter(path=>/\.[cm]?js$/.test(path))){const r=spawnSync(process.execPath,['--check',join(root,path)],{encoding:'utf8'});assert.equal(r.status,0,`${path}: ${r.stderr}`);}
const python=spawnSync('python3',['-c','import os,sys; assert sys.version_info >= (3,10); assert os.open in os.supports_dir_fd; assert hasattr(os,"O_NOFOLLOW"); print("Python descriptor reads supported")'],{encoding:'utf8'});assert.equal(python.status,0,'Python 3.10+ with nofollow/openat support required');
for(const path of ['LICENSE','THIRD_PARTY_NOTICES.md','third-party-licenses/modelcontextprotocol-sdk.txt','third-party-licenses/zod.txt','third-party-licenses/playwright-core.txt','third-party-licenses/playwright-core-NOTICE.txt','third-party-licenses/playwright-core-third-party.txt','docs/verification.md','docs/operator-runbook.md'])assert.ok((await readFile(join(root,path),'utf8')).trim());
const config=JSON.parse(await readFile(join(root,'examples/plugin-config.json'),'utf8'));assert.equal(config.enabled,false);assert.equal(config.publicOnlyHost,true);
const native=JSON.parse(await readFile(join(root,'management-plugin/package.json'),'utf8'));
assert.equal(native.dependencies['playwright-core'],'1.64.1');assert.equal(pkg.dependencies['playwright-core'],'1.64.1');assert.equal(native.name,'dot-dsh-management');assert.equal(native.version,pkg.version);assert.equal(native.author,'奥克斯木木山');assert.equal(pkg.dsh,undefined);assert.equal(native.dsh.bundle.patch,'./cordis.patch.yml');
// npm deliberately omits package-lock.json from published archives; shrinkwrap remains required.
for(const name of ['package-lock.json','npm-shrinkwrap.json']){const contents=await readFile(join(root,name),'utf8').catch(error=>{if(name==='package-lock.json'&&error.code==='ENOENT')return null;throw error;});if(contents===null)continue;const lock=JSON.parse(contents);assert.equal(lock.version,pkg.version);assert.equal(lock.packages[''].version,pkg.version);assert.deepEqual(lock.packages[''].bin,pkg.bin);}
console.log(JSON.stringify({syntax_files:files.length,python_descriptor_io:true,licenses:true,fixture_default_disabled:true,single_native_bundle:true,version:pkg.version}));
