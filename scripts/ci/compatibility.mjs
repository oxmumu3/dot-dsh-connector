import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,realpath,mkdtemp} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {validateCompatibility} from '../check-compatibility.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url)),run=promisify(execFile);
const contracts=['dsh-agent','dsh-agent-loop','dsh-system-prompt','dsh-tools','dsh-llm','dsh-session','dsh-session-projection','dsh-agent-default-model','dsh-launch-environment','dsh-typert-protocol','dsh-typert-registry','dsh-api-gateway','dsh-client-connection','dsh-llm-deepseek-api-key'];
export function assertSdk(version,manifest){assert.ok(manifest.verifiedSdks.includes(version)&&/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version),'unverified SDK: '+version);return version;}
export function workflowMatrix(manifest){assert.ok(manifest.verifiedSdks.length>0&&manifest.verifiedSdks.length<=12);assert.equal(new Set(manifest.verifiedSdks).size,manifest.verifiedSdks.length);return{sdk:manifest.verifiedSdks.map(version=>assertSdk(version,manifest))};}
export function carrierDependencies(version,manifest,host=false){assertSdk(version,manifest);return{...Object.fromEntries(contracts.map(name=>['@deepseek-ai/'+name,version])),'@deepseek-ai/cordis':'4.0.5',zod:'4.6.7','@modelcontextprotocol/sdk':'1.32.1','playwright-core':'1.64.1',...host?{'@deepseek-ai/dsh':version,pnpm:'11.28.5'}:{}};}
export function cleanEnvironment(home,source=process.env){return{PATH:source.PATH??'/usr/bin:/bin:/usr/sbin:/sbin',HOME:home,XDG_CONFIG_HOME:join(home,'.config'),XDG_DATA_HOME:join(home,'.local/share'),DSH_HOME:join(home,'dsh'),DSH_AGENTS_HOME:join(home,'agents'),TMPDIR:tmpdir(),LANG:'en_US.UTF-8',CI:'true',DSH_TELEMETRY_DISABLED:'1',NPM_CONFIG_USERCONFIG:join(home,'empty.npmrc'),NPM_CONFIG_CACHE:join(home,'npm-cache')};}
async function carrier(rootPath,version,manifest){
 const directory=await realpath(rootPath);
 for(const [name,expected]of Object.entries(carrierDependencies(version,manifest))){const metadata=JSON.parse(await readFile(join(directory,'node_modules',name,'package.json'),'utf8'));assert.equal(metadata.version,expected,'Carrier mismatch: '+name);}
 return directory;
}
function options(args){const result={};while(args.length){const key=args.shift();assert.match(key,/^--[a-z-]+$/);if(key==='--host'){result.host=true;continue;}assert.ok(args.length&& !args[0].startsWith('--'),'Missing value for '+key);result[key.slice(2)]=args.shift();}return result;}
export async function main(args=process.argv.slice(2)){
 const command=args.shift(),options_=options(args),manifest=JSON.parse(await readFile(join(root,'compatibility.json'),'utf8'));
 if(command==='discover'){
  assert.ok(options_.out);const out=resolve(options_.out);await mkdir(out,{recursive:true});let official;
  if(options_.official)official=JSON.parse(await readFile(options_.official,'utf8'));
  else{const response=await fetch('https://registry.npmjs.org/@deepseek-ai%2fdsh',{signal:AbortSignal.timeout(15000)});assert.equal(response.status,200,'Official SDK discovery unavailable');const text=await response.text();assert.ok(Buffer.byteLength(text)<=4*1024*1024,'Official metadata exceeds bound');official=JSON.parse(text);}
  official={name:official.name,versions:Array.isArray(official.versions)?official.versions:Object.keys(official.versions??{}),'dist-tags':official['dist-tags']};
  const checked=await validateCompatibility({root,official}),matrix=workflowMatrix(manifest),{stdout}=await run('git',['rev-parse','HEAD'],{cwd:root});const sourceSha=stdout.trim();assert.match(sourceSha,/^[a-f0-9]{40}$/);
  await writeFile(join(out,'official.json'),JSON.stringify(official,null,2)+'\n');
  if(process.env.GITHUB_SHA)assert.equal(sourceSha,process.env.GITHUB_SHA,'Discovery did not check out the triggering source');
  const proof={...checked,matrix,sourceSha,manifestSha256:createHash('sha256').update(await readFile(join(root,'compatibility.json'))).digest('hex'),source:options_.official?'local-fixture':'official-npm-registry',desktopOnboardingVerified:false};
  await writeFile(join(out,'discovery.json'),JSON.stringify(proof,null,2)+'\n');
  if(process.env.GITHUB_OUTPUT)await writeFile(process.env.GITHUB_OUTPUT,`matrix=${JSON.stringify(matrix)}\nlatest_sdk=${checked.latestOfficial}\nsource_sha=${sourceSha}\n`,{flag:'a'});
  console.log(JSON.stringify(proof));return;
 }
 assertSdk(options_.sdk,manifest);
 if(command==='prepare'){
  assert.ok(options_.carrier);const directory=resolve(options_.carrier);await mkdir(directory,{recursive:true});
  await writeFile(join(directory,'package.json'),JSON.stringify({name:'synthetic-public-sdk-carrier',private:true,type:'module',dependencies:carrierDependencies(options_.sdk,manifest,options_.host)},null,2)+'\n',{flag:'wx'});
  const home=await mkdtemp(join(tmpdir(),'dsh-ci-package-home-'));const env=cleanEnvironment(home);
  await run('npm',['install','--ignore-scripts','--no-audit','--no-fund','--maxsockets=8'],{cwd:directory,env,timeout:480000,maxBuffer:4*1024*1024});
  await carrier(directory,options_.sdk,manifest);console.log(JSON.stringify({sdk:options_.sdk,carrier:directory,publicPackagesOnly:true,lifecycleHooks:false}));return;
 }
 assert.ok(options_.carrier&&options_.out);const directory=await carrier(options_.carrier,options_.sdk,manifest),out=resolve(options_.out);await mkdir(out,{recursive:true});
 if(command==='test'){
  assert.ok(options_.official,'An exact discovery snapshot is required');
  const official=JSON.parse(await readFile(options_.official,'utf8'));await validateCompatibility({root,official});
  const result=await run('python3',[join(root,'scripts/ci/run-sandbox.py'),'--sdk',options_.sdk,'--carrier',directory,'--out',out,'--node',process.execPath,'--official',resolve(options_.official)],{cwd:root,timeout:240000,maxBuffer:2*1024*1024});process.stdout.write(result.stdout);return;
 }
 if(command==='host'){
  assert.equal(process.platform,'darwin','Official Host smoke requires macOS, not a simulated Desktop preflight');
  const {runHost}=await import('./run-host.mjs');await runHost({root,carrier:directory,sdk:options_.sdk,out,cleanEnvironment,pnpm:options_.pnpm,offline:options_.offline==='true',publicStore:options_['public-store'],publicCache:options_['public-cache']});return;
 }
 throw Error('Unknown compatibility CI command: '+command);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
