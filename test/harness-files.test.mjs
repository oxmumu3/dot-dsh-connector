import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,symlink,link,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

async function api(){const module=await import('../src/harness-files.js').catch(()=>({}));assert.equal(typeof module.createHarnessFiles,'function','descriptor-based Harness workspace reader required');return module;}
async function fixture(t){const root=await realpath(await mkdtemp(join(tmpdir(),'dot-harness-files-')));t.after(()=>rm(root,{recursive:true,force:true}));return root;}
const redact=text=>({text:text.replaceAll('sk-synthetic-secret-1234567890','[REDACTED]'),redaction_count:text.includes('sk-synthetic-secret-1234567890')?1:0});

test('workspace directory reads paginate ordinary entries and exclude credentials',async t=>{
 const root=await fixture(t);await mkdir(join(root,'src'));await writeFile(join(root,'README.md'),'public');await writeFile(join(root,'.env'),'not exported');await mkdir(join(root,'.ssh'));await writeFile(join(root,'credentials.json'),'not exported');
 const {createHarnessFiles}=await api();const files=createHarnessFiles({redact});const page=await files.list({root,path:'',offset:0,limit:1});assert.equal(page.entries.length,1);assert.equal(page.total,2);assert.equal(page.next_offset,1);const next=await files.list({root,path:'',offset:page.next_offset,limit:1});assert.deepEqual([...page.entries,...next.entries].map(e=>e.name),['README.md','src']);assert.equal(next.next_offset,null);
});
test('text is redacted before byte pagination, including secrets split across tiny pages',async t=>{
 const root=await fixture(t);await writeFile(join(root,'notes.md'),'start sk-synthetic-secret-1234567890 中文 end');const {createHarnessFiles}=await api();const files=createHarnessFiles({redact});let offset=0,text='';for(let n=0;n<100;n++){const page=await files.read({root,path:'notes.md',offset,maxBytes:5});assert.equal(page.redaction_count,1);text+=page.text;if(page.next_offset===null)break;assert.ok(page.next_offset>offset);offset=page.next_offset;}assert.equal(text,'start [REDACTED] 中文 end');
});
test('traversal, credentials, symlinks and hardlinks fail closed',async t=>{
 const root=await fixture(t);await writeFile(join(root,'file.md'),'safe');await symlink('/etc/passwd',join(root,'escape'));await link(join(root,'file.md'),join(root,'hardlink'));await writeFile(join(root,'.env'),'secret');const {createHarnessFiles}=await api();const files=createHarnessFiles({redact});for(const path of ['../outside','/etc/passwd','.env','escape','hardlink','x/../file.md'])await assert.rejects(files.read({root,path}),/denied|unavailable|ordinary/i);
});
test('binary, oversized files and invalid options are rejected without output',async t=>{
 const root=await fixture(t);await writeFile(join(root,'binary.txt'),Buffer.from([0,255]));await writeFile(join(root,'large.txt'),Buffer.alloc(4*1024*1024+1,65));const {createHarnessFiles}=await api();const files=createHarnessFiles({redact});for(const path of ['binary.txt','large.txt'])await assert.rejects(files.read({root,path}),/denied|limit|unavailable|UTF/i);await assert.rejects(files.read({root,path:'binary.txt',offset:-1}));assert.throws(()=>createHarnessFiles({}),/redact/i);
});
test('a registered root inside a credential directory cannot bypass relative-path checks',async t=>{
 const root=await fixture(t);await mkdir(join(root,'.ssh'));await writeFile(join(root,'.ssh','notes.md'),'secret transport material');const {createHarnessFiles}=await api();const files=createHarnessFiles({redact});await assert.rejects(files.read({root:join(root,'.ssh'),path:'notes.md'}),/denied|unavailable/i);
});
test('secret-bearing filenames are omitted rather than returned as an unusable redacted path',async t=>{
 const root=await fixture(t);await writeFile(join(root,'sk-synthetic-secret-1234567890.md'),'safe');await writeFile(join(root,'normal.md'),'safe');const {createHarnessFiles}=await api();const page=await createHarnessFiles({redact}).list({root});assert.deepEqual(page.entries.map(e=>e.name),['normal.md']);assert.equal(page.omitted_secret_names,1);
});
test('only explicitly trusted Harness memory/skills roots bypass the .dsh directory exclusion',async t=>{
 const root=await fixture(t);const memory=join(root,'.dsh','memory');await mkdir(memory,{recursive:true});await writeFile(join(memory,'notes.md'),'normal memory');const {createHarnessFiles}=await api();await assert.rejects(createHarnessFiles({redact}).read({root:memory,path:'notes.md'}));const page=await createHarnessFiles({redact,internalRoots:[memory]}).read({root:memory,path:'notes.md'});assert.equal(page.text,'normal memory');
});
test('Kubernetes credential directories remain blocked',async t=>{
 const root=await fixture(t);await mkdir(join(root,'.kube'));await writeFile(join(root,'.kube','config'),'token: opaque-credential-value');const {createHarnessFiles}=await api();await assert.rejects(createHarnessFiles({redact}).read({root,path:'.kube/config'}));
});
test('well-known credential filenames are rejected at the descriptor layer',async t=>{
 const root=await fixture(t);const names=['.git-credentials','id_rsa','id_ed25519'];for(const name of names)await writeFile(join(root,name),'synthetic credential');const {createHarnessFiles}=await api();const files=createHarnessFiles({redact});for(const path of names)await assert.rejects(files.read({root,path}));
});
test('trusted global instruction roots expose exactly AGENTS.md and no other Harness state',async t=>{
 const root=await fixture(t),home=join(root,'.dsh');await mkdir(home);await writeFile(join(home,'AGENTS.md'),'owner instructions');await writeFile(join(home,'other.md'),'private state');await writeFile(join(home,'credentials.json'),'credential');const {createHarnessFiles}=await api();const files=createHarnessFiles({redact,instructionRoots:[home]});assert.equal((await files.read({root:home,path:'AGENTS.md'})).text,'owner instructions');assert.deepEqual((await files.list({root:home})).entries.map(e=>e.name),['AGENTS.md']);for(const path of ['other.md','credentials.json','nested/AGENTS.md'])await assert.rejects(files.read({root:home,path}));await assert.rejects(files.list({root:home,path:'nested'}));
});
