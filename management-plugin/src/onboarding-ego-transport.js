/** Bounded Ego v2 rounds. Only explicit, validated receipts cross the process boundary. */
import {spawn} from 'node:child_process';
import {lstat,realpath} from 'node:fs/promises';
import {homedir} from 'node:os';
import {isAbsolute,join,resolve,sep,basename} from 'node:path';
import {randomBytes} from 'node:crypto';
import {StringDecoder} from 'node:string_decoder';

const MESSAGES={
 EGO_BROWSER_UNAVAILABLE:'无法打开 Ego 连接窗口，请检查 Ego 是否已安装。',
 ONBOARDING_PAGE_CHANGED:'连接页面状态无法确认，请保留窗口并继续连接。',
 ONBOARDING_EGO_CONTROL:'连接窗口正由你操作或已暂停，请回到插件继续连接。',
 ONBOARDING_EGO_SPACE_MISSING:'原连接窗口已关闭。重新打开窗口会保留现有账号授权与任务。',
 ONBOARDING_EGO_HANDOFF:'连接窗口已交给你，请完成当前步骤后回到插件继续连接。',
 ONBOARDING_EGO_TIMEOUT:'本次窗口操作尚未确认，请先检查当前页面，再继续连接。',
 ONBOARDING_EGO_OUTPUT_LIMIT:'本次窗口操作返回过多内容，已停止自动操作。',
 ONBOARDING_EGO_BUSY:'连接窗口已有操作正在进行。',
 ONBOARDING_KEY_RECOVERY:'专用密钥尚未完整记录，请保留当前窗口并继续连接。',
 ONBOARDING_PRIVATE_STATE:'连接状态目录需要本人独占访问。',
 ONBOARDING_AUTH_BROWSER_REJECTED:'当前登录方式被官方页面拒绝，请在连接窗口查看其他可用登录方式。',
 ONBOARDING_BROWSER_CLOSED:'连接窗口已关闭，请继续连接以重新打开。'
};
const error=(code,{late=false}={})=>Object.assign(new Error(MESSAGES[code]??MESSAGES.ONBOARDING_PAGE_CHANGED),{code,...late?{mayHaveLateEffects:true}: {}});
const abortError=late=>Object.assign(new Error('Connection setup cancelled.'),{name:'AbortError',...late?{mayHaveLateEffects:true}:{}});
const check=signal=>{if(signal?.aborted)throw abortError(false);};
const pageLabelValid=value=>typeof value==='string'&&/^p[1-9][0-9]{0,6}$/.test(value);
const spaceIdValid=value=>Number.isSafeInteger(value)&&value>0;

const RECEIPT_FIELDS={
 spaceId:'space',pageLabel:'page',platformPage:'page',dotPage:'page',
 status:'tag',step:'tag',reason:'tag',state:'tag',waiting_for:'tag',
 prepared:'bool',pending:'bool',ready:'bool',sent:'bool',verified:'bool',resumed:'bool',handed_off:'bool',finished:'bool',claimed:'bool',protectedPages:'pages',
 key_saved:'bool',plugin_connected:'bool',connected:'bool',created:'bool',found:'bool',navigated:'bool',
 tunnel_id:'tunnel',organization_id:'organization',workspace_id:'workspace',plugin_id:'plugin',
 installation_id:'installation',tunnel_name:'tunnelName',plugin_name:'pluginName',request_id:'request',count:'count',patch:'patch'
};
const PATCH_FIELDS={
 version:'version',installation_id:'installation',tunnel_name:'tunnelName',plugin_name:'pluginName',
 tunnel_id:'tunnel',organization_id:'organization',workspace_id:'workspace',plugin_id:'plugin',
 tunnel_intent:'bool',key_intent:'bool',key_saved:'bool',key_capture_nonce:'nonce',plugin_intent:'bool',plugin_connected:'bool',
 verification_request_ids:'requests',verification_pending_request:'nullableRequest',
 plugin_absence_fingerprint:'fingerprint',plugin_absence_since:'timestamp'
};

