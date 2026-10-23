#!/usr/bin/env node
import {open,realpath} from 'node:fs/promises';
import {constants} from 'node:fs';
import {isAbsolute,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {z} from 'zod';
import {createBridge,isValidToken,HARNESS_TOOL_NAMES} from '../src/bridge.js';
import {createHarnessFiles} from '../src/harness-files.js';
import {createHarnessReader,redactText} from '../src/harness-reader.js';

const contextSchema=z.object({workspaceId:z.string().min(1).max(512),path:z.string().refine(p=>isAbsolute(p)&&resolve(p)===p),title:z.string().min(1).max(200),contextKind:z.enum(['skill','instructions','skill_catalog']),sessionIds:z.array(z.never()).max(0)}).strict();
const schema=z.object({enabled:z.literal(true),scope:z.literal('owner-harness-read-only'),dshHome:z.string().refine(isAbsolute),principal:z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),tokenEnv:z.string().regex(/^DOT_DSH_[A-Z0-9_]+$/),port:z.number().int().min(0).max(65535).default(31471),extraWorkspaces:z.array(contextSchema).max(100).default([])}).strict();
const failed=()=>Object.assign(new Error('Harness read host unavailable'),{code:'BACKEND_OFFLINE'});
const rejected=()=>Object.assign(new Error('Harness read access denied'),{code:'BACKEND_REJECTED'});

/** No original DSH service is mounted, resumed, repaired, cancelled or stopped. */
export async function launchHarnessRead({config,token,storageFactory,signal}={}){
 const parsed=schema.safeParse(config);if(!parsed.success||!isValidToken(token))throw rejected();const settings=parsed.data;
 if(resolve(settings.dshHome)!==settings.dshHome||await realpath(settings.dshHome)!==settings.dshHome)throw rejected();
 let storage,bridge,closing,stopped=false,active=0;
 const close=()=>closing??=(async()=>{stopped=true;await bridge?.close();await storage?.close();})();
 const assertOpen=()=>{if(stopped||signal?.aborted)throw failed();};
 const abort=()=>{void close().catch(()=>{});};signal?.addEventListener('abort',abort,{once:true});
 try{
  assertOpen();const factory=storageFactory??(await import('../src/harness-storage.js')).createHarnessStorage;
  const acquiredStorage=await factory({dshHome:settings.dshHome,extraWorkspaces:settings.extraWorkspaces});
  if(stopped||signal?.aborted){await acquiredStorage.close();throw failed();}storage=acquiredStorage;
  const internalRoots=['memory','skills'].map(name=>join(settings.dshHome,name)).filter(root=>/\/\.dsh\/(memory|skills)$/.test(root));
  const instructionRoots=settings.extraWorkspaces.filter(w=>w.contextKind==='instructions').map(w=>w.path);
  const reader=createHarnessReader({rpc:storage.rpc,files:createHarnessFiles({redact:redactText,internalRoots,instructionRoots}),principal:settings.principal});
  const names=new Set(HARNESS_TOOL_NAMES);
  const service={async call(principal,tool,args){if(stopped||principal!==settings.principal||!names.has(tool)||active>=2)throw rejected();active++;try{return await reader.call(principal,tool,args);}finally{active--;}}};
  const acquiredBridge=await createBridge({service,token,principal:settings.principal,port:settings.port,requestTimeoutMs:10000});
  if(stopped||signal?.aborted){await acquiredBridge.close();throw failed();}bridge=acquiredBridge;
  return{url:bridge.url,close:async()=>{signal?.removeEventListener('abort',abort);await close();}};
 }catch{await close().catch(()=>{});signal?.removeEventListener('abort',abort);throw failed();}
}

async function main(){
 if(process.argv.length!==2)throw rejected();const path=process.env.DOT_DSH_HARNESS_CONFIG;if(typeof path!=='string'||!isAbsolute(path)||resolve(path)!==path)throw rejected();
 const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);let config;
 try{const info=await file.stat();if(!info.isFile()||info.nlink!==1||info.size>65536)throw rejected();const bytes=Buffer.alloc(65537);const {bytesRead}=await file.read(bytes,0,bytes.length,0);if(bytesRead!==info.size||bytesRead>65536)throw rejected();config=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,bytesRead)));}finally{await file.close();}
 const parsed=schema.safeParse(config);if(!parsed.success)throw rejected();const controller=new AbortController();let host;
 const stop=()=>{controller.abort();void host?.close().catch(()=>{process.exitCode=1;});};process.once('SIGINT',stop);process.once('SIGTERM',stop);
 host=await launchHarnessRead({config,token:process.env[config.tokenEnv],signal:controller.signal});
 process.stdout.write(JSON.stringify({event:'ready',mode:'existing_harness_persisted_read_only',url:host.url})+'\n');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))void main().catch(()=>{process.stderr.write('Harness read host: invalid configuration or startup failure.\n');process.exitCode=1;});
