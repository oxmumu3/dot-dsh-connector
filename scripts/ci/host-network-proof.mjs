import {readFile,writeFile,rm} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {arch,release,version} from 'node:os';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const run=promisify(execFile),here=fileURLToPath(new URL('.',import.meta.url));
const socketProbe=`import socket,json,sys
host=sys.argv[1]
result={"address":host,"bound":False,"listened":False,"stage":"socket"}
s=None
try:
 s=socket.socket(socket.AF_INET6 if ":" in host else socket.AF_INET,socket.SOCK_STREAM)
 result["stage"]="bind";s.bind((host,0));result["bound"]=True
 result["stage"]="listen";s.listen(1);result["listened"]=True
 result["stage"]="complete"
except OSError as error:
 result.update(errno=error.errno,error=str(error))
finally:
 if s is not None:s.close()
print(json.dumps(result))`;
const bounded=value=>String(value??'').slice(0,8192);

async function observeLoopback({sandbox,cwd,env}){
 const result={};
 for(const [family,address]of [['ipv4','127.0.0.1'],['ipv6','::1']]){
  const command=sandbox?'/usr/bin/sandbox-exec':'python3';
  const args=[...sandbox?['-f',sandbox,'python3']:[],'-I','-S','-c',socketProbe,address];
  try{const {stdout}=await run(command,args,{cwd,env,timeout:3000,maxBuffer:16384});result[family]=JSON.parse(stdout);}
  catch(error){result[family]={address,probeError:true,code:error.code,signal:error.signal,stdout:bounded(error.stdout),stderr:bounded(error.stderr)};}
 }
 return result;
}

/** Diagnostics never replace, retry or relax the original hard network gate. */
export async function proveHostNetwork({sandbox,out,cwd,env}){
 for(const name of ['network-proof.json','network-failure.json','network-environment.json'])await rm(join(out,name),{force:true});
 const environment={platform:process.platform,arch:arch(),osRelease:release(),osVersion:version(),node:process.version,libuv:process.versions.uv,nodePath:process.execPath,sandboxSha256:createHash('sha256').update(await readFile(sandbox)).digest('hex'),baseline:await observeLoopback({cwd,env})};
 await writeFile(join(out,'network-environment.json'),JSON.stringify(environment,null,2)+'\n');
 try{
  const {stdout}=await run('/usr/bin/sandbox-exec',['-f',sandbox,process.execPath,join(here,'network-proof.mjs')],{cwd,env,timeout:10000,maxBuffer:65536});
  const proof=JSON.parse(stdout);await writeFile(join(out,'network-proof.json'),JSON.stringify(proof,null,2)+'\n');return proof;
 }catch(error){
  // Family-specific observations explain failure only. Even if they succeed,
  // the failed gate is rethrown and the actual Host must not start.
  const failure={...environment,gatePassed:false,code:error.code,signal:error.signal,stdout:bounded(error.stdout),stderr:bounded(error.stderr),sandboxLoopback:await observeLoopback({sandbox,cwd,env})};
  try{await writeFile(join(out,'network-failure.json'),JSON.stringify(failure,null,2)+'\n');}
  catch(writeError){error.networkDiagnosticWriteError={code:writeError.code,message:bounded(writeError.message)};}
  throw error;
 }
}
