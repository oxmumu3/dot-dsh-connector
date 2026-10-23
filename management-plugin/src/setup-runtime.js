/** Host-only local lifecycle. No account credential lookup, PID adoption or cloud mutation. */
import {open,mkdir,realpath,lstat,unlink,readFile,rename} from 'node:fs/promises';
import {constants} from 'node:fs';
import {isAbsolute,resolve,join,dirname} from 'node:path';
import {homedir} from 'node:os';
import {randomBytes} from 'node:crypto';
import {execFile} from 'node:child_process';
import {createServer} from 'node:net';
import {fileURLToPath} from 'node:url';
import {z} from 'zod';

const ASAR='/Applications/DeepSeek Harness.app/Contents/Resources/app.asar';
export const SUPPORTED={platform:'darwin',sdk:'0.2.1-rc.2',python:'>=3.10',node:'>=22.15'};
const DEFAULT_PORTS={reader:0,gateway:0,admin:0,worker:0};
const directory=z.string().refine(v=>isAbsolute(v)&&resolve(v)===v&&!v.includes('\0')&&!v.includes('\\'));
const ports=z.strictObject(Object.fromEntries(Object.keys(DEFAULT_PORTS).map(k=>[k,z.number().int().min(0).max(65535)])));
const configSchema=z.strictObject({version:z.literal(1),dshHome:directory,dataDir:directory,principal:z.string().regex(/^owner-[a-f0-9]{32}$/),ports,automaticPorts:z.boolean().default(false),requestedPorts:ports.optional(),activated:z.boolean().default(false),cloudHealthFile:directory.optional()});
const MESSAGES={MCP_ENTRY_UNAVAILABLE:'本机 MCP 入口无法使用当前 Harness 的 Node 启动。请检查本机运行环境后重试。',UNSUPPORTED_RUNTIME:'当前仅支持 macOS、Harness 0.2.1-rc.2、Node 22.15+ 和 Python 3.10+。',PROFILE_UNAVAILABLE:'未发现当前 Harness Desktop profile。请先完成 Harness 首次启动。',PRIVATE_STATE_REQUIRED:'连接器状态或凭据目录不是本人私有的规范路径。请检查诊断，不会自动修复或接管。',STATE_LOCKED:'此状态目录已有运行锁。请先核对并停止原实例，再重新准备；不会自动清除或接管。',SETUP_RUNNING:'请先停止本插件拥有的本机服务，再准备新的云端状态文件引用。',PORT_IN_USE:'连接器端口已被占用。现有外部部署请保留 tokenFile 模式；不会结束或接管该进程。',SETUP_REQUIRED:'请先准备本地连接。',LOCAL_START_FAILED:'本地服务启动失败；已关闭本次取得的资源。请检查运行环境和诊断。',CLOSED:'插件已关闭。请重新启用插件。'};
const failure=code=>Object.assign(new Error(MESSAGES[code]??MESSAGES.LOCAL_START_FAILED),{code});
const safeError=error=>({code:Object.hasOwn(MESSAGES,error?.code)?error.code:'LOCAL_START_FAILED',message:MESSAGES[error?.code]??MESSAGES.LOCAL_START_FAILED});
const uid=()=>typeof process.getuid==='function'?process.getuid():undefined;
function canonical(value){if(!directory.safeParse(value).success)throw failure('PRIVATE_STATE_REQUIRED');return value;}
async function privateDirectory(path,create=false){
 canonical(path);
 if(create){if(await realpath(dirname(path))!==dirname(path))throw failure('PRIVATE_STATE_REQUIRED');try{await mkdir(path,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}}
 const info=await lstat(path);if(await realpath(path)!==path||!info.isDirectory()||(info.mode&0o077)!==0||(uid()!==undefined&&info.uid!==uid()))throw failure('PRIVATE_STATE_REQUIRED');
}
export async function readPrivateFile(path,maximum=65536){
 canonical(path);let handle;
 try{
  if(await realpath(path)!==path)throw failure('PRIVATE_STATE_REQUIRED');
  handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);const info=await handle.stat();
  if(!info.isFile()||info.nlink!==1||(info.mode&0o077)!==0||info.size>maximum||(uid()!==undefined&&info.uid!==uid()))throw failure('PRIVATE_STATE_REQUIRED');
  const bytes=Buffer.alloc(maximum+1),{bytesRead}=await handle.read(bytes,0,bytes.length,0);if(bytesRead!==info.size)throw failure('PRIVATE_STATE_REQUIRED');
  return new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,bytesRead));
 }finally{await handle?.close();}
}
async function createPrivateFile(path,value){let handle;try{handle=await open(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);await handle.writeFile(value);await handle.sync();}finally{await handle?.close();}}
async function tokenFile(path,create=false){
 if(create){try{await createPrivateFile(path,randomBytes(48).toString('base64url')+'\n');}catch(error){if(error.code!=='EEXIST')throw error;}}
 const value=(await readPrivateFile(path,1024)).trim();if(!/^[A-Za-z0-9_-]{64}$/.test(value))throw failure('PRIVATE_STATE_REQUIRED');return value;
}
async function configAt(dataDir){await privateDirectory(dataDir);const config=configSchema.parse(JSON.parse(await readPrivateFile(join(dataDir,'config.json'))));if(config.dataDir!==dataDir)throw failure('PRIVATE_STATE_REQUIRED');return config;}
function shellQuote(value){return "'"+value.replaceAll("'","'\\''")+"'";}

