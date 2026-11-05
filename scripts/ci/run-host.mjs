import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,symlink,realpath} from 'node:fs/promises';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const run=promisify(execFile),here=fileURLToPath(new URL('.',import.meta.url));
const safeLog=text=>String(text??'').replace(/token=[^&\s]+/g,'token=[synthetic-redacted]');
export async function inspectInstalledAbi(packageRoot,{sdk,cordisVersion}){
 const require=createRequire(join(packageRoot,'package.json'));
 async function metadata(name){
  const resolvedEntry=require.resolve(name);let current=dirname(resolvedEntry);
  for(;;){
   try{const path=join(current,'package.json'),value=JSON.parse(await readFile(path,'utf8'));if(value.name===name)return{version:value.version,resolvedEntry,metadataPath:path};}catch(error){if(error.code!=='ENOENT')throw error;}
   const parent=dirname(current);assert.notEqual(parent,current,'Resolved package metadata missing: '+name);current=parent;
  }
 }
 const protocol=await metadata('@deepseek-ai/dsh-typert-protocol'),cordis=await metadata('@deepseek-ai/cordis');
 assert.equal(protocol.version,sdk,'Installed protocol ABI differs from the exact Host SDK');assert.equal(cordis.version,cordisVersion,'Installed Cordis ABI differs from the exact Host carrier');
 const manifest=JSON.parse(await readFile(join(packageRoot,'package.json'),'utf8')),peers={};
 for(const name of Object.keys(manifest.peerDependencies??{}).filter(name=>name.startsWith('@deepseek-ai/dsh-'))){peers[name]=await metadata(name);assert.equal(peers[name].version,sdk,'Installed SDK peer differs from the exact Host: '+name);}
 return{protocol,cordis,peers};
}
export async function runHost({root,carrier,sdk,out,cleanEnvironment,pnpm,offline=false,publicStore,publicCache}){
 assert.equal(process.platform,'darwin');
 const directory=await realpath(await mkdtemp(join(tmpdir(),'dsh-ci-official-host-'))),home=join(directory,'home'),project=join(directory,'project'),tools=join(directory,'tools');
 for(const path of [home,project,tools,join(out,'assets')])await mkdir(path,{recursive:true});
 const pnpmEntry=await realpath(pnpm??join(carrier,'node_modules/pnpm/bin/pnpm.cjs'));
 assert.equal(JSON.parse(await readFile(join(dirname(dirname(pnpmEntry)),'package.json'),'utf8')).version,'11.28.5','Host fixture requires exact pnpm11.28.5');
 await symlink(pnpmEntry,join(tools,'pnpm'));const env=cleanEnvironment(home);env.PATH=tools+':'+dirname(process.execPath)+':'+env.PATH;
 if(publicStore||publicCache){assert.ok(offline&&publicStore&&publicCache,'Public cache fixtures are offline-only');await mkdir(join(home,'Library/Caches'),{recursive:true});await mkdir(join(home,'.local/share/pnpm/store'),{recursive:true});await symlink(await realpath(publicCache),join(home,'Library/Caches/pnpm'));await symlink(await realpath(publicStore),join(home,'.local/share/pnpm/store/v11'));}
 await writeFile(join(project,'README.md'),'# Synthetic public management compatibility fixture\n');
 await run(process.execPath,[join(root,'scripts/build-management-package.mjs')],{cwd:root,env,timeout:30000,maxBuffer:1024*1024});
 const {stdout}=await run('npm',['pack','./management-plugin','--ignore-scripts','--json','--pack-destination',join(out,'assets')],{cwd:root,env,timeout:30000,maxBuffer:1024*1024});
 const packed=JSON.parse(stdout);assert.equal(packed.length,1);assert.equal(packed[0].name,'@oxmumu3/dot-dsh-management');
 const tarball=join(out,'assets',packed[0].filename),cli=join(carrier,'node_modules/@deepseek-ai/dsh/lib/bin.js');
 assert.equal(JSON.parse(await readFile(join(carrier,'node_modules/@deepseek-ai/dsh/package.json'),'utf8')).version,sdk);
 // This acquisition step fetches public npm dependencies only. The actual Host starts under the sandbox below.
 const install=await run(process.execPath,[cli,'plugin','--profile','web','add',...offline?['--offline']:[],'--ignore-scripts',tarball],{cwd:project,env,timeout:240000,maxBuffer:4*1024*1024});await writeFile(join(out,'install.log'),safeLog(install.stdout)+safeLog(install.stderr));
 const profile=JSON.parse(await readFile(join(env.DSH_HOME,'profiles/web/package.json'),'utf8')),thirdParty=Object.keys(profile.dependencies??{}).filter(name=>!name.startsWith('@deepseek-ai/'));
 assert.deepEqual(thirdParty,['@oxmumu3/dot-dsh-management']);
 const installedPackageRoot=join(env.DSH_HOME,'profiles/web/node_modules',packed[0].name),installedMembers=[];
 for(const file of packed[0].files){const expected=await readFile(join(root,'management-plugin',file.path)),actual=await readFile(join(installedPackageRoot,file.path));assert.deepEqual(actual,expected,'Installed package drift: '+file.path);installedMembers.push({path:file.path,sha256:createHash('sha256').update(actual).digest('hex')});}
 const runtimeLoaderSha256=installedMembers.find(file=>file.path==='runtime/src/harness-storage.js').sha256;
 const cordisVersion=JSON.parse(await readFile(join(carrier,'node_modules/@deepseek-ai/cordis/package.json'),'utf8')).version;
 await writeFile(join(out,'installed-byte-proof.json'),JSON.stringify({installedPackageRoot,allPackedFilesMatch:true,files:installedMembers},null,2)+'\n');

 const sandbox=join(out,'network.sb');await writeFile(sandbox,'(version 1)\n(allow default)\n(deny network*)\n(allow network-bind (local ip "localhost:*"))\n(allow network-inbound (local ip "localhost:*"))\n(allow network-outbound (remote ip "localhost:*"))\n(deny file-read* file-write* (subpath "/Applications"))\n(deny process-exec (subpath "/Applications"))\n');
 const network=await run('/usr/bin/sandbox-exec',['-f',sandbox,process.execPath,join(here,'network-proof.mjs')],{cwd:project,env,timeout:10000,maxBuffer:65536});const networkProof=JSON.parse(network.stdout);await writeFile(join(out,'network-proof.json'),JSON.stringify(networkProof,null,2)+'\n');
 const patch=join(directory,'proof.patch.yml');await writeFile(patch,JSON.stringify([{insert:[{id:'management-ci-host-proof',name:pathToFileURL(join(here,'host-observer.mjs')).href,config:{package:packed[0].name,version:packed[0].version,installedPackageRoot,sdk,cordisVersion}}]}]));
 async function stage(mode){
  const child=spawn('/usr/bin/sandbox-exec',['-f',sandbox,process.execPath,cli,'--profile','web','--patch',patch,'--host','127.0.0.1','--port','0','--no-open'],{cwd:project,env,stdio:['ignore','pipe','pipe','ipc']});let hostOut='',hostErr='',sent=false,value,forced=false;
  try{value=await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error('Isolated official Host '+mode+' timeout: '+safeLog(hostErr).slice(-1000))),45000),finish=fn=>value=>{clearTimeout(timer);fn(value);};
   child.stdout.on('data',bytes=>{hostOut=(hostOut+bytes).slice(-16000);if(!sent&&/dsh web: http:\/\//.test(hostOut)){sent=true;child.send({action:'proof',mode});}});
   child.stderr.on('data',bytes=>hostErr=(hostErr+bytes).slice(-16000));child.once('error',finish(reject));child.once('exit',code=>finish(reject)(Error('Own Host exited '+code+' '+safeLog(hostErr).slice(-1000))));child.on('message',message=>{if(message?.action==='proof')finish(resolve)(message);});
  });}finally{
   if(child.exitCode===null&&child.signalCode===null)await new Promise(resolve=>{const timer=setTimeout(()=>{forced=true;child.kill('SIGKILL');},10000);child.once('exit',()=>{clearTimeout(timer);resolve();});child.kill('SIGTERM');});
   await writeFile(join(out,'host-'+mode+'.log'),safeLog(hostOut)+safeLog(hostErr));
  }
  assert.equal(forced,false,'Own Host did not stop gracefully');assert.equal(value.passed,true,value.error);return{...value,pid:child.pid,ownHostExited:true};
 }
 const first=await stage('cycle'),restarted=await stage('restarted');assert.notEqual(first.pid,restarted.pid,'Host restart reused its process');assert.ok(first.installedAbi,'Actual Host did not report its installed ABI');assert.deepEqual(first.installedAbi,restarted.installedAbi,'Installed ABI changed after Host restart');const installedAbi=first.installedAbi;
 await writeFile(join(out,'installed-byte-proof.json'),JSON.stringify({installedPackageRoot,allPackedFilesMatch:true,installedAbi,files:installedMembers},null,2)+'\n');
 const uninstall=await run(process.execPath,[cli,'plugin','--profile','web','remove',...offline?['--config.offline=true']:[],'--config.ignore-scripts=true',packed[0].name],{cwd:project,env,timeout:240000,maxBuffer:4*1024*1024});await writeFile(join(out,'uninstall.log'),safeLog(uninstall.stdout)+safeLog(uninstall.stderr));
 const removedProfile=JSON.parse(await readFile(join(env.DSH_HOME,'profiles/web/package.json'),'utf8'));assert.equal(removedProfile.dependencies?.[packed[0].name],undefined,'Official CLI retained the plugin dependency');await assert.rejects(readFile(join(installedPackageRoot,'package.json')),error=>error.code==='ENOENT');
 const removed=await stage('removed');
 const result={...restarted,sdk,installedPackageRoot,runtimeLoaderSha256,installedAbi,installedFileCount:installedMembers.length,tarballSha256:createHash('sha256').update(await readFile(tarball)).digest('hex'),network:networkProof,thirdParty,lifecycle:{first,restarted,removed,officialCliUninstalled:true},onlyOwnHostExited:true,productionProfileUsed:false,compatibilityOverride:false,realAuthorizationCompleted:false,realModelCalled:false,realDotTaskVerified:false,desktopOnboardingVerified:false,packageAcquisitionOutsideSandbox:true};
 await writeFile(join(out,'host-proof.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));assert.equal(result.passed,true,result.error);
}
