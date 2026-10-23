import http from 'node:http';
import {createHash,timingSafeEqual} from 'node:crypto';

const ORIGIN='dsh-app://app',TIMEOUT_MS=10000,RESPONSE_LIMIT=1024*1024;
const ROUTES=new Map([['/native/claim',{method:'claim',token:'claim_token',keys:['command_id','claim_token','client_id'],limit:64*1024}],['/native/report',{method:'report',token:'lease_token',keys:['command_id','lease_token','client_id','result'],limit:256*1024}]]);
const ERRORS=Object.freeze({
 NATIVE_DENIED:{status:403,message:'Native worker access denied.'},
 NATIVE_INVALID:{status:400,message:'Invalid native worker request.'},
 NATIVE_CONFLICT:{status:409,message:'Native worker request conflicts with existing state.'},
 NATIVE_UNAVAILABLE:{status:503,message:'Native worker is unavailable.'},
 NATIVE_CAPACITY:{status:503,message:'Native worker capacity is unavailable.'},
});
const COUNTED_HEADERS=new Set(['host','origin','authorization','content-type','content-length','transfer-encoding','content-encoding','access-control-request-method','access-control-request-headers','access-control-request-private-network']);
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;
const validIdentifier=value=>typeof value==='string'&&value.length>0&&value.length<=200;
const validToken=value=>typeof value==='string'&&value.length>=32&&value.length<=512&&/^[A-Za-z0-9._~+/=-]+$/.test(value);
const failure=code=>Object.assign(new Error(ERRORS[code].message),{code});
const digest=value=>createHash('sha256').update(value).digest();
function safeCode(error){try{return Object.hasOwn(ERRORS,error?.code)?error.code:'NATIVE_UNAVAILABLE';}catch{return'NATIVE_UNAVAILABLE';}}
function envelope(value,route){
 return plain(value)&&Object.keys(value).length===route.keys.length&&route.keys.every(key=>Object.hasOwn(value,key))
  &&validIdentifier(value.command_id)&&validIdentifier(value.client_id)&&validToken(value[route.token])
  &&(route.method!=='report'||plain(value.result));
}
function duplicated(req){
 const counts=new Map();
 for(let i=0;i<req.rawHeaders.length;i+=2){const key=req.rawHeaders[i].toLowerCase();if(COUNTED_HEADERS.has(key))counts.set(key,(counts.get(key)??0)+1);}
 return [...counts.values()].some(count=>count!==1);
}
function send(res,status,payload,cors=false,extra={}){
 if(res.destroyed||res.writableEnded)return;
 let body='';
 if(status!==204){
  try{body=JSON.stringify(payload);if(typeof body!=='string'||Buffer.byteLength(body)>RESPONSE_LIMIT)throw failure('NATIVE_UNAVAILABLE');}
  catch{status=503;body=JSON.stringify({error:{code:'NATIVE_UNAVAILABLE',message:ERRORS.NATIVE_UNAVAILABLE.message}});}
 }
 res.writeHead(status,{'content-type':'application/json; charset=utf-8','content-length':Buffer.byteLength(body),'cache-control':'no-store','x-content-type-options':'nosniff',connection:'close',...(cors?{'access-control-allow-origin':ORIGIN,vary:'Origin'}:{}),...extra});
 res.end(body);
}
const reject=(res,code,cors=false,status=ERRORS[code].status)=>send(res,status,{error:{code,message:ERRORS[code].message}},cors);
function preflight(req,res,cors){
 const requested=req.headers['access-control-request-headers'];
 const names=typeof requested==='string'?requested.split(',').map(value=>value.trim().toLowerCase()):[];
 const privateNetwork=req.headers['access-control-request-private-network'];
 if(req.headers['access-control-request-method']!=='POST'||!names.length||names.length>2||new Set(names).size!==names.length||names.some(value=>!['content-type','authorization'].includes(value))||(privateNetwork!==undefined&&privateNetwork!=='true'))return reject(res,'NATIVE_DENIED',cors);
 send(res,204,null,cors,{'access-control-allow-methods':'POST','access-control-allow-headers':'content-type, authorization',...(privateNetwork==='true'?{'access-control-allow-private-network':'true'}:{})});
}
function readBody(req,limit,signal){
 return new Promise((resolve,rejectRead)=>{
  let size=0;const chunks=[];
  const cleanup=()=>{req.off('data',onData);req.off('end',onEnd);req.off('error',onError);req.off('aborted',onError);signal.removeEventListener('abort',onAbort);};
  const finish=(error,value)=>{cleanup();if(error){req.resume();rejectRead(error);}else resolve(value);};
  const onError=()=>finish(failure('NATIVE_INVALID'));
  const onAbort=()=>finish(failure('NATIVE_UNAVAILABLE'));
  const onData=chunk=>{size+=chunk.length;if(size>limit)finish(Object.assign(failure('NATIVE_INVALID'),{status:413}));else chunks.push(chunk);};
  const onEnd=()=>{try{finish(null,new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}catch{finish(failure('NATIVE_INVALID'));}};
  req.on('data',onData);req.once('end',onEnd);req.once('error',onError);req.once('aborted',onError);signal.addEventListener('abort',onAbort,{once:true});
  if(signal.aborted)onAbort();
 });
}

/** Fixed native-worker transport. Capability validity and replay semantics remain in control. */
export async function createNativeWorkerServer(options){
 let control,port;
 try{
  if(!plain(options)||Object.keys(options).some(key=>!['control','port'].includes(key)))throw failure('NATIVE_INVALID');
  ({control,port=31474}=options);
  if(typeof control?.claim!=='function'||typeof control?.report!=='function'||!Number.isInteger(port)||port<0||port>65535)throw failure('NATIVE_INVALID');
 }catch{throw failure('NATIVE_INVALID');}
 let expectedHost,closing=false,closePromise;
 const active=new Set();
 const server=http.createServer({maxHeaderSize:8192},async(req,res)=>{
  let cors=false;
  try{
   if(closing||req.headers.host!==expectedHost||req.headers.origin!==ORIGIN||duplicated(req))return reject(res,'NATIVE_DENIED');
   cors=true;
   const route=ROUTES.get(req.url);
   if(!route)return reject(res,'NATIVE_INVALID',cors,404);
   if(req.method==='OPTIONS')return preflight(req,res,cors);
   if(req.method!=='POST')return reject(res,'NATIVE_INVALID',cors,405);
   if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type']??'')||req.headers['content-encoding']!==undefined)return reject(res,'NATIVE_INVALID',cors,415);
   if(Number(req.headers['content-length'])>route.limit)return reject(res,'NATIVE_INVALID',cors,413);
   const lifetime=new AbortController();const cancel=()=>lifetime.abort();
   active.add(cancel);res.once('close',cancel);
   const timer=setTimeout(cancel,TIMEOUT_MS);
   let abortListener;
   try{
    const cancelled=new Promise((_,rejectCancel)=>{abortListener=()=>rejectCancel(failure('NATIVE_UNAVAILABLE'));lifetime.signal.addEventListener('abort',abortListener,{once:true});});
    const work=async()=>{
     let value;
     try{value=JSON.parse(await readBody(req,route.limit,lifetime.signal));}catch(error){if(error?.status===413)return{status:413,payload:{error:{code:'NATIVE_INVALID',message:ERRORS.NATIVE_INVALID.message}}};throw failure(error?.code==='NATIVE_UNAVAILABLE'?'NATIVE_UNAVAILABLE':'NATIVE_INVALID');}
     if(!envelope(value,route))return{status:400,payload:{error:{code:'NATIVE_INVALID',message:ERRORS.NATIVE_INVALID.message}}};
     const auth=req.headers.authorization;
     if(typeof auth!=='string'||auth.length>519||!timingSafeEqual(digest(auth),digest(`Bearer ${value[route.token]}`)))return{status:401,payload:{error:{code:'NATIVE_DENIED',message:ERRORS.NATIVE_DENIED.message}}};
     const result=await control[route.method](value);
     return{status:200,payload:{result}};
    };
    const response=await Promise.race([work(),cancelled]);send(res,response.status,response.payload,cors);
   }catch(error){reject(res,safeCode(error),cors);}
   finally{clearTimeout(timer);active.delete(cancel);res.off('close',cancel);lifetime.signal.removeEventListener('abort',abortListener);req.resume();}
  }catch{reject(res,'NATIVE_UNAVAILABLE',cors);}
 });
 server.requestTimeout=TIMEOUT_MS;server.headersTimeout=TIMEOUT_MS;server.maxHeadersCount=32;server.maxRequestsPerSocket=1;
 server.on('clientError',(_error,socket)=>{
  if(!socket.writable)return socket.destroy();
  const body=JSON.stringify({error:{code:'NATIVE_INVALID',message:ERRORS.NATIVE_INVALID.message}});
  socket.end(`HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Type: application/json; charset=utf-8\r\nCache-Control: no-store\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
 });
 await new Promise((resolve,rejectListen)=>{
  const failed=()=>rejectListen(failure('NATIVE_UNAVAILABLE'));
  server.once('error',failed);server.listen(port,'127.0.0.1',()=>{server.off('error',failed);resolve();});
 });
 expectedHost=`127.0.0.1:${server.address().port}`;
 return{url:`http://${expectedHost}`,close(){
  if(closePromise)return closePromise;
  closing=true;for(const cancel of active)cancel();
  closePromise=new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});return closePromise;
 }};
}
