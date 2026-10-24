/** A private stdin lifeline. Only this process's direct child is ever signalled. */
import {spawn} from 'node:child_process';
import {open,lstat,unlink} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {canonicalPrivatePath,ensurePrivateDirectory,readPrivateStateFile} from './onboarding-store.js';

const self=fileURLToPath(import.meta.url),lifelines=new WeakMap();
const delay=ms=>new Promise(done=>setTimeout(done,ms));
const failure=()=>new Error('Private Tunnel supervision failed.');
const same=(a,b)=>a.dev===b.dev&&a.ino===b.ino;
const privateFile=s=>s.isFile()&&s.nlink===1&&(s.mode&0o077)===0&&s.uid===process.getuid();

export function spawnOwnedTunnel(binary,args,{ownerDirectory,...options}={}){
 canonicalPrivatePath(ownerDirectory);
 // Harness may launch this module under Electron's executable. This flag makes
 // the helper a Node process without opening another desktop application.
 const child=spawn(process.execPath,[self,'--supervise-tunnel',ownerDirectory,binary,...args],{
  ...options,shell:false,stdio:['pipe','pipe','ignore'],env:{...options.env,ELECTRON_RUN_AS_NODE:'1'},
 });
 const state={started:false};let received='';lifelines.set(child,state);
 child.stdin?.on('error',()=>{});child.stdout.on('error',()=>stopOwnedTunnel(child));
 child.stdout.on('data',chunk=>{received+=chunk.toString('ascii');if(received==='started\n')state.started=true;else if(received.length>=8)stopOwnedTunnel(child);});
 return child;
}

export function ownedTunnelReady(child){return lifelines.get(child)?.started??true;}

export function stopOwnedTunnel(child){
 if(!lifelines.has(child))return false;
 // EOF also happens automatically when the Host is killed. Do not kill the
 // helper: it must retain its guard until its child has actually been reaped.
 child.stdin?.end();return true;
}

async function acquireGuard(directory,closing){
 if(process.platform!=='darwin')throw failure();
 const path=join(directory,'tunnel.guard'),deadline=Date.now()+5000;
 while(!closing()){
  await ensurePrivateDirectory(directory);let handle;
  try{
   // Darwin O_EXLOCK is atomic with open and released by the kernel. The inode
   // is permanent; unlinking it would permit two independently locked files.
   handle=await open(path,constants.O_RDWR|constants.O_CREAT|constants.O_NOFOLLOW|constants.O_NONBLOCK|0x20,0o600);
   const held=await handle.stat(),named=await lstat(path);
   if(!privateFile(held)||!privateFile(named)||!same(held,named))throw failure();
   await ensurePrivateDirectory(directory);return handle;
  }catch(error){
   await handle?.close();
   if(!['EAGAIN','EWOULDBLOCK'].includes(error.code)||Date.now()>=deadline)throw failure();
   await delay(50);
  }
 }
}

export async function superviseTunnel(directory,binary,args){
 canonicalPrivatePath(directory);canonicalPrivatePath(binary);
 let closing=false,child,guard,killTimer,childDone=false,finishChild;
 const exited=new Promise(done=>{finishChild=done;});
 const finish=()=>{childDone=true;clearTimeout(killTimer);finishChild();};
 const stop=()=>{
  closing=true;if(!child||childDone||killTimer)return;
  child.kill('SIGTERM');
  killTimer=setTimeout(()=>{if(!childDone)child.kill('SIGKILL');},1000);
 };
 // Register before the first await or spawn, including EOF while waiting for
 // an older helper to finish cleaning up this installation's child.
 process.stdin.on('end',stop);process.stdin.on('error',stop);process.stdout.on('error',stop);
 process.on('SIGTERM',stop);process.on('SIGINT',stop);process.stdin.resume();
 try{
  guard=await acquireGuard(directory,()=>closing);
  if(closing||!guard)return 0;
  const named=await lstat(join(directory,'tunnel.guard'));
  if(!privateFile(named)||!same(await guard.stat(),named))throw failure();
  // The old owner can have written its health file after the new Host began.
  // Clear it only once we own the guard, before starting our own child.
  const healthFile=join(directory,'health.url');
  if(args[args.indexOf('--health.url-file')+1]!==healthFile)throw failure();
  try{await readPrivateStateFile(healthFile,2048);await unlink(healthFile);}catch(error){if(error.code!=='ENOENT')throw error;}
  if(closing)return 0;
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  child=spawn(binary,args,{shell:false,windowsHide:true,stdio:'ignore',env});
  child.once('error',finish);child.once('exit',finish);
  child.once('spawn',()=>{if(!closing)process.stdout.write('started\n');});
  if(closing)stop();
  await exited;return closing?0:1;
 }finally{
  clearTimeout(killTimer);await guard?.close();
  process.stdin.removeListener('end',stop);process.stdin.removeListener('error',stop);process.stdout.removeListener('error',stop);
  process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);process.stdin.destroy();
 }
}

if(process.argv[1]&&resolve(process.argv[1])===self&&process.argv[2]==='--supervise-tunnel'){
 superviseTunnel(process.argv[3],process.argv[4],process.argv.slice(5)).then(code=>{process.exitCode=code;},()=>{process.exitCode=1;process.stdin.destroy();});
}
