import {selectPythonExecutable} from './python-runtime.js';
import {execFile} from 'node:child_process';
import {mkdtemp,mkdir,open,readFile,writeFile,rm,realpath,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,isAbsolute,join,dirname,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {zstdDecompressSync} from 'node:zlib';
import {z} from 'zod';
const ASAR='/Applications/DeepSeek Harness.app/Contents/Resources/app.asar';
const PACKAGES=['@deepseek-ai/dsh-session-format-v0-to-v1','@deepseek-ai/dsh-session-format-v1-to-v2','@deepseek-ai/dsh-session-format-v2-to-v3','@deepseek-ai/dsh-session-format-v3-to-v4'];
const helper=fileURLToPath(new URL('../scripts/read-harness-storage.py',import.meta.url));
const error=()=>Object.assign(new Error('Harness persisted snapshot is unavailable.'),{code:'HARNESS_UNAVAILABLE'});
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const identity=z.string().min(1).max(256);
const extraWorkspaceSchema=z.array(z.object({workspaceId:z.string().min(1).max(512).refine(value=>!value.includes('\0')),path:z.string().min(1).max(4096).refine(value=>isAbsolute(value)&&resolve(value)===value&&!value.startsWith('//')&&!value.includes('\\')&&!value.includes('\0')),title:z.string().min(1).max(512),contextKind:z.enum(['skill','instructions','skill_catalog']),sessionIds:z.array(z.string()).length(0)}).strict()).max(100);
const address=z.discriminatedUnion('kind',[z.object({kind:z.literal('session'),sessionId:identity}).strict(),z.object({kind:z.literal('subagent'),parentSessionId:identity,childSessionId:identity,mode:z.enum(['unknown','one-shot','continuable'])}).strict()]);
const methods={
 'workspace/baseline':z.object({}).strict(),
 'pluginInventory/list':z.object({}).strict(),
 'session/list':z.object({_request:z.object({}).strict()}).strict(),
 'session/projections':z.object({request:z.object({sessionId:identity}).strict()}).strict(),
 'session/page':z.object({request:z.object({address,throughSeq:z.number().int().min(-1).max(Number.MAX_SAFE_INTEGER),beforeSeq:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),maxMessages:z.number().int().min(1).max(100)}).strict()}).strict(),
};
function readStorage(home,operation,artifact){return new Promise((fulfil,reject)=>{
 const request={home,operation,...artifact===undefined?{}:{artifact}};
 const child=execFile(selectPythonExecutable(),['-I','-S','-B',helper],{shell:false,cwd:'/',env:{PATH:process.env.PATH??'/usr/bin:/bin'},encoding:'utf8',timeout:15000,maxBuffer:24*1024*1024},(failure,stdout)=>{
  if(failure)return reject(error());try{const value=JSON.parse(stdout);if(!record(value)||value.error)throw error();fulfil(value);}catch{reject(error());}
 });child.stdin?.on('error',()=>{});child.stdin?.end(JSON.stringify(request));
});}

