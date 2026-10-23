import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,open,readFile,writeFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,resolve,sep} from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createExecutor} from '../src/executor.js';

const ASAR='/Applications/DeepSeek Harness.app/Contents/Resources/app.asar';
const ROOT_PACKAGES=['@deepseek-ai/cordis','@deepseek-ai/dsh-agent','@deepseek-ai/dsh-agent-loop','@deepseek-ai/dsh-system-prompt','@deepseek-ai/dsh-tools','@deepseek-ai/dsh-llm','@deepseek-ai/dsh-session','@deepseek-ai/dsh-session-projection'];

/** Copy only public npm runtime packages into a fresh temporary directory.
 * No application code, host configuration, user sessions, or credentials are
 * loaded. ASAR paths are package distribution paths, never user-controlled.
 */
async function sdkForTest(t){
 if(process.env.DSH_TEST_NATIVE_SDK_ROOT)return{root:resolve(process.env.DSH_TEST_NATIVE_SDK_ROOT),close:async()=>{}};
 try{await stat(ASAR);}catch{t.skip('Real AgentLoop SDK unavailable; set DSH_TEST_NATIVE_SDK_ROOT to public 0.2.1-rc.2 packages');return;}
 const temporary=await mkdtemp(join(tmpdir(),'dot-dsh-public-native-sdk-'));
 const archive=await open(ASAR,'r');
 try{
  const first=Buffer.alloc(16);await archive.read(first,0,16,0);const headerSize=first.readUInt32LE(4),jsonSize=first.readUInt32LE(12);
  if(jsonSize>32*1024*1024||jsonSize<2)throw new Error('Public SDK archive header outside bounds');
  const header=Buffer.alloc(jsonSize);await archive.read(header,0,jsonSize,16);const tree=JSON.parse(header.toString('utf8'));const dataStart=8+headerSize;
  const lookup=path=>path.split('/').reduce((node,part)=>node?.files?.[part],tree);
  async function bytes(path,node=lookup(path)){
   if(!node||node.link||node.size>32*1024*1024)throw new Error(`Unavailable public SDK file: ${path}`);
   if(node.unpacked)return readFile(`${ASAR}.unpacked/${path}`);
   const value=Buffer.alloc(node.size);await archive.read(value,0,value.length,dataStart+Number(node.offset));return value;
  }
  const done=new Set();
  async function copyTree(path,node){
   const destination=resolve(temporary,path.slice('dsh/'.length));
   if(!destination.startsWith(`${temporary}${sep}`)||node.link)throw new Error('Unexpected public package path');
   if(node.files){await mkdir(destination,{recursive:true});for(const [name,child]of Object.entries(node.files))await copyTree(`${path}/${name}`,child);}
   else{await mkdir(dirname(destination),{recursive:true});await writeFile(destination,await bytes(path,node));}
  }
  async function copyPackage(name){
   if(done.has(name))return;done.add(name);
   const prefix=`dsh/node_modules/${name}`;const node=lookup(prefix);if(!node)throw new Error(`Public SDK dependency unavailable: ${name}`);
   const pkg=JSON.parse((await bytes(`${prefix}/package.json`)).toString('utf8'));
   await copyTree(prefix,node);
   const deps={...pkg.dependencies,...pkg.peerDependencies};
   for(const dep of Object.keys(deps)){
    if(pkg.peerDependenciesMeta?.[dep]?.optional&&!Object.hasOwn(pkg.dependencies??{},dep))continue;
    // A package's bundled node_modules already preserves its exact nested
    // versions. Root packages provide dependencies not bundled below it.
    if(!lookup(`${prefix}/node_modules/${dep}`))await copyPackage(dep);
   }
  }
  for(const name of ROOT_PACKAGES)await copyPackage(name);
  await writeFile(join(temporary,'package.json'),JSON.stringify({private:true,type:'module'}));
  return{root:temporary,close:()=>rm(temporary,{recursive:true,force:true})};
 }catch(error){await rm(temporary,{recursive:true,force:true});throw error;}
 finally{await archive.close();}
}