// Kept self-contained so the same restrictions run before output AND after parsing.
function validateReceipt(value,fields,patchFields){
 const invalid=()=>{throw Object.assign(new Error('Invalid connection receipt.'),{code:'ONBOARDING_PAGE_CHANGED'});};
 const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
 const text=(value,pattern,maximum=160)=>typeof value==='string'&&value.length<=maximum&&pattern.test(value);
 const request=value=>text(value,/^dsh_connect_[a-f0-9]{32}$/);
 const plugin=value=>text(value,/^plugin_[A-Za-z0-9_-]{8,180}$/,200);
 function object(input,schema){
  if(!record(input))invalid();const result={};
  for(const [key,item]of Object.entries(input)){
   if(item===undefined)continue;
   if(!Object.hasOwn(schema,key))invalid();const type=schema[key];let valid=false;
   switch(type){
    case 'bool':valid=typeof item==='boolean';break;
    case 'space':valid=Number.isSafeInteger(item)&&item>0;break;
    case 'count':valid=Number.isSafeInteger(item)&&item>=0&&item<=100000;break;
    case 'timestamp':valid=item===null||(Number.isSafeInteger(item)&&item>=0);break;
    case 'version':valid=item===1;break;
    case 'page':valid=text(item,/^p[1-9][0-9]{0,6}$/);break;
    case 'pages':valid=Array.isArray(item)&&item.length<=100&&new Set(item).size===item.length&&item.every(label=>text(label,/^p[1-9][0-9]{0,6}$/));break;
    case 'tag':valid=text(item,/^[a-z][a-z0-9_-]{0,79}$/,80);break;
    case 'installation':valid=text(item,/^[a-f0-9]{32}$/);break;
    case 'nonce':valid=text(item,/^[a-f0-9]{32}$/);break;
    case 'tunnelName':valid=text(item,/^dsh-dot-[a-f0-9]{32}$/);break;
    case 'pluginName':valid=text(item,/^DeepSeek Harness(?: Connector)?(?: · [^\r\n\0]{1,80})?$/,120)&&!/(?:sk-|https?:|@)/.test(item);break;
    case 'tunnel':valid=text(item,/^tunnel_[A-Za-z0-9_-]{8,120}$/);break;
    case 'organization':valid=text(item,/^org[-_][A-Za-z0-9_-]{8,120}$/);break;
    case 'workspace':valid=text(item,/^(?:[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}|(?:ws|workspace)[-_][A-Za-z0-9_-]{8,120})$/);break;
    case 'plugin':valid=plugin(item);break;
    case 'request':valid=request(item);break;
    case 'nullableRequest':valid=item===null||request(item);break;
    case 'requests':valid=Array.isArray(item)&&item.length<=100&&item.every(request);break;
    case 'fingerprint':valid=item===null||(typeof item==='string'&&item.length<=16384&&(item===''||item.split(/[|,\n]/).every(plugin)));break;
    case 'patch':result[key]=object(item,patchFields);continue;
   }
   if(!valid)invalid();result[key]=item;
  }
  return result;
 }
 return object(value,fields);
}

async function executable({path,officialPath,home,lstatImpl,realpathImpl}){
 try{
  if(typeof path!=='string'||!isAbsolute(path)||resolve(path)!==path||path.includes('\0'))throw 0;
  const entry=await lstatImpl(path);let target=path;
  if(entry.isSymbolicLink()){
   // The installed shim points through ~/.local/share/ego to the signed app bundle.
   if(path!==officialPath)throw 0;
   target=await realpathImpl(path);
   const roots=[join(home,'.local','share','ego'),'/Applications/ego lite.app/Contents',join(home,'Applications','ego lite.app','Contents')];
   if(!roots.some(root=>target.startsWith(root+sep))||basename(target)!=='ego-browser')throw 0;
  }else if(!entry.isFile())throw 0;
  const info=target===path?entry:await lstatImpl(target);
  if(!info.isFile()||info.isSymbolicLink()||!Number.isInteger(info.mode)||(info.mode&0o111)===0||(info.mode&0o002)!==0)throw 0;
  if(typeof process.getuid==='function'&&Number.isInteger(info.uid)&&![0,process.getuid()].includes(info.uid))throw 0;
  return target;
 }catch{throw error('EGO_BROWSER_UNAVAILABLE');}
}