// Copy only the public pure physical-codec modules and package dependencies.
// No Cordis application, profile, provider, storage service or credentials load.
async function openCodecs(){
 const temporary=await mkdtemp(join(tmpdir(),'dot-dsh-read-codecs-'));let archive;
 try{
  archive=await open(ASAR,'r');const first=Buffer.alloc(16);await archive.read(first,0,16,0);const headerSize=first.readUInt32LE(4),jsonSize=first.readUInt32LE(12);if(jsonSize<2||jsonSize>32*1024*1024)throw error();
  const header=Buffer.alloc(jsonSize);const read=await archive.read(header,0,jsonSize,16);if(read.bytesRead!==jsonSize)throw error();const tree=JSON.parse(header.toString('utf8')),start=8+headerSize;
  const lookup=path=>path.split('/').reduce((node,part)=>node?.files?.[part],tree);
  async function bytes(path,node=lookup(path)){if(!node||node.link||!Number.isSafeInteger(node.size)||node.size<0||node.size>16*1024*1024)throw error();if(node.unpacked)return readFile(`${ASAR}.unpacked/${path}`);const value=Buffer.alloc(node.size);if((await archive.read(value,0,value.length,start+Number(node.offset))).bytesRead!==value.length)throw error();return value;}
  const done=new Set();
  async function copyTree(path,node){const destination=resolve(temporary,path.slice(4));if(!destination.startsWith(temporary+sep)||node.link)throw error();if(node.files){await mkdir(destination,{recursive:true});for(const[name,child]of Object.entries(node.files))await copyTree(path+'/'+name,child);}else{await mkdir(dirname(destination),{recursive:true});await writeFile(destination,await bytes(path,node));}}
  async function copyPackage(name){if(done.has(name))return;done.add(name);const path='dsh/node_modules/'+name,node=lookup(path);if(!node)throw error();const pkg=JSON.parse((await bytes(path+'/package.json')).toString('utf8'));if(name.startsWith('@deepseek-ai/dsh-')&&pkg.version!=='0.2.1-rc.2')throw error();await copyTree(path,node);for(const dependency of Object.keys({...pkg.dependencies,...pkg.peerDependencies})){if(pkg.peerDependenciesMeta?.[dependency]?.optional&&!Object.hasOwn(pkg.dependencies??{},dependency))continue;if(!lookup(path+'/node_modules/'+dependency))await copyPackage(dependency);}}
  for(const name of PACKAGES)await copyPackage(name);await writeFile(join(temporary,'package.json'),'{"private":true,"type":"module"}');
  const require=createRequire(join(temporary,'package.json'));const loaded=await Promise.all(PACKAGES.map(name=>import(pathToFileURL(require.resolve(name)).href)));
  const codecs=[loaded[0].releasedV0SessionFormatCodec,loaded[0].releasedV1SessionFormatCodec,loaded[1].releasedV2SessionFormatCodec,loaded[2].releasedV3SessionFormatCodec,loaded[3].releasedV4SessionFormatCodec];
  if(codecs.some((codec,index)=>codec?.version!==index||typeof codec.createDecoder!=='function'))throw error();
  return{codecs,close:()=>rm(temporary,{recursive:true,force:true})};
 }catch{await rm(temporary,{recursive:true,force:true});throw error();}finally{await archive?.close();}
}

