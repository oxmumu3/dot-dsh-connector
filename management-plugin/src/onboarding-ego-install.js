/** Explicit user-requested Ego setup. Inspection never downloads or opens applications. */
import {execFile as callbackExecFile} from 'node:child_process';
import {promisify} from 'node:util';
import {lstat,realpath,mkdir,mkdtemp,open,rm} from 'node:fs/promises';
import {constants} from 'node:fs';
import {homedir,tmpdir} from 'node:os';
import {join,resolve,isAbsolute,sep,basename} from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
const execFile=promisify(callbackExecFile);
// Official ego-browser skill scripts/install.sh distribution, verified 2026-10-23.
export const EGO_DOWNLOADS=Object.freeze({arm64:'https://cdn.ego.app/setup/macos/arm64/egolite-fHoqgZ74bOEM.dmg',x64:'https://cdn.ego.app/setup/macos/x64/egolite-fHoqgZ74bOEM.dmg'});
const APP='ego lite.app',TEAM='JGQLC6YQYJ',APP_ID='com.citrolabs.ego.lite',CLI_ID='com.citrolabs.ego.ego-browser',MAX_BYTES=300*1024*1024;
const requirement=id=>`anchor apple generic and identifier "${id}" and certificate leaf[subject.OU] = "${TEAM}" and certificate 1[field.1.2.840.113635.100.6.2.6] exists and certificate leaf[field.1.2.840.113635.100.6.1.13] exists`;
const messages={EGO_INSTALL_UNSUPPORTED:'自动安装目前支持 Apple Silicon 和 Intel Mac。',EGO_INSTALL_PATH:'Ego 安装目录无法安全使用，请检查本人的 Applications 文件夹后重试。',EGO_INSTALL_DOWNLOAD:'Ego 官方安装包下载未完成，请重试。',EGO_INSTALL_SIGNATURE:'Ego 安装包未通过官方签名或系统安全检查，未安装或打开。请从 lite.ego.app 获取官方版本。',EGO_INSTALL_EXISTS:'已发现另一份 Ego 安装，已保留；请重新继续连接。',EGO_INSTALL_COPY:'Ego 安装未完成，请重试。',EGO_INSTALL_OPEN:'Ego 未能打开，请手动打开 Ego，完成首次设置后继续连接。',EGO_INSTALL_BUSY:'Ego 正在准备，请稍候。'};
const fail=code=>Object.assign(new Error(messages[code]??messages.EGO_INSTALL_COPY),{code});
const abort=()=>Object.assign(new Error('Ego setup cancelled.'),{name:'AbortError'});
const check=signal=>{if(signal?.aborted)throw abort();};
const ownerOK=entry=>!process.getuid||entry.uid===0||entry.uid===process.getuid();
const canonical=path=>typeof path==='string'&&isAbsolute(path)&&resolve(path)===path&&!path.includes('\0');
const approvedURL=address=>{try{const u=new URL(address);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&['cdn.ego.app','lite.ego.app'].includes(u.hostname);}catch{return false;}};
async function optionalStat(path){try{return await lstat(path);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function safeDirectory(path,{create=false,owned=false,allowGroupWritable=false}={}){
 if(!canonical(path))throw fail('EGO_INSTALL_PATH');
 if(create){try{await mkdir(path,{mode:0o755});}catch(e){if(e.code!=='EEXIST')throw fail('EGO_INSTALL_PATH');}}
 const s=await optionalStat(path);if(!s)return null;
 if(!s.isDirectory()||s.isSymbolicLink()||await realpath(path)!==path||(s.mode&(allowGroupWritable?0o002:0o022))!==0||!ownerOK(s)||(owned&&process.getuid&&s.uid!==process.getuid()))throw fail('EGO_INSTALL_PATH');return s;
}
async function download(url,path,{fetchImpl,signal}){
 const bounded=AbortSignal.any([AbortSignal.timeout(300000),...(signal?[signal]:[])]);let response,reader,file;
 try{
  for(let redirects=0;redirects<4;redirects++){
   check(signal);if(!approvedURL(url))throw fail('EGO_INSTALL_DOWNLOAD');
   response=await fetchImpl(url,{redirect:'manual',signal:bounded});
   if(response.status>=300&&response.status<400){const next=response.headers.get('location');await response.body?.cancel().catch(()=>{});if(!next||redirects===3)throw fail('EGO_INSTALL_DOWNLOAD');url=new URL(next,url).href;continue;}break;
  }
  if(!response?.ok||!response.body)throw fail('EGO_INSTALL_DOWNLOAD');
  const rawLength=response.headers.get('content-length'),length=rawLength===null?null:Number(rawLength),sha=response.headers.get('x-amz-meta-sha256');
  if(length!==null&&(!Number.isSafeInteger(length)||length<=0||length>MAX_BYTES)||sha!==null&&!/^[a-f0-9]{64}$/.test(sha))throw fail('EGO_INSTALL_DOWNLOAD');
  file=await open(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);reader=response.body.getReader();const hash=createHash('sha256');let bytes=0;
  while(true){check(signal);bounded.throwIfAborted();const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>MAX_BYTES||length!==null&&bytes>length)throw fail('EGO_INSTALL_DOWNLOAD');hash.update(part.value);await file.writeFile(part.value);}
  if(!bytes||length!==null&&bytes!==length||sha!==null&&hash.digest('hex')!==sha)throw fail('EGO_INSTALL_DOWNLOAD');await file.sync();check(signal);
 }catch{check(signal);throw fail('EGO_INSTALL_DOWNLOAD');}finally{await reader?.cancel().catch(()=>{});await file?.close();}
}
export function createEgoInstaller({homeDirectory=homedir(),systemApplicationsDirectory='/Applications',platform=process.platform,arch=process.arch,fetchImpl=globalThis.fetch,execFileImpl=execFile}={}){
 const home=homeDirectory,applications=join(home,'Applications'),target=join(applications,APP),systemApp=join(systemApplicationsDirectory,APP),cli=join(home,'.local','bin','ego-browser');let busy=false;
 async function run(command,args,{signal,code='EGO_INSTALL_COPY',timeout=120000,input}={}){
  check(signal);try{const pending=execFileImpl(command,args,{shell:false,windowsHide:true,encoding:'utf8',maxBuffer:32768,timeout,signal,killSignal:'SIGKILL',input});pending.child?.stdin?.on('error',()=>{});pending.child?.stdin?.end(input??'');const result=await pending;check(signal);return result;}catch{check(signal);throw fail(code);}
 }
 async function verify(path,id,{signal,deep=false,gatekeeper=false,timeout=120000}={}){
  if(deep)await run('/usr/bin/codesign',['--verify','--strict','--deep',path],{signal,code:'EGO_INSTALL_SIGNATURE',timeout});
  await run('/usr/bin/codesign',['--verify','--strict','-R='+requirement(id),path],{signal,code:'EGO_INSTALL_SIGNATURE',timeout});
  if(gatekeeper)await run('/usr/sbin/spctl',['--assess','--type','execute',path],{signal,code:'EGO_INSTALL_SIGNATURE',timeout:180000});
 }
 async function isReady({signal}={}){
  check(signal);if(platform!=='darwin')return false;
  try{
   if(!canonical(home)||await realpath(home)!==home)throw 0;
   const entry=await optionalStat(cli);if(!entry)return false;let actual=cli;
   if(entry.isSymbolicLink()){
    actual=await realpath(cli);const roots=[join(home,'.local','share','ego'),join(systemApp,'Contents'),join(target,'Contents')];if(!roots.some(root=>actual.startsWith(root+sep))||basename(actual)!=='ego-browser')throw 0;
   }else if(!entry.isFile()||await realpath(cli)!==cli)throw 0;
   const s=await lstat(actual);if(!s.isFile()||s.isSymbolicLink()||(s.mode&0o111)===0||(s.mode&0o002)!==0||!ownerOK(s))throw 0;
   await verify(actual,CLI_ID,{signal});const marker='__DSH_EGO_READY_'+randomBytes(16).toString('hex')+'__';
   const result=await run(cli,['nodejs'],{input:`if (typeof taskSpace === 'function') console.log(${JSON.stringify(marker)});`,signal,timeout:15000});
   return[String(result.stdout??''),String(result.stderr??'')].flatMap(s=>s.split(/\r?\n/)).filter(line=>line===marker).length===1;
  }catch{check(signal);return false;}
 }
 async function existingApp({signal}={}){
  for(const [parent,path]of [[systemApplicationsDirectory,systemApp],[applications,target]]){
   if(!await optionalStat(parent))continue;await safeDirectory(parent,{allowGroupWritable:parent===systemApplicationsDirectory});const s=await optionalStat(path);if(!s)continue;
   if(!s.isDirectory()||s.isSymbolicLink()||!ownerOK(s)||(s.mode&0o002)!==0||await realpath(path)!==path)throw fail('EGO_INSTALL_PATH');
   await verify(path,APP_ID,{signal,deep:true,gatekeeper:true});return path;
  }return null;
 }
 // Only call from an explicit install/continue action; never from a status poll or auto-restore.
 async function prepare({signal,onProgress}={}){
  check(signal);if(busy)throw fail('EGO_INSTALL_BUSY');if(platform!=='darwin'||!EGO_DOWNLOADS[arch])throw fail('EGO_INSTALL_UNSUPPORTED');busy=true;
  const progress=phase=>{try{onProgress?.({phase});}catch{}};
  let work,mount,attachAttempted=false,detached=false,reserved,installed=false;
  try{
   if(await isReady({signal}))return{ready:true};check(signal);
   await safeDirectory(home,{owned:true});let app=await existingApp({signal});
   if(!app){
    await safeDirectory(applications,{create:true,owned:true});check(signal);
    work=await mkdtemp(join(await realpath(tmpdir()),'dsh-ego-install-'));mount=join(work,'mount');await mkdir(mount,{mode:0o700});const dmg=join(work,'ego.dmg');
    progress('downloading');await download(EGO_DOWNLOADS[arch],dmg,{fetchImpl,signal});check(signal);
    progress('verifying');attachAttempted=true;await run('/usr/bin/hdiutil',['attach',dmg,'-nobrowse','-readonly','-noautoopen','-mountpoint',mount],{signal,timeout:600000});
    const source=join(mount,APP),s=await optionalStat(source);if(!s?.isDirectory()||s.isSymbolicLink()||await realpath(source)!==source)throw fail('EGO_INSTALL_SIGNATURE');
    // mkdir is exclusive: concurrent installations and every existing app are preserved.
    await safeDirectory(applications,{owned:true});try{await mkdir(target,{mode:0o700});}catch(e){if(e.code==='EEXIST')throw fail('EGO_INSTALL_EXISTS');throw fail('EGO_INSTALL_COPY');}reserved=await lstat(target);
    progress('installing');await run('/usr/bin/ditto',[source,target],{signal});check(signal);
    // The official HFS image carries Finder metadata which strict codesign rejects.
    // Normalize only this exclusive new copy. -s acts on symlinks, never their targets;
    // quarantine and every other attribute stay intact. Existing apps are never altered.
    const assertReserved=async()=>{const current=await lstat(target);if(!current.isDirectory()||current.isSymbolicLink()||current.dev!==reserved.dev||current.ino!==reserved.ino||await realpath(target)!==target)throw fail('EGO_INSTALL_PATH');};
    for(const attribute of ['com.apple.FinderInfo','com.apple.ResourceFork']){await assertReserved();await run('/usr/bin/xattr',['-drs',attribute,target],{signal,code:'EGO_INSTALL_SIGNATURE'});}
    // Verify the exact copy we will execute, avoiding repeated scans of the compressed image.
    // Until both checks pass this reserved directory is untrusted and is rolled back on failure.
    progress('verifying');await verify(target,APP_ID,{signal,deep:true,gatekeeper:true,timeout:600000});check(signal);await assertReserved();installed=true;app=target;
   }
   // Detach our own read-only image before opening the installed application.
   if(attachAttempted){await run('/usr/bin/hdiutil',['detach',mount,'-quiet'],{signal,timeout:15000});detached=true;}
   progress('opening');await run('/usr/bin/open',[app],{signal,code:'EGO_INSTALL_OPEN',timeout:15000});check(signal);
   return{ready:false,needsOnboarding:true};
  }catch(e){check(signal);if(e?.code&&Object.hasOwn(messages,e.code))throw e;throw fail('EGO_INSTALL_COPY');}
  finally{
   if(reserved&&!installed){try{const current=await lstat(target);if(current.isDirectory()&&!current.isSymbolicLink()&&current.dev===reserved.dev&&current.ino===reserved.ino)await rm(target,{recursive:true});}catch{}}
   if(attachAttempted&&!detached){try{await run('/usr/bin/hdiutil',['detach',mount,'-quiet'],{timeout:15000});detached=true;}catch{}}
   // Never recursively remove a still-mounted filesystem.
   if(work&&(!attachAttempted||detached))await rm(work,{recursive:true,force:true}).catch(()=>{});busy=false;
  }
 }
 return{isReady,prepare};
}
