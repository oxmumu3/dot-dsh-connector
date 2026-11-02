import assert from 'node:assert/strict';
import {createServer,connect} from 'node:net';
const server=createServer(socket=>socket.end('synthetic-loopback'));
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
try{
 const data=await new Promise((resolve,reject)=>{const socket=connect(server.address().port,'127.0.0.1');let data='';socket.on('data',value=>data+=value);socket.once('end',()=>resolve(data));socket.once('error',reject);socket.setTimeout(2000,()=>socket.destroy(Error('loopback probe timed out')));});assert.equal(data,'synthetic-loopback');
 const code=await new Promise((resolve,reject)=>{const socket=connect(443,'192.0.2.1');socket.once('connect',()=>{socket.destroy();reject(Error('Non-loopback socket was admitted'));});socket.once('error',error=>resolve(error.code));socket.setTimeout(1000,()=>socket.destroy(Error('Network isolation could not be established')));});
 assert.ok(['EPERM','EACCES','ENETUNREACH','EHOSTUNREACH'].includes(code),'Missing hard non-loopback denial: '+code);
 console.log(JSON.stringify({platform:process.platform,loopback:true,nonLoopbackDenied:true,denial:code,desktopOnboardingVerified:false}));
}finally{await new Promise(resolve=>server.close(resolve));}
