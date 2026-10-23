import {selectPythonExecutable} from './python-runtime.js';
import {execFile} from 'node:child_process';
import {isAbsolute,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {z} from 'zod';

const rootSchema=z.string().max(4096).refine(root=>isAbsolute(root)&&resolve(root)===root&&!root.includes('\\')&&!root.includes('\0'));
const pathSchema=z.string().max(2000).refine(path=>!isAbsolute(path)&&!path.includes('\\')&&!path.includes('\0')&&(!path||path.split('/').every(p=>p&&p!=='.'&&p!=='..')));
const listSchema=z.object({root:rootSchema,path:pathSchema.default(''),offset:z.number().int().min(0).max(10000000).default(0),limit:z.number().int().min(1).max(100).default(50)}).strict();
const readSchema=z.object({root:rootSchema,path:pathSchema.refine(Boolean),offset:z.number().int().min(0).max(10000000).default(0),maxBytes:z.number().int().min(1).max(32768).default(32768)}).strict();
const helper=fileURLToPath(new URL('../scripts/read-harness-files.py',import.meta.url));
const denied=()=>Object.assign(new Error('Workspace file denied or unavailable'),{code:'BACKEND_REJECTED'});
function validate(schema,options){const parsed=schema.safeParse(options);if(!parsed.success)throw denied();return parsed.data;}

function read(request){return new Promise((resolveResult,reject)=>{
 const child=execFile(selectPythonExecutable(),['-I','-S','-B',helper],{shell:false,cwd:'/',env:{PATH:process.env.PATH??'/usr/bin:/bin'},encoding:'utf8',timeout:8000,maxBuffer:32*1024*1024},(error,stdout)=>{if(error)return reject(denied());try{const result=JSON.parse(stdout);if(result.error)throw denied();resolveResult(result);}catch{reject(denied());}});
 child.stdin?.on('error',()=>{});child.stdin?.end(JSON.stringify(request));
});}

/** Sanitizer is mandatory and runs on complete text before any page slicing. */
export function createHarnessFiles({redact,internalRoots=[],instructionRoots=[]}={}){
 if(typeof redact!=='function')throw new Error('Explicit redact function required');
 const trusted=new Set(z.array(rootSchema.refine(root=>/\/\.dsh\/(memory|skills)$/.test(root))).max(2).parse(internalRoots));
 const instructions=new Set(z.array(rootSchema.refine(root=>/\/(\.dsh|\.agents)$/.test(root))).max(2).parse(instructionRoots));
 const mode=root=>instructions.has(root)?'instructions':trusted.has(root)?'context':'none';
 return Object.freeze({
  async list(options){const {root,path,offset,limit}=validate(listSchema,options);const result=await read({root,path,operation:'list',internal:mode(root)});if(!Array.isArray(result.entries))throw denied();const entries=result.entries.filter(entry=>{const clean=redact(entry.name);return clean?.text===entry.name&&clean.redaction_count===0;});return{path,entries:entries.slice(offset,offset+limit),total:entries.length,omitted_secret_names:result.entries.length-entries.length,offset,next_offset:offset+limit<entries.length?offset+limit:null};},
  async read(options){const {root,path,offset,maxBytes}=validate(readSchema,options);const result=await read({root,path,operation:'read',internal:mode(root)});if(typeof result.text!=='string')throw denied();const clean=redact(result.text);if(typeof clean?.text!=='string'||!Number.isSafeInteger(clean.redaction_count)||clean.redaction_count<0)throw denied();const all=Buffer.from(clean.text,'utf8');if(offset>all.length)throw denied();let end=Math.min(offset+maxBytes,all.length);while(end>offset&&(all[end]&0xc0)===0x80)end--;if(end===offset&&offset<all.length)throw denied();let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(all.subarray(offset,end));}catch{throw denied();}return{path,text,offset,next_offset:end<all.length?end:null,eof:end===all.length,size:all.length,source_bytes:result.source_bytes,sha256_redacted:createHash('sha256').update(all).digest('hex'),redaction_count:clean.redaction_count};},
 });
}
