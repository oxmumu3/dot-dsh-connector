import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {mkdtemp,writeFile,realpath,rm,mkdir,rename,symlink,unlink,link} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readContext} from '../src/projects.js';

const run=promisify(execFile);
const helper=fileURLToPath(new URL('../scripts/read-context.py',import.meta.url));
async function fixture(t){
 const base=await realpath(await mkdtemp(join(tmpdir(),'dot-context-security-')));
 t.after(()=>rm(base,{recursive:true,force:true}));
 const root=join(base,'public'),outside=join(base,'not-allowlisted');
 await mkdir(root);await mkdir(join(root,'ctx'));await mkdir(outside);
 await writeFile(join(root,'ctx','README.md'),'PUBLIC FIXTURE');
 await writeFile(join(outside,'README.md'),'SECRET FIXTURE');
 return{base,root,outside,project:{id:'public',root,contextFiles:['ctx/README.md']}};
}

test('directory replacement between path validation and open cannot expose an external file',async t=>{
 const f=await fixture(t),context=join(f.root,'ctx'),retired=join(f.root,'retired');
 const originalOpen=fs.promises.open;
 // Reproduce the old check-then-open race. A descriptor-based reader never uses
 // this ambient absolute-path open for context files.
 fs.promises.open=async function(path,...args){
  if(path!==join(context,'README.md'))return originalOpen.call(this,path,...args);
  await rename(context,retired);await symlink(f.outside,context);
  try{return await originalOpen.call(this,path,...args);}
  finally{await unlink(context);await rename(retired,context);}
 };
 syncBuiltinESMExports();
 try{assert.equal((await readContext(f.project)).files[0].text,'PUBLIC FIXTURE');}
 finally{fs.promises.open=originalOpen;syncBuiltinESMExports();}
});

test('held directory descriptors survive adversarial replacement of an opened ancestor',async t=>{
 const f=await fixture(t);
 // Inject only a filesystem operation into the real helper. There is no test
 // mode or caller-controlled command in production. Replace ctx immediately
 // after os.open returns its directory descriptor, before the leaf is opened.
 const program=`import importlib.util,json,os,sys\nhelper,root,outside=sys.argv[1:]\nspec=importlib.util.spec_from_file_location('context_reader',helper)\nreader=importlib.util.module_from_spec(spec)\nspec.loader.exec_module(reader)\noriginal_open=os.open\nreplaced=False\ndef replace_after_open(path,flags,*args,**kwargs):\n global replaced\n fd=original_open(path,flags,*args,**kwargs)\n if path=='ctx' and kwargs.get('dir_fd') is not None and not replaced:\n  replaced=True\n  os.rename(os.path.join(root,'ctx'),os.path.join(root,'retired'))\n  os.symlink(outside,os.path.join(root,'ctx'))\n return fd\nos.open=replace_after_open\nresult=reader.read_context({'root':root,'files':['ctx/README.md']})\nassert replaced\nprint(json.dumps(result))\n`;
 const {stdout}=await run('python3',['-I','-S','-B','-c',program,helper,f.root,f.outside],{timeout:5000,maxBuffer:512*1024});
 const result=JSON.parse(stdout);
 assert.equal(result.files[0].text,'PUBLIC FIXTURE');
 assert.equal(result.files[0].path,'ctx/README.md');
 assert.equal(result.bytes,14);
});

test('only exact configured ordinary files are read; static symlinks and hardlinks fail closed',async t=>{
 const f=await fixture(t);
 await writeFile(join(f.root,'unlisted.md'),'UNLISTED');
 const result=await readContext(f.project);
 assert.deepEqual(result.files.map(file=>file.path),['ctx/README.md']);
 assert.equal(JSON.stringify(result).includes(f.root),false);
 await symlink(f.outside,join(f.root,'linked-dir'));
 await symlink(join(f.outside,'README.md'),join(f.root,'linked-file'));
 await link(join(f.outside,'README.md'),join(f.root,'hardlinked-file'));
 for(const path of ['linked-dir/README.md','linked-file','hardlinked-file','../not-allowlisted/README.md','ctx/../unlisted.md']){
  await assert.rejects(readContext({...f.project,contextFiles:[path]}));
 }
 const alias=join(f.base,'alias');await symlink(f.root,alias);
 await assert.rejects(readContext({...f.project,root:alias}));
});

test('context byte caps, UTF-8 and NUL restrictions remain enforced',async t=>{
 const f=await fixture(t),path=join(f.root,'ctx','README.md');
 for(const content of [Buffer.from([0xff]),Buffer.from('visible\0hidden'),Buffer.alloc(32769,120)]){
  await writeFile(path,content);await assert.rejects(readContext(f.project));
 }
 await writeFile(path,'中'.repeat(10922));
 assert.equal((await readContext(f.project)).bytes,32766);
 await writeFile(join(f.root,'second.md'),Buffer.alloc(32768,120));
 await writeFile(join(f.root,'third.md'),'123');
 await assert.rejects(readContext({...f.project,contextFiles:['ctx/README.md','second.md','third.md']}),/limit/);
});

test('missing Python dependency fails closed',async t=>{
 const f=await fixture(t),path=process.env.PATH;
 process.env.PATH=join(f.base,'no-executables');
 try{await assert.rejects(readContext(f.project),/Context reader unavailable/);}
 finally{if(path===undefined)delete process.env.PATH;else process.env.PATH=path;}
});
