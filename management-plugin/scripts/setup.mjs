#!/usr/bin/env node
import {createManagedRuntime} from '../src/setup-runtime.js';
const args=process.argv.slice(2),command=args.shift();
if(command==='--help'){
 process.stdout.write('Usage: dot-dsh-setup status|prepare|start [--dsh-home /canonical/harness-home] [--data-dir /canonical/private-directory]\nPrepare also accepts --cloud-health-file /canonical/registered-tunnel.url to retain an existing official Tunnel health URL file reference. Stop the owned local service before changing this reference; no Tunnel is created or adopted.\nStart runs in this foreground process. Ctrl-C stops its own resources. In the native plugin, use local setup controls. Disable/uninstall preserves records; unknown runtime locks are never removed automatically.\n');
}else{
 let runtime;
 try{
  if(!['status','prepare','start'].includes(command)||args.length%2)throw new Error('arguments');const options={};
  for(let index=0;index<args.length;index+=2){const key={'--dsh-home':'dshHome','--data-dir':'dataDir','--cloud-health-file':'cloudHealthFile'}[args[index]];if(!key||options[key]!==undefined||key==='cloudHealthFile'&&command!=='prepare')throw new Error('arguments');options[key]=args[index+1];}
  runtime=createManagedRuntime(options);let finished;const lifetime=new Promise(resolve=>finished=resolve);
  process.once('SIGINT',()=>{void runtime.stop().finally(finished);});process.once('SIGTERM',()=>{void runtime.close().finally(finished);});
  const state=await runtime[command]();process.stdout.write(JSON.stringify(state,null,2)+'\n');
  if(state.phase==='blocked')process.exitCode=1;
  else if(command==='start')await lifetime;
 }catch{process.stderr.write('Dot DSH setup: invalid arguments or local setup failure. Use --help.\n');process.exitCode=1;}
 finally{await runtime?.close();}
}
