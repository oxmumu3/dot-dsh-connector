import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';

const origin='dsh-app://app';
const claimToken='claim_'+ 'a'.repeat(64),leaseToken='lease_'+ 'b'.repeat(64);
const claim={command_id:'command-1',claim_token:claimToken,client_id:'client-1'};
const report={command_id:'command-1',lease_token:leaseToken,client_id:'client-1',result:{status:'succeeded',value:{text:'synthetic'}}};
const secret='synthetic-private-message-never-return';
const implementation=await import('../src/native-worker-server.js').catch(()=>({}));

async function fixture(t,control={claim:async()=>({claimed:true}),report:async()=>({accepted:true})}){
 assert.equal(typeof implementation.createNativeWorkerServer,'function','Native worker HTTP implementation is required.');
 const server=await implementation.createNativeWorkerServer({control,port:0});
 t.after(()=>server.close());return server;
}
function request(server,{path='/native/claim',method='POST',body=claim,raw,headers={},rawHeaders}={}){
 const url=new URL(server.url),text=raw??JSON.stringify(body),token=path.startsWith('/native/report')?body?.lease_token:body?.claim_token;
 const defaults={host:url.host,origin,'content-type':'application/json',authorization:`Bearer ${token}`,'content-length':Buffer.byteLength(text)};
 const actual=rawHeaders??Object.fromEntries(Object.entries({...defaults,...headers}).filter(([,v])=>v!==undefined));
 return new Promise((resolve,reject)=>{
  const req=http.request({hostname:url.hostname,port:url.port,path,method,headers:actual},res=>{
   const chunks=[];res.on('data',x=>chunks.push(x));res.on('end',()=>{
    const text=Buffer.concat(chunks).toString('utf8');let json;try{json=JSON.parse(text);}catch{}
    resolve({status:res.statusCode,headers:res.headers,rawHeaders:res.rawHeaders,text,json});
   });
  });req.on('error',reject);req.end(method==='OPTIONS'?undefined:text);
 });
}

test('native worker only dispatches the two strict authenticated native envelopes',async t=>{
 const calls=[],server=await fixture(t,{claim:async body=>{calls.push(['claim',body]);return{claimed:true};},report:async body=>{calls.push(['report',body]);return{accepted:true};}});
 assert.match(server.url,/^http:\/\/127\.0\.0\.1:\d+$/);
 const c=await request(server),r=await request(server,{path:'/native/report',body:report});
 assert.equal(c.status,200);assert.deepEqual(c.json,{result:{claimed:true}});
 assert.equal(r.status,200);assert.deepEqual(r.json,{result:{accepted:true}});
 assert.deepEqual(calls,[['claim',claim],['report',report]]);
 assert.equal(c.headers['access-control-allow-origin'],origin);assert.equal(c.headers['cache-control'],'no-store');
 assert.equal(c.headers['access-control-allow-credentials'],undefined);assert.equal(c.headers['x-content-type-options'],'nosniff');
});

test('native worker requires one exact native Origin and loopback Host before dispatch',async t=>{
 let calls=0;const server=await fixture(t,{claim:async()=>{calls++;return{};},report:async()=>{calls++;return{};}});
 for(const headers of [{origin:undefined},{origin:'null'},{origin:'https://example.com'},{origin:'dsh-app://other'},{origin:'dsh-app://app/'},{host:'localhost:'+new URL(server.url).port},{host:'127.0.0.1:1'}]){
  const r=await request(server,{headers});assert.equal(r.status,403);assert.equal(r.json.error.code,'NATIVE_DENIED');assert.equal(r.headers['access-control-allow-origin'],undefined);
 }
 assert.equal(calls,0);
});

test('native worker Bearer authorization must exactly match the appropriate bounded capability',async t=>{
 let calls=0;const server=await fixture(t,{claim:async()=>{calls++;return{};},report:async()=>{calls++;return{};}});
 for(const auth of [undefined,'',claimToken,`Basic ${claimToken}`,`bearer ${claimToken}`,`Bearer ${leaseToken}`,'Bearer '+ 'a'.repeat(513)]){
  const r=await request(server,{headers:{authorization:auth}});assert.equal(r.status,401);assert.equal(r.json.error.code,'NATIVE_DENIED');
 }
 for(const body of [{...claim,claim_token:''},{...claim,claim_token:'short'},{...claim,claim_token:[]},{...claim,claim_token:'a'.repeat(513)}])assert.notEqual((await request(server,{body})).status,200);
 const r=await request(server,{path:'/native/report',body:report,headers:{authorization:`Bearer ${claimToken}`}});assert.equal(r.status,401);assert.equal(calls,0);
});