// Structurally walk the standard Zstandard frame header/block lengths. Decode
// only complete frames; a final partial frame is reported and never repaired.
function frames(bytes,firstOnly=false){
 const result=[];let at=0;
 while(at<bytes.length){const start=at;if(bytes.length-at<5)return{result,torn:true};if(bytes.readUInt32LE(at)!==0xFD2FB528)throw error();const descriptor=bytes[at+4];if(descriptor&24)throw error();at+=5;
  const sizeFlag=descriptor>>>6,single=Boolean(descriptor&32),dict=descriptor&3;at+=(single?0:1)+(dict===3?4:dict)+(sizeFlag===0?(single?1:0):1<<sizeFlag);if(at>bytes.length)return{result,torn:true};
  for(;;){if(bytes.length-at<3)return{result,torn:true};const block=bytes.readUIntLE(at,3),type=(block>>>1)&3;if(type===3)throw error();at+=3+(type===1?1:block>>>3);if(at>bytes.length)return{result,torn:true};if(block&1)break;}
  if(descriptor&4)at+=4;if(at>bytes.length)return{result,torn:true};result.push({start,end:at});if(firstOnly)return{result,torn:false};
 }return{result,torn:false};
}
function plaintext(bytes,compressed,headerOnly=false){
 let data=bytes,torn=false;
 if(compressed){const scanned=frames(bytes,headerOnly);if(!scanned.result.length)throw error();const parts=[];let total=0;for(const frame of scanned.result){const remaining=32*1024*1024-total;if(remaining<=0)throw error();const part=zstdDecompressSync(bytes.subarray(frame.start,frame.end),{maxOutputLength:remaining});total+=part.length;parts.push(part);}data=Buffer.concat(parts);torn=scanned.torn;}
 const final=data.lastIndexOf(10);if(final<0)throw error();torn||=final!==data.length-1;const decoded=new TextDecoder('utf-8',{fatal:true}).decode(data.subarray(0,headerOnly?data.indexOf(10)+1:final+1));return{lines:decoded.trimEnd().split('\n'),torn};
}
function encodeSegment(value){let result='';for(let index=0;index<value.length;index++){const ch=value[index];result+=/^[A-Za-z0-9._-]$/.test(ch)?ch:'~'+value.charCodeAt(index).toString(16).toUpperCase().padStart(4,'0');}return result==='.'?'~002E':result==='..'?'~002E~002E':result;}
function parsedHeader(item,codecs){const prefix=Buffer.from(item.header_prefix,'base64');const source=JSON.parse(plaintext(prefix,item.artifact.endsWith('.zstd'),true).lines[0]);if(source.version!==item.version||!codecs[item.version])throw error();const header=codecs[item.version].decodeHeader(source);if(encodeSegment(header.id)!==item.artifact.split('/')[2])throw error();return header;}
function metadata(header,item){return{sessionId:header.id,updatedAt:item.mtime_ms,source:'persisted_storage_only',...header.cwd===undefined?{}:{cwd:header.cwd},...header.parentSession===undefined?{}:{parentSessionId:header.parentSession},...header.origin===undefined?{}:{origin:header.origin},formatStatus:'current',persistedFormatVersion:header.version,...cachedTitle(header,item.title_cache,item.legacy_title_cache)};}
function cachedTitle(header,current,legacy){
 // Frozen title state v1 is format-independent. Official predecessor hints
 // accept absent formatVersion after matching the immutable lifecycle fields.
 for(const[cache,source]of[[current,'per_record_cache_hint'],[legacy,'legacy_cache_hint']]){
  const identity=cache?.identity,title=cache?.title,version=identity?.formatVersion;
  if(!record(identity)||!record(title)||identity.createdAt!==header.createdAt||identity.cwd!==header.cwd||(identity.isSeeded??false)!==header.isSeeded||(version!==undefined&&(!Number.isSafeInteger(version)||version<0||version>4))||title.ver!==1||!Number.isSafeInteger(title.seq)||title.seq< -1||!(title.val===null||typeof title.val==='string'))continue;
  return{projections:{kind:'cached',asOfSeq:title.seq,values:{title:title.val}},title_source:source};
 }
 return{};
}
function fold(header,events){const values={title:null,workingDirectory:header.cwd??null,agentPreset:header.agentPreset??null};for(const event of events){if(event.type==='session/title'&&typeof event.data?.title==='string')values.title=event.data.title;if(event.type==='working-directory/change'&&typeof event.data?.cwd==='string')values.workingDirectory=event.data.cwd;if(event.type==='todo/write'&&Array.isArray(event.data?.todos))values.todos=event.data.todos;if(event.type==='agent-preset/selected'&&typeof event.data?.agentPreset==='string')values.agentPreset=event.data.agentPreset;}return values;}

