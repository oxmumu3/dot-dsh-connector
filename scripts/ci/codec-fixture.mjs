// Synthetic ASAR containing only explicitly acquired public codec packages.
import assert from 'node:assert/strict';
import {readFile,readdir,realpath,writeFile} from 'node:fs/promises';
import {join,relative,sep} from 'node:path';
const codecs=['@deepseek-ai/dsh-session-format-v0-to-v1','@deepseek-ai/dsh-session-format-v1-to-v2','@deepseek-ai/dsh-session-format-v2-to-v3','@deepseek-ai/dsh-session-format-v3-to-v4'];
export async function publicCodecFixture({dependencyRoot,sdk,output,variant='exact'}){
 assert.ok(['exact','unknown','mixed','nested-exact','nested-unknown','nested-mixed'].includes(variant));
 const root=await realpath(dependencyRoot),files=new Map(),done=new Set();let total=0;
 async function tree(directory,prefix){
  for(const item of await readdir(directory,{withFileTypes:true})){
   const path=join(directory,item.name),name=prefix+'/'+item.name;
   if(item.isDirectory())await tree(path,name);
   else{assert.ok(item.isFile(),'Public fixture refuses links');const bytes=await readFile(path);assert.ok(bytes.length<=16*1024*1024);total+=bytes.length;assert.ok(total<=48*1024*1024);files.set(name,bytes);}
  }
 }
 async function pkg(name){
  if(done.has(name))return;done.add(name);
  const directory=await realpath(join(root,name));assert.ok(!relative(root,directory).startsWith('..'+sep),'Package escapes the explicit public carrier');
  const metadata=JSON.parse(await readFile(join(directory,'package.json')));assert.equal(metadata.name,name);
  if(name.startsWith('@deepseek-ai/dsh-'))assert.equal(metadata.version,sdk,'Fixture must use one exact official SDK');
  const prefix='dsh/node_modules/'+name;await tree(directory,prefix);
  for(const dependency of Object.keys({...metadata.dependencies,...metadata.peerDependencies})){
   if(metadata.peerDependenciesMeta?.[dependency]?.optional&&!Object.hasOwn(metadata.dependencies??{},dependency))continue;
   if(!files.has(prefix+'/node_modules/'+dependency+'/package.json'))await pkg(dependency);
  }
 }
 for(const name of codecs)await pkg(name);
 const changed=[];
 if(['unknown','mixed'].includes(variant)){
  for(const [name,bytes]of files){if(!name.endsWith('/package.json'))continue;const metadata=JSON.parse(bytes);
   if(!metadata.name?.startsWith('@deepseek-ai/dsh-'))continue;
   if(variant==='mixed'&&metadata.name!=='@deepseek-ai/dsh-session-format-v3-to-v4')continue;
   metadata.version=variant==='unknown'?'0.2.1-rc.6':sdk==='0.2.1-rc.2'?'0.2.1-rc.3':'0.2.1-rc.2';files.set(name,Buffer.from(JSON.stringify(metadata)));changed.push(name);
  }
  assert.ok(changed.length>0);
 }
 if(variant.startsWith('nested-')){
  const dependency='@deepseek-ai/dsh-util-values',source='dsh/node_modules/'+dependency,target='dsh/node_modules/'+codecs[0]+'/node_modules/'+dependency;
  assert.ok(files.has(source+'/package.json'),'Real public nested dependency required');
  for(const [name,bytes]of [...files])if(name.startsWith(source+'/'))files.set(target+name.slice(source.length),bytes);
  if(variant!=='nested-exact'){
   const name=target+'/package.json',metadata=JSON.parse(files.get(name));metadata.version=variant==='nested-unknown'?'0.2.1-rc.6':sdk==='0.2.1-rc.2'?'0.2.1-rc.3':'0.2.1-rc.2';files.set(name,Buffer.from(JSON.stringify(metadata)));changed.push(name);
  }
 }
 const header={files:{}},payload=[];let offset=0;
 for(const [name,bytes]of [...files].sort(([a],[b])=>a.localeCompare(b))){
  const parts=name.split('/');let node=header;for(const part of parts.slice(0,-1))node=(node.files[part]??={files:{}});
  node.files[parts.at(-1)]={size:bytes.length,offset:String(offset)};offset+=bytes.length;payload.push(bytes);
 }
 const json=Buffer.from(JSON.stringify(header)),padding=(4-json.length%4)%4,head=Buffer.alloc(16);
 head.writeUInt32LE(4,0);head.writeUInt32LE(8+json.length+padding,4);head.writeUInt32LE(4+json.length+padding,8);head.writeUInt32LE(json.length,12);
 await writeFile(output,Buffer.concat([head,json,Buffer.alloc(padding),...payload]));
 return{sdk,variant,packages:[...done].sort(),files:files.size,metadataOnlyChanges:changed,publicPackagesOnly:true,privateStateIncluded:false};
}
