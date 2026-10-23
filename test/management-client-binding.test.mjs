import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

test('the complete browser factory uses its mounted Remote namespace from a real injected plugin scope',async t=>{
 const executable='/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness';
 try{await stat(executable);}catch{t.skip('Public native SDK unavailable');return;}
 const packagePath=fileURLToPath(new URL('../package.json',import.meta.url));
 const clientUrl=new URL('../management-plugin/src/client.js',import.meta.url).href;
 const source=`
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const sdk='/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/';
const [{Context,Service},{default:Registry},gateway,{managementClientFactory}]=await Promise.all([
 import(sdk+'@deepseek-ai/cordis/lib/index.js'),
 import(sdk+'@deepseek-ai/dsh-typert-registry/lib/index.js'),
 import(sdk+'@deepseek-ai/dsh-api-gateway/lib/client.node.js'),
 import(${JSON.stringify(clientUrl)}),
]);
const require=createRequire(${JSON.stringify(packagePath)}),React=require('react'),{act,create}=require('react-test-renderer');
const host=new Context(),registrations=[],calls=[];
const value={connection:{state:'connected',task_backend:'online',read_backend:'online'},admission:{paused:false},audit:{events_total:0,jobs_total:0},recent_events:[]};
class Slots extends Service{
 constructor(ctx){super(ctx,'slots');}
 inject(name,register){return register();}
 register(options,component){const entry={options,component};registrations.push(entry);return this.ctx.effect(()=>()=>{const index=registrations.indexOf(entry);if(index>=0)registrations.splice(index,1);});}
}
new Slots(host);
host.provide('connection',{interactions:'none',rpc:{open(){throw new Error('Unexpected synthetic stream');},async call(path,endpoint,payload){calls.push({path,endpoint,payload});return{ok:true,value:endpoint.endsWith('/jobs')?{items:[],total:0,next_offset:null}:endpoint.endsWith('/setupStatus')?{mode:'external',phase:'external',services:{reader:'external',manager:'external'},actions:{}}:value};}},start(){throw new Error('Unexpected synthetic transport');},openWebSocket(){throw new Error('Unexpected synthetic transport');}});
let tree;
try{
 await host.plugin(Registry);await host.plugin(gateway);
 const api=managementClientFactory(require),plugin=host.plugin(api);await plugin;
 const Page=registrations.find(entry=>entry.options.name==='main')?.component;
 assert.equal(typeof Page,'function');
 await act(async()=>{tree=create(React.createElement(Page));});
 const nodeText=node=>typeof node==='string'||typeof node==='number'?String(node):Array.isArray(node)?node.map(nodeText).join(''):node?.type==='style'?'':nodeText(node?.children??[]);
 const text=nodeText(tree.toJSON());
 console.log(JSON.stringify({overviewReached:calls.some(call=>call.endpoint==='dotDshManagement/overview'),remoteThrew:text.includes('dot-management/remote-threw')}));
 assert.match(text,/本机已就绪/);
 assert.deepEqual(JSON.parse(JSON.stringify(calls)),[{path:'/api',endpoint:'dotDshManagement/overview',payload:{args:{request:{include_control:false}}}},{path:'/api',endpoint:'dotDshManagement/jobs',payload:{args:{request:{offset:0,limit:4}}}},{path:'/api',endpoint:'dotDshManagement/setupStatus',payload:{args:{request:{}}}}]);
 assert.equal(registrations.filter(entry=>entry.options.name==='main').length,1);
 await act(async()=>tree.unmount());tree=null;
 await plugin.dispose();
 assert.equal(registrations.length,0);assert.equal(host.get('remote.dotDshManagement'),undefined);
}finally{if(tree)await act(async()=>tree.unmount());await host.fiber.dispose();}
`;
 const {stdout}=await promisify(execFile)(executable,['--input-type=module','--eval',source],{env:{PATH:process.env.PATH,ELECTRON_RUN_AS_NODE:'1'},timeout:30000,maxBuffer:1024*1024});
 assert.deepEqual(JSON.parse(stdout.trim()),{overviewReached:true,remoteThrew:false});
});
