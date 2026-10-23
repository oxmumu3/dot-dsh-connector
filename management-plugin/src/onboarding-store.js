/** Private, installation-scoped onboarding metadata. Never stores credentials. */
import {open,mkdir,realpath,lstat,unlink,rename} from 'node:fs/promises';
import {constants} from 'node:fs';
import {isAbsolute,resolve,dirname,join} from 'node:path';
import {randomBytes} from 'node:crypto';

const fail=code=>Object.assign(new Error(code==='ONBOARDING_LOCKED'?'Another connection setup owns this installation.':'Private connection state is unavailable.'),{code});
const uid=()=>process.getuid?.();
export function canonicalPrivatePath(path){if(typeof path!=='string'||!isAbsolute(path)||resolve(path)!==path||path.includes('\0')||path.includes('\\'))throw fail('ONBOARDING_PRIVATE_STATE');return path;}
export async function ensurePrivateDirectory(path,{create=false}={}){
 canonicalPrivatePath(path);
 if(create){if(await realpath(dirname(path))!==dirname(path))throw fail('ONBOARDING_PRIVATE_STATE');try{await mkdir(path,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}}
 const s=await lstat(path);if(await realpath(path)!==path||!s.isDirectory()||(s.mode&0o077)!==0||(uid()!==undefined&&s.uid!==uid()))throw fail('ONBOARDING_PRIVATE_STATE');
 return path;
}
export async function readPrivateStateFile(path,maximum=65536){
 canonicalPrivatePath(path);let h;
 try{
  if(await realpath(path)!==path)throw fail('ONBOARDING_PRIVATE_STATE');
  h=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);const s=await h.stat();
  if(!s.isFile()||s.nlink!==1||(s.mode&0o077)!==0||s.size>maximum||(uid()!==undefined&&s.uid!==uid()))throw fail('ONBOARDING_PRIVATE_STATE');
  const b=Buffer.alloc(maximum+1),r=await h.read(b,0,b.length,0);if(r.bytesRead!==s.size)throw fail('ONBOARDING_PRIVATE_STATE');return new TextDecoder('utf8',{fatal:true}).decode(b.subarray(0,r.bytesRead));
 }finally{await h?.close();}
}
export async function writeNewPrivateStateFile(path,value){canonicalPrivatePath(path);let h;try{h=await open(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);await h.writeFile(value);await h.sync();}finally{await h?.close();}}
const fields=new Set(['version','installation_id','created_at','updated_at','activated','tunnel_id','organization_id','workspace_id','plugin_id','request_id','attempt_started_at','verification_sent','completed_at']);
const identifiers=new Set(['tunnel_id','organization_id','workspace_id','plugin_id','request_id']);
function validate(value,complete=false){
 if(!value||Object.getPrototypeOf(value)!==Object.prototype)throw fail('ONBOARDING_PRIVATE_STATE');
 if(complete&&['version','installation_id','created_at','updated_at','activated'].some(key=>!Object.hasOwn(value,key)))throw fail('ONBOARDING_PRIVATE_STATE');
 for(const [key,v]of Object.entries(value)){
  if(!fields.has(key))throw fail('ONBOARDING_PRIVATE_STATE');
  if(key==='version'){if(v!==1)throw fail('ONBOARDING_PRIVATE_STATE');}
  else if(key==='installation_id'){if(typeof v!=='string'||!/^[a-f0-9]{32}$/.test(v))throw fail('ONBOARDING_PRIVATE_STATE');}
  else if(identifiers.has(key)){if(typeof v!=='string'||! /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(v))throw fail('ONBOARDING_PRIVATE_STATE');}
  else if(key==='activated'||key==='verification_sent'){if(typeof v!=='boolean')throw fail('ONBOARDING_PRIVATE_STATE');}
  else if(typeof v!=='string'||!Number.isFinite(Date.parse(v))||new Date(v).toISOString()!==v)throw fail('ONBOARDING_PRIVATE_STATE');
 }
 return value;
}
export function createOnboardingStore({directory,now=()=>new Date().toISOString()}={}){
 canonicalPrivatePath(directory);const statePath=join(directory,'state.json'),lockPath=join(directory,'setup.lock');let lock,identity,pending=Promise.resolve();
 const serial=operation=>{const result=pending.then(operation);pending=result.catch(()=>{});return result;};
 async function own(){await ensurePrivateDirectory(directory);let s;try{s=await lstat(lockPath);}catch{throw fail('ONBOARDING_LOCKED');}if(!lock||!identity||!s.isFile()||s.nlink!==1||s.dev!==identity.dev||s.ino!==identity.ino)throw fail('ONBOARDING_LOCKED');}
 async function read(){await ensurePrivateDirectory(directory);try{return validate(JSON.parse(await readPrivateStateFile(statePath)),true);}catch(e){if(e.code==='ENOENT')throw e;throw fail('ONBOARDING_PRIVATE_STATE');}}
 async function update(patch){validate(patch);await own();const current=await read();if(Object.hasOwn(patch,'installation_id')&&patch.installation_id!==current.installation_id||Object.hasOwn(patch,'created_at')&&patch.created_at!==current.created_at)throw fail('ONBOARDING_PRIVATE_STATE');const value=validate({...current,...patch,updated_at:now()});const temporary=join(directory,'state-'+randomBytes(12).toString('hex')+'.tmp');try{await writeNewPrivateStateFile(temporary,JSON.stringify(value)+'\n');await own();await rename(temporary,statePath);}finally{await unlink(temporary).catch(()=>{});}return structuredClone(value);}
 async function close(){if(!lock)return;try{await own();await unlink(lockPath);}catch{}finally{await lock.close();lock=undefined;identity=undefined;}}
 return {directory,read,update:patch=>serial(()=>update(patch)),close:()=>serial(close),async acquire(){
  if(lock){await own();return read();}await ensurePrivateDirectory(directory,{create:true});
  try{lock=await open(lockPath,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);}catch(e){if(e.code==='EEXIST')throw fail('ONBOARDING_LOCKED');throw fail('ONBOARDING_PRIVATE_STATE');}
  try{identity=await lock.stat();await lock.writeFile(JSON.stringify({instance:randomBytes(16).toString('hex'),pid:process.pid})+'\n');await lock.sync();try{return await read();}catch(e){if(e.code!=='ENOENT')throw e;const time=now(),initial={version:1,installation_id:randomBytes(16).toString('hex'),created_at:time,updated_at:time,activated:false};await writeNewPrivateStateFile(statePath,JSON.stringify(initial)+'\n');return initial;}}catch(e){await close();throw e;}
 }};
}
