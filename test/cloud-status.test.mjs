import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,writeFile,chmod,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import http from 'node:http';

const START=Date.parse('2026-10-22T12:00:00Z');
// Real loopback requests share a busy Host event loop during integration runs.
// Keep the short deadline only in the intentionally stalled-response test.
const HTTP_TIMEOUT_MS=2000;
const stamp=value=>new Date(value).toISOString();
function healthy(now=START){return{schema_version:1,live:true,ready:true,snapshot_at:stamp(now),runtime:{instance_id:'a'.repeat(32),lifecycle:'running',started_at:stamp(now-3*3600000)},components:{'control-plane':{status:'ok',state:'polling',details:{last_success:stamp(now-10000),consecutive_failures:0,current_poll_age_seconds:10,deadline_seconds:35}},dispatcher:{status:'ok',state:'accepting',details:{accepting:true}},mcp:{status:'ok',state:'initialized',observed_at:stamp(now-2*3600000),details:{transport:'stdio',child_state:'running',evidence:'same_child',initialize:{ok:true,identity_complete:true,server_name:'dot-dsh-connector'}}},'response-delivery':{status:'ok',state:'accepted',details:{http_status:200,last_accepted:stamp(now-2*3600000),last_completed:stamp(now-2*3600000)}}}};}
function awaitingFirstCall(now=START){const value=healthy(now);value.components.mcp={status:'unknown',state:'not_observed',details:{transport:'stdio',child_state:'running',evidence:'same_child',initialize:{ok:false,identity_complete:false,limited:false,capability_names:[]}}};return value;}
async function api(options={}){const m=await import('../src/cloud-status.js').catch(()=>({}));assert.equal(typeof m.createCloudStatus,'function','automatic official Tunnel status observer is required');return m.createCloudStatus(options);}
async function fixture(t){
 const directory=await realpath(await mkdtemp(join(tmpdir(),'dsh-cloud-status-')));let clock=START,body=healthy(clock),status=200,calls=0,hold=false;
 const server=http.createServer((req,res)=>{calls++;assert.equal(req.url,'/health?details=true');if(hold)return;res.writeHead(status,{'content-type':'application/json'});res.end(typeof body==='string'?body:JSON.stringify(body));});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const url=`http://127.0.0.1:${server.address().port}`,file=join(directory,'official.url');await writeFile(file,url+'\n',{mode:0o600});
 let observer;t.after(async()=>{observer?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});});
 observer=await api({healthFile:file,now:()=>clock,timeoutMs:HTTP_TIMEOUT_MS});
 return{observer,file,directory,url,server,get calls(){return calls;},clock(value){clock=value;},body(value){body=value;},status(value){status=value;},hold(value){hold=value;}};
}
test('unconfigured connection cannot be verified by local activity',async()=>{let calls=0;const observer=await api({fetchImpl:()=>{calls++;throw new Error('must not probe');},now:()=>START});try{const result=await observer.read();assert.equal(result.state,'not_configured');assert.equal(result.source,'none');assert.equal(calls,0);}finally{observer.close();}});
test('fresh official health proves an idle channel online without inventing a new cloud interaction',async t=>{const f=await fixture(t);const result=await f.observer.read();assert.equal(result.state,'online',result.reason);assert.equal(result.source,'official_tunnel_health');assert.equal(result.last_connected_at,stamp(START));assert.equal(result.last_interaction_at,stamp(START-2*3600000));assert.equal(f.calls,1);});
test('admin reads share a bounded health cache; a real degraded signal automatically changes status',async t=>{const f=await fixture(t);const results=await Promise.all([f.observer.read(),f.observer.read()]);assert.equal(f.calls,1);assert.equal(results[0].state,'online');await f.observer.read();assert.equal(f.calls,1);f.clock(START+5001);const broken=healthy(START+5001);broken.components['response-delivery']=healthy().components['response-delivery'];broken.ready=false;broken.components['control-plane'].status='error';broken.components['control-plane'].state='disconnected';f.body(broken);const offline=await f.observer.read();assert.equal(offline.state,'offline');assert.equal(offline.last_connected_at,stamp(START));assert.equal(offline.last_interaction_at,stamp(START-2*3600000));assert.equal(f.calls,2);});
test('a fresh snapshot does not hide a stuck cloud poll or an unrelated MCP server',async t=>{const f=await fixture(t);for(const mutation of [v=>{v.components['control-plane'].details.last_success=stamp(START-3600000);},v=>{v.components['control-plane'].details.current_poll_age_seconds=200;},v=>{v.components.mcp.details.initialize.server_name='other-private-server';},v=>{v.components.mcp.details.evidence='different_child';}]){const value=healthy();mutation(value);f.body(value);const isolated=await api({healthFile:f.file,now:()=>START,timeoutMs:HTTP_TIMEOUT_MS});try{const result=await isolated.read();assert.notEqual(result.state,'online');assert.notEqual(result.reason,'probe_unavailable');}finally{isolated.close();}}});
test('old or future snapshots cannot preserve the current-online label',async t=>{const f=await fixture(t);await f.observer.read();for(const value of [healthy(START-60000),healthy(START+60000)]){f.clock(START+6001);f.body(value);const isolated=await api({healthFile:f.file,now:()=>START+6001});try{assert.equal((await isolated.read()).state,'unknown');}finally{isolated.close();}}});
test('registered endpoint disappearance and recovery follow the same URL file instead of a stale port',async t=>{const f=await fixture(t);await f.observer.read();await rm(f.file);f.clock(START+5001);assert.equal((await f.observer.read()).state,'offline');await writeFile(f.file,f.url+'\n',{mode:0o600});f.clock(START+10002);f.body(healthy(START+10002));assert.equal((await f.observer.read()).state,'online');});
test('symlinks, public references and non-loopback or URL credential targets never trigger a request',async t=>{const f=await fixture(t);const link=join(f.directory,'link.url');await symlink(f.file,link);const candidates=[link];for(const [index,value]of ['http://example.com:12345','http://127.0.0.1:12345/private','http://user:password@127.0.0.1:12345','http://127.0.0.1:12345/?token=private'].entries()){const file=join(f.directory,'invalid'+index+'.url');await writeFile(file,value,{mode:0o600});candidates.push(file);}await chmod(f.file,0o644);candidates.push(f.file);for(const file of candidates){const observer=await api({healthFile:file,now:()=>START});try{const value=await observer.read();assert.equal(value.state,'unknown');assert.ok(!JSON.stringify(value).includes('password'));}finally{observer.close();}}assert.equal(f.calls,0);});
test('malformed, oversized or stalled health data stays unknown and does not leak server content',async t=>{
 const f=await fixture(t);
 for(const [value,reason]of [['not-json-private-detail','probe_unavailable'],['x'.repeat(70000),'invalid_health']]){
  f.body(value);let received=0;
  // Distinguish a parsed bad response from an unrelated deadline expiry.
  const fetchImpl=async(...args)=>{const response=await fetch(...args),reader=response.body.getReader();return{status:response.status,body:{getReader:()=>({async read(){const part=await reader.read();received+=part.value?.byteLength??0;return part;},cancel:()=>reader.cancel()})}};};
  const observer=await api({healthFile:f.file,now:()=>START,timeoutMs:HTTP_TIMEOUT_MS,fetchImpl});
  try{const result=await observer.read();assert.equal(result.state,'unknown');assert.equal(result.reason,reason);if(reason==='invalid_health')assert.ok(received>65536);else assert.equal(received,Buffer.byteLength(value));assert.ok(!JSON.stringify(result).includes('private-detail'));}finally{observer.close();}
 }
 f.hold(true);const observer=await api({healthFile:f.file,now:()=>START,timeoutMs:30});try{const result=await observer.read();assert.equal(result.state,'unknown');assert.equal(result.reason,'probe_unavailable');}finally{observer.close();}
});
test('closing releases a stalled probe and rejects late health as current evidence',async t=>{const f=await fixture(t);f.hold(true);const started=f.observer.read();await new Promise(resolve=>setTimeout(resolve,10));f.observer.close();const result=await started;assert.equal(result.state,'unknown');assert.equal((await f.observer.read()).state,'unknown');});
test('a failed response-delivery path cannot be shown as a healthy cloud channel',async t=>{const f=await fixture(t);const broken=healthy();broken.components['response-delivery']={status:'error',state:'failed',details:{http_status:503}};f.body(broken);assert.equal((await f.observer.read()).state,'unknown');});
test('a new runtime cannot borrow a control-plane success from before its own start',async t=>{const f=await fixture(t);const changed=healthy();changed.runtime.started_at=stamp(START-3000);changed.components['control-plane'].details.last_success=stamp(START-5000);f.body(changed);assert.equal((await f.observer.read()).state,'unknown');});
test('a registered connector child that has explicitly exited is unavailable even without a complete live identity',async t=>{const f=await fixture(t);const exited=healthy();exited.ready=false;exited.components.mcp.status='error';exited.components.mcp.details.child_state='exited';exited.components.mcp.details.initialize.identity_complete=false;f.body(exited);assert.equal((await f.observer.read()).state,'offline');});
test('a healthy cold stdio runtime waits for its first call without claiming online or a cloud interaction',async t=>{
 const f=await fixture(t);f.body(awaitingFirstCall());const waiting=await f.observer.read();
 assert.equal(waiting.state,'unknown');assert.equal(waiting.reason,'awaiting_first_call');assert.equal(waiting.source,'official_tunnel_health');assert.equal(waiting.last_connected_at,null);assert.equal(waiting.last_interaction_at,null);
 assert.deepEqual(Object.keys(waiting).sort(),['state','source','reason','checked_at','last_connected_at','last_interaction_at'].sort());
 f.clock(START+5001);f.body(healthy(START+5001));const online=await f.observer.read();assert.equal(online.state,'online');assert.equal(online.reason,'healthy');
 f.clock(START+10002);f.body(awaitingFirstCall(START+10002));const next=await f.observer.read();assert.equal(next.reason,'awaiting_first_call');assert.equal(next.last_connected_at,online.last_connected_at);assert.equal(next.last_interaction_at,online.last_interaction_at);
});
test('waiting for a first call requires precise unobserved identity and healthy current transport evidence',async t=>{
 const f=await fixture(t);const mutations=[
  ['wrong server',v=>{v.components.mcp.details.initialize.server_name='other-private-server';}],
  ['partial expected server',v=>{v.components.mcp.details.initialize.server_name='dot-dsh-connector';}],
  ['partial version',v=>{v.components.mcp.details.initialize.server_version='1.0';}],
  ['partial protocol',v=>{v.components.mcp.details.initialize.protocol_version='2025-03-26';}],
  ['partial capabilities',v=>{v.components.mcp.details.initialize.capability_names=['tools'];}],
  ['invalid capabilities',v=>{v.components.mcp.details.initialize.capability_names={};}],
  ['unrecognized array',v=>{v.components.mcp.details.initialize.other_identity=[];}],
  ['invalid server type',v=>{v.components.mcp.details.initialize.server_name=false;}],
  ['limited discovery',v=>{v.components.mcp.details.initialize.limited=true;}],
  ['successful initialization',v=>{v.components.mcp.details.initialize.ok=true;}],
  ['complete identity',v=>{v.components.mcp.details.initialize.identity_complete=true;}],
  ['missing initialize result',v=>{delete v.components.mcp.details.initialize;}],
  ['missing success flag',v=>{delete v.components.mcp.details.initialize.ok;}],
  ['missing complete flag',v=>{delete v.components.mcp.details.initialize.identity_complete;}],
  ['different child',v=>{v.components.mcp.details.evidence='different_child';}],
  ['exited child',v=>{v.components.mcp.details.child_state='exited';}],
  ['http target',v=>{v.components.mcp.details.transport='http';}],
  ['initialization failed',v=>{v.components.mcp.state='failed';}],
  ['mcp error',v=>{v.components.mcp.status='error';}],
  ['stale snapshot',v=>{v.snapshot_at=stamp(START-60000);}],
  ['future snapshot',v=>{v.snapshot_at=stamp(START+60000);}],
  ['not live',v=>{v.live=false;}],
  ['not ready',v=>{v.ready=false;}],
  ['stopping runtime',v=>{v.runtime.lifecycle='stopping';}],
  ['failed poll',v=>{v.components['control-plane'].status='error';}],
  ['unobserved poll',v=>{delete v.components['control-plane'].details.last_success;}],
  ['old poll',v=>{v.components['control-plane'].details.last_success=stamp(START-3600000);}],
  ['earlier runtime poll',v=>{v.runtime.started_at=stamp(START-3000);}],
  ['stuck poll',v=>{v.components['control-plane'].details.current_poll_age_seconds=200;}],
  ['failed retries',v=>{v.components['control-plane'].details.consecutive_failures=1;}],
  ['dispatcher stopped',v=>{v.components.dispatcher.details.accepting=false;}],
  ['dispatcher failed',v=>{v.components.dispatcher.status='error';}],
  ['delivery failed',v=>{v.components['response-delivery'].status='error';}],
 ];
 for(const [name,mutate]of mutations){const value=awaitingFirstCall();mutate(value);f.body(value);const isolated=await api({healthFile:f.file,now:()=>START});try{const result=await isolated.read();assert.notEqual(result.reason,'awaiting_first_call',name);assert.notEqual(result.state,'online',name);assert.notEqual(result.reason,'probe_unavailable',name);}finally{isolated.close();}}
});
test('an inconsistent 503 response cannot establish a ready waiting transport',async t=>{const f=await fixture(t);f.body(awaitingFirstCall());f.status(503);const result=await f.observer.read();assert.notEqual(result.reason,'awaiting_first_call');assert.notEqual(result.state,'online');});
