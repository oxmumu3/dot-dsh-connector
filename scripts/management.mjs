#!/usr/bin/env node
import {open} from 'node:fs/promises';import {constants} from 'node:fs';import {isAbsolute,resolve,join} from 'node:path';import {fileURLToPath} from 'node:url';import {z} from 'zod';
import {createBridge,isValidToken,HARNESS_TOOL_NAMES} from '../src/bridge.js';import {canonicalBridgeUrl,callBridge} from '../src/bridge-client.js';import {createManagement} from '../src/management.js';import {readOwnedTaskSnapshot} from '../src/owned-job-snapshot.js';
import {createCloudStatus} from '../src/cloud-status.js';
const root=z.string().max(4096).refine(v=>isAbsolute(v)&&resolve(v)===v&&!v.includes('\0')&&!v.includes('\\'));
const endpoint=z.string().refine(v=>{try{canonicalBridgeUrl(v);return true;}catch{return false;}});
const port=z.number().int().min(0).max(65535).refine(v=>v===0||v>=1024);
const schema=z.object({enabled:z.literal(true),principal:z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),stateDir:root,taskStateDir:root.optional(),taskUrl:endpoint.optional(),readUrl:endpoint,gatewayPort:port.default(31472),adminPort:port.default(31473),nativeExecution:z.boolean().default(false),nativeStateDir:root.optional(),workerPort:port.default(31474),cloudHealthFile:root.optional()}).strict();
const failure=()=>Object.assign(new Error('Management host configuration or startup failed.'),{code:'BACKEND_OFFLINE'});
export async function launchManagement({config,channelToken,adminToken,storeFactory,forward,signal}={}){
 const parsed=schema.safeParse(config);if(!parsed.success||!isValidToken(channelToken)||!isValidToken(adminToken)||channelToken===adminToken)throw failure();const settings=parsed.data;
 const listening=[settings.gatewayPort,settings.adminPort,...settings.nativeExecution?[settings.workerPort]:[]].filter(Boolean);
 if(!settings.nativeExecution&&!settings.taskUrl||new Set(listening).size!==listening.length||[settings.taskUrl,settings.readUrl].filter(Boolean).some(url=>listening.includes(Number(new URL(url).port))))throw failure();
 let audit,manager,gateway,admin,nativeTasks,nativeStore,worker,closing,stopped=false;const close=()=>closing??=(async()=>{stopped=true;for(const resource of [worker,admin,gateway,manager,nativeTasks,nativeStore,audit])await resource?.close();})();
 const check=()=>{if(stopped||signal?.aborted)throw failure();};const abort=()=>{void close().catch(()=>{});};signal?.addEventListener('abort',abort,{once:true});
 try{
  check();const factory=storeFactory??(await import('../src/audit-store.js')).createAuditStore;const acquired=await factory({directory:settings.stateDir,principal:settings.principal});if(stopped||signal?.aborted){await acquired.close();throw failure();}audit=acquired;
  const readTools=new Set(HARNESS_TOOL_NAMES);const send=forward??((tool,args)=>{const url=readTools.has(tool)?settings.readUrl:settings.taskUrl;if(!url)throw failure();return callBridge({url,token:channelToken},tool,args);});
  if(settings.nativeExecution){
   const [{createFileStore},{createNativeTasks},{createNativeWorkerServer}]=await Promise.all([import('../src/store.js'),import('../src/native-tasks.js'),import('../src/native-worker-server.js')]);check();
   const store=await createFileStore(settings.nativeStateDir??join(settings.stateDir,'native-tasks'));if(stopped||signal?.aborted){await store.close();throw failure();}nativeStore=store;
   nativeTasks=await createNativeTasks({store:nativeStore,principal:settings.principal});check();
   const transport=await createNativeWorkerServer({control:nativeTasks,port:settings.workerPort});if(stopped||signal?.aborted){await transport.close();throw failure();}worker=transport;
  }
  manager=await createManagement({audit,forward:send,principal:settings.principal,cloudStatus:createCloudStatus({healthFile:settings.cloudHealthFile}),...nativeTasks?{nativeTasks}:{},...settings.taskStateDir?{loadJobs:()=>readOwnedTaskSnapshot(settings.taskStateDir)}:{}});check();
  const g=await createBridge({service:manager.channel,token:channelToken,principal:settings.principal,port:settings.gatewayPort,requestTimeoutMs:14000});if(stopped||signal?.aborted){await g.close();throw failure();}gateway=g;
  const a=await createBridge({service:manager.admin,token:adminToken,principal:settings.principal,port:settings.adminPort,scope:'management',requestTimeoutMs:14000});if(stopped||signal?.aborted){await a.close();throw failure();}admin=a;
  return{gatewayUrl:gateway.url,adminUrl:admin.url,...worker?{nativeWorkerUrl:worker.url}:{},close:async()=>{signal?.removeEventListener('abort',abort);await close();}};
 }catch{await close().catch(()=>{});signal?.removeEventListener('abort',abort);throw failure();}
}
async function main(){if(process.argv.length!==2)throw failure();const path=process.env.DOT_DSH_MANAGEMENT_CONFIG;if(typeof path!=='string'||!isAbsolute(path)||resolve(path)!==path)throw failure();const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);let config;try{const info=await file.stat();if(!info.isFile()||info.nlink!==1||(info.mode&0o077)!==0||info.size>65536)throw failure();const bytes=Buffer.alloc(65537);const{bytesRead}=await file.read(bytes,0,bytes.length,0);if(bytesRead!==info.size)throw failure();config=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,bytesRead)));}finally{await file.close();}
 const controller=new AbortController();let host;const stop=()=>{controller.abort();void host?.close().catch(()=>{process.exitCode=1;});};process.once('SIGINT',stop);process.once('SIGTERM',stop);host=await launchManagement({config,channelToken:process.env.DOT_DSH_TOKEN,adminToken:process.env.DOT_DSH_ADMIN_TOKEN,signal:controller.signal});process.stdout.write(JSON.stringify({event:'ready',mode:'owner_connector_management',gateway_url:host.gatewayUrl,admin_url:host.adminUrl})+'\n');}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))void main().catch(()=>{process.stderr.write('Dot connector management: invalid configuration or startup failure.\n');process.exitCode=1;});
