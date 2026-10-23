#!/usr/bin/env node
// A separate, explicitly scoped process; never boots a Desktop/Web/base profile.
import {z} from 'zod';
import {mkdtemp,mkdir,open,readFile,writeFile,rm,realpath,stat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,resolve,relative,isAbsolute,sep} from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createExecutor} from '../src/executor.js';
import {createCore} from '../src/core.js';
import {createFileStore} from '../src/store.js';
import {createBridge,isValidToken} from '../src/bridge.js';

const ASAR='/Applications/DeepSeek Harness.app/Contents/Resources/app.asar';
const KERNEL=Object.freeze(['@deepseek-ai/cordis','@deepseek-ai/dsh-agent','@deepseek-ai/dsh-agent-loop','@deepseek-ai/dsh-system-prompt','@deepseek-ai/dsh-tools','@deepseek-ai/dsh-llm','@deepseek-ai/dsh-session','@deepseek-ai/dsh-session-projection','@deepseek-ai/dsh-agent-default-model','@deepseek-ai/dsh-launch-environment']);
const API_ADAPTER='@deepseek-ai/dsh-llm-deepseek-api-key';
const identifier=z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const configuration=z.object({enabled:z.boolean().default(false),isolatedHostHome:z.string().refine(isAbsolute),publicOnlyHost:z.literal(true),principal:identifier,tokenEnv:z.string().regex(/^DOT_DSH_[A-Z0-9_]+$/),stateDir:z.string().refine(isAbsolute),port:z.number().int().min(0).max(65535).refine(port=>port===0||port>=1024).default(31470),timeoutMs:z.number().int().min(1000).max(600000).default(120000),projects:z.array(z.object({id:identifier,label:z.string().min(1).max(100),root:z.string().refine(isAbsolute),contextFiles:z.array(z.string().min(1).max(300)).min(1).max(6),principals:z.array(identifier).length(1),public:z.literal(true)}).strict()).min(1).max(10)}).strict();
const failure=(message,code)=>Object.assign(new Error(message),{code});

/** Public package distribution reader only. It copies no host/profile data.
 * The selected modules are exact-version checked before their first import.
 */
export async function openPublicSdk({sdkRoot,realProvider=false}={}){
 const roots=[...KERNEL,...(realProvider?[API_ADAPTER]:[])];
 if(sdkRoot){
  const root=resolve(sdkRoot);if(await realpath(root)!==root)throw failure('Public SDK root must be canonical','SDK_UNAVAILABLE');
  return{root,close:async()=>{},packages:roots};
 }
 try{await stat(ASAR);}catch{throw failure('Public SDK unavailable; provide an explicit verified SDK root','SDK_UNAVAILABLE');}
 const temporary=await mkdtemp(join(tmpdir(),'dot-dsh-narrow-sdk-'));const archive=await open(ASAR,'r');
 try{
  const first=Buffer.alloc(16);await archive.read(first,0,16,0);const headerSize=first.readUInt32LE(4),jsonSize=first.readUInt32LE(12);
  if(jsonSize<2||jsonSize>32*1024*1024)throw failure('Public SDK archive outside bounds','SDK_UNAVAILABLE');
  const header=Buffer.alloc(jsonSize);await archive.read(header,0,jsonSize,16);const tree=JSON.parse(header.toString('utf8')),dataStart=8+headerSize;
  const lookup=path=>path.split('/').reduce((node,part)=>node?.files?.[part],tree);
  async function bytes(path,node=lookup(path)){
   if(!node||node.link||!Number.isSafeInteger(node.size)||node.size<0||node.size>32*1024*1024)throw failure('Unavailable public SDK package file','SDK_UNAVAILABLE');
   if(node.unpacked)return readFile(`${ASAR}.unpacked/${path}`);
   const value=Buffer.alloc(node.size);const {bytesRead}=await archive.read(value,0,value.length,dataStart+Number(node.offset));if(bytesRead!==value.length)throw failure('Incomplete public SDK package file','SDK_UNAVAILABLE');return value;
  }
  const done=new Set();
  async function copyTree(path,node){
   const destination=resolve(temporary,path.slice('dsh/'.length));if(!destination.startsWith(`${temporary}${sep}`)||node.link)throw failure('Unexpected public SDK package path','SDK_UNAVAILABLE');
   if(node.files){await mkdir(destination,{recursive:true});for(const [name,child]of Object.entries(node.files))await copyTree(`${path}/${name}`,child);}
   else{await mkdir(dirname(destination),{recursive:true});await writeFile(destination,await bytes(path,node));}
  }
  async function copyPackage(name){
   if(done.has(name))return;done.add(name);const prefix=`dsh/node_modules/${name}`,node=lookup(prefix);if(!node)throw failure('Public SDK dependency unavailable','SDK_UNAVAILABLE');
   const pkg=JSON.parse((await bytes(`${prefix}/package.json`)).toString('utf8'));await copyTree(prefix,node);
   for(const dep of Object.keys({...pkg.dependencies,...pkg.peerDependencies})){
    if(pkg.peerDependenciesMeta?.[dep]?.optional&&!Object.hasOwn(pkg.dependencies??{},dep))continue;
    if(!lookup(`${prefix}/node_modules/${dep}`))await copyPackage(dep);
   }
  }
  for(const name of roots)await copyPackage(name);
  await writeFile(join(temporary,'package.json'),JSON.stringify({private:true,type:'module'}));
  return{root:temporary,close:()=>rm(temporary,{recursive:true,force:true}),packages:roots};
 }catch(error){await rm(temporary,{recursive:true,force:true});throw error;}
 finally{await archive.close();}
}

