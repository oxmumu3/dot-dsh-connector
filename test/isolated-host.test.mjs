import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,realpath,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';

async function api(){const value=await import('../scripts/isolated-host.mjs').catch(()=>({}));assert.equal(typeof value.launchIsolatedHost,'function','narrow isolated host launcher required');return value;}
async function fixture(t){
 const home=await realpath(await mkdtemp(join(tmpdir(),'dot-dsh-narrow-host-'))),root=join(home,'public-fixture');await mkdir(root);await writeFile(join(root,'README.md'),'Public synthetic fixture; live Dot and real model acceptance unverified.');
 const oldHome=process.env.DSH_HOME,tokenEnv='DOT_DSH_NARROW_TEST_TOKEN',oldToken=process.env[tokenEnv];process.env.DSH_HOME=home;const token=randomBytes(32).toString('hex');process.env[tokenEnv]=token;
 t.after(async()=>{if(oldHome===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=oldHome;if(oldToken===undefined)delete process.env[tokenEnv];else process.env[tokenEnv]=oldToken;await rm(home,{recursive:true,force:true});});
 return{home,token,config:{enabled:true,isolatedHostHome:home,publicOnlyHost:true,principal:'synthetic-owner',tokenEnv,stateDir:join(home,'connector-state'),port:0,projects:[{id:'public-fixture',label:'Public fixture',root,contextFiles:['README.md'],principals:['synthetic-owner'],public:true}]}};
}
test('dry mode validates explicit scope without SDK imports, state writes, key reads or listener',async t=>{
 const f=await fixture(t);const {launchIsolatedHost}=await api();const host=await launchIsolatedHost({config:f.config});t.after(()=>host.close());
 assert.equal(host.summary.mode,'dry');assert.equal(host.summary.started,false);assert.equal(host.core,undefined);assert.ok(host.summary.modules.includes('@deepseek-ai/dsh-agent-loop'));assert.equal(host.summary.modules.includes('@deepseek-ai/dsh-credentials-local'),false);assert.equal(JSON.stringify(host.summary).includes(f.token),false);await assert.rejects(access(f.config.stateDir));
});
test('real mode rejects missing or non-dedicated credential references before creating state',async t=>{
 const f=await fixture(t);const {launchIsolatedHost}=await api();
 for(const options of [{mode:'real',model:'explicit-model'},{mode:'real',model:'explicit-model',apiKeyEnv:'DEEPSEEK_API_KEY'},{mode:'real',apiKeyEnv:'DOT_DSH_MODEL_NEW_KEY'}])await assert.rejects(launchIsolatedHost({config:f.config,...options}),/explicit|dedicated|model|credential/i);
 await assert.rejects(access(f.config.stateDir));
});
test('unsafe home, broad config, or disabled real configuration fails before native startup',async t=>{
 const f=await fixture(t);const {launchIsolatedHost}=await api();
 for(const config of [{...f.config,publicOnlyHost:undefined},{...f.config,stateDir:f.home},{...f.config,extraPlugin:'broad-memory'},{...f.config,isolatedHostHome:'/different/home'}])await assert.rejects(launchIsolatedHost({config}));
 await assert.rejects(launchIsolatedHost({config:{...f.config,enabled:false},mode:'synthetic'}),/enabled/i);await assert.rejects(access(f.config.stateDir));
});
test('startup abort rolls back a late public SDK result before state or listener admission',async t=>{
 const f=await fixture(t);const {launchIsolatedHost}=await api();const controller=new AbortController();
 const pending=launchIsolatedHost({config:f.config,mode:'synthetic',signal:controller.signal});const timer=setTimeout(()=>controller.abort(),10);t.after(()=>clearTimeout(timer));
 await assert.rejects(pending,error=>error.code==='ABORTED');await assert.rejects(access(f.config.stateDir));
});
test('public API-key adapter supports explicit fixed-endpoint options without mounting or resolving a key',async t=>{
 const {openPublicSdk}=await api();const sdk=await openPublicSdk({realProvider:true});t.after(()=>sdk.close());const require=createRequire(join(sdk.root,'package.json'));
 const adapter=await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-llm-deepseek-api-key')).href);assert.equal(typeof adapter.apply,'function');assert.equal(adapter.default,undefined);
 const {createLaunchEnvironmentSnapshot,launchEnvironmentOf}=await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-launch-environment')).href);
 const snapshot=createLaunchEnvironmentSnapshot([{source:'process',values:{DOT_DSH_MODEL_NEW_KEY:'synthetic-value-only'}}]);assert.equal(launchEnvironmentOf({get:()=>snapshot}),snapshot);assert.equal(snapshot.get('DEEPSEEK_API_KEY'),undefined);assert.equal(snapshot.get('DEEPSEEK_BASE_URL'),undefined);assert.equal(snapshot.get('DOT_DSH_MODEL_NEW_KEY').value,'synthetic-value-only');
 let environmentReads=0;const options=adapter.resolveAdapterOptions({baseURL:'https://api.deepseek.com/anthropic',apiKeyEnv:'DOT_DSH_MODEL_NEW_KEY'},{get(){environmentReads++;throw new Error('No fallback environment reads allowed');}});
 assert.equal(options.baseURL,'https://api.deepseek.com/anthropic');assert.equal(options.apiKeyEnv,'DOT_DSH_MODEL_NEW_KEY');assert.equal(environmentReads,0);
});
test('synthetic standalone host runs production bridge/core/executor and actual AgentLoop without network',async t=>{
 const f=await fixture(t);const {launchIsolatedHost}=await api();let host;
 t.after(async()=>{await host?.close();});let fetches=0;t.mock.method(globalThis,'fetch',()=>{fetches++;throw new Error('Synthetic test forbids network');});
 host=await launchIsolatedHost({config:f.config,mode:'synthetic'});
 assert.equal(host.summary.started,true);assert.equal(host.summary.model_kind,'deterministic_synthetic');assert.match(host.url,/^http:\/\/127\.0\.0\.1:\d+\/rpc$/);assert.equal(JSON.stringify(host.summary).includes(f.token),false);
 const started=await host.core.call('synthetic-owner','start_task',{project_id:'public-fixture',task:'Summarize the public fixture and its unverified boundary.',request_id:'native-host-synthetic'});
 const until=Date.now()+10000;let result;
 while(Date.now()<until){result=await host.core.call('synthetic-owner','get_task',{job_id:started.job_id});if(!['accepted','starting','running'].includes(result.status))break;await new Promise(resolve=>setTimeout(resolve,5));}
 assert.equal(result.status,'succeeded',JSON.stringify(result));assert.match(result.result,/SYNTHETIC/);assert.equal(result.acceptance,'unverified');assert.ok(Number.isInteger(result.turn));assert.equal(fetches,0);
 await host.close();await host.close();
 const second=await launchIsolatedHost({config:f.config,mode:'synthetic'});try{assert.equal((await second.core.call('synthetic-owner','get_task',{job_id:started.job_id})).status,'succeeded');}finally{await second.close();}
});
