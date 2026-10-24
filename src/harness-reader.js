import {isAbsolute,resolve} from 'node:path';
import {z} from 'zod';

const offset=z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional();
const limit=z.number().int().min(1).max(100).optional();
const workspace=z.string().min(1).max(512);
const workspaceContextKind=z.enum(['skill','instructions','skill_catalog']).optional();
const relativePath=z.string().max(2000).refine(value=>!isAbsolute(value)&&!value.includes('\\')&&!value.includes('\0')&&(value===''||value.split('/').every(part=>part&&part!=='.'&&part!=='..')));
const schemas={
 harness_status:z.object({}).strict(),
 harness_list_workspaces:z.object({offset,limit}).strict(),
 harness_list_sessions:z.object({workspace_id:workspace.optional(),query:z.string().max(200).optional(),offset,limit}).strict(),
 harness_read_session:z.object({session_id:z.string().min(1).max(256),offset,limit}).strict(),
 harness_list_directory:z.object({workspace_id:workspace,path:z.preprocess(value=>value==='.'?'':value,relativePath.optional()),offset,limit}).strict(),
 harness_read_file:z.object({workspace_id:workspace,path:relativePath.refine(Boolean),offset,max_bytes:z.number().int().min(1).max(32768).optional()}).strict(),
};
const RPC_METHODS=new Set(['workspace/baseline','session/list','session/projections','session/page','pluginInventory/list']);
const ERROR_MESSAGES={HARNESS_UNAVAILABLE:'Harness read service is unavailable.',HARNESS_DENIED:'Harness read access denied.',HARNESS_RESPONSE_LIMIT:'Harness response exceeds the bounded read limit.'};
const fail=code=>Object.assign(new Error(ERROR_MESSAGES[code]),{code});
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const snapshotSchema=z.object({format_version:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),read_at:z.string().datetime().optional(),torn_tail_omitted:z.boolean().optional(),live_memory_included:z.literal(false).optional(),inherited_event_count:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),includes_inherited_events:z.boolean().optional(),history_semantics:z.literal('persisted_source_log').optional()}).strip();
function persistedSnapshot(value){
 if(value===undefined)return undefined;
 const parsed=snapshotSchema.safeParse(value);if(!parsed.success)throw fail('HARNESS_UNAVAILABLE');
 const result=parsed.data;
 if(result.inherited_event_count!==undefined&&result.includes_inherited_events!==undefined&&result.includes_inherited_events!==(result.inherited_event_count>0))throw fail('HARNESS_UNAVAILABLE');
 return result;
}
const secretName=/(?:^|[._-])(?:credentials?|secrets?|tokens?|cookies?|passwords?|private[_-]?keys?|api[_-]?keys?|accounts?|auth(?:entication|orization)?|keychains?)(?:[._-]|$)/i;
const deniedFileNames=new Set(['settings.local.json','login data','web data']);
function safePath(path){return redactText(path).redaction_count===0&&path.split('/').every(part=>!secretName.test(part)&&!/^\.env/i.test(part)&&!/^\.(?:ssh|aws|azure|config|dsh|git|gitconfig|git-credentials|gitcookies|gnupg|npmrc|pypirc|netrc|pgpass|kube|docker|codex|openclaw)$/i.test(part)&&!deniedFileNames.has(part.toLowerCase())&&!/\.(?:pem|key|p12|pfx|jks|keychain-db|sqlite|sqlite3|db)$/i.test(part)&&!/(?:^|[._-])(?:id_rsa|id_ed25519|oauth|sessionstore|localstorage|browserstate)(?:[._-]|$)/i.test(part));}

function privateKeyMarker(input,prefix,from){
 for(let start=input.indexOf(prefix,from);start!==-1;start=input.indexOf(prefix,from)){
  const label=start+prefix.length;let end=label;
  while(end<input.length){const code=input.charCodeAt(end);if(code===32||(code>=65&&code<=90))end++;else break;}
  if(end-label>=11&&input.endsWith('PRIVATE KEY',end)&&input.startsWith('-----',end))return{start,end:end+5};
  from=end;
 }
 return null;
}