async function planFor({config,mode,apiKeyEnv,model}){
 const parsed=configuration.safeParse(config);if(!parsed.success)throw failure('Explicit narrow host configuration required','INVALID_CONFIG');const value=parsed.data;
 if(!['dry','synthetic','real'].includes(mode))throw failure('Explicit valid host mode required','INVALID_CONFIG');
 const home=resolve(value.isolatedHostHome);if(value.isolatedHostHome!==home||!process.env.DSH_HOME||resolve(process.env.DSH_HOME)!==home||await realpath(home)!==home)throw failure('Explicit canonical isolated DSH_HOME mismatch','INVALID_CONFIG');
 const child=relative(home,resolve(value.stateDir));if(!child||child==='..'||child.startsWith(`..${sep}`)||isAbsolute(child))throw failure('State must be a child of the isolated home','INVALID_CONFIG');
 if(value.projects.some(project=>project.principals[0]!==value.principal))throw failure('Single-owner project scope required','INVALID_CONFIG');
 if(mode!=='dry'&&value.enabled!==true)throw failure('Explicit enabled:true is required to start','INVALID_CONFIG');
 if(mode==='real'&&(!/^DOT_DSH_MODEL_[A-Z0-9_]+$/.test(apiKeyEnv??'')||typeof model!=='string'||!model.trim()||model.length>200))throw failure('Real mode requires an explicit exact model and dedicated DOT_DSH_MODEL_* credential reference','MODEL_AUTH_REQUIRED');
 const provider=mode==='real'?'deepseek-official':'synthetic-local-only',selectedModel=mode==='real'?model:'deterministic-fixture';
 return{config:value,summary:{mode,started:false,model_kind:mode==='real'?'real_provider_not_yet_called':mode==='synthetic'?'deterministic_synthetic':'not_started',provider:mode==='dry'?null:provider,model:mode==='dry'?null:selectedModel,api_key_env:mode==='real'?apiKeyEnv:null,modules:[...KERNEL,...(mode==='real'?[API_ADAPTER]:[])],profile:'explicit_narrow_kernel_no_profile_inheritance',public_only_attestation:true},provider,selectedModel};
}

