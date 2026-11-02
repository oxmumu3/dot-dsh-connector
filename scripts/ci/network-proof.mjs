import assert from 'node:assert/strict';
import {createServer,connect} from 'node:net';
import {execFile} from 'node:child_process';
const server=createServer(socket=>socket.end('synthetic-loopback'));
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
try{
 const data=await new Promise((resolve,reject)=>{const socket=connect(server.address().port,'127.0.0.1');let data='';socket.on('data',value=>data+=value);socket.once('end',()=>resolve(data));socket.once('error',reject);socket.setTimeout(2000,()=>socket.destroy(Error('loopback probe timed out')));});assert.equal(data,'synthetic-loopback');
 let lookupCalled=false;
 const code=await new Promise((resolve,reject)=>{const socket=connect({host:'localhost',port:443,autoSelectFamily:false,lookup(_host,_options,callback){lookupCalled=true;callback(null,'192.0.2.1',4);}});socket.once('connect',()=>{socket.destroy();reject(Error('Non-loopback socket was admitted'));});socket.once('error',error=>resolve(error.code));socket.setTimeout(1000,()=>socket.destroy(Error('Network isolation could not be established')));});
 assert.equal(lookupCalled,true);
 assert.ok(['EPERM','EACCES','ENETUNREACH','EHOSTUNREACH'].includes(code),'Missing hard non-loopback denial: '+code);
 const python='import socket,errno,json\ns=socket.socket();s.settimeout(1)\ntry:\n s.connect(("192.0.2.1",443));raise AssertionError("Child escaped network isolation")\nexcept OSError as e:\n assert e.errno in (errno.EPERM,errno.EACCES,errno.ENETUNREACH,errno.EHOSTUNREACH),str(e)\n print(json.dumps({"denied":True,"errno":e.errno}))\nfinally:\n s.close()';
 const child=await new Promise((resolve,reject)=>execFile('python3',['-I','-S','-c',python],{env:{PATH:process.env.PATH,HOME:process.env.HOME},timeout:3000,maxBuffer:65536},(error,stdout)=>error?reject(error):resolve(JSON.parse(stdout))));assert.equal(child.denied,true);
 console.log(JSON.stringify({platform:process.platform,loopback:true,loopbackListenAddress:server.address().address,nonLoopbackDenied:true,denial:code,customLookupDenied:true,nonNodeChildDenied:true,childErrno:child.errno,desktopOnboardingVerified:false}));
}finally{await new Promise(resolve=>server.close(resolve));}
