// Runs only the synthetic full local-loop scenario, with real MCP client/stdio/HTTP/disk.
// The test source owns temporary fixtures and cleanup; no real DSH or model is started.
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const path=fileURLToPath(new URL('../test/integration.test.mjs',import.meta.url));
console.log('SYNTHETIC DEMO: real MCP/HTTP/storage; deterministic executor; no Dot, DSH model or user acceptance.');
const child=spawn(process.execPath,['--max-old-space-size=128','--test','--test-concurrency=1',path],{stdio:'inherit'});
child.on('exit',code=>{process.exitCode=code??1;});
