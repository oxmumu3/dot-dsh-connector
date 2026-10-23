#!/usr/bin/env node
/** Official Tunnel stdio command: credentials stay in this private Node environment. */
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {managedMcpEnvironment} from '../src/setup-runtime.js';
try{
 if(process.argv.length!==4||process.argv[2]!=='--data-dir')throw new Error('configuration');
 const env=await managedMcpEnvironment(process.argv[3]);
 const child=spawn(process.execPath,[fileURLToPath(new URL('../runtime/scripts/mcp.mjs',import.meta.url))],{stdio:'inherit',env:{PATH:process.env.PATH??'/usr/bin:/bin',...env},shell:false});
 process.once('SIGINT',()=>child.kill('SIGINT'));process.once('SIGTERM',()=>child.kill('SIGTERM'));
 child.once('error',()=>{process.stderr.write('Dot DSH MCP: local runtime unavailable.\n');process.exitCode=1;});
 child.once('exit',code=>{process.exitCode=code??1;});
}catch{process.stderr.write('Dot DSH MCP: prepare local setup before connecting the official private Tunnel.\n');process.exitCode=1;}
