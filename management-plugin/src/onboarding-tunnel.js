/** Downloads pinned official code and supervises only this installation's child. */
import {open,lstat,realpath,unlink,rename,rm,mkdir} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join} from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {spawn,execFile as callbackExecFile} from 'node:child_process';
import {promisify} from 'node:util';
import {ensurePrivateDirectory,readPrivateStateFile,writeNewPrivateStateFile,canonicalPrivatePath} from './onboarding-store.js';
const execFile=promisify(callbackExecFile);
const base='https://github.com/openai/tunnel-client/releases/download/v0.0.16/';
export const OFFICIAL_TUNNEL_ARTIFACTS=Object.freeze({
 arm64:Object.freeze({arch:'arm64',url:base+'tunnel-client-v0.0.16-darwin-arm64.zip',size:27041422,sha256:'a160820d45089b5253d8d671fe2a689bde0f73d78c135d1497a7b33f28a3ac62'}),
 x64:Object.freeze({arch:'amd64',url:base+'tunnel-client-v0.0.16-darwin-amd64.zip',size:28886485,sha256:'57b3dd73f2d042c7aeb5664681f7538078359f55538b9e048640f1df71a0c83f'}),
});
const fail=code=>Object.assign(new Error('The private official Tunnel runtime is unavailable.'),{code});
const aborted=signal=>{if(signal?.aborted)throw Object.assign(new Error('Cancelled.'),{name:'AbortError'});};
async function pause(ms,signal){aborted(signal);await new Promise((done,reject)=>{const timer=setTimeout(finish,ms);function finish(){signal?.removeEventListener('abort',abort);done();}function abort(){clearTimeout(timer);signal?.removeEventListener('abort',abort);reject(Object.assign(new Error('Cancelled.'),{name:'AbortError'}));}signal?.addEventListener('abort',abort,{once:true});});}
function artifactValid(a){return a&&['arm64','amd64','x64'].includes(a.arch)&&/^https:\/\/github\.com\/openai\/tunnel-client\/releases\/download\/v0\.0\.16\/tunnel-client-v0\.0\.16-darwin-(arm64|amd64)\.zip$/.test(a.url)&&Number.isSafeInteger(a.size)&&a.size>0&&a.size<=40*1024*1024&&/^[a-f0-9]{64}$/.test(a.sha256);}
function approvedURL(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&(['github.com','release-assets.githubusercontent.com'].includes(u.hostname));}catch{return false;}}
async function download(artifact,target,{fetchImpl,signal}){
 let address=artifact.url,response;for(let redirects=0;redirects<4;redirects++){
  aborted(signal);if(!approvedURL(address))throw fail('TUNNEL_DOWNLOAD');
  response=await fetchImpl(address,{redirect:'manual',signal:AbortSignal.any([AbortSignal.timeout(120000),...(signal?[signal]:[])])});
  if(response.status>=300&&response.status<400){const next=response.headers.get('location');await response.body?.cancel().catch(()=>{});if(!next||redirects===3)throw fail('TUNNEL_DOWNLOAD');address=new URL(next,address).href;continue;}
  if(!response.ok||!response.body)throw fail('TUNNEL_DOWNLOAD');break;
 }
 if(!response?.ok)throw fail('TUNNEL_DOWNLOAD');
 const reader=response.body.getReader(),hash=createHash('sha256');let count=0,h;
 try{h=await open(target,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);while(true){aborted(signal);const r=await reader.read();if(r.done)break;count+=r.value.byteLength;if(count>artifact.size)throw fail('TUNNEL_INTEGRITY');hash.update(r.value);await h.write(r.value);}await h.sync();if(count!==artifact.size||hash.digest('hex')!==artifact.sha256)throw fail('TUNNEL_INTEGRITY');}
 finally{await reader.cancel().catch(()=>{});await h?.close();}
}
const EXTRACT=String.raw`import os,stat,sys,zipfile,hashlib
archive,dest,arch,action,expected_sha,expected_size=sys.argv[1:]
allowed={'tunnel-client','LICENSE','NOTICE','tunnel-client-v0.0.16-darwin-'+arch+'-licenses.txt','tunnel-client-v0.0.16-darwin-'+arch+'.spdx.json','cloudflared','cloudflared-manifest.json'}
required=allowed-{'cloudflared','cloudflared-manifest.json'}
def safe(fd,mode,size):
 info=os.fstat(fd)
 if not stat.S_ISREG(info.st_mode) or info.st_nlink!=1 or stat.S_IMODE(info.st_mode)!=mode or info.st_uid!=os.getuid() or info.st_size!=size:raise ValueError('private file')
def digest(stream):
 h=hashlib.sha256()
 while True:
  b=stream.read(65536)
  if not b:break
  h.update(b)
 return h.hexdigest()
fd=os.open(archive,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
with os.fdopen(fd,'rb') as source:
 safe(source.fileno(),0o600,int(expected_size))
 if digest(source)!=expected_sha:raise ValueError('archive integrity')
 source.seek(0)
 with zipfile.ZipFile(source) as z:
  members=z.infolist()
  if len(members)>20:raise ValueError('members')
  seen=set();total=0
  for m in members:
   mode=m.external_attr>>16
   if m.filename in seen or m.filename not in allowed or '/' in m.filename or '\\' in m.filename or m.is_dir() or m.flag_bits&1 or (stat.S_IFMT(mode) not in (0,stat.S_IFREG)):raise ValueError('member')
   seen.add(m.filename);total+=m.file_size
   if total>160*1024*1024 or m.file_size>80*1024*1024:raise ValueError('size')
  if not required.issubset(seen):raise ValueError('required')
  if action=='check' and set(os.listdir(dest))!=required|{'archive.zip'}:raise ValueError('cache layout')
  for m in members:
   if m.filename.startswith('cloudflared'):continue
   path=os.path.join(dest,m.filename);mode=0o700 if m.filename=='tunnel-client' else 0o600
   if action=='check':
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    with os.fdopen(fd,'rb') as cached,z.open(m) as original:
     safe(cached.fileno(),mode,m.file_size)
     if digest(cached)!=digest(original):raise ValueError('cache integrity')
   else:
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,mode)
    with z.open(m) as original,os.fdopen(fd,'wb') as out:
     while True:
      b=original.read(65536)
      if not b:break
      out.write(b)
     out.flush();os.fsync(out.fileno())
`;
async function archiveAction({archive,destination,artifact,action,signal}){
 try{const executable=await(await import('../runtime/src/python-runtime.js')).pythonExecutable();await execFile(executable,['-I','-S','-c',EXTRACT,archive,destination,artifact.arch==='x64'?'amd64':artifact.arch,action,artifact.sha256,String(artifact.size)],{timeout:30000,maxBuffer:4096,signal,env:{PATH:process.env.PATH??'/usr/bin:/bin'}});}catch(e){if(signal?.aborted)throw e;throw fail('TUNNEL_ARCHIVE');}
}
export async function installTunnel({directory,artifact=OFFICIAL_TUNNEL_ARTIFACTS[process.arch],fetchImpl=globalThis.fetch,signal,platform=process.platform}={}){
 if(platform!=='darwin'||!artifactValid(artifact))throw fail('TUNNEL_UNSUPPORTED');await ensurePrivateDirectory(directory,{create:true});
 const installed=join(directory,'v0.0.16-'+(artifact.arch==='x64'?'amd64':artifact.arch));
 try{const existing=await lstat(installed);if(!existing.isDirectory()||await realpath(installed)!==installed||(process.getuid&&existing.uid!==process.getuid()))throw fail('TUNNEL_PRIVATE_STATE');}catch(e){if(e.code!=='ENOENT')throw e;}
 const inspect=async()=>{await ensurePrivateDirectory(installed);await archiveAction({archive:join(installed,'archive.zip'),destination:installed,artifact,action:'check',signal});};
 try{await inspect();return{binary:join(installed,'tunnel-client'),directory:installed,cached:true};}catch(e){aborted(signal);}
 const suffix=randomBytes(12).toString('hex'),archive=join(directory,'download-'+suffix+'.zip'),staging=join(directory,'extract-'+suffix);
 try{
  await download(artifact,archive,{fetchImpl,signal});aborted(signal);await mkdir(staging,{mode:0o700});
  await archiveAction({archive,destination:staging,artifact,action:'extract',signal});await rename(archive,join(staging,'archive.zip'));await archiveAction({archive:join(staging,'archive.zip'),destination:staging,artifact,action:'check',signal});aborted(signal);
  // A concurrent installer may already have completed. Never replace its good cache.
  try{await inspect();return{binary:join(installed,'tunnel-client'),directory:installed,cached:true};}catch(e){aborted(signal);}
  try{const info=await lstat(installed);if(!info.isDirectory()||await realpath(installed)!==installed||(process.getuid&&info.uid!==process.getuid()))throw fail('TUNNEL_PRIVATE_STATE');await rm(installed,{recursive:true});}catch(e){if(e.code!=='ENOENT')throw e;}
  await rename(staging,installed);return{binary:join(installed,'tunnel-client'),directory:installed,cached:false};
 }finally{await unlink(archive).catch(()=>{});await rm(staging,{recursive:true,force:true}).catch(()=>{});}
}
const environment=()=>Object.fromEntries(['PATH','HOME','LANG','LC_ALL','TMPDIR','HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','http_proxy','https_proxy','all_proxy','no_proxy','SSL_CERT_FILE','SSL_CERT_DIR','NODE_EXTRA_CA_CERTS'].filter(k=>typeof process.env[k]==='string').map(k=>[k,process.env[k]]));
export async function probeTunnelHealth({healthFile,fetchImpl=globalThis.fetch,signal,now=Date.now}={}){
 const address=(await readPrivateStateFile(healthFile,2048)).trim();let u;try{u=new URL(address);}catch{throw fail('TUNNEL_HEALTH');}
 if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||!u.port||u.username||u.password||u.hash||u.search||!['','/','/health'].includes(u.pathname))throw fail('TUNNEL_HEALTH');
 u.pathname='/health';u.search='details=true';const response=await fetchImpl(u,{redirect:'error',signal:AbortSignal.any([AbortSignal.timeout(2000),...(signal?[signal]:[])])});
 const reader=response.body?.getReader();if(!reader)throw fail('TUNNEL_HEALTH');const chunks=[];let bytes=0;
 try{while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>65536)throw fail('TUNNEL_HEALTH');chunks.push(part.value);}}finally{await reader.cancel().catch(()=>{});}
 const data=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(Buffer.concat(chunks))),snapshot=Date.parse(data?.snapshot_at),started=Date.parse(data?.runtime?.started_at),current=now();
 if(![200,503].includes(response.status)||data?.schema_version!==1||data?.live!==true||!Number.isFinite(snapshot)||current-snapshot>15000||snapshot-current>5000||!Number.isFinite(started)||started>snapshot||data?.runtime?.lifecycle!=='running'||typeof data.runtime.instance_id!=='string'||!/^[-A-Za-z0-9_]{1,128}$/.test(data.runtime.instance_id))throw fail('TUNNEL_HEALTH');
 return{healthy:true,ready:data.ready===true};
}
export function createTunnelRuntime({directory,installationId,install=installTunnel,spawnImpl=spawn,probe=probeTunnelHealth,pollMs=250,startTimeoutMs=30000}={}){
 canonicalPrivatePath(directory);if(typeof installationId!=='string'||!/^[a-f0-9]{32}$/.test(installationId))throw fail('TUNNEL_PRIVATE_STATE');
 let distribution,child,closed=false,spawnFailure,exitSeen=false;const healthFile=join(directory,'health.url');
 async function close(){closed=true;const owned=child;child=undefined;if(!owned||owned.exitCode!==null||exitSeen)return;
  await new Promise(done=>{let timer;const finish=()=>{clearTimeout(timer);owned.removeListener('exit',finish);done();};owned.once('exit',finish);owned.kill('SIGTERM');timer=setTimeout(()=>{if(owned.exitCode===null)owned.kill('SIGKILL');finish();},4000);timer.unref?.();});
 }
 return{healthFile,async prepare({signal}={}){if(closed)throw fail('TUNNEL_CLOSED');await ensurePrivateDirectory(directory,{create:true});distribution=await install({directory:join(directory,'tools'),signal});return{installed:true};},async start({tunnel_id,runtimeKeyFile,mcpCommand,signal}={}){
  if(closed)throw fail('TUNNEL_CLOSED');if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(tunnel_id??'')||typeof mcpCommand!=='string'||mcpCommand.length>8192||mcpCommand.includes('\0'))throw fail('TUNNEL_PRIVATE_STATE');
  await readPrivateStateFile(runtimeKeyFile,4096);if(!distribution)await this.prepare({signal});await ensurePrivateDirectory(directory);aborted(signal);
  if(child)throw fail('TUNNEL_RUNNING');const logFile=join(directory,'tunnel-'+randomBytes(8).toString('hex')+'.log');await writeNewPrivateStateFile(logFile,'');
  try{const s=await lstat(healthFile);if(!s.isFile()||s.nlink!==1||(s.mode&0o077)!==0)throw fail('TUNNEL_PRIVATE_STATE');await readPrivateStateFile(healthFile,2048);await unlink(healthFile);}catch(e){if(e.code!=='ENOENT')throw e;}
  const args=['run','--control-plane.tunnel-id',tunnel_id,'--control-plane.api-key','file:'+runtimeKeyFile,'--mcp.command',mcpCommand,'--health.listen-addr','127.0.0.1:0','--health.url-file',healthFile,'--log.file',logFile,'--log.level','warn'];
  if(closed)throw fail('TUNNEL_CLOSED');aborted(signal);
  child=spawnImpl(distribution.binary,args,{shell:false,windowsHide:true,stdio:['ignore','ignore','ignore'],env:environment()});child.once('error',()=>{spawnFailure=true;});child.once('exit',()=>{exitSeen=true;});
  const stop=()=>{void close();};signal?.addEventListener('abort',stop,{once:true});
  try{const deadline=Date.now()+startTimeoutMs;while(Date.now()<deadline){aborted(signal);if(spawnFailure||exitSeen||child?.exitCode!==null)throw fail('TUNNEL_START');try{const health=await probe({healthFile,signal});if(health.healthy)return health;}catch(e){if(signal?.aborted)throw e;}await pause(pollMs,signal);}throw fail('TUNNEL_HEALTH');}
  catch(e){await close();throw e;}finally{signal?.removeEventListener('abort',stop);}
 },close};
}
