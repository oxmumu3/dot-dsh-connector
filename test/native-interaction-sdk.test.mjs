import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import vm from 'node:vm';
import {createNativeWorker} from '../management-plugin/src/native-worker.js';
import {VERIFIED_SDK_VERSIONS,sdkCordisVersion} from '../management-plugin/src/compatibility.js';

// This test executes the actual published SDK services and Client bundles. Only
// the transport, catalog and unrendered presentation seams are test doubles.
const nativeRoot=process.env.DSH_TEST_NATIVE_SDK_ROOT;
const sdkRoot=process.env.DSH_TEST_SDK_ROOT??(nativeRoot?.endsWith('/node_modules')?dirname(nativeRoot):nativeRoot);

for(const {lateReply,allow,legacy=false} of [{lateReply:false,allow:true},{lateReply:true,allow:true},{lateReply:false,allow:false},{lateReply:false,allow:true,legacy:true}])test(`actual SDK ${legacy?'default legacy question':lateReply?'timed continued reply':'suspended original turn'} answers and one-operation ${allow?'approval':'denial'} resume through the production worker`, {timeout:20000}, async t=>{
 assert.ok(sdkRoot,'Set DSH_TEST_NATIVE_SDK_ROOT to the exact public compatibility carrier; no daily Desktop fallback is allowed');
 const require=createRequire(join(resolve(sdkRoot),'package.json')),rootRequire=createRequire(import.meta.url);
 const load=name=>import(pathToFileURL(require.resolve(name)).href),packageDir=name=>dirname(require.resolve(name+'/package.json'));
 const sdk=require('@deepseek-ai/dsh-agent/package.json').version;
 assert.ok(VERIFIED_SDK_VERSIONS.includes(sdk));assert.equal(require('@deepseek-ai/cordis/package.json').version,sdkCordisVersion(sdk));
 const required=['dsh-agent','dsh-agent-loop','dsh-system-prompt','dsh-tools','dsh-llm','dsh-session','dsh-session-projection','dsh-user-approval','dsh-user-questions','dsh-tool-ask-user','dsh-client-ui-session','dsh-client-ui-approval','dsh-client-ui-user-questions','dsh-api-gateway','dsh-api-session-controller','dsh-client-store','dsh-client-ui-slots'];
 for(const name of required)assert.equal(require('@deepseek-ai/'+name+'/package.json').version,sdk,name);
 const [cordis,{default:Agents},{default:AgentLoop},{default:SystemPrompt},{default:Tools,defineTool},llm,{default:Sessions},{default:Projections},approval,questions,askTool,store,slots]=await Promise.all(['@deepseek-ai/cordis','@deepseek-ai/dsh-agent','@deepseek-ai/dsh-agent-loop','@deepseek-ai/dsh-system-prompt','@deepseek-ai/dsh-tools','@deepseek-ai/dsh-llm','@deepseek-ai/dsh-session','@deepseek-ai/dsh-session-projection','@deepseek-ai/dsh-user-approval','@deepseek-ai/dsh-user-questions','@deepseek-ai/dsh-tool-ask-user','@deepseek-ai/dsh-client-store','@deepseek-ai/dsh-client-ui-slots'].map(load));
 const {Context}=cordis,{LlmAdapter,createUserMessage}=llm;
 const {ClientRemoteEvents}=await import(pathToFileURL(join(packageDir('@deepseek-ai/dsh-api-gateway'),'lib/types/client/remote-events.js')).href);
 const {createScope,scopeOf}=await import(pathToFileURL(join(packageDir('@deepseek-ai/dsh-api-session-controller'),'lib/types/client/scope.js')).href);
 const previousWindow=globalThis.window,previousDocument=globalThis.document;
 let captured;
 globalThis.window={__ModuleLoader__:{load(value){captured=value;}}};
 globalThis.document={querySelector:()=>({})};
 t.after(()=>{if(previousWindow===undefined)delete globalThis.window;else globalThis.window=previousWindow;if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument;});
 const bundleRequire=name=>{
  if(name==='@deepseek-ai/cordis')return cordis;
  if(name==='@deepseek-ai/dsh-client-store')return store;
  if(name==='@deepseek-ai/dsh-client-ui-slots')return slots;
  if(name==='react'||name==='react/jsx-runtime')return rootRequire(name);
  if(name==='@deepseek-ai/dsh-client-ui-primitives')return new Proxy({},{get(){return()=>{throw new Error('This SDK fixture never renders a presentation component');};}});
  throw new Error('Unconfigured SDK bundle import: '+name);
 };
 const clientModule=async name=>{captured=undefined;const file=join(packageDir(name),'lib/client.js');vm.runInThisContext(await readFile(file,'utf8'),{filename:file});assert.equal(captured?.id,name);return captured.factory(bundleRequire);};
 const [uiSessionModule,uiApprovalModule,uiQuestionsModule]=await Promise.all(['@deepseek-ai/dsh-client-ui-session','@deepseek-ai/dsh-client-ui-approval','@deepseek-ai/dsh-client-ui-user-questions'].map(clientModule));
 const host=new Context(),client=new Context(),scratch=await mkdtemp(join(tmpdir(),'dot-native-human-sdk-'));
 let agentHandle,worker;const clientScopes=new Map();
 t.after(async()=>{worker?.close();await agentHandle?.dispose();for(const scoped of clientScopes.values())await scoped.fiber.dispose();await client.fiber.dispose();await host.fiber.dispose();await rm(scratch,{recursive:true,force:true});});
 let networkCalls=0;t.mock.method(globalThis,'fetch',()=>{networkCalls++;throw new Error('External network disabled in actual SDK interaction fixture');});
 await host.plugin(SystemPrompt,{includeHarnessIdentity:false,includeRuntimeContext:false});await host.plugin(llm.default);await host.plugin(Sessions);await host.plugin(Projections);await host.plugin(Tools,sdk==='0.2.2-rc.1'?undefined:{mode:'native'});
 if(sdk==='0.2.2-rc.1')await host.plugin(await load('@deepseek-ai/dsh-tool-executor-native'));
 await host.plugin(Agents);await host.plugin(AgentLoop,{agents:[]});await host.plugin(approval.default);await host.plugin(questions.default);await host.plugin(askTool,legacy?undefined:{mode:'timed',timeout:lateReply?1:-1});
 host.on('tools/pre-execute',()=>({kind:'allow'}));
 let modelCalls=0,toolBodies=0;
 const questionBatch=[{id:'format',question:'Choose the synthetic output format',options:[{label:'Plain'},{label:'JSON'}]}];
 class Synthetic extends LlmAdapter{
  async *stream(){
   const step=modelCalls++;
   if(step===0||step===(lateReply?2:1)){const call=step===0?{id:'sdk-question-call',name:'ask_user_question',arguments:JSON.stringify({questions:questionBatch,...legacy?{}:{timeout:lateReply?1:-1}})}:{id:'sdk-approval-call',name:'synthetic_write',arguments:'{}'};yield{type:'block-start',index:0,blockType:'tool-call'};yield{type:'tool-call-delta',index:0,id:call.id,name:call.name,argumentsDelta:call.arguments};yield{type:'block-end',index:0,block:{type:'tool-call',...call}};yield{type:'finish',reason:{kind:'tool-calls'}};return;}
   yield{type:'block-start',index:0,blockType:'text'};yield{type:'text-delta',index:0,text:'Synthetic human-controlled task completed'};yield{type:'block-end',index:0,block:{type:'text',text:'Synthetic human-controlled task completed'}};yield{type:'finish',reason:{kind:'stop'}};
  }
 }
 host.llm.registerAdapter(['synthetic-local-human'],new Synthetic());
 host.tools.register(defineTool({name:'synthetic_write',description:'In-memory SDK acceptance only',parameters:{},output:{schema:{type:'object',properties:{wrote:{type:'boolean',required:true}},additionalProperties:false},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},async execute(_args,exec){const result=await host.approval.request({agent:exec.agent,toolName:'synthetic_write',callId:exec.callId,reason:'Allow the single synthetic in-memory operation?',signal:exec.signal});if(result!=='allowed-once')throw new Error('Synthetic operation was not approved');toolBodies++;return{wrote:true};}}));
 const remoteEvents=new ClientRemoteEvents(client,{registerGenerationSource:()=>()=>{}},()=>{throw new Error('Physical transport is not part of this component fixture');});
 t.after(()=>remoteEvents.dispose());
 const scopeFor=id=>{if(!clientScopes.has(id))clientScopes.set(id,createScope(client,id));return clientScopes.get(id).ctx;};
 const bridge=(event,fields)=>host.on(event,function(request,next){const wire=Object.fromEntries(fields.filter(key=>request[key]!==undefined).map(key=>[key,request[key]]));return remoteEvents.dispatchWaterfall(scopeFor(request.agent.id),{event,request:wire},request.signal??new AbortController().signal).then(outcome=>outcome.kind==='result'?outcome.value:next());},{prepend:true});
 bridge('approval/request',['toolName','callId','reason','displayReason']);bridge('user-questions/request',['questions','wait']);
 const userQuestionsRemote={answer:async(id,callId,value)=>({ok:true,value:host.userQuestions.answer(host.agents.get(id),callId,value)}),attachWait:(id,callId,signal)=>{const controller=new AbortController(),stream=host.userQuestions.attachWait(host.agents.get(id),callId,AbortSignal.any([signal,controller.signal]));return{[Symbol.asyncIterator]:()=>stream,dispose:()=>controller.abort()};}};
 client.provide('remote',{$on:(event,listener)=>remoteEvents.subscribe(client,event,listener),userQuestions:userQuestionsRemote});client.provide('remote.userQuestions',userQuestionsRemote);
 client.provide('slots',{inject:()=>()=>{},register:()=>()=>{},registerFactory:()=>()=>{},bindStoreScope(){throw new Error('No main Session view may be opened in this test');}});
 client.provide('locale',{register:()=>()=>{}});client.provide('uiConversation',{events:{register:()=>()=>{}}});
 let catalog={ids:[],byId:{},phase:'ready',projectionsBySession:{}};const catalogListeners=new Set(),projectionListeners=new Set();let backgroundBinding;
 client.provide('sessions',{list:{getSnapshot:()=>catalog,subscribe:listener=>{catalogListeners.add(listener);return()=>catalogListeners.delete(listener);}},scopeOf,binding:()=>backgroundBinding,retainInfo:()=>({getSnapshot:()=>({retainedBy:{}}),subscribe:()=>()=>{}})});
 const uiSession=new uiSessionModule.UiSession(client,client.sessions);await client.plugin(uiApprovalModule);await client.plugin(uiQuestionsModule);
 const sessionId='dsh_dot_'+randomUUID(),requestId=randomUUID();
 agentHandle=await host.agents.create({sessionId,meta:{cwd:scratch},agentOptions:{provider:'synthetic-local-human',model:'deterministic',maxOutputTokens:2048}});
 const agent=agentHandle.agent;
 const publishBackground=()=>{backgroundBinding={session:{projections:{faceOf:key=>({getSnapshot:()=>host.sessionProjections.snapshot(agent.session).values[key],subscribe:listener=>{projectionListeners.add(listener);return()=>projectionListeners.delete(listener);}})}}};catalog={...catalog,ids:[sessionId],byId:{[sessionId]:{id:sessionId,retainedBy:{}}}};for(const listener of catalogListeners)listener();};
 host.on('session/event',(session)=>{if(session===agent.session)queueMicrotask(()=>{for(const listener of projectionListeners)listener();});});
 const realSnapshot=()=>({type:'snapshot',header:{id:sessionId,cwd:agent.session.header.cwd},cursor:agent.session.snapshotEvents().at(-1)?.seq??0,hasMore:false,records:agent.session.snapshotEvents().map(event=>({type:'event',event})),projections:host.sessionProjections.snapshot(agent.session)});
 const remote={workspace:{async *follow(){yield{type:'baseline',value:{items:[{workspaceId:'sdk-workspace',path:scratch,sessionIds:[sessionId]}]}};}},session:{async list(){return{ok:true,value:{items:[{sessionId,cwd:scratch,running:agent.status==='running'}]}};},async *follow(){yield realSnapshot();},async prompt(){throw new Error('Answers must never use session.prompt');}}};
 let offered,commandIndex=0;const reports=[],token='synthetic-sdk-claim-token-0123456789',lease='synthetic-sdk-lease-token-0123456789';
 worker=createNativeWorker({remote,uiSession,location:{protocol:'dsh-app:',hostname:'app'},timeoutMs:3000,overview:async()=>({ok:true,value:{native_control:offered?{command_id:offered.command_id,claim_token:token}:null,native_worker_url:'http://127.0.0.1:12345/native/'}}),fetchImpl:async(url,options)=>{const body=JSON.parse(options.body);if(url.endsWith('/claim')){const command=offered;offered=undefined;return{ok:true,json:async()=>({result:{command,lease_token:lease,expires_at:new Date(Date.now()+5000).toISOString()}})};}reports.push(body.result);return{ok:true,json:async()=>({result:{accepted:true}})};}});
 let continuationCallIds=[];const command=async(action,extra={})=>{offered={command_id:'sdk_command_'+(++commandIndex),action,job_id:'native_sdk_job',workspace_id:'sdk-workspace',session_id:sessionId,request_id:requestId,continuation_call_ids:continuationCallIds,...extra};await worker.poll();assert.equal(reports.at(-1)?.ok,true,JSON.stringify(reports.at(-1)));return reports.at(-1);};
 const until=async predicate=>{const end=Date.now()+5000;for(;;){const value=predicate();if(value)return value;if(Date.now()>=end)throw new Error('Actual SDK task did not reach pending: '+JSON.stringify({status:agent.status,modelCalls,pending:[...uiSession.sessionStatus.getSnapshot()].map(([id,s])=>({id,kind:s.pendingInteraction?.kind})),events:agent.session.snapshotEvents().map(e=>({type:e.type,data:e.type==='turn/end'||e.type==='tool/result'?e.data:undefined}))}));await new Promise(r=>setTimeout(r,5));}};
 agent.followup(createUserMessage({source:{kind:'user',rpcId:requestId},content:[{type:'text',text:'Run the synthetic question, one-operation approval, then return the final result.'}]}));
 await until(()=>uiSession.sessionStatus.getSnapshot().get(sessionId)?.pendingInteraction?.kind==='question');if(legacy)assert.equal(uiSession.sessionStatus.getSnapshot().get(sessionId).pendingInteraction.callId,undefined);
 const first=await command('inspect');assert.equal(first.interactions.length,1);assert.equal(first.interactions[0].kind,'question');assert.equal(agent.status,'running');assert.equal(toolBodies,0);assert.deepEqual(catalog.ids,[]);publishBackground();
 if(lateReply){await until(()=>agent.status==='idle'&&uiSession.sessionStatus.getSnapshot().get(sessionId)?.pendingInteraction?.getSnapshot?.().state==='continued');const waiting=await command('inspect');assert.equal(waiting.interactions[0].state,'continued');assert.equal(waiting.events.at(-1).type,'turn/end');assert.equal(waiting.user_question_count,1);}
 const answer=await command('answer_question',{interaction:first.interactions[0],interaction_request_id:'sdk_answer',answers:[{id:'format',selected:['JSON']}]});assert.equal(answer.interaction_result.outcome,'applied');
 if(lateReply){continuationCallIds=['sdk-question-call'];assert.ok(answer.events.some(event=>event.source_kind==='user-question-reply'&&event.source_call_id==='sdk-question-call'&&event.turn>first.interactions[0].turn));}
 await until(()=>uiSession.sessionStatus.getSnapshot().get(sessionId)?.pendingInteraction?.kind==='approval');
 const second=await command('inspect');assert.equal(second.interactions[0].kind,'approval');assert.equal(toolBodies,0);
 const decide=await command('decide_approval',{interaction:second.interactions[0],interaction_request_id:'sdk_decision',decision:allow?'allow_once':'deny'});assert.equal(decide.interaction_result.outcome,'applied');
 await until(()=>agent.status==='idle');const finished=await command('inspect');assert.equal(finished.events.at(-1).type,'turn/end');assert.equal(finished.events.at(-1).reason,'completed');assert.ok(finished.events.some(event=>event.type==='assistant/message'&&event.text.includes('Synthetic human-controlled task completed')));assert.equal(toolBodies,allow?1:0);assert.equal(modelCalls,lateReply?4:3);assert.equal(networkCalls,0);assert.equal(agent.session.snapshotEvents().find(event=>event.type==='approval/decided').data.outcome,allow?'allowed-once':'rejected');
});
