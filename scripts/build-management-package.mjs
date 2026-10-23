import {readdir,mkdir,copyFile,writeFile,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';import {resolve,join} from 'node:path';
import {buildManagementUi} from './build-management-ui.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
/** Copy only repository code into the native bundle. Never inspect a profile or user state. */
export async function buildManagementPackage(){
 const destination=join(root,'management-plugin','runtime');await rm(destination,{recursive:true,force:true});await mkdir(join(destination,'src'),{recursive:true});await mkdir(join(destination,'scripts'),{recursive:true});
 const sources=await readdir(join(root,'src'));for(const file of sources.filter(v=>v.endsWith('.js')))await copyFile(join(root,'src',file),join(destination,'src',file));
 const scripts=['harness-read.mjs','management.mjs','mcp.mjs','read-harness-files.py','read-harness-storage.py','read-context.py'];
 for(const file of scripts)await copyFile(join(root,'scripts',file),join(destination,'scripts',file));
 await writeFile(join(destination,'package.json'),JSON.stringify({private:true,type:'module'})+'\n');
 await copyFile(join(root,'THIRD_PARTY_NOTICES.md'),join(root,'management-plugin','THIRD_PARTY_NOTICES.md'));
 const licenses=join(root,'management-plugin','third-party-licenses');await mkdir(licenses,{recursive:true});for(const file of await readdir(join(root,'third-party-licenses')))await copyFile(join(root,'third-party-licenses',file),join(licenses,file));
 const ui=await buildManagementUi();return{runtime_files:sources.filter(v=>v.endsWith('.js')).length+scripts.length+1,client_bytes:ui.bytes,client_sha256:ui.sha256};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))process.stdout.write(JSON.stringify(await buildManagementPackage())+'\n');