test('native worker rejects extra routes, query strings and methods without invoking control',async t=>{
 let calls=0;const server=await fixture(t,{claim:async()=>{calls++;return{};},report:async()=>{calls++;return{};}});
 for(const path of ['/rpc','/native/claim?x=1','/native/report/','http://127.0.0.1/native/claim','/native/%63laim'])assert.equal((await request(server,{path})).status,404);
 for(const method of ['GET','PUT','PATCH','DELETE'])assert.equal((await request(server,{method})).status,405);
 assert.equal(calls,0);
});

test('native worker only accepts exact ordinary JSON envelopes and bounded identifiers',async t=>{
 let calls=0;const server=await fixture(t,{claim:async()=>{calls++;return{};},report:async()=>{calls++;return{};}});
 for(const body of [null,[],{},'secret',{...claim,url:'https://example.com'},{...claim,headers:{}},{...claim,command_id:''},{...claim,command_id:'x'.repeat(201)},{...claim,client_id:3},{...claim,client_id:'x'.repeat(201)},{command_id:'command-1',claim_token:claimToken}]){
  const r=await request(server,{body});assert.notEqual(r.status,200);assert.equal(r.json.error.code,'NATIVE_INVALID');
 }
 for(const body of [{...report,extra:true},{...report,result:[]},{...report,result:'secret'},{...report,result:null}])assert.equal((await request(server,{path:'/native/report',body})).json.error.code,'NATIVE_INVALID');
 assert.equal((await request(server,{raw:'{"broken":'})).json.error.code,'NATIVE_INVALID');
 assert.equal((await request(server,{headers:{'content-type':'text/plain'}})).status,415);
 assert.equal((await request(server,{headers:{'content-encoding':'gzip'}})).status,415);
 assert.equal(calls,0);
});

test('native worker bounds claim and report request bodies before control dispatch',async t=>{
 let calls=0;const server=await fixture(t,{claim:async()=>{calls++;return{};},report:async()=>{calls++;return{};}});
 const c=await request(server,{raw:JSON.stringify({...claim,padding:'a'.repeat(64*1024)})});assert.equal(c.status,413);assert.equal(c.json.error.code,'NATIVE_INVALID');
 const r=await request(server,{path:'/native/report',body:{...report,result:{text:'a'.repeat(256*1024)}}});assert.equal(r.status,413);assert.equal(r.json.error.code,'NATIVE_INVALID');assert.equal(calls,0);
 for(const [path,body]of [['/native/claim',{...claim,padding:'a'.repeat(64*1024)}],['/native/report',{...report,result:{text:'a'.repeat(256*1024)}}]]){
  const chunked=await request(server,{path,body,headers:{'content-length':undefined,'transfer-encoding':'chunked'}});assert.equal(chunked.status,413);assert.equal(chunked.json.error.code,'NATIVE_INVALID');
 }
 assert.equal(calls,0);
});

test('native worker times out stalled control operations after the fixed ten-second bound',async t=>{
 let calls=0;const server=await fixture(t,{claim:()=>{calls++;return new Promise(()=>{});},report:async()=>({})});
 const started=Date.now(),r=await request(server);
 assert.equal(r.status,503);assert.equal(r.json.error.code,'NATIVE_UNAVAILABLE');assert.ok(Date.now()-started>=9000);assert.ok(Date.now()-started<12500);assert.equal(calls,1);
});

test('native preflight permits only exact native origin and the fixed method, header and private-network set',async t=>{
 const server=await fixture(t);
 const base={'access-control-request-method':'POST','access-control-request-headers':'content-type, authorization','content-length':undefined};
 const r=await request(server,{method:'OPTIONS',headers:{...base,'access-control-request-private-network':'true'}});
 assert.equal(r.status,204);assert.equal(r.text,'');assert.equal(r.headers['access-control-allow-origin'],origin);assert.equal(r.headers['access-control-allow-methods'],'POST');
 assert.equal(r.headers['access-control-allow-headers'],'content-type, authorization');assert.equal(r.headers['access-control-allow-private-network'],'true');assert.equal(r.headers['access-control-allow-credentials'],undefined);
 const ordinary=await request(server,{method:'OPTIONS',headers:base});assert.equal(ordinary.status,204);assert.equal(ordinary.headers['access-control-allow-private-network'],undefined);
 for(const extra of [{origin:undefined},{origin:'null'},{origin:'https://example.com'},{'access-control-request-method':'GET'},{'access-control-request-headers':'authorization, x-token'},{'access-control-request-headers':'authorization, authorization'},{'access-control-request-private-network':'false'}]){
  const denied=await request(server,{method:'OPTIONS',headers:{...base,...extra}});assert.equal(denied.status,403);assert.equal(denied.headers['access-control-allow-private-network'],undefined);
 }
});