/** The official Tunnel and the local probe use exactly the same executable and argv.
 * /usr/bin/env is a fixed wrapper, not a PATH lookup for Node. */
export function managedMcpEntry({dataDir,executable=process.execPath,electron=Boolean(process.versions.electron),env=process.env}={}){
 canonical(dataDir);canonical(executable);
 const args=[...electron?['ELECTRON_RUN_AS_NODE=1']:[],executable,fileURLToPath(new URL('../scripts/mcp-managed.mjs',import.meta.url)),'--data-dir',dataDir];
 return{command:'/usr/bin/env',args,env:{PATH:env.PATH??'/usr/bin:/bin'},mcpCommand:['/usr/bin/env',...args].map(shellQuote).join(' ')};
}
/** Initialize and list tools only; never invokes a project, task or account tool. */
export async function probeManagedMcp(entry){
 const [{Client},{StdioClientTransport}]=await Promise.all([import('@modelcontextprotocol/sdk/client/index.js'),import('@modelcontextprotocol/sdk/client/stdio.js')]);
 const client=new Client({name:'dot-dsh-local-preflight',version:'1'}),transport=new StdioClientTransport({command:entry.command,args:entry.args,env:entry.env,stderr:'ignore'});
 try{await client.connect(transport,{timeout:30000});const result=await client.listTools(undefined,{timeout:5000});if(client.getServerVersion()?.name!=='dot-dsh-connector'||!['harness_list_workspaces','harness_start_task','harness_get_task'].every(name=>result.tools.some(tool=>tool.name===name)))throw failure('MCP_ENTRY_UNAVAILABLE');}
 finally{await client.close();}
}

/** Reads only installed public distribution metadata; never imports its application. */
async function sdkVersion(){let archive;try{
 const path='dsh/node_modules/@deepseek-ai/dsh-app-boot/package.json';
 const versionFrom=data=>{if(data.length>65536)throw failure('UNSUPPORTED_RUNTIME');const metadata=JSON.parse(data.toString('utf8'));if(metadata.name!=='@deepseek-ai/dsh-app-boot'||typeof metadata.version!=='string'||!metadata.version)throw failure('UNSUPPORTED_RUNTIME');return metadata.version;};
 // Electron exposes archive entries as files, but opening the archive itself is intercepted.
 // Keep its global ASAR behavior intact for every other plugin in the shared Host.
 if(process.versions.electron)return versionFrom(await readFile(ASAR+'/'+path));
 archive=await open(ASAR,'r');const first=Buffer.alloc(16);await archive.read(first,0,16,0);const size=first.readUInt32LE(12);if(size<2||size>32*1024*1024)throw failure('UNSUPPORTED_RUNTIME');
 const bytes=Buffer.alloc(size);if((await archive.read(bytes,0,size,16)).bytesRead!==size)throw failure('UNSUPPORTED_RUNTIME');const tree=JSON.parse(bytes.toString('utf8'));
 const node=path.split('/').reduce((v,k)=>v?.files?.[k],tree);if(!node||node.link||node.size>65536)throw failure('UNSUPPORTED_RUNTIME');
 let data;if(node.unpacked)data=await readFile(ASAR+'.unpacked/'+path);else{data=Buffer.alloc(node.size);if((await archive.read(data,0,data.length,8+first.readUInt32LE(4)+Number(node.offset))).bytesRead!==data.length)throw failure('UNSUPPORTED_RUNTIME');}
 return versionFrom(data);
 }finally{await archive?.close();}}
