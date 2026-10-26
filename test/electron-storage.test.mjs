import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';

const executable='/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness';
test('installed Electron reads released persisted codecs without disabling ASAR virtualization',{
 skip:!existsSync(executable)?'Official desktop application is not installed':false,
 timeout:30000,
},async()=>{
 const {stdout}=await promisify(execFile)(executable,['--test','test/harness-storage.test.mjs'],{
  cwd:fileURLToPath(new URL('..',import.meta.url)),
  env:{PATH:process.env.PATH??'/usr/bin:/bin',ELECTRON_RUN_AS_NODE:'1'},
  timeout:25000,maxBuffer:1024*1024,
 });
 assert.match(stdout,/tests 15/);
 assert.match(stdout,/pass 15/);
 assert.match(stdout,/fail 0/);
});
