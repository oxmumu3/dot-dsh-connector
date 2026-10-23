import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import React from 'react';
import {create,act} from 'react-test-renderer';
import {z} from 'zod';
import {createManagementRemote} from '../management-plugin/src/remote.js';
import {createManagementUI,managementClientFactory} from '../management-plugin/src/client.js';

const allowed=[
 'gateway/invocation-unavailable','gateway/definition-unavailable','gateway/service-unavailable',
 'gateway/method-unavailable','gateway/binding-invalid','gateway/input-invalid','gateway/bad-request',
 'gateway/internal','gateway/cancelled',
 'dot-management/denied','dot-management/unsupported','dot-management/busy','dot-management/unavailable','dot-management/invalid-request',
];
const stages=['dot-management/input-invalid','dot-management/remote-threw','dot-management/invalid-response','dot-management/remote-error'];
const secret='synthetic-private-admin-token-never-display';
const fallback='dot-management/request-failed';
const modules=name=>({react:React,zod:{z}}[name]);
const nodeText=node=>typeof node==='string'||typeof node==='number'?String(node):Array.isArray(node)?node.map(nodeText).join(''):node?.type==='style'?'':nodeText(node?.children??[]);

test('native adapter retains only the stable management failure code from a Remote result',async()=>{
 const api=managementClientFactory(modules);
 for(const code of allowed){
  const adapter=api.createNativeAdapter({dotDshManagement:{overview:async()=>({ok:false,error:{code,message:secret,details:{token:secret}}})}});
  await assert.rejects(adapter.call('manager_overview',{}),error=>{
   assert.equal(error.code,code);assert.equal(error.message,'Management service is unavailable.');
   assert.equal(error.cause,undefined);assert.doesNotMatch(String(error)+JSON.stringify(error),new RegExp(secret));return true;
  });
 }
});

test('native adapter sanitizes unknown and thrown failures without retaining their message or cause',async()=>{
 const api=managementClientFactory(modules);
 for(const [expected,operation] of [
  ['dot-management/remote-error',async()=>({ok:false,error:{code:secret,message:secret}})],
  ['dot-management/remote-threw',async()=>{throw Object.assign(new Error(secret),{code:secret,cause:new Error(secret)});}],
  ['dot-management/denied',async()=>{throw Object.assign(new Error(secret),{code:'dot-management/denied',cause:new Error(secret)});}],
  ['dot-management/remote-threw',async()=>{throw Object.defineProperty(new Error(secret),'code',{get(){throw new Error(secret);}});}],
 ]){
  const adapter=api.createNativeAdapter({dotDshManagement:{overview:operation}});
  await assert.rejects(adapter.call('manager_overview',{}),error=>{
   assert.equal(error.code,expected);
   assert.equal(error.message,'Management service is unavailable.');assert.equal(error.cause,undefined);
   assert.doesNotMatch(String(error)+JSON.stringify(error),new RegExp(secret));return true;
  });
 }
});

test('native adapter identifies invalid input before calling Remote',async()=>{
 const api=managementClientFactory(modules);let calls=0;
 const adapter=api.createNativeAdapter({dotDshManagement:{overview:async()=>{calls++;return{ok:true,value:{}};}}});
 for(const [tool,args] of [['unknown_operation',{}],['manager_overview',{private:secret}]]){
  await assert.rejects(adapter.call(tool,args),error=>{
   assert.equal(error.code,'dot-management/input-invalid');
   assert.equal(error.message,'Invalid management request.');assert.equal(error.cause,undefined);
   assert.doesNotMatch(String(error)+JSON.stringify(error),new RegExp(secret));return true;
  });
 }
 assert.equal(calls,0);
});

test('native adapter distinguishes malformed responses from failed Remote results',async()=>{
 const api=managementClientFactory(modules);
 for(const result of [null,undefined,secret,0,{},[],{ok:secret},{ok:0},{ok:null},Object.defineProperty({},'ok',{get(){throw new Error(secret);}})]){
  const adapter=api.createNativeAdapter({dotDshManagement:{overview:async()=>result}});
  await assert.rejects(adapter.call('manager_overview',{}),error=>{
   assert.equal(error.code,'dot-management/invalid-response');assert.doesNotMatch(String(error)+JSON.stringify(error),new RegExp(secret));return true;
  });
 }
 for(const result of [{ok:false},{ok:false,error:null},{ok:false,error:{code:secret}},
  {ok:false,error:Object.defineProperty({},'code',{get(){throw new Error(secret);}})},
  Object.defineProperty({ok:false},'error',{get(){throw new Error(secret);}})]){
  const adapter=api.createNativeAdapter({dotDshManagement:{overview:async()=>result}});
  await assert.rejects(adapter.call('manager_overview',{}),error=>{
   assert.equal(error.code,'dot-management/remote-error');assert.doesNotMatch(String(error)+JSON.stringify(error),new RegExp(secret));return true;
  });
 }
});

