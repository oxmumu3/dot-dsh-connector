import {z} from 'zod';
import {isAbsolute,resolve,relative,sep} from 'node:path';
import {realpath} from 'node:fs/promises';
import {createFileStore} from './store.js';
import {createCore} from './core.js';
import {createBridge,isValidToken} from './bridge.js';
const id=z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const configSchema=z.object({enabled:z.boolean().default(false),isolatedHostHome:z.string().refine(isAbsolute).optional(),publicOnlyHost:z.literal(true).optional(),principal:id,tokenEnv:z.string().regex(/^DOT_DSH_[A-Z0-9_]+$/),stateDir:z.string().refine(isAbsolute),port:z.number().int().min(1024).max(65535).default(31470),timeoutMs:z.number().int().min(1000).max(600000).default(120000),projects:z.array(z.object({id,label:z.string().min(1).max(100),root:z.string().refine(isAbsolute),contextFiles:z.array(z.string().min(1).max(300)).min(1).max(6),principals:z.array(id).min(1).max(5),public:z.literal(true)}).strict()).min(1).max(10)}).strict();
export async function installConnector(ctx,options={}){
 if(options.enabled!==true)return{enabled:false};
 const parsed=configSchema.safeParse(options);if(!parsed.success)throw new Error('Invalid connector configuration');
 const config=parsed.data;
 if(config.projects.some(p=>p.principals.length!==1||p.principals[0]!==config.principal))throw new Error('Invalid single-owner connector configuration');
 if(!config.isolatedHostHome||config.publicOnlyHost!==true||!process.env.DSH_HOME)throw new Error('DSH prompt isolation requires a dedicated clean host profile');
 const home=resolve(config.isolatedHostHome);
 if(resolve(process.env.DSH_HOME)!==home||await realpath(home)!==home)throw new Error('DSH host isolation profile mismatch');
 const stateRelative=relative(home,resolve(config.stateDir));if(!stateRelative||stateRelative==='..'||stateRelative.startsWith(`..${sep}`)||isAbsolute(stateRelative))throw new Error('Connector state must be inside its isolated host profile');
 const token=process.env[config.tokenEnv];if(!isValidToken(token))throw new Error('Connector token environment unavailable');
 if(typeof ctx?.get!=='function'||typeof ctx?.effect!=='function')throw new Error('DSH host unavailable');
 let executor,store,core,bridge,stopped=false;
 const assertOpen=()=>{if(stopped)throw new Error('Connector owner unloaded during setup');};
 const close=async()=>{
  stopped=true;
  // Capture each generation: setup may still be awaiting creation. Every later
  // await checks stopped and rolls back resources that arrived after cleanup.
  const b=bridge,c=core,e=executor,s=store;bridge=core=executor=store=null;
  const errors=[];
  try{await b?.close();}catch(error){errors.push(error);}
  try{if(c)await c.close();else await e?.close();}catch(error){errors.push(error);}
  // Core normally owns this store; close is idempotent and remains a final
  // safety net if an executor/host teardown threw before Core reached it.
  try{await s?.close();}catch(error){errors.push(error);}
  if(errors.length)throw new Error('Connector cleanup failed');
 };
 // Register ownership before imports, locks or listeners can yield. An inactive
 // scope rejects here with nothing acquired, rather than leaking a live bridge.
 ctx.effect(()=>close);
 try{
  const {createExecutor}=await import('./executor.js');assertOpen();
  const {createUserMessage}=await import('@deepseek-ai/dsh-llm');assertOpen();
  executor=createExecutor({ctx,createMessage:createUserMessage,isolatedHost:true});
  store=await createFileStore(config.stateDir);assertOpen();
  core=await createCore({projects:config.projects,store,executor,timeoutMs:config.timeoutMs});assertOpen();
  bridge=await createBridge({service:core,token,principal:config.principal,port:config.port});assertOpen();
 }catch(error){await close().catch(()=>{});throw error;}
 return{enabled:true,url:bridge.url,core,close};
}