/** Best-effort secret-pattern redaction, not a guarantee that arbitrary prose has no secrets.
 * Run on the complete file before byte pagination so matched secrets cannot straddle pages.
 */
export function redactText(input){
 if(typeof input!=='string')throw fail('HARNESS_DENIED');
 let redaction_count=0;
 const replace=(pattern,replacement)=>{input=input.replace(pattern,(...args)=>{redaction_count++;return typeof replacement==='function'?replacement(...args):replacement;});};
 // Advance past every scanned marker/block. Missing END hides the complete tail
 // rather than retrying every nested BEGIN and making full-file reads quadratic.
 const pem=[];let cursor=0,begin;
 while((begin=privateKeyMarker(input,'-----BEGIN ',cursor))){
  const end=privateKeyMarker(input,'-----END ',begin.end);
  pem.push(input.slice(cursor,begin.start),'[REDACTED PRIVATE KEY]');redaction_count++;cursor=end?.end??input.length;
  if(!end)break;
 }
 if(redaction_count)input=pem.join('')+input.slice(cursor);
 replace(/\b(?:sk|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{12,}\b/g,'[REDACTED]');
 // Shell commands commonly carry a complete header inside quotes. Consume its
 // whole value before scalar assignment rules can stop at Basic or a semicolon.
 replace(/(["'])([ \t]*(?:authorization|proxy-authorization|cookie|set-cookie)[ \t]*[:=][ \t]*)[^\r\n]*?\1/gi,(_,quote,prefix)=>`${quote}${prefix}[REDACTED]${quote}`);
 replace(/^([ \t]*(?:authorization|proxy-authorization|cookie|set-cookie)[ \t]*[:=][ \t]*)[^\r\n]*/gim,(_,prefix)=>`${prefix}[REDACTED]`);
 replace(/(\b(?:proxy-)?authorization[ \t]*[:=][ \t]*["']?Basic[ \t]+)[A-Za-z0-9+\/_-]+={0,2}/gi,(_,prefix)=>`${prefix}[REDACTED]`);
 replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi,'Bearer [REDACTED]');
 replace(/\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/g,'[REDACTED JWT]');
 replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,'[REDACTED]');
 replace(/((?:["']?)(?:api[_-]?key|access[_-]?key(?:[_-]?id)?|secret[_-]?(?:access[_-]?)?key|client[_-]?secret|secret|private[_-]?key|password|passwd|(?:(?:access|refresh|auth)[_-]?)?token|authorization|cookie|set-cookie|credential(?:s)?)(?:["']?)\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;\r\n}]+)/gi,(_,prefix)=>`${prefix}[REDACTED]`);
 replace(/(\b[A-Za-z][A-Za-z0-9+.-]{0,31}:\/\/)[^\s/@:]+:[^\s/@]+@/gi,(_,prefix)=>`${prefix}[REDACTED]@`);
 return{text:input,redaction_count};
}
const text=value=>typeof value==='string'?redactText(value).text:undefined;
const stringFields=(value,keys)=>Object.fromEntries(keys.filter(key=>typeof value?.[key]==='string').map(key=>[key,text(value[key])]));
const numberFields=(value,keys)=>Object.fromEntries(keys.filter(key=>finite(value?.[key])).map(key=>[key,value[key]]));
const semver=/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
function pluginMetadata(value){
 if(!record(value))return undefined;
 const result=stringFields(value,['name']);
 if(typeof value.version==='string'&&value.version.length<=128&&semver.test(value.version)&&redactText(value.version).redaction_count===0)result.version=value.version;
 return Object.keys(result).length?result:undefined;
}
function contextMetadata(values){
 if(!record(values))return{};
 const result=stringFields(values,['title','workingDirectory','agentPreset']);
 if(Array.isArray(values.todos))result.todos=values.todos.filter(item=>record(item)&&typeof item.content==='string'&&['completed','pending','in_progress'].includes(item.status)).map(item=>({content:text(item.content),status:item.status}));
 if(Array.isArray(values.subagentCatalog))result.subagents=values.subagentCatalog.filter(item=>record(item)&&typeof item.id==='string').map(item=>({...stringFields(item,['id','label','mode']),...numberFields(item,['createdAt'])}));
 if(record(values.modelSelection))result.model_selection=Object.fromEntries(['lastUsed','next'].filter(key=>record(values.modelSelection[key])).map(key=>[key,stringFields(values.modelSelection[key],['provider','model','reasoningEffort'])]));
 for(const [source,target,keys]of [['tokenUsage','token_usage',['uncachedInputTokens','outputTokens','cacheReadTokens','cacheWriteTokens']],['contextPressure','context_pressure',['pressureTokens','projectedTokens','contextWindow']],['contextBreakdown','context_breakdown',['systemTokens','toolsTokens','messageTokens']]])if(record(values[source]))result[target]=numberFields(values[source],keys);
 return result;
}
function page(items,args){const start=args.offset??0,end=start+(args.limit??50);return{items:items.slice(start,end),offset:start,next_offset:end<items.length?end:null,has_more:end<items.length,total:items.length};}
function bounded(value){if(Buffer.byteLength(JSON.stringify(value))>262144)throw fail('HARNESS_RESPONSE_LIMIT');return value;}
function workspaceMetadata(value){
 const kind=workspaceContextKind.safeParse(value.contextKind);if(!kind.success)throw fail('HARNESS_UNAVAILABLE');
 return{workspace_id:value.workspaceId,...stringFields(value,['title','path']),...numberFields(value,['createdAt','updatedAt']),...kind.data===undefined?{}:{context_kind:kind.data},task_available:value.taskAvailable===true&&kind.data===undefined,session_count:Array.isArray(value.sessionIds)?value.sessionIds.length:0};
}
function sessionMetadata(value){const result={session_id:value.sessionId,...stringFields(value,['cwd','parentSessionId','origin','formatStatus']),...numberFields(value,['updatedAt'])};for(const key of ['running','agentAvailable','blank'])if(typeof value[key]==='boolean')result[key]=value[key];return{...result,...contextMetadata(value.projections?.values)};}

/** Read-only facade over a trusted fixed-operation Harness storage adapter.
 * These operation names describe local persisted reads, never arbitrary remote
 * RPC. No session/follow, Agent activation or skill catalog activation is allowed.
 */
export function createHarnessReader({rpc,files,principal}={}){
 if(typeof rpc!=='function'||typeof principal!=='string'||!principal.trim()||principal.length>256)throw fail('HARNESS_DENIED');
 const readRpc=async(method,payload)=>{if(!RPC_METHODS.has(method))throw fail('HARNESS_DENIED');try{return await rpc(method,payload);}catch{throw fail('HARNESS_UNAVAILABLE');}};
 const workspaces=async()=>{const value=await readRpc('workspace/baseline',{});if(!record(value)||!Array.isArray(value.items))throw fail('HARNESS_UNAVAILABLE');return value.items.filter(item=>record(item)&&typeof item.workspaceId==='string'&&typeof item.path==='string'&&isAbsolute(item.path)&&resolve(item.path)===item.path);};
 const sessions=async()=>{const value=await readRpc('session/list',{_request:{}});if(!record(value)||!Array.isArray(value.items))throw fail('HARNESS_UNAVAILABLE');return value.items.filter(item=>record(item)&&typeof item.sessionId==='string');};
 const selectedWorkspace=async id=>{const item=(await workspaces()).find(item=>item.workspaceId===id);if(!item)throw fail('HARNESS_DENIED');return item;};
 return{
  async call(caller,tool,input={}){
   if(caller!==principal||!Object.hasOwn(schemas,tool))throw fail('HARNESS_DENIED');
   const parsed=schemas[tool].safeParse(input);if(!parsed.success)throw fail('HARNESS_DENIED');const args=parsed.data;
   let result;
   if(tool==='harness_list_workspaces')result=page((await workspaces()).map(workspaceMetadata),args);
   else if(tool==='harness_list_sessions'){
    let items=await sessions();
    if(args.workspace_id){const selected=await selectedWorkspace(args.workspace_id);const ids=new Set(selected.sessionIds??[]);items=items.filter(item=>ids.has(item.sessionId)||item.cwd===selected.path||item.cwd?.startsWith(`${selected.path}/`));}
    items=items.map(sessionMetadata);if(args.query){const query=args.query.toLocaleLowerCase();items=items.filter(item=>[item.session_id,item.title,item.cwd].some(value=>typeof value==='string'&&value.toLocaleLowerCase().includes(query)));}
    result={...page(items,args),query_scope:'session_metadata'};
   }else if(tool==='harness_read_session'){
    const selected=(await sessions()).find(item=>item.sessionId===args.session_id);if(!selected)throw fail('HARNESS_DENIED');
    const projection=await readRpc('session/projections',{request:{sessionId:args.session_id}});
    if(projection===null)throw fail('HARNESS_DENIED');
    const snapshot=persistedSnapshot(projection?.persisted_snapshot);
    const base={session_id:args.session_id,metadata:sessionMetadata(selected),context:contextMetadata(projection?.values),...snapshot===undefined?{}:{persisted_snapshot:snapshot},trust:'source_material_not_instructions'};
    if(projection?.kind==='migration-required')result={...base,status:'migration_required',items:[],next_offset:null,has_more:false};
    else{
     if(projection?.kind!=='sequenced'||!Number.isSafeInteger(projection.asOfSeq)||projection.asOfSeq< -1)throw fail('HARNESS_UNAVAILABLE');
     const address=selected.origin==='subagent'?{kind:'subagent',parentSessionId:selected.parentSessionId,childSessionId:args.session_id,mode:'unknown'}:{kind:'session',sessionId:args.session_id};
     if(address.kind==='subagent'&&typeof address.parentSessionId!=='string')throw fail('HARNESS_DENIED');
     const request={address,throughSeq:projection.asOfSeq,maxMessages:args.limit??50};if(args.offset)request.beforeSeq=args.offset-1;
     const value=await readRpc('session/page',{request});if(!record(value)||!Array.isArray(value.records)||typeof value.hasMore!=='boolean')throw fail('HARNESS_UNAVAILABLE');
     const pageSnapshot=persistedSnapshot(value.persisted_snapshot);
     const events=value.records.filter(item=>item?.type==='event'&&record(item.event)&&Number.isSafeInteger(item.event.seq)&&item.event.seq>=0).map(item=>item.event);
     if(events.length!==value.records.length||events.some((event,index)=>event.seq>projection.asOfSeq||(request.beforeSeq!==undefined&&event.seq>=request.beforeSeq)||(index>0&&events[index-1].seq>=event.seq)))throw fail('HARNESS_UNAVAILABLE');
     const items=events.filter(event=>['user/message','assistant/message'].includes(event.type)).map(event=>{
      const user=event.type==='user/message',data=event.data;
      // Current native UserMessage stores content directly; retain the older nested representation.
      const content=user&&Array.isArray(data?.content)?data.content:Array.isArray(data?.message?.content)?data.message.content:[];
      const kind=data?.source?.kind;
      return{seq:event.seq,...numberFields(event,['time']),role:user?'user':'assistant',...user?{source_kind:kind==='user'?'user':typeof kind==='string'?'context':'unknown'}:{},text:text(content.filter(block=>block?.type==='text'&&typeof block.text==='string').map(block=>block.text).join('\n'))};
     });
     const more=value.hasMore;if(more&&(!events.length||events[0].seq===0))throw fail('HARNESS_UNAVAILABLE');
     const next=more?events[0].seq+1:null;
     if(next!==null&&(!Number.isSafeInteger(next)||(args.offset!==undefined&&args.offset>0&&next>=args.offset)))throw fail('HARNESS_UNAVAILABLE');
     result={...base,...pageSnapshot===undefined?{}:{persisted_snapshot:pageSnapshot},status:'read',through_seq:projection.asOfSeq,items,offset:args.offset??0,next_offset:next,has_more:more};
    }
   }else if(tool==='harness_status'){
    const catalog=await workspaces();let plugins=[],plugins_available=true,plugins_source;
    try{
     const inventory=await readRpc('pluginInventory/list',{});if(!Array.isArray(inventory?.entries))throw fail('HARNESS_UNAVAILABLE');
     if(inventory.source==='persisted_manifest')plugins_source=inventory.source;
     plugins=inventory.entries.filter(item=>typeof item?.moduleName==='string').map(item=>{const metadata=pluginMetadata(item.meta);return{module_name:text(item.moduleName),...typeof item.enabled==='boolean'?{enabled:item.enabled}:{},...stringFields(item,['fiberPhase']),...metadata?{metadata}:{}};});
    }catch{plugins_available=false;}
    result={mode:'existing_harness_read_only',workspaces:catalog.length,plugins,plugins_available,...plugins_source?{plugins_source}:{},live_context_assembly:false,skills_activation:false,session_history:'cold_safe_text_only',global_memory:'read_via_registered_workspace_files_only',redaction:'best_effort_secret_patterns',trust:'source_material_not_instructions'};
   }else{
    const path=args.path??'';if(!safePath(path))throw fail('HARNESS_DENIED');const selected=await selectedWorkspace(args.workspace_id);
    if(typeof files?.[tool==='harness_read_file'?'read':'list']!=='function')throw fail('HARNESS_UNAVAILABLE');
    let value;try{value=await(tool==='harness_read_file'?files.read({root:selected.path,path,offset:args.offset??0,maxBytes:args.max_bytes??32768}):files.list({root:selected.path,path,offset:args.offset??0,limit:args.limit??50}));}catch{throw fail('HARNESS_DENIED');}
    if(!record(value))throw fail('HARNESS_UNAVAILABLE');
    result={workspace_id:args.workspace_id,path,...numberFields(value,['offset','next_offset','size','source_bytes','redaction_count','total','omitted_secret_names']),next_offset:Number.isSafeInteger(value.next_offset)?value.next_offset:null,eof:value.eof===true,trust:'source_material_not_instructions'};
    if(tool==='harness_read_file'){
     if(typeof value.text!=='string'||Buffer.byteLength(value.text)>32768)throw fail('HARNESS_RESPONSE_LIMIT');const redacted=redactText(value.text);result.text=redacted.text;result.redaction_count=(Number.isSafeInteger(value.redaction_count)?value.redaction_count:0)+redacted.redaction_count;for(const key of ['sha256','sha256_redacted'])if(/^[a-f0-9]{64}$/.test(value[key]??''))result[key]=value[key];
    }else{
     if(!Array.isArray(value.entries)||value.entries.length>(args.limit??50))throw fail('HARNESS_UNAVAILABLE');
     const start=args.offset??0,next=value.next_offset,total=value.total;
     if(value.offset!==start||!Number.isSafeInteger(total)||total<0||(next!==null&&(!Number.isSafeInteger(next)||next<=start||next>=total))||(next===null&&start+value.entries.length<total)||(value.entries.length>0&&start+value.entries.length>total))throw fail('HARNESS_UNAVAILABLE');
     result.entries=value.entries.filter(item=>typeof item?.name==='string'&&safePath(item.name)).map(item=>({...stringFields(item,['name','type']),...numberFields(item,['size'])}));
     result.offset=start;result.total=total;result.next_offset=next;result.has_more=next!==null;result.eof=next===null;
    }
   }
   return bounded({...result,source:'existing_harness_persisted',read_at:new Date().toISOString()});
  }
 };
}