test('duplicate security and preflight headers are rejected even when Node normalizes their values',async t=>{
 const server=await fixture(t),host=new URL(server.url).host;
 const base=['Host',host,'Origin',origin,'Authorization',`Bearer ${claimToken}`,'Content-Type','application/json','Content-Length',String(Buffer.byteLength(JSON.stringify(claim)))];
 for(const [name,value]of [['Origin',origin],['Host',host],['Authorization',`Bearer ${claimToken}`],['Content-Type','application/json']]){
  const r=await request(server,{rawHeaders:[...base,name,value]});assert.equal(r.status,403);assert.equal(r.json.error.code,'NATIVE_DENIED');
 }
 const pre=['Host',host,'Origin',origin,'Access-Control-Request-Method','POST','Access-Control-Request-Headers','content-type, authorization','Access-Control-Request-Private-Network','true'];
 for(const [name,value]of [['Access-Control-Request-Method','POST'],['Access-Control-Request-Headers','authorization'],['Access-Control-Request-Private-Network','true']]){
  const r=await request(server,{method:'OPTIONS',rawHeaders:[...pre,name,value]});assert.equal(r.status,403);assert.equal(r.headers['access-control-allow-private-network'],undefined);
 }
});

test('native worker maps only approved control errors and never echoes raw messages or unknown codes',async t=>{
 const approved={NATIVE_DENIED:403,NATIVE_INVALID:400,NATIVE_CONFLICT:409,NATIVE_UNAVAILABLE:503,NATIVE_CAPACITY:503};let current;
 const server=await fixture(t,{claim:async()=>{throw current;},report:async()=>{throw current;}});
 for(const [code,status]of Object.entries(approved)){
  current=Object.assign(new Error(secret),{code,cause:{secret}});const r=await request(server);assert.equal(r.status,status);assert.equal(r.json.error.code,code);assert.ok(!r.text.includes(secret));
 }
 for(const error of [Object.assign(new Error(secret),{code:secret}),Object.defineProperty(new Error(secret),'code',{get(){throw new Error(secret);}})]){
  current=error;const r=await request(server);assert.equal(r.status,503);assert.equal(r.json.error.code,'NATIVE_UNAVAILABLE');assert.ok(!r.text.includes(secret));
 }
});

test('native worker limits serialized responses and sanitizes serialization failures',async t=>{
 let result;const server=await fixture(t,{claim:async()=>result,report:async()=>result});
 for(const value of [{text:'x'.repeat(1024*1024)},Object.defineProperty({},'value',{enumerable:true,get(){throw new Error(secret);}})]){
  result=value;const r=await request(server);assert.equal(r.status,503);assert.equal(r.json.error.code,'NATIVE_UNAVAILABLE');assert.ok(!r.text.includes(secret));
 }
});

test('native worker close is idempotent and cancels pending transport work without a ten-second leak',async t=>{
 let reached;const ready=new Promise(resolve=>{reached=resolve;});
 const server=await fixture(t,{claim:()=>{reached();return new Promise(()=>{});},report:async()=>({})});
 const pending=request(server).catch(e=>({transportError:e.code}));await ready;
 const started=Date.now();await server.close();await server.close();assert.ok(Date.now()-started<1000);
 const completed=await pending;assert.ok(completed.transportError||completed.status===503);
 const u=new URL(server.url);await assert.rejects(new Promise((resolve,reject)=>{const socket=net.connect({host:u.hostname,port:u.port});socket.once('error',reject);socket.once('connect',()=>{socket.destroy();resolve();});}));
});

test('native worker validates its narrow configuration before listening',async()=>{
 assert.equal(typeof implementation.createNativeWorkerServer,'function','Native worker HTTP implementation is required.');
 for(const options of [{},{control:{}},{control:{claim(){},report(){}},port:-1},{control:{claim(){},report(){}},port:65536},{control:{claim(){},report(){}},port:1.5},{control:{claim(){},report(){}},token:secret}]){
  await assert.rejects(implementation.createNativeWorkerServer(options),e=>e.code==='NATIVE_INVALID'&&!String(e).includes(secret));
 }
});

test('native worker listener conflicts are fixed failures without disrupting the existing listener',async t=>{
 const server=await fixture(t),port=Number(new URL(server.url).port);
 await assert.rejects(implementation.createNativeWorkerServer({control:{claim(){},report(){}},port}),e=>e.code==='NATIVE_UNAVAILABLE'&&!String(e).includes('EADDRINUSE'));
 assert.equal((await request(server)).status,200);
});