function wrapScript(prelude,body,marker){
 return `const __receiptMarker = ${JSON.stringify(marker)};
const __validateReceipt = ${validateReceipt.toString()};
const __receiptFields = ${JSON.stringify(RECEIPT_FIELDS)};
const __patchFields = ${JSON.stringify(PATCH_FIELDS)};
const __safeCodes = ${JSON.stringify(Object.keys(MESSAGES))};
let __phaseStarted = false;
try {
${prelude}
 __phaseStarted = true;
 let __emitted, __emitCount = 0;
 const emit = (receipt) => { if (++__emitCount > 1) throw Object.assign(new Error('Duplicate receipt.'), {code:'ONBOARDING_PAGE_CHANGED'}); __emitted = __validateReceipt(receipt, __receiptFields, __patchFields); };
 const __returned = await (async () => {
${body}
 })();
 if (__emitCount && __returned !== undefined) throw Object.assign(new Error('Ambiguous receipt.'), {code:'ONBOARDING_PAGE_CHANGED'});
 const __receipt = __validateReceipt(__emitCount ? __emitted : __returned, __receiptFields, __patchFields);
 console.log(__receiptMarker + JSON.stringify({ok:true,receipt:__receipt}));
} catch (__error) {
 const __rawCode = typeof __error?.code === 'string' ? __error.code : '';
 const __control = /^EGO_.*(?:CONTROL|OWN|INACTIVE|UNASSIGNED|NAME_IN_USE|SPACE_NOT_FOUND)/.test(__rawCode);
 const __code = __control ? 'ONBOARDING_EGO_CONTROL' : __safeCodes.includes(__rawCode) ? __rawCode : 'ONBOARDING_PAGE_CHANGED';
 const __late = __error?.mayHaveLateEffects === true || (__phaseStarted && !__control && !__safeCodes.includes(__rawCode));
 console.log(__receiptMarker + JSON.stringify({ok:false,error:{code:__code,...__late ? {mayHaveLateEffects:true} : {},...__error?.executionStopped === true ? {executionStopped:true} : {}}}));
}
`;
}

function decodeOutput(output,marker){
 const candidates=output.split(/\r?\n/).filter(line=>line.startsWith(marker));
 if(candidates.length!==1)throw error('ONBOARDING_PAGE_CHANGED',{late:true});
 let result;try{result=JSON.parse(candidates[0].slice(marker.length));}catch{throw error('ONBOARDING_PAGE_CHANGED',{late:true});}
 if(!result||typeof result!=='object'||Array.isArray(result))throw error('ONBOARDING_PAGE_CHANGED',{late:true});
 if(result.ok===false){
  const code=Object.hasOwn(MESSAGES,result.error?.code)?result.error.code:'ONBOARDING_PAGE_CHANGED';
  const failure=error(code,{late:result.error?.mayHaveLateEffects===true});
  if(result.error?.executionStopped===true)failure.executionStopped=true;
  throw failure;
 }
 if(result.ok!==true||Object.keys(result).some(key=>!['ok','receipt'].includes(key)))throw error('ONBOARDING_PAGE_CHANGED',{late:true});
 return validateReceipt(result.receipt,RECEIPT_FIELDS,PATCH_FIELDS);
}

