import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,writeFile,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {selectPythonExecutable,BUNDLED_PYTHON} from '../src/python-runtime.js';

test('Python selection uses only the fixed official bundled runtime before the CLI fallback',()=>{
 assert.equal(selectPythonExecutable({platform:'darwin',exists:()=>true}),BUNDLED_PYTHON);
 assert.equal(selectPythonExecutable({platform:'darwin',exists:()=>false}),'python3');
 assert.equal(selectPythonExecutable({platform:'linux',exists:()=>true}),'python3');
});
test('actual bundled Python performs descriptor-safe file reads without a shell PATH',{skip:process.platform!=='darwin'},async t=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'dot-python-runtime-')));t.after(()=>rm(root,{recursive:true,force:true}));await writeFile(join(root,'README.md'),'bundled-runtime-ok\n');
 const module=new URL('../src/harness-files.js',import.meta.url).href;
 const code=`import{createHarnessFiles}from${JSON.stringify(module)};const files=createHarnessFiles({redact:text=>({text,redaction_count:0})});const result=await files.read({root:${JSON.stringify(root)},path:'README.md'});if(result.text!=='bundled-runtime-ok\\n')throw Error('Mismatch');console.log('ok');`;
 const result=await promisify(execFile)(process.execPath,['--input-type=module','-e',code],{env:{PATH:''},timeout:15000});assert.equal(result.stdout.trim(),'ok');
});