test('actual public AgentLoop completes a connector-owned turn through a deterministic synthetic provider, without network or credentials',async t=>{
 const sdk=await sdkForTest(t);if(!sdk)return;
 const require=createRequire(join(sdk.root,'package.json'));const load=name=>import(pathToFileURL(require.resolve(name)).href);
 let ctx,executor;const scratch=await mkdtemp(join(tmpdir(),'dot-dsh-native-turn-'));
 t.after(async()=>{await executor?.close();await ctx?.fiber.dispose();await rm(scratch,{recursive:true,force:true});await sdk.close();});
 for(const name of ROOT_PACKAGES.filter(name=>name.includes('/dsh-')))assert.equal(require(`${name}/package.json`).version,'0.2.1-rc.2',name);
 const [{Context},{default:Agents},{default:AgentLoop},{default:SystemPrompt},{default:Tools},{default:Llm,LlmAdapter,createUserMessage},{default:Sessions},{default:Projections}]=await Promise.all(ROOT_PACKAGES.map(load));
 let networkCalls=0;t.mock.method(globalThis,'fetch',()=>{networkCalls++;throw new Error('Network disabled by native-loop test');});
 ctx=new Context();const requests=[];
 await ctx.plugin(SystemPrompt,{includeHarnessIdentity:false,includeRuntimeContext:false});
 await ctx.plugin(Llm);await ctx.plugin(Sessions);await ctx.plugin(Projections);await ctx.plugin(Tools,{mode:'native'});await ctx.plugin(Agents);await ctx.plugin(AgentLoop,{agents:[]});
 ctx.provide('agentDefaultModel',{currentSelection:()=>({provider:'synthetic-local-only',model:'deterministic-fixture'})});
 class SyntheticAdapter extends LlmAdapter{
  async *stream(options){requests.push(options);yield{type:'block-start',index:0,blockType:'text'};yield{type:'text-delta',index:0,text:'SYNTHETIC actual AgentLoop response, source README.md; real model and Dot are untested.'};yield{type:'block-end',index:0,block:{type:'text',text:'SYNTHETIC actual AgentLoop response, source README.md; real model and Dot are untested.'}};yield{type:'finish',reason:{kind:'stop'}};}
 }
 let owner;
 await ctx.plugin({name:'native-loop-connector-owner',inject:['agents','tools','sessions','systemPrompt','llm','agentDefaultModel'],apply(scope){owner=scope;scope.llm.registerAdapter(['synthetic-local-only'],new SyntheticAdapter());}});
 executor=createExecutor({ctx:owner,createMessage:createUserMessage,isolatedHost:true});
 const session_id=`dsh_dot_${randomUUID()}`,message_id=randomUUID(),events=[];const done=Promise.withResolvers();
 const deadline=setTimeout(()=>done.reject(new Error(`Actual AgentLoop did not settle: ${JSON.stringify(events)}`)),10_000);t.after(()=>clearTimeout(deadline));
 const accepted=await executor.start({session_id,message_id,task:'State what the public fixture says and its unverified boundary.',project_root:scratch,context:{files:[{path:'README.md',text:'Only public synthetic material. No real model or Dot acceptance.',sha256:'a'.repeat(64)}]}},{onEvent:event=>{events.push(event);if(event.type==='turn/end')done.resolve(event);}});
 assert.deepEqual(accepted,{session_id,message_id});const terminal=await done.promise;
 assert.equal(terminal.reason,'completed');assert.equal(requests.length,1);assert.deepEqual(requests[0].tools??[],[]);assert.equal(requests[0].maxTokens,4096);assert.equal(networkCalls,0);
 assert.ok(events.some(event=>event.type==='user/message'&&event.message_id===message_id&&event.turn===terminal.turn));
 assert.match(events.find(event=>event.type==='assistant/message')?.text??'',/SYNTHETIC actual AgentLoop response/);
 assert.ok(events.every(event=>event.session_id===session_id));
 await executor.close();assert.equal(owner.get('agents').get(session_id),undefined);
});