function runChild({command,script,marker,signal,timeoutMs,maxOutputBytes,spawnImpl,killGroupImpl}){
 return new Promise((yes,no)=>{
  check(signal);let child;
  try{child=spawnImpl(command,['nodejs'],{shell:false,detached:process.platform!=='win32',windowsHide:true,stdio:['pipe','pipe','pipe']});}catch{no(error('EGO_BROWSER_UNAVAILABLE'));return;}
  let settled=false,candidates=[],timer;
  const streams={stdout:{size:0,tail:'',decoder:new StringDecoder('utf8')},stderr:{size:0,tail:'',decoder:new StringDecoder('utf8')}};
  const line=value=>{const normalized=value.endsWith('\r')?value.slice(0,-1):value;if(normalized.startsWith(marker))candidates.push(normalized);};
  const collect=(stream,value)=>{stream.tail+=value;let boundary;while((boundary=stream.tail.indexOf('\n'))!==-1){line(stream.tail.slice(0,boundary));stream.tail=stream.tail.slice(boundary+1);}};
  const terminate=()=>{try{if(process.platform!=='win32'&&Number.isSafeInteger(child.pid)&&child.pid>0)killGroupImpl(-child.pid,'SIGTERM');else child.kill('SIGTERM');}catch{try{child.kill('SIGTERM');}catch{}}};
  const finish=(failure,result)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);candidates=[];for(const stream of Object.values(streams)){stream.tail='';stream.decoder=null;}failure?no(failure):yes(result);};
  const abort=()=>{terminate();finish(abortError(true));};
  timer=setTimeout(()=>{terminate();finish(error('ONBOARDING_EGO_TIMEOUT',{late:true}));},timeoutMs);
  signal?.addEventListener('abort',abort,{once:true});
  child.once('error',()=>finish(error('EGO_BROWSER_UNAVAILABLE')));
  child.stdin.on('error',()=>{terminate();finish(error('EGO_BROWSER_UNAVAILABLE',{late:true}));});
  // Ego can route console.log to either pipe. Keep only exact nonce lines;
  // ordinary diagnostics (including OAuth URLs) are discarded, never returned.
  for(const name of ['stdout','stderr'])child[name].on('data',chunk=>{
   if(settled)return;const stream=streams[name],buffer=Buffer.from(chunk);stream.size+=buffer.length;
   if(stream.size>maxOutputBytes){terminate();finish(error('ONBOARDING_EGO_OUTPUT_LIMIT',{late:true}));return;}
   collect(stream,stream.decoder.write(buffer));
  });
  child.once('close',(code,terminationSignal)=>{
   if(settled)return;
   if(code!==0||terminationSignal){finish(error('EGO_BROWSER_UNAVAILABLE',{late:true}));return;}
   try{for(const stream of Object.values(streams)){collect(stream,stream.decoder.end());if(stream.tail)line(stream.tail);}finish(null,decodeOutput(candidates.join('\n'),marker));}catch(failure){finish(failure);}
  });
  if(signal?.aborted){abort();return;}
  try{child.stdin.end(script);}catch{terminate();finish(error('EGO_BROWSER_UNAVAILABLE',{late:true}));}
 });
}

