import {mkdir,realpath,open,rename,unlink,lstat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {isAbsolute,join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
// 100 bounded jobs with worst-case UTF-8/JSON escaping fit below 16 MiB.
const LIMIT=16*1024*1024;
export async function createFileStore(directory){
 if(typeof directory!=='string'||!isAbsolute(directory))throw new Error('Absolute connector state directory required');
 const dir=resolve(directory);await mkdir(dir,{recursive:true,mode:0o700});if(await realpath(dir)!==dir)throw new Error('State directory symlink denied');
 const dirStat=await lstat(dir);if(!dirStat.isDirectory()||(dirStat.mode&0o077)!==0)throw new Error('State directory must be private (0700)');
 const lockPath=join(dir,'connector.lock');let lock;
 try{lock=await open(lockPath,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);}catch{throw new Error('Connector state locked; inspect owner before recovery');}
 await lock.writeFile(JSON.stringify({pid:process.pid,created_at:new Date().toISOString()}));await lock.sync();
 let closed=false;const file=join(dir,'state.json');
 return{
  async load(){
   if(closed)throw new Error('Store closed');let handle;
   try{handle=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);}catch(error){if(error.code==='ENOENT')return null;throw new Error('State unavailable');}
   try{const stat=await handle.stat();if(!stat.isFile()||stat.nlink!==1||stat.size>LIMIT||(stat.mode&0o077)!==0)throw new Error('Unsafe state file');const buffer=Buffer.alloc(LIMIT+1);const {bytesRead}=await handle.read(buffer,0,buffer.length,0);if(bytesRead>LIMIT)throw new Error('State limit exceeded');return JSON.parse(buffer.subarray(0,bytesRead).toString('utf8'));}finally{await handle.close();}
  },
  async save(value){
   if(closed)throw new Error('Store closed');const text=JSON.stringify(value);if(Buffer.byteLength(text)>LIMIT)throw new Error('State limit exceeded');
   const temp=join(dir,`.state-${randomUUID()}`);let handle;
   try{handle=await open(temp,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);await handle.writeFile(text);await handle.sync();await handle.close();handle=null;await rename(temp,file);const dirHandle=await open(dir,constants.O_RDONLY);try{await dirHandle.sync();}finally{await dirHandle.close();}}
   finally{await handle?.close();await unlink(temp).catch(error=>{if(error.code!=='ENOENT')throw error;});}
  },
  async close(){if(closed)return;closed=true;await lock.close();await unlink(lockPath);},
 };
}
