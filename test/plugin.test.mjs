import {test} from 'node:test';
import assert from 'node:assert/strict';
import {installConnector} from '../src/plugin.js';
test('plugin stays inert unless explicitly enabled and never reads environment in disabled mode',async()=>{
 const runtime=await installConnector({},{enabled:false});assert.deepEqual(runtime,{enabled:false});
});
test('enabled plugin requires public scope and external channel configuration before dependencies',async()=>{
 await assert.rejects(installConnector({},{enabled:true}),/configuration/i);
 await assert.rejects(installConnector({},{enabled:true,principal:'owner',tokenEnv:'DOT_DSH_TOKEN',stateDir:'/tmp/test',projects:[]}),/configuration/i);
});
test('operator must select a dedicated clean host profile; token alone cannot enable ambient host',async()=>{
 const config={enabled:true,principal:'owner',tokenEnv:'DOT_DSH_TOKEN',stateDir:'/tmp/test',projects:[{id:'p',label:'p',root:'/tmp/public',contextFiles:['README.md'],principals:['owner'],public:true}]};
 const saved=process.env.DOT_DSH_TOKEN;process.env.DOT_DSH_TOKEN='a'.repeat(48);
 try{await assert.rejects(installConnector({},config),/isolation/i);}finally{if(saved===undefined)delete process.env.DOT_DSH_TOKEN;else process.env.DOT_DSH_TOKEN=saved;}
});
test('state directory cannot be the parent of the isolated host profile',async t=>{
 const {mkdtemp,realpath,mkdir,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const base=await realpath(await mkdtemp(join(tmpdir(),'dot-plugin-')));const home=join(base,'host');await mkdir(home);t.after(()=>rm(base,{recursive:true,force:true}));
 const previousHome=process.env.DSH_HOME,previousToken=process.env.DOT_DSH_TOKEN;process.env.DSH_HOME=home;process.env.DOT_DSH_TOKEN='a'.repeat(48);
 const config={enabled:true,isolatedHostHome:home,publicOnlyHost:true,principal:'owner',tokenEnv:'DOT_DSH_TOKEN',stateDir:base,projects:[{id:'p',label:'p',root:base,contextFiles:['README.md'],principals:['owner'],public:true}]};
 try{await assert.rejects(installConnector({},config),/inside/);}finally{if(previousHome===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=previousHome;if(previousToken===undefined)delete process.env.DOT_DSH_TOKEN;else process.env.DOT_DSH_TOKEN=previousToken;}
});
test('inactive owner rejects lifecycle registration before acquiring resources',async t=>{
 const {mkdtemp,realpath,mkdir,rm,access}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const base=await realpath(await mkdtemp(join(tmpdir(),'dot-plugin-close-'))),home=join(base,'host'),stateDir=join(home,'state');await mkdir(home);t.after(()=>rm(base,{recursive:true,force:true}));
 const previousHome=process.env.DSH_HOME,previousToken=process.env.DOT_DSH_TOKEN;process.env.DSH_HOME=home;process.env.DOT_DSH_TOKEN='a'.repeat(48);
 const config={enabled:true,isolatedHostHome:home,publicOnlyHost:true,principal:'owner',tokenEnv:'DOT_DSH_TOKEN',stateDir,projects:[{id:'p',label:'p',root:base,contextFiles:['README.md'],principals:['owner'],public:true}]};
 try{await assert.rejects(installConnector({get(){},effect(){throw new Error('Owner scope closed');}},config),/Owner scope closed/);await assert.rejects(access(stateDir));}
 finally{if(previousHome===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=previousHome;if(previousToken===undefined)delete process.env.DOT_DSH_TOKEN;else process.env.DOT_DSH_TOKEN=previousToken;}
});