async function defaultPythonCheck(){
 const executable=await(await import('../runtime/src/python-runtime.js')).pythonExecutable();
 await new Promise((done,reject)=>execFile(executable,['-I','-S','-c','import os,sys; assert sys.version_info >= (3,10); assert os.open in os.supports_dir_fd; assert hasattr(os,"O_NOFOLLOW")'],{timeout:4000,maxBuffer:4096,env:{PATH:process.env.PATH??'/usr/bin:/bin'}},error=>error?reject(error):done()));
}
export async function runtimePreflight({dshHome,platform=process.platform,nodeVersion=process.versions.node,checkSdk=sdkVersion,checkPython}={}){
 const checks=[],add=(id,ok,message)=>checks.push({id,ok,message});
 add('platform',platform==='darwin','支持 macOS；当前平台 '+platform);
 const [major,minor]=nodeVersion.split('.').map(Number);add('node',major>22||(major===22&&minor>=15),'需要 Node 22.15+（含 Zstandard 读取支持）');
 try{add('sdk',await checkSdk()===SUPPORTED.sdk,'需要已安装的 Harness '+SUPPORTED.sdk);}catch{add('sdk',false,'未找到受支持的 Harness Desktop 公共运行时');}
 try{await(checkPython??defaultPythonCheck)();add('python',true,'Python 3.10+ descriptor 读取可用');}catch{add('python',false,'当前 Python 运行时不可用，请检查 Harness 安装。');}
 try{canonical(dshHome);if(await realpath(dshHome)!==dshHome)throw failure('PROFILE_UNAVAILABLE');for(const suffix of ['profiles/desktop','storages'])if(!(await lstat(join(dshHome,suffix))).isDirectory()||await realpath(join(dshHome,suffix))!==join(dshHome,suffix))throw failure('PROFILE_UNAVAILABLE');add('profile',true,'已发现当前 Harness Desktop profile');}catch{add('profile',false,'未找到当前 Harness Desktop profile 与存储目录');}
 return checks;
}
async function availablePorts(values){const listeners=[];try{for(const port of Object.values(values)){if(port===0)continue;const server=createServer();listeners.push(server);await new Promise((done,reject)=>{server.once('error',()=>reject(failure('PORT_IN_USE')));server.listen({host:'127.0.0.1',port,exclusive:true},done);});}}finally{await Promise.all(listeners.filter(server=>server.listening).map(server=>new Promise(done=>server.close(done))));}}
function boundPort(url,suffix){const match=typeof url==='string'&&url.match(/^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})(\/rpc)?$/);if(!match||Number(match[1])>65535||(match[2]??'')!==suffix)throw failure('LOCAL_START_FAILED');return Number(match[1]);}
const defaultRead=async options=>(await import('../runtime/scripts/harness-read.mjs')).launchHarnessRead(options);
const defaultManager=async options=>(await import('../runtime/scripts/management.mjs')).launchManagement(options);