/** Build only this new process's narrow kernel and connector-owned resources. */
export async function launchIsolatedHost({config,mode='dry',apiKeyEnv,model,sdkRoot,signal}={}){
 const plan=await planFor({config,mode,apiKeyEnv,model});if(mode==='dry')return{summary:plan.summary,close:async()=>{}};
 if(signal?.aborted)throw failure('Isolated host startup aborted','ABORTED');
 const token=process.env[plan.config.tokenEnv];if(!isValidToken(token))throw failure('Explicit connector token environment unavailable','CHANNEL_AUTH_REQUIRED');
 let modelKey;
 if(mode==='real'){
  // This is the sole model-key reference read by this launcher. No default
  // DeepSeek key, managed credential document, dotenv file or account is read.
  modelKey=process.env[apiKeyEnv];if(typeof modelKey!=='string'||!modelKey.trim()||/[\r\n]/.test(modelKey))throw failure('Explicit new model credential environment unavailable','MODEL_AUTH_REQUIRED');
 }
 let sdk,ctx,executor,store,core,bridge,stopped=false;
 const assertOpen=()=>{if(stopped||signal?.aborted)throw failure('Isolated host startup aborted','ABORTED');};
 const close=async()=>{
  stopped=true;const s=sdk,c=ctx,e=executor,d=store,k=core,b=bridge;sdk=ctx=executor=store=core=bridge=null;const errors=[];
  for(const operation of [()=>b?.close(),()=>k?.close(),()=>e?.close(),()=>d?.close(),()=>c?.fiber.dispose(),()=>s?.close()])try{await operation();}catch(error){errors.push(error);}
  if(errors.length)throw failure('Isolated host cleanup failed','CLEANUP_FAILED');
 };
 const aborted=()=>{void close().catch(()=>{});};signal?.addEventListener('abort',aborted,{once:true});
 try{
  sdk=await openPublicSdk({sdkRoot,realProvider:mode==='real'});assertOpen();
  const require=createRequire(join(sdk.root,'package.json'));for(const name of sdk.packages){const version=require(`${name}/package.json`).version;if(version!==(name==='@deepseek-ai/cordis'?'4.0.5':'0.2.1-rc.2'))throw failure('Public SDK exact version mismatch','SDK_UNAVAILABLE');}
  const load=name=>import(pathToFileURL(require.resolve(name)).href);
  const [{Context},{default:Agents},{default:AgentLoop},{default:SystemPrompt},{default:Tools},{default:Llm,LlmAdapter,createUserMessage},{default:Sessions},{default:Projections},{default:DefaultModel},{createLaunchEnvironmentSnapshot}]=await Promise.all(KERNEL.map(load));assertOpen();
  ctx=new Context();
  // Without this explicit public snapshot the adapter helper would copy the
  // entire inherited process.env. Only this new exact reference is exposed.
  ctx.provide('launchEnvironment',createLaunchEnvironmentSnapshot([{source:'process',values:mode==='real'?{[apiKeyEnv]:modelKey}:{}}]));modelKey=undefined;
  for(const [plugin,options]of [[SystemPrompt,{includeHarnessIdentity:false,includeRuntimeContext:false}],[Llm,undefined],[Sessions,undefined],[Projections,undefined],[Tools,{mode:'native'}],[Agents,undefined],[AgentLoop,{agents:[]}],[DefaultModel,{provider:plan.provider,model:plan.selectedModel}]]){await ctx.plugin(plugin,options);assertOpen();}
  if(mode==='real'){
   // This public plugin exports apply/inject/Config, with no default export.
   // An explicit root also prevents inherited DEEPSEEK_BASE_URL redirection.
   const adapter=await load(API_ADAPTER);assertOpen();
   await ctx.plugin(adapter,{apiKeyEnv,baseURL:'https://api.deepseek.com/anthropic'});assertOpen();
  }
  let owner;
  class SyntheticAdapter extends LlmAdapter{
   async *stream(){yield{type:'text-delta',index:0,text:'SYNTHETIC standalone DSH AgentLoop result. Source: README.md. No real provider call or Dot/user acceptance is established.'};yield{type:'finish',reason:{kind:'stop'}};}
  }
  await ctx.plugin({name:'dot-dsh-narrow-host-owner',inject:['agents','tools','sessions','systemPrompt','llm','agentDefaultModel'],apply(scope){owner=scope;if(mode==='synthetic')scope.llm.registerAdapter([plan.provider],new SyntheticAdapter());}});assertOpen();
  executor=createExecutor({ctx:owner,createMessage:createUserMessage,isolatedHost:true});
  store=await createFileStore(plan.config.stateDir);assertOpen();
  core=await createCore({projects:plan.config.projects,store,executor,timeoutMs:plan.config.timeoutMs});assertOpen();
  bridge=await createBridge({service:core,token,principal:plan.config.principal,port:plan.config.port});assertOpen();
  const ownedClose=async()=>{signal?.removeEventListener('abort',aborted);await close();};
  return{url:bridge.url,core,summary:{...plan.summary,started:true,url:bridge.url},close:ownedClose};
 }catch(error){signal?.removeEventListener('abort',aborted);await close().catch(()=>{});throw error;}
}

async function readConfiguration(path){
 if(typeof path!=='string'||!isAbsolute(path))throw failure('Explicit absolute configuration file required','INVALID_CONFIG');
 const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);try{const info=await file.stat();if(!info.isFile()||info.nlink!==1||info.size>65536)throw failure('Unsafe configuration file','INVALID_CONFIG');const bytes=Buffer.alloc(65537);const {bytesRead}=await file.read(bytes,0,bytes.length,0);if(bytesRead>65536)throw failure('Configuration exceeds limit','INVALID_CONFIG');return JSON.parse(bytes.subarray(0,bytesRead).toString('utf8'));}finally{await file.close();}
}
async function main(argv){
 const allowed=new Map([['--config','configFile'],['--mode','mode'],['--api-key-env','apiKeyEnv'],['--model','model'],['--sdk-root','sdkRoot']]);const options={};
 if(argv.length===1&&argv[0]==='--help'){process.stdout.write('Usage: node scripts/isolated-host.mjs --config /absolute/config.json [--mode dry|synthetic|real] [--api-key-env DOT_DSH_MODEL_NEW_KEY --model EXACT_MODEL] [--sdk-root /verified/public/runtime]\nDefault dry mode starts no host. Never place key values in arguments.\n');return;}
 for(let index=0;index<argv.length;index+=2){const key=allowed.get(argv[index]),value=argv[index+1];if(!key||!value||Object.hasOwn(options,key))throw failure('Invalid isolated host arguments','INVALID_CONFIG');options[key]=value;}
 const controller=new AbortController();let host;
 const stop=()=>{controller.abort();void host?.close().catch(()=>{process.exitCode=1;});};process.once('SIGINT',stop);process.once('SIGTERM',stop);
 try{const config=await readConfiguration(options.configFile);host=await launchIsolatedHost({...options,config,signal:controller.signal});process.stdout.write(`${JSON.stringify({event:host.summary.started?'ready':'dry',...host.summary})}\n`);}
 catch(error){await host?.close().catch(()=>{});throw error;}
 finally{if(!host?.summary.started){process.off('SIGINT',stop);process.off('SIGTERM',stop);}}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))void main(process.argv.slice(2)).catch(error=>{process.stderr.write(`${JSON.stringify({event:'failed',code:typeof error?.code==='string'&&/^[A-Z_]+$/.test(error.code)?error.code:'STARTUP_FAILED'})}\n`);process.exitCode=1;});
