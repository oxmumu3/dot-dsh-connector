import {writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {createManagementRemote} from '../management-plugin/src/remote.js';
import {createManagementUI,managementClientFactory,createNativeWorker} from '../management-plugin/src/client.js';

/** No duplicate React runtime or dependencies: publish the official lazy factory protocol. */
export async function buildManagementUi(){
 const destination=new URL('../management-plugin/lib/client.js',import.meta.url);
 const body=`// Built by scripts/build-management-ui.mjs; shared React and Zod come from DSH.\nwindow.__ModuleLoader__.load({id:'dot-dsh-management',factory:(require)=>(${managementClientFactory.toString()})(require,${createManagementRemote.toString()},${createManagementUI.toString()},${createNativeWorker.toString()})});\n`;
 await mkdir(new URL('../management-plugin/lib/',import.meta.url),{recursive:true});await writeFile(destination,body);
 return {path:fileURLToPath(destination),bytes:Buffer.byteLength(body),sha256:createHash('sha256').update(body).digest('hex')};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const result=await buildManagementUi();process.stdout.write(JSON.stringify({bytes:result.bytes,sha256:result.sha256})+'\n');
}