export function createHarnessStorage({dshHome,extraWorkspaces=[]}={}){
 if(typeof dshHome!=='string'||!isAbsolute(dshHome)||resolve(dshHome)!==dshHome||dshHome.includes('\0'))throw error();
 const parsedExtras=extraWorkspaceSchema.safeParse(extraWorkspaces);if(!parsedExtras.success)throw error();const extras=parsedExtras.data;if(new Set(extras.map(item=>item.workspaceId)).size!==extras.length||new Set(extras.map(item=>item.path)).size!==extras.length)throw error();
 let closed=false,codecPromise;const pending=new Set();const getCodecs=async()=>{if(closed)throw error();codecPromise??=openCodecs();return(await codecPromise).codecs;};
 async function catalog(){const value=await readStorage(dshHome,'catalog');if(!Array.isArray(value.items))throw error();const codecs=await getCodecs();const items=value.items.map(item=>({...item,header:parsedHeader(item,codecs)}));if(new Set(items.map(item=>item.header.id)).size!==items.length)throw error();return items;}
 async function loaded(id){const item=(await catalog()).find(item=>item.header.id===id);if(!item)throw error();const value=await readStorage(dshHome,'artifact',item.artifact),codecs=await getCodecs();const parsed=plaintext(Buffer.from(value.bytes,'base64'),item.artifact.endsWith('.zstd'));const physical=JSON.parse(parsed.lines[0]);if(physical.id!==id||physical.version!==item.version)throw error();const decoder=codecs[item.version].createDecoder(physical,'strict'),events=[];const collector={emitEvent(event){if(events.length>=100000)throw error();events.push(event);},emitRun(run){for(const event of run.expand())this.emitEvent(event);}};for(const line of parsed.lines.slice(1))decoder.decodeRow(JSON.parse(line),collector);const inheritedEventCount=decoder.finish(collector);if(events.some((event,index)=>event.seq!==index)||!Number.isSafeInteger(inheritedEventCount)||inheritedEventCount<0)throw error();return{header:decoder.header,events,inheritedEventCount,torn:parsed.torn};}
 async function invoke(method,args){
  if(closed||!Object.hasOwn(methods,method))throw error();const result=methods[method].safeParse(args);if(!result.success)throw error();const input=result.data;
  if(method==='pluginInventory/list')return readStorage(dshHome,'plugins');
  if(method==='workspace/baseline'){
   const stored=await readStorage(dshHome,'workspaces'),document=stored.document;if(document?.unit?.name!=='workspace'||document.unit.version!==2||!record(document.global)||!Array.isArray(document.global.workspaceIds)||!record(document.tables?.workspaces)||document.global.pendingMutation!==undefined)throw error();
   const items=document.global.workspaceIds.map(workspaceId=>{const row=document.tables.workspaces[workspaceId];if(typeof workspaceId!=='string'||!record(row)||typeof row.path!=='string'||!isAbsolute(row.path)||resolve(row.path)!==row.path||typeof row.title!=='string'||!Array.isArray(row.sessionIds)||!row.sessionIds.every(id=>typeof id==='string'))throw error();return{workspaceId,path:row.path,title:row.title,sessionIds:row.sessionIds,taskAvailable:true,createdAt:Date.parse(row.createdAt),updatedAt:Date.parse(row.updatedAt)};});
   for(const root of stored.virtual??[]){if(!['memory','skills'].includes(root.name)||root.path!==join(dshHome,root.name))throw error();items.push({workspaceId:'harness-'+root.name,path:root.path,title:'Harness '+root.name,sessionIds:[],taskAvailable:false,createdAt:0,updatedAt:0});}
   const ids=new Set(items.map(item=>item.workspaceId));for(const extra of extras){if(ids.has(extra.workspaceId)||await realpath(extra.path)!==extra.path||!(await stat(extra.path)).isDirectory())throw error();ids.add(extra.workspaceId);items.push({...extra,sessionIds:[],taskAvailable:false});}
   return{items,archivedSessionIds:document.global.archivedSessionIds??[],pinnedSessionIds:document.global.pinnedSessionIds??[],snapshot:'persisted_storage_only'};
  }
  if(method==='session/list')return{items:(await catalog()).map(item=>metadata(item.header,item)).sort((a,b)=>b.updatedAt-a.updatedAt),snapshot:'persisted_storage_only'};
  const request=input.request,id=method==='session/projections'?request.sessionId:request.address.kind==='session'?request.address.sessionId:request.address.childSessionId;
  const session=await loaded(id),persisted_snapshot={format_version:session.header.version,read_at:new Date().toISOString(),torn_tail_omitted:session.torn,live_memory_included:false,inherited_event_count:session.inheritedEventCount,includes_inherited_events:session.inheritedEventCount>0,history_semantics:'persisted_source_log'};
  if(method==='session/projections')return{kind:'sequenced',asOfSeq:session.events.length-1,values:fold(session.header,session.events),persisted_snapshot};
  if(request.throughSeq>=session.events.length)throw error();const target=request.address;if(target.kind==='session'&&session.header.origin==='subagent'||target.kind==='subagent'&&(session.header.origin!=='subagent'||session.header.parentSession!==target.parentSessionId))throw error();
  const end=Math.min(request.throughSeq+1,request.beforeSeq??request.throughSeq+1);let cut=0,count=0;for(let index=end-1;index>=0;index--){const event=session.events[index];if(['user/message','assistant/message'].includes(event.type))if(++count>=request.maxMessages){cut=index;break;}}
  return{records:session.events.slice(cut,end).map(event=>({type:'event',event})),hasMore:cut>0,persisted_snapshot};
 }
 return{rpc(method,args){const work=(async()=>{try{return await invoke(method,args);}catch{throw error();}})();pending.add(work);work.then(()=>pending.delete(work),()=>pending.delete(work));return work;},async close(){if(closed)return;closed=true;await Promise.allSettled([...pending]);if(codecPromise){const result=await Promise.allSettled([codecPromise]);if(result[0].status==='fulfilled')await result[0].value.close();}}};
}