/** `script` is trusted bundled phase code, never page-provided text. It can return or emit one receipt. */
export function createEgoTransport({executablePath,spawnImpl=spawn,killGroupImpl=process.kill,lstatImpl=lstat,realpathImpl=realpath,homeDirectory=homedir(),timeoutMs:defaultTimeoutMs=30000,maxOutputBytes=65536}={}){
 const officialPath=join(homeDirectory,'.local','bin','ego-browser');
 if(!Number.isInteger(defaultTimeoutMs)||defaultTimeoutMs<1||defaultTimeoutMs>60000||!Number.isInteger(maxOutputBytes)||maxOutputBytes<256||maxOutputBytes>1048576)throw error('ONBOARDING_PAGE_CHANGED');
 let busy=false;
 async function invoke({prelude,script,signal,timeoutMs=defaultTimeoutMs}){
  check(signal);
  if(busy)throw error('ONBOARDING_EGO_BUSY');
  if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>60000||typeof script!=='string'||Buffer.byteLength(script)>131072)throw error('ONBOARDING_PAGE_CHANGED');
  busy=true;
  try{
   const command=await executable({path:executablePath??officialPath,officialPath,home:homeDirectory,lstatImpl,realpathImpl});check(signal);
   const marker=`__DSH_EGO_RECEIPT_${randomBytes(16).toString('hex')}__:`;
   return await runChild({command,script:wrapScript(prelude,script,marker),marker,signal,timeoutMs,maxOutputBytes,spawnImpl,killGroupImpl});
  }finally{busy=false;}
 }
 const validSpace=spaceId=>{if(!spaceIdValid(spaceId))throw error('ONBOARDING_PAGE_CHANGED');};
 return{
  async inspectBinding({spaceId,signal,timeoutMs}={}){
   validSpace(spaceId);
   return invoke({prelude:'',script:`const spaces = await listTaskSpaces();
if (!Array.isArray(spaces) || spaces.some(space => !Number.isSafeInteger(space?.id) || space.id < 1) || new Set(spaces.map(space => space.id)).size !== spaces.length) throw Object.assign(new Error('Incomplete space inventory.'), {code:'ONBOARDING_PAGE_CHANGED'});
return {spaceId:${spaceId},found:spaces.some(space => space.id === ${spaceId})};`,signal,timeoutMs});
  },
  async recoverBinding({name,signal,timeoutMs}={}){
   if(typeof name!=='string'||!name.trim()||name.length>120||/[\r\n\0]/.test(name))throw error('ONBOARDING_PAGE_CHANGED');
   // Recover a lost creation receipt by its one persisted name, without another
   // creation or an ownership change. Unknown or ambiguous inventories fail shut.
   return invoke({prelude:'',script:`const spaces = await listTaskSpaces();
if (!Array.isArray(spaces) || spaces.some(space => !Number.isSafeInteger(space?.id) || space.id < 1 || typeof space.name !== 'string') || new Set(spaces.map(space => space.id)).size !== spaces.length) throw Object.assign(new Error('Incomplete space inventory.'), {code:'ONBOARDING_PAGE_CHANGED'});
const matches = spaces.filter(space => space.name === ${JSON.stringify(name)});
if (matches.length === 0) return {found:false};
if (matches.length !== 1) throw Object.assign(new Error('Ambiguous replacement space.'), {code:'ONBOARDING_PAGE_CHANGED'});
const space = await taskSpace(matches[0].id);
const pages = await space.pages();
if (space.spaceId !== matches[0].id || pages.length !== 1 || !pages[0]?.label) throw Object.assign(new Error('Unexpected replacement pages.'), {code:'ONBOARDING_PAGE_CHANGED'});
return {found:true,spaceId:space.spaceId,platformPage:pages[0].label};`,signal,timeoutMs});
  },
  async run({spaceId,pageLabel,script,signal,timeoutMs}={}){
   validSpace(spaceId);if(!pageLabelValid(pageLabel))throw error('ONBOARDING_PAGE_CHANGED');
   return invoke({prelude:`const space = await taskSpace(${spaceId});\nconst page = space.page(${JSON.stringify(pageLabel)});`,script,signal,timeoutMs});
  },
  async createBinding({name,signal,timeoutMs}={}){
   if(typeof name!=='string'||!name.trim()||name.length>120||/[\r\n\0]/.test(name))throw error('ONBOARDING_PAGE_CHANGED');
   // Names are stable per installation. Ego resumes that same owned name after an uncertain round.
   return invoke({prelude:`const space = await taskSpace(${JSON.stringify(name)});`,script:"const pages = await space.pages(); if (pages.length !== 1 || !pages[0]?.label) throw Object.assign(new Error('Unexpected connection pages.'), {code:'ONBOARDING_PAGE_CHANGED'}); return {spaceId:space.spaceId,platformPage:pages[0].label};",signal,timeoutMs});
  },
  async createPage({spaceId,kind,signal,timeoutMs}={}){
   validSpace(spaceId);if(!['platform','connection','verification'].includes(kind))throw error('ONBOARDING_PAGE_CHANGED');
   // Persist the real label before navigation. A failed load must not lose an already-created page.
   return invoke({prelude:`const space = await taskSpace(${spaceId});`,script:'const page = await space.newPage(); return {pageLabel:page.label};',signal,timeoutMs});
  },
  async createVerificationPage(options={}){return this.createPage({...options,kind:'verification'});},
  async handOffBinding({spaceId,signal,timeoutMs}={}){
   validSpace(spaceId);
   return invoke({prelude:`const space = await taskSpace(${spaceId});`,script:'const boundId = space.spaceId; await space.handOff(); return {spaceId:boundId,handed_off:true};',signal,timeoutMs});
  },
  async finishBinding({spaceId,keep,signal,timeoutMs}={}){
   validSpace(spaceId);if(!Array.isArray(keep)||keep.length>100||!keep.every(pageLabelValid)||new Set(keep).size!==keep.length)throw error('ONBOARDING_PAGE_CHANGED');
   return invoke({prelude:`const space = await taskSpace(${spaceId});`,script:`const managed = await space.pages();
const keep = ${JSON.stringify(keep)}.filter(label => managed.some(page => page.label === label));
const boundId = space.spaceId;
if (boundId !== ${spaceId}) throw Object.assign(new Error('Unexpected connection space.'), {code:'ONBOARDING_PAGE_CHANGED'});
await space.finish({keep});
return {spaceId:boundId,finished:true};`,signal,timeoutMs});
  },
  async claimBinding({spaceId,signal,timeoutMs}={}){
   validSpace(spaceId);
   // Only the provider's explicit reverify path may claim a completed space.
   return invoke({prelude:`const space = await claimTaskSpace(${spaceId});`,script:'const tabs = await space.tabs(); return {spaceId:space.spaceId,claimed:true,protectedPages:tabs.filter(tab => tab.label !== undefined).map(tab => tab.label)};',signal,timeoutMs});
  },
  async resumeBinding({spaceId,handedOff=false,signal,timeoutMs}={}){
   validSpace(spaceId);if(typeof handedOff!=='boolean')throw error('ONBOARDING_PAGE_CHANGED');
   // A handle may still be readable after handOff. The provider persists this explicit
   // handoff receipt and invokes resume only after the user's Continue authorization.
   if(handedOff)return invoke({prelude:`let space; try { space = await takeOverTaskSpace(${spaceId}); } catch { throw Object.assign(new Error('Connection control unavailable.'), {code:'ONBOARDING_EGO_CONTROL'}); }`,script:'return {spaceId:space.spaceId,resumed:true};',signal,timeoutMs});
   // An explicit Continue can follow a manual takeover. First reuse without changing ownership.
   const prelude=`let space;
try { space = await taskSpace(${spaceId}); }
catch (__selectionError) {
 const __code = typeof __selectionError?.code === 'string' ? __selectionError.code : '';
 if (!/^EGO_.*(?:HANDOFF|HAND_OFF|CONTROL)/.test(__code) || /INACTIVE|UNASSIGNED|USER_OWNED|NAME_IN_USE|NOT_FOUND/.test(__code)) throw Object.assign(new Error('Connection control unavailable.'), {code:'ONBOARDING_EGO_CONTROL'});
 try { space = await takeOverTaskSpace(${spaceId}); }
 catch { throw Object.assign(new Error('Connection control unavailable.'), {code:'ONBOARDING_EGO_CONTROL'}); }
}`;
   return invoke({prelude,script:'return {spaceId:space.spaceId,resumed:true};',signal,timeoutMs});
  }
 };
}
