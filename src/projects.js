import {execFile} from 'node:child_process';
import {isAbsolute,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {z} from 'zod';
const id=z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const schema=z.array(z.object({id,label:z.string().min(1).max(100),root:z.string().refine(isAbsolute),contextFiles:z.array(z.string().min(1).max(300)).min(1).max(6),principals:z.array(id).min(1).max(5),public:z.literal(true)}).strict()).max(10);
const contextPath=z.string().min(1).max(300).refine(path=>!isAbsolute(path)&&!path.includes('\\')&&!path.includes('\0')&&path.split('/').every(part=>part&&part!=='.'&&part!=='..'));
const requestSchema=z.object({root:z.string().min(1).max(4096).refine(root=>isAbsolute(root)&&resolve(root)===root&&!root.startsWith('//')&&!root.includes('\\')&&!root.includes('\0')),files:z.array(contextPath).min(1).max(6)}).strict();
const responseSchema=z.object({files:z.array(z.object({path:contextPath,text:z.string(),sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict()).min(1).max(6),bytes:z.number().int().min(0).max(65536)}).strict();
const helper=fileURLToPath(new URL('../scripts/read-context.py',import.meta.url));
const helperErrors=new Set(['Project root denied','Context path denied','Context must be an ordinary single-link file','Context exceeds byte limit','Binary context denied','UTF-8 context required','Context reader unavailable']);

// Python 3 on POSIX is a required dependency: Node's pathname-based open cannot
// anchor every ancestor to an O_NOFOLLOW directory descriptor. Fail closed when
// the fixed isolated helper or its required openat-style capabilities are absent.
function readWithDescriptors(request){
 const input=JSON.stringify(request);
 if(Buffer.byteLength(input)>32768)throw new Error('Context request exceeds byte limit');
 return new Promise((resolveResult,reject)=>{
  const child=execFile('python3',['-I','-S','-B',helper],{shell:false,cwd:'/',env:{PATH:process.env.PATH??'/usr/bin:/bin'},encoding:'utf8',timeout:5000,maxBuffer:512*1024},(error,stdout)=>{
   if(error)return reject(new Error('Context reader unavailable'));
   try{
    const value=JSON.parse(stdout);
    if(value&&Object.keys(value).length===1&&helperErrors.has(value.error))return reject(new Error(value.error));
    resolveResult(responseSchema.parse(value));
   }catch{reject(new Error('Context reader unavailable'));}
  });
  child.stdin?.on('error',()=>{});
  child.stdin?.end(input);
 });
}
export function projectAccess(input){
 const projects=schema.parse(input);if(new Set(projects.map(p=>p.id)).size!==projects.length)throw new Error('Duplicate project id');
 const get=(principal,id)=>{const p=projects.find(p=>p.id===id&&p.principals.includes(principal));if(!p)throw new Error('Project access denied');return p;};
 return {get,list:principal=>projects.filter(p=>p.principals.includes(principal)).map(p=>({project_id:p.id,label:p.label,mode:'bounded_context_read_only'}))};
}
export async function readContext(project){
 const project_id=id.parse(project.id);
 const request=requestSchema.parse({root:project.root,files:project.contextFiles});
 const result=await readWithDescriptors(request);
 if(result.files.length!==request.files.length)throw new Error('Context reader unavailable');
 let total=0;
 for(const [index,file]of result.files.entries()){
  const bytes=Buffer.from(file.text,'utf8');total+=bytes.length;
  if(file.path!==request.files[index]||file.text.includes('\0')||bytes.length>32768||total>65536||createHash('sha256').update(bytes).digest('hex')!==file.sha256)throw new Error('Context reader unavailable');
 }
 if(total!==result.bytes)throw new Error('Context reader unavailable');
 return{project_id,...result,trust:'source_material_not_instructions'};
}