export function createManagedRuntime({dshHome:requestedHome,dataDir:requestedData,cloudHealthFile:requestedCloudHealthFile,env=process.env,home=homedir(),preflight=runtimePreflight,ports:requestedPorts,checkPorts=availablePorts,launchRead=defaultRead,launchManager=defaultManager,nodeExecutable=process.execPath,nodeElectron=Boolean(process.versions.electron),checkMcp=probeManagedMcp}={}){
 const selectedPorts=requestedPorts??DEFAULT_PORTS;
 let selectedCloudHealthFile=requestedCloudHealthFile,validatedMcpCommand;
 const mcpEntry=()=>managedMcpEntry({dataDir,executable:nodeExecutable,electron:nodeElectron,env});
 const expanded=requestedHome??(env.DSH_HOME?.trim()||join(home,'.dsh'));
 const dshHome=resolve(expanded==='~'?home:expanded.startsWith('~/')?join(home,expanded.slice(2)):expanded),dataDir=requestedData??join(dshHome,'dot-dsh-connector');
 let config,reader,manager,lock,lockIdentity,foreignLock=false,closed=false,running=false,phase='setup_required',lastError,checks=[],pending=Promise.resolve();
 const serial=fn=>{const result=pending.then(fn);pending=result.catch(()=>{});return result;};
 const assertOpen=()=>{if(closed)throw failure('CLOSED');};
 const response=()=>({mode:'managed',phase,last_checked_at:new Date().toISOString(),supported:SUPPORTED,checks,services:{reader:reader?'running':foreignLock?'unknown':'stopped',manager:manager?'running':foreignLock?'unknown':'stopped',tunnel:'external_setup_required'},account:{state:'unverified',message:'本地就绪不表示 Dot 已连接。请在官方账号界面完成本人私有 Tunnel 与插件授权，并用实际 Dot 调用验证。'},actions:{prepare:!closed&&!running,start:!closed&&!running&&!lastError&&Boolean(config)&&checks.every(c=>c.ok),stop:!closed&&running},scope:{reads:'读取本人已保存的项目、会话与允许的文件；不会唤醒已有会话。',execution:'仅执行本人派发的新任务，沿用 Harness 模型、工具与审批。'},handoff:{steps:['在目标 OpenAI workspace 的官方界面确认私有插件 / 自定义 MCP 与 Secure MCP Tunnel 权限。','按官方 Tunnel CLI 的当前帮助，将下方命令设为 stdio 服务；运行密钥由官方流程保管，不交给本插件。','在 Dot 官方界面关联本人私有 Tunnel 并授权工具。用实际读取、派任务及结果回读分别确认。','插件停止或升级会关闭本地监听器；已交给 Harness 的任务不会自动取消。'],...(config?{command:mcpEntry().mcpCommand}:{})},...(lastError?{error:lastError}:{})});
 async function ensureOwnership(){
  try{
   const current=await lstat(join(dataDir,'runtime.lock'));
   if(lock&&lockIdentity&&current.isFile()&&current.nlink===1&&current.dev===lockIdentity.dev&&current.ino===lockIdentity.ino){foreignLock=false;return;}
   foreignLock=true;throw failure('STATE_LOCKED');
  }catch(error){if(error.code==='ENOENT'&&!lock){foreignLock=false;return;}if(error.code==='ENOENT'){foreignLock=true;throw failure('STATE_LOCKED');}throw error;}
 }
 async function inspect(){
  try{canonical(dataDir);checks=await preflight({dshHome});await privateDirectory(dataDir);await ensureOwnership();config=await configAt(dataDir);if(config.dshHome!==dshHome)throw failure('PRIVATE_STATE_REQUIRED');await tokenFile(join(dataDir,'channel.key'));await tokenFile(join(dataDir,'admin.key'));if(!running&&!lastError)phase='prepared';}
  catch(error){if(error.code==='ENOENT'){if(!running&&!lastError)phase='setup_required';}else{lastError=safeError(Object.hasOwn(MESSAGES,error.code)?error:failure('PRIVATE_STATE_REQUIRED'));phase='blocked';}}
  if(checks.some(c=>!c.ok)){phase='blocked';lastError=safeError(failure('UNSUPPORTED_RUNTIME'));}return response();
 }
 async function prepare(){
  assertOpen();lastError=undefined;if(selectedCloudHealthFile!==undefined)canonical(selectedCloudHealthFile);checks=await preflight({dshHome});if(checks.some(c=>!c.ok))throw failure('UNSUPPORTED_RUNTIME');
  canonical(dataDir);ports.parse(selectedPorts);await privateDirectory(dataDir,true);await ensureOwnership();
  try{config=await configAt(dataDir);}catch(error){if(error.code!=='ENOENT')throw failure('PRIVATE_STATE_REQUIRED');config={version:1,dshHome,dataDir,principal:'owner-'+randomBytes(16).toString('hex'),ports:selectedPorts,automaticPorts:requestedPorts===undefined,...requestedPorts===undefined?{}:{requestedPorts},...selectedCloudHealthFile===undefined?{}:{cloudHealthFile:selectedCloudHealthFile}};await tokenFile(join(dataDir,'channel.key'),true);await tokenFile(join(dataDir,'admin.key'),true);try{await createPrivateFile(join(dataDir,'config.json'),JSON.stringify(config,null,2)+'\n');}catch(error){if(error.code!=='EEXIST')throw error;config=await configAt(dataDir);}}
  if(config.dshHome!==dshHome)throw failure('PRIVATE_STATE_REQUIRED');await tokenFile(join(dataDir,'channel.key'));await tokenFile(join(dataDir,'admin.key'));
  if(selectedCloudHealthFile!==undefined&&config.cloudHealthFile!==selectedCloudHealthFile){
   if(running)throw failure('SETUP_RUNNING');let temporaryLock=false;
   try{
    if(!lock){try{lock=await open(join(dataDir,'runtime.lock'),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);temporaryLock=true;}catch(error){if(error.code==='EEXIST')throw failure('STATE_LOCKED');throw error;}lockIdentity=await lock.stat();await lock.writeFile(JSON.stringify({instance:randomBytes(16).toString('hex'),pid:process.pid,started_at:new Date().toISOString()}));}
    await ensureOwnership();const current=await configAt(dataDir);await saveConfiguration({...current,cloudHealthFile:selectedCloudHealthFile});
   }finally{if(temporaryLock)await release();}
  }
  if(!running)phase='prepared';return response();
 }
 async function saveConfiguration(next){
  if(!lock)throw failure('STATE_LOCKED');await ensureOwnership();await privateDirectory(dataDir);const current=await configAt(dataDir);if(current.principal!==config.principal||next.principal!==current.principal)throw failure('PRIVATE_STATE_REQUIRED');
  const temporary=join(dataDir,'config-'+randomBytes(12).toString('hex')+'.tmp');await createPrivateFile(temporary,JSON.stringify(next,null,2)+'\n');try{await ensureOwnership();await rename(temporary,join(dataDir,'config.json'));config=next;}finally{await unlink(temporary).catch(()=>{});}
 }
 async function saveIntent(activated){
  if(!config||config.activated===activated)return;const current=await configAt(dataDir);await saveConfiguration({...current,activated});
 }
 async function release(){
  running=false;let error;for(const resource of [manager,reader])try{await resource?.close();}catch(e){error=e;}manager=undefined;reader=undefined;
  if(lock){try{const current=await lstat(join(dataDir,'runtime.lock'));if(lockIdentity&&current.dev===lockIdentity.dev&&current.ino===lockIdentity.ino)await unlink(join(dataDir,'runtime.lock'));}catch(e){if(e.code!=='ENOENT')error=e;}await lock.close();lock=undefined;lockIdentity=undefined;}
  if(error)throw error;
 }
 async function start(){
  assertOpen();if(running)return response();await prepare();const requested=config.automaticPorts?DEFAULT_PORTS:config.requestedPorts??config.ports;await checkPorts(requested);assertOpen();
  try{lock=await open(join(dataDir,'runtime.lock'),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);}catch(error){if(error.code==='EEXIST')throw failure('STATE_LOCKED');throw error;}
  try{
   lockIdentity=await lock.stat();await lock.writeFile(JSON.stringify({instance:randomBytes(16).toString('hex'),pid:process.pid,started_at:new Date().toISOString()}));
   const channelToken=await tokenFile(join(dataDir,'channel.key')),adminToken=await tokenFile(join(dataDir,'admin.key'));
   reader=await launchRead({config:{enabled:true,scope:'owner-harness-read-only',dshHome,principal:config.principal,tokenEnv:'DOT_DSH_TOKEN',port:requested.reader},token:channelToken});assertOpen();
   manager=await launchManager({config:{enabled:true,principal:config.principal,stateDir:join(dataDir,'audit'),nativeStateDir:join(dataDir,'tasks'),readUrl:reader.url,gatewayPort:requested.gateway,adminPort:requested.admin,workerPort:requested.worker,nativeExecution:true,...config.cloudHealthFile===undefined?{}:{cloudHealthFile:config.cloudHealthFile}},channelToken,adminToken});assertOpen();
   // Publish usable addresses only after every owned listener has been acquired.
   const actual={reader:boundPort(reader.url,'/rpc'),gateway:boundPort(manager.gatewayUrl,'/rpc'),admin:boundPort(manager.adminUrl,'/rpc'),worker:boundPort(manager.nativeWorkerUrl,'')};
   if(new Set(Object.values(actual)).size!==4)throw failure('LOCAL_START_FAILED');
   await saveConfiguration({...config,ports:actual,activated:true});running=true;phase='running';lastError=undefined;return response();
  }catch(error){await release();throw error;}
 }
 const attempt=fn=>serial(async()=>{try{return await fn();}catch(error){lastError=safeError(error);phase='blocked';return response();}});
 return{
  status:()=>serial(inspect),prepare:()=>attempt(prepare),start:()=>attempt(start),
  resume:()=>attempt(async()=>{await inspect();if(config?.activated&&checks.every(c=>c.ok)&&!lastError)return start();return response();}),
  stop:()=>attempt(async()=>{
   // Keep exclusive ownership through the intent write; a successor must never see a late write from this stop.
   try{await ensureOwnership();if(lock)await saveIntent(false);}finally{await release();}
   phase=config?'stopped':'setup_required';lastError=undefined;return response();
  }),
  async adminReference(){if(!running)throw failure('SETUP_REQUIRED');return{tokenFile:join(dataDir,'admin.key'),url:manager.adminUrl};},
  async nativeWorkerReference(){if(!running||closed)throw failure('SETUP_REQUIRED');boundPort(manager.nativeWorkerUrl,'');return manager.nativeWorkerUrl+'/native/';},
  onboardingReference:({verify=true}={})=>serial(async()=>{
   assertOpen();if(!config)config=await configAt(dataDir);await ensureOwnership();const entry=mcpEntry();
   if(verify&&validatedMcpCommand!==entry.mcpCommand){try{await checkMcp(entry);assertOpen();await ensureOwnership();validatedMcpCommand=entry.mcpCommand;}catch{throw failure('MCP_ENTRY_UNAVAILABLE');}}
   return{directory:join(dataDir,'onboarding'),mcpCommand:entry.mcpCommand,cloudHealthFile:config.cloudHealthFile,running};
  }),
  setCloudHealthFile:path=>serial(async()=>{
   assertOpen();canonical(path);if(!config)config=await configAt(dataDir);await ensureOwnership();
   if(config.cloudHealthFile===path){selectedCloudHealthFile=path;return;}
   if(running)throw failure('SETUP_RUNNING');
   if(path!==join(dataDir,'onboarding','health.url'))throw failure('PRIVATE_STATE_REQUIRED');
   let temporaryLock=false;
   try{
    if(!lock){try{lock=await open(join(dataDir,'runtime.lock'),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);temporaryLock=true;}catch(error){if(error.code==='EEXIST')throw failure('STATE_LOCKED');throw error;}lockIdentity=await lock.stat();await lock.writeFile(JSON.stringify({instance:randomBytes(16).toString('hex'),pid:process.pid,started_at:new Date().toISOString()}));}
    await ensureOwnership();const current=await configAt(dataDir);await saveConfiguration({...current,cloudHealthFile:path});selectedCloudHealthFile=path;
   }finally{if(temporaryLock)await release();}
  }),
  close(){closed=true;return serial(async()=>{await release();phase=config?'stopped':'setup_required';});},
 };
}

export async function managedMcpEnvironment(dataDir,{electron=Boolean(process.versions.electron)}={}){canonical(dataDir);const config=await configAt(dataDir);const token=await tokenFile(join(dataDir,'channel.key'));const gateway=`http://127.0.0.1:${config.ports.gateway}/rpc`;return{...electron?{ELECTRON_RUN_AS_NODE:'1'}:{},DOT_DSH_TOKEN:token,DOT_DSH_BRIDGE_URL:gateway,DOT_DSH_HARNESS_BRIDGE_URL:gateway,DOT_DSH_NATIVE_TASKS_URL:gateway,DOT_DSH_FIXTURE_TASKS:'disabled'};}
export function externalSetupStatus(){return{mode:'external',phase:'external',supported:SUPPORTED,checks:[],services:{reader:'external',manager:'external',tunnel:'external_setup_required'},account:{state:'unverified',message:'保留现有外部服务与连接。本地状态不证明 Dot 账号已关联。'},actions:{prepare:false,start:false,stop:false},handoff:{steps:['使用现有安装的官方 Tunnel 与 Dot 连接流程；本插件不会迁移其数据或接管进程。']},scope:{reads:'现有外部管理器配置的范围',execution:'现有原生任务通道'}};}