test('native diagnostics inspect only the explicit code field',async()=>{
 const api=managementClientFactory(modules);let codeReads=0;
 const error=new Proxy({get code(){codeReads++;return'gateway/internal';}},{
  get(target,key){if(key==='code')return target.code;throw new Error(secret);},
  ownKeys(){throw new Error(secret);},
 });
 for(const operation of [async()=>({ok:false,error}),async()=>{throw error;}]){
  const adapter=api.createNativeAdapter({dotDshManagement:{overview:operation}});
  await assert.rejects(adapter.call('manager_overview',{}),failure=>failure.code==='gateway/internal'&&!String(failure).includes(secret));
 }
 assert.equal(codeReads,2);
});

test('native success and the serialized browser factory preserve the same adapter contract',async()=>{
 const factory=runInNewContext(`(${managementClientFactory.toString()})`);
 const remoteFactory=runInNewContext(`(${createManagementRemote.toString()})`);
 const uiFactory=runInNewContext(`(${createManagementUI.toString()})`);
 const api=factory(modules,remoteFactory,uiFactory),value={connection:{state:'connected'}},calls=[];
 const good=api.createNativeAdapter({dotDshManagement:{overview:async request=>{calls.push(request);return{ok:true,value};}}});
 assert.equal(await good.call('manager_overview',{}),value);assert.deepEqual(calls,[{}]);
 const bad=api.createNativeAdapter({dotDshManagement:{overview:async()=>({ok:false,error:{code:'gateway/service-unavailable',message:secret}})}});
 await assert.rejects(bad.call('manager_overview',{}),error=>error.code==='gateway/service-unavailable'&&!String(error).includes(secret));
 const invalid=api.createNativeAdapter({dotDshManagement:{overview:async()=>({ok:secret})}});
 await assert.rejects(invalid.call('manager_overview',{}),error=>error.code==='dot-management/invalid-response'&&!String(error).includes(secret));
});

test('page read errors display an allowlisted diagnostic and never an external error payload',async()=>{
 for(const [expected,failure] of [
  ...[...allowed,...stages].map(code=>[code,Object.assign(new Error(secret),{code})]),
  [fallback,Object.assign(new Error(secret),{code:secret})],
  [fallback,Object.defineProperty(new Error(secret),'code',{get(){throw new Error(secret);}})],
 ]){
  let tree;const Page=createManagementUI(React,{async call(){throw failure;}});
  try{
   await act(async()=>{tree=create(React.createElement(Page));});
   const text=nodeText(tree.toJSON());
   assert.match(text,/本机连接状态暂时(?:无法读取|繁忙)。请重试刷新。/);
   assert.ok(text.includes(`诊断代码：${expected}`));
   assert.doesNotMatch(text,new RegExp(secret));
  }finally{if(tree)await act(async()=>tree.unmount());}
 }
});

test('a successful page refresh removes the earlier failure diagnostic',async()=>{
 let failed=true,tree;
 const overview={connection:{state:'connected',task_backend:'online',read_backend:'online'},admission:{paused:false},audit:{events_total:0,jobs_total:0},recent_events:[]};
 const Page=createManagementUI(React,{async call(){if(failed)throw Object.assign(new Error(secret),{code:'dot-management/unavailable'});return overview;}});
 try{
  await act(async()=>{tree=create(React.createElement(Page));});
  assert.match(nodeText(tree.toJSON()),/诊断代码：dot-management\/unavailable/);
  failed=false;
  await act(async()=>{tree.root.findAllByType('button').find(node=>nodeText(node.props.children)==='刷新').props.onClick();});
  assert.match(nodeText(tree.toJSON()),/本机已就绪/);assert.doesNotMatch(nodeText(tree.toJSON()),/诊断代码|synthetic-private/);
 }finally{if(tree)await act(async()=>tree.unmount());}
});
