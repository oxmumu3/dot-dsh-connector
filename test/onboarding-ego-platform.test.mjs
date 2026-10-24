import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,realpath,writeFile,readFile,stat,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
const api=await import('../management-plugin/src/onboarding-ego-platform.js').catch(()=>({}));
const identity={directory:'/private/synthetic/onboarding',runtimeKeyFile:'/private/synthetic/onboarding/runtime.key',installationId:'a'.repeat(32),tunnelName:'dsh-dot-'+'a'.repeat(32),state:{}};
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
async function phase(observation,extra={}){assert.equal(typeof api.buildEgoPlatformPhaseScript,'function');const actions=[];const page={url:async()=>extra.url??'https://platform.openai.com/settings/organization/tunnels',evaluate:async()=>observation,click:async s=>actions.push(['click',s]),fill:async(s,v)=>actions.push(['fill',s,v]),goto:async url=>actions.push(['goto',url]),keyboard:{press:async key=>actions.push(['press',key])}};const script=api.buildEgoPlatformPhaseScript({...identity,...extra});const result=await new AsyncFunction('page',script)(page);return{result,actions,script};}
test('existing matching tunnel draft is preserved and records intent without final Create',async()=>{const{result,actions}=await phase({kind:'tunnel_draft',name:identity.tunnelName});assert.equal(result.patch.tunnel_intent,true);assert.equal(result.step,'tunnel_confirm');assert.deepEqual(actions,[]);});
test('foreign tunnel draft fails closed without navigation or edit',async()=>{await assert.rejects(phase({kind:'tunnel_draft',name:'someone-else'}),{code:'ONBOARDING_PAGE_CHANGED'});});
test('real exact tunnel receipt retains workspace but does not claim key saved',async()=>{const{result}=await phase({kind:'tunnel_ready',tunnel_id:'tunnel_1234567890abcdef',tunnel_name:identity.tunnelName,workspace_id:'12345678-1234-1234-1234-123456789012'});assert.equal(result.status,'tunnel_ready');assert.equal(result.key_saved,undefined);});
test('Google rejected is precise and excludes ordinary challenge',async()=>{await assert.rejects(phase({}, {url:'https://accounts.google.com/v3/signin/rejected?private=secret'}),e=>e.code==='ONBOARDING_AUTH_BROWSER_REJECTED'&&!e.message.includes('private'));const{result,actions}=await phase({}, {url:'https://accounts.google.com/v3/signin/challenge'});assert.equal(result.step,'platform_login');assert.deepEqual(actions,[]);});
test('an explicitly resumed Google rejection returns only to the official Platform entry and hands control back',async()=>{
 for(const state of [{},{tunnel_id:'tunnel_1234567890abcdef'}]){
  const {result,actions}=await phase({}, {url:'https://accounts.google.com/v3/signin/rejected?private=secret',recoverRejected:true,state});
  assert.deepEqual(actions,[['goto','https://platform.openai.com/settings/organization/'+(state.tunnel_id?'api-keys':'tunnels')]]);assert.deepEqual(result,{status:'pending',step:'platform_login',waiting_for:'login'});
 }
 for(const url of ['https://accounts.google.com/v3/signin/challenge','https://accounts.google.com.attacker.invalid/v3/signin/rejected']){const{result,actions}=await phase({}, {url,recoverRejected:true});assert.equal(result.step,'platform_login');assert.deepEqual(actions,[]);}
 assert.throws(()=>api.buildEgoPlatformPhaseScript({...identity,recoverRejected:'yes'}));
});
test('key save without recorded creation intent refuses capture',async()=>{await assert.rejects(phase({kind:'key_saved_dialog'}),{code:'ONBOARDING_KEY_RECOVERY'});});
test('uncertain prior tunnel creation never creates another without complete-table evidence',async()=>{const{result,actions}=await phase({kind:'tunnel_list',complete:false,createSelector:'loc=css:#create'},{state:{tunnel_intent:true}});assert.equal(result.status,'pending');assert.deepEqual(actions,[]);});
test('key intent alone cannot capture a newly displayed unrelated save dialog',async()=>{await assert.rejects(phase({kind:'key_saved_dialog'},{state:{key_intent:true,tunnel_id:'tunnel_1234567890abcdef'}}),{code:'ONBOARDING_KEY_RECOVERY'});});
const tunnelId='tunnel_1234567890abcdef',organizationId='org-1234567890abcdef',workspaceId='12345678-1234-1234-1234-123456789012';
async function actualTablePhase(targetValues,{extraRows=[],nestedValues=[]}={}){
 const element=textContent=>({textContent,getClientRects:()=>[{}],getAttribute:()=>null});
 const makeRow=(name,values,nested=[])=>{const row=element(name+'Description'+values.join('')),cells=[element(name+'Description'),...values.map(element)],nameSpan=element(name),foreign={};for(const cell of cells)cell.closest=()=>row;const nestedCells=nested.map(value=>({...element(value),closest:()=>foreign}));row.querySelectorAll=selector=>selector.includes('span,div')?[...cells,nameSpan,...nestedCells]:selector.includes('[role="cell"]')?[...cells,...nestedCells]:[];return row;};
 const rows=[makeRow(identity.tunnelName,targetValues,nestedValues),...extraRows.map(item=>makeRow(item.name,item.values))];const doc={querySelectorAll:selector=>selector==='tr,[role="row"]'?rows:[]};
 const previous={document:globalThis.document,location:globalThis.location,getComputedStyle:globalThis.getComputedStyle};
 try{globalThis.document=doc;globalThis.location={pathname:'/settings/organization/tunnels'};globalThis.getComputedStyle=()=>({display:'block',visibility:'visible'});const page={url:async()=> 'https://platform.openai.com/settings/organization/tunnels',evaluate:async(fn,input)=>fn(input)};return await new AsyncFunction('page',api.buildEgoPlatformPhaseScript(identity))(page);}
 finally{for(const[key,value]of Object.entries(previous)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}}
}
test('actual DOM cells parse IDs despite adjacent row text having no separators',async()=>{
 const result=await actualTablePhase([tunnelId,'2026年10月23日',organizationId,workspaceId,'Creator','']);assert.deepEqual(result,{status:'tunnel_ready',tunnel_id:tunnelId,tunnel_name:identity.tunnelName,workspace_id:workspaceId,organization_id:organizationId});
 const padded=await actualTablePhase([' '+tunnelId+' ','2026年10月23日','\n'+organizationId+'\n',' '+workspaceId+' ']);assert.equal(padded.tunnel_id,tunnelId);assert.equal(padded.organization_id,organizationId);
});
test('only exact target-row cells contribute IDs; adjacent or nested foreign rows are ignored',async()=>{
 const result=await actualTablePhase([tunnelId,'date',organizationId,workspaceId],{extraRows:[{name:'Other tunnel',values:['tunnel_ffffffffffffffff','org-ffffffffffffffff','ffffffff-ffff-ffff-ffff-ffffffffffff']}],nestedValues:['org-eeeeeeeeeeeeeeee','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee']});assert.equal(result.workspace_id,workspaceId);assert.equal(result.organization_id,organizationId);
 const pending=await actualTablePhase([tunnelId,'date',organizationId],{extraRows:[{name:'Other tunnel',values:[workspaceId]}]});assert.equal(pending.step,'tunnel_scope');assert.equal(pending.tunnel_id,undefined);
});
test('ambiguous workspace organization or tunnel ID cells fail closed',async()=>{
 for(const extra of ['ffffffff-ffff-ffff-ffff-ffffffffffff','org-ffffffffffffffff','tunnel_ffffffffffffffff',workspaceId,organizationId])await assert.rejects(actualTablePhase([tunnelId,'date',organizationId,workspaceId,extra]),{code:'ONBOARDING_PAGE_CHANGED'});
});
test('an ID embedded in a longer cell is not treated as an exact identifier',async()=>{
 await assert.rejects(actualTablePhase(['prefix '+tunnelId,'date',organizationId,workspaceId]),{code:'ONBOARDING_PAGE_CHANGED'});
 const result=await actualTablePhase([tunnelId,'date',organizationId,'workspace '+workspaceId]);assert.equal(result.step,'tunnel_scope');assert.equal(result.workspace_id,undefined);
});
async function actualPopoverPhase({kind='permissions',unrelated=false,foreignResource=false,invalidOption=false,secondMain=false,extraDialog=false,plainLabel=false,foreignScope=false,duplicateLabel=false,duplicateTrigger=false,closedTrigger=false,duplicateOption=false,readSelected=false,useSelected=false,projectOptions=1}={}){
 const byId=new Map();const el=(textContent='',attrs={})=>{const value={textContent,id:attrs.id??'',children:[],map:{},tagName:attrs.tagName??'DIV',getAttribute:key=>attrs[key]??null,getClientRects:()=>[{}],querySelectorAll(selector){return this.map[selector]??[];},querySelector(selector){return this.querySelectorAll(selector)[0]??null;}};if(value.id)byId.set(value.id,value);return value;};
 const main=el('',{id:'main-form'}),popup=el('',{id:'permission-popover'}),list=el('',{id:'options-list','aria-multiselectable':kind==='permissions'?'true':'false'}),field={...el(),value:identity.tunnelName+'-runtime'},restricted=el('Restricted',{'aria-checked':'true'});
 const trigger=el(kind==='permissions'?'None':kind==='project'?'Select project...':'Expiry 7 days',{id:'expanded-trigger','aria-haspopup':'dialog','aria-expanded':closedTrigger?'false':'true','aria-controls':unrelated?'some-other-popover':popup.id});
 const label=el(foreignResource?'Other resource':'Tunnels'),other=el('Other'),scopeControl=kind==='permissions'?trigger:el('All selected');
 const row=el(),otherRow=el(),container={children:[row,otherRow]};label.parentElement=row;scopeControl.parentElement=row;row.parentElement=container;
 row.map[':scope > button']=[label];row.map[':scope > button[disabled]']=[label];row.map[':scope > [role="button"][aria-haspopup="dialog"]']=[scopeControl];row.map['[role="button"][aria-haspopup="dialog"],button[aria-haspopup="dialog"]']=[scopeControl];
 otherRow.map[':scope > button']=duplicateLabel?[other,el('Duplicate')]:[other];otherRow.map[':scope > button[disabled]']=plainLabel?[]:[other];otherRow.map[':scope > [role="button"][aria-haspopup="dialog"]']=[el(foreignScope?'All selected':'None')];
 const options=kind==='permissions'?[el('Read',{id:'read-option','data-option-id':'api.organization.tunnel.read','aria-selected':readSelected?'true':'false'}),el('Use',{id:'use-option','data-option-id':invalidOption?'api.organization.other.write':duplicateOption?'api.organization.tunnel.read':'api.organization.tunnel.use','aria-selected':useSelected?'true':'false'})]:kind==='project'?Array.from({length:projectOptions},(_,i)=>el('Project '+i,{id:i?'project-option-'+i:'project-option'})):[el('30 days',{id:'expiry-option'})];
 list.map['[role="option"]']=options;popup.map['[role="listbox"]']=[list];popup.map['[role="listbox"][aria-multiselectable="true"]']=kind==='permissions'?[list]:[];
 main.map['input[placeholder="My Test Key"]']=[field];main.map['[aria-controls]']=duplicateTrigger?[trigger,trigger]:[trigger];main.map['[role="radio"],input[type="radio"]']=[restricted];main.map['button']=[label,other];main.map['button[disabled]']=[label];main.map['*']=[el('2 selected permissions')];main.map['button,[role="button"]']=kind==='permissions'?[]:[trigger];main.map['input#project-key-expiration']=[{value:'7'}];
 if(secondMain)popup.map['input[placeholder="My Test Key"]']=[field];
 const doc={documentElement:{},querySelectorAll:selector=>selector==='[role="dialog"],dialog[open]'?[main,popup,...extraDialog?[el()]:[]]:selector==='[role="listbox"][aria-multiselectable="true"]'&&kind==='permissions'?[list]:selector==='[role="option"]'?options:selector.startsWith('#')?[byId.get(selector.slice(1))].filter(Boolean):[],getElementById:id=>byId.get(id)};
 const previous={document:globalThis.document,location:globalThis.location,getComputedStyle:globalThis.getComputedStyle,CSS:globalThis.CSS};const actions=[];
 try{globalThis.document=doc;globalThis.location={pathname:'/settings/organization/api-keys'};globalThis.getComputedStyle=()=>({display:'block',visibility:'visible'});globalThis.CSS={escape:value=>value};const page={url:async()=> 'https://platform.openai.com/settings/organization/api-keys',evaluate:async(fn,input)=>fn(input),click:async selector=>actions.push(selector),keyboard:{press:async key=>actions.push(key)}};const result=await new AsyncFunction('page',api.buildEgoPlatformPhaseScript({...identity,state:{tunnel_id:tunnelId}}))(page);return{result,actions};}
 finally{for(const[key,value]of Object.entries(previous)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}}
}
test('exact aria-controls-linked Tunnels permissions popover is valid beside the main key form',async()=>{const{result,actions}=await actualPopoverPhase();assert.equal(result.step,'key_confirm');assert.deepEqual(actions,['loc=css:#read-option']);});
test('linked permission menu resumes from its selected state then closes without a grant',async()=>{assert.deepEqual((await actualPopoverPhase({readSelected:true})).actions,['loc=css:#use-option']);assert.deepEqual((await actualPopoverPhase({readSelected:true,useSelected:true})).actions,['Escape']);});
test('only the linked project or expiry popover is accepted for its exact main-form control',async()=>{assert.deepEqual((await actualPopoverPhase({kind:'project'})).actions,['loc=css:#project-option']);assert.deepEqual((await actualPopoverPhase({kind:'expiry'})).actions,['loc=css:#expiry-option']);});
test('linked project menu with multiple choices waits for the user',async()=>{const{result,actions}=await actualPopoverPhase({kind:'project',projectOptions:2});assert.equal(result.waiting_for,'project');assert.deepEqual(actions,[]);});
test('unrelated ambiguous or foreign-scope dialogs remain rejected',async()=>{for(const options of [{unrelated:true},{foreignResource:true},{invalidOption:true},{secondMain:true},{extraDialog:true},{duplicateTrigger:true},{closedTrigger:true},{duplicateOption:true}])await assert.rejects(actualPopoverPhase(options),{code:'ONBOARDING_PAGE_CHANGED'});});
test('ordinary enabled resource labels are validated and never skipped',async()=>{
 assert.deepEqual((await actualPopoverPhase({kind:'expiry',plainLabel:true})).actions,['loc=css:#expiry-option']);
 for(const options of [{foreignScope:true},{duplicateLabel:true}])await assert.rejects(actualPopoverPhase({kind:'expiry',plainLabel:true,...options}),{code:'ONBOARDING_PAGE_CHANGED'});
});
test('actual capture arm accepts a labelled native radio and only the unchanged trusted final grant',()=>{
 const markerName='__dsh_synthetic_key_capture',nonce='d'.repeat(32),keyName=identity.tunnelName+'-runtime';let listener;
 const field={value:keyName},expiry={value:'30'},count={textContent:'2 selected permissions',children:[]},radio={checked:true,labels:[{textContent:'Restricted'}],textContent:'',getAttribute:()=>null};
 const tunnelLabel={textContent:'Tunnels'},otherLabel={textContent:'Other'},modelLabel={textContent:'Model capabilities'},tunnelControl={textContent:'All selected'},otherControl={textContent:'None'},modelControl={textContent:'None'};
 const row=(label,control,disabled=true)=>({querySelector(s){return this.querySelectorAll(s)[0]??null;},querySelectorAll:s=>s===':scope > button[disabled]'?(disabled?[label]:[]):s===':scope > button'?[label]:s===':scope > [role="button"][aria-haspopup="dialog"]'?[control]:[]});const tunnelRow=row(tunnelLabel,tunnelControl),otherRow=row(otherLabel,otherControl),modelRow=row(modelLabel,modelControl,false);tunnelLabel.parentElement=tunnelRow;tunnelRow.parentElement={children:[tunnelRow,otherRow,modelRow]};
 const dialog={getClientRects:()=>[{}],querySelector:s=>s.includes('My Test Key')?field:s.includes('project-key-expiration')?expiry:null,querySelectorAll:s=>s.includes('radio')?(s.includes('input')?[radio]:[]):s==='button[disabled]'?[tunnelLabel,otherLabel]:s==='button'?[tunnelLabel,otherLabel,modelLabel]:s==='*'?[count]:[]};
 const doc={querySelectorAll:()=>[dialog],addEventListener:(type,fn)=>listener=fn,removeEventListener:()=>{}};const previousDocument=globalThis.document,previousStyle=globalThis.getComputedStyle;
 const button={textContent:'Create secret key',getAttribute:()=>null,closest:selector=>selector.includes('dialog')?dialog:button};
 try{globalThis.document=doc;globalThis.getComputedStyle=()=>({visibility:'visible'});assert.equal(api.armEgoKeyCapture({keyName,nonce,markerName}),true);
  listener({isTrusted:false,target:button});assert.equal(globalThis[markerName].armed,false);assert.equal(globalThis[markerName].creationObservedAt,null);const before=Date.now();listener({isTrusted:true,target:button});assert.equal(globalThis[markerName].armed,true);assert.ok(globalThis[markerName].creationObservedAt>=before);assert.ok(globalThis[markerName].creationObservedAt<=Date.now());
  field.value='foreign';listener({isTrusted:true,target:button});assert.equal(globalThis[markerName].armed,false);assert.equal(globalThis[markerName].creationObservedAt,null);field.value=keyName;
  expiry.value='never';listener({isTrusted:true,target:button});assert.equal(globalThis[markerName].armed,false);expiry.value='30';
  count.textContent='3 selected permissions';listener({isTrusted:true,target:button});assert.equal(globalThis[markerName].armed,false);count.textContent='2 selected permissions';
  modelControl.textContent='All selected';listener({isTrusted:true,target:button});assert.equal(globalThis[markerName].armed,false);modelControl.textContent='None';
  otherControl.textContent='All selected';listener({isTrusted:true,target:button});assert.equal(globalThis[markerName].armed,false);
 }finally{delete globalThis[markerName];if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument;if(previousStyle===undefined)delete globalThis.getComputedStyle;else globalThis.getComputedStyle=previousStyle;}
});

test('renewal requires an existing tunnel and derives a unique key name and isolated candidate path',async()=>{
 const renewalId='c'.repeat(32);assert.throws(()=>api.buildEgoPlatformPhaseScript({...identity,renewalId}),{code:'ONBOARDING_PRIVATE_STATE'});assert.throws(()=>api.buildEgoPlatformPhaseScript({...identity,renewalId:'../key',state:{tunnel_id:tunnelId}}),{code:'ONBOARDING_PRIVATE_STATE'});
 const {actions,script}=await phase({kind:'key_name',name:'',selector:'loc=css:#name'},{renewalId,state:{tunnel_id:tunnelId},url:'https://platform.openai.com/settings/organization/api-keys'});assert.deepEqual(actions,[['fill','loc=css:#name',identity.tunnelName+'-runtime-'+renewalId]]);assert.ok(script.includes('runtime-next-'+renewalId+'.key'));
});
test('renewal cannot create a tunnel from a stale tunnel page',async()=>{
 const renewalId='c'.repeat(32);await assert.rejects(phase({kind:'tunnel_draft',name:identity.tunnelName},{renewalId,state:{tunnel_id:tunnelId}}),{code:'ONBOARDING_PAGE_CHANGED'});
 const {actions}=await phase({kind:'tunnel_list',complete:true,createSelector:'loc=css:#create-tunnel'},{renewalId,state:{tunnel_id:tunnelId}});assert.deepEqual(actions,[['goto','https://platform.openai.com/settings/organization/api-keys']]);
});

async function actualSavePhase({renewalId,foreignNonce=false,observedAt=Date.now()-1000}={}){
 const directory=await realpath(await mkdtemp(join(tmpdir(),'dsh-synthetic-key-capture-'))),runtimeKeyFile=join(directory,'runtime.key'),nonce='d'.repeat(32),markerName='__dsh_ego_key_'+identity.installationId+(renewalId?'_'+renewalId:'');
 const original='sk-'+ 'o'.repeat(32),candidate='sk-'+ 'n'.repeat(32);if(renewalId)await writeFile(runtimeKeyFile,original+'\n',{mode:0o600});
 const dialog={getClientRects:()=>[{}],querySelectorAll:selector=>selector.startsWith('h1')?[{textContent:'Save your key'}]:selector.startsWith('input[readonly]')?[{value:candidate}]:[]};
 const previous={document:globalThis.document,location:globalThis.location,getComputedStyle:globalThis.getComputedStyle};
 globalThis.document={querySelectorAll:()=>[dialog],removeEventListener:()=>{}};globalThis.location={origin:'https://platform.openai.com'};globalThis.getComputedStyle=()=>({visibility:'visible'});globalThis[markerName]={nonce:foreignNonce?'e'.repeat(32):nonce,armed:true,creationObservedAt:observedAt,listener:()=>{}};
 const page={url:async()=> 'https://platform.openai.com/settings/organization/api-keys',evaluate:async(fn,input)=>fn.name==='inspectPlatform'?{kind:'key_saved_dialog'}:fn(input)};
 try{const script=api.buildEgoPlatformPhaseScript({...identity,directory,runtimeKeyFile,renewalId,state:{tunnel_id:tunnelId,key_intent:true,key_capture_nonce:nonce}}),result=await new AsyncFunction('page',script)(page);const stem=renewalId?'runtime-next-'+renewalId:'runtime';return{result,key:await readFile(join(directory,stem+'.key'),'utf8'),metadata:JSON.parse(await readFile(join(directory,stem+'.json'),'utf8')),mode:(await stat(join(directory,stem+'.key'))).mode&0o777,original:renewalId?await readFile(runtimeKeyFile,'utf8'):undefined,observedAt,script};}
 finally{delete globalThis[markerName];for(const[k,v]of Object.entries(previous)){if(v===undefined)delete globalThis[k];else globalThis[k]=v;}await rm(directory,{recursive:true,force:true});}
}
test('actual renewal capture writes only its private candidate and trusted-click metadata',async()=>{
 const renewalId='c'.repeat(32),r=await actualSavePhase({renewalId});assert.deepEqual(r.result,{status:'key_saved',key_saved:true});assert.equal(r.original,'sk-'+ 'o'.repeat(32)+'\n');assert.equal(r.key,'sk-'+ 'n'.repeat(32)+'\n');assert.equal(r.mode,0o600);assert.deepEqual(r.metadata,{version:1,installation_id:identity.installationId,renewal_id:renewalId,creation_observed_at:new Date(r.observedAt).toISOString(),lifetime_days:30,expiry_source:'creation_observed'});assert.doesNotMatch(JSON.stringify(r.result),/sk-|2026/);
});
test('initial capture records the same metadata; foreign nonce cannot capture a renewal',async()=>{
 const r=await actualSavePhase();assert.equal(r.metadata.creation_observed_at,new Date(r.observedAt).toISOString());assert.equal(r.metadata.renewal_id,undefined);await assert.rejects(actualSavePhase({renewalId:'c'.repeat(32),foreignNonce:true}),{code:'ONBOARDING_KEY_RECOVERY'});
});

test('a renewal whose grant outcome is unknown cannot open another create form from the key list',async()=>{
 const renewalId='c'.repeat(32);await assert.rejects(phase({kind:'key_list',complete:true,createSelector:'loc=css:#create'},{renewalId,state:{tunnel_id:tunnelId,key_intent:true,key_capture_nonce:'d'.repeat(32)},url:'https://platform.openai.com/settings/organization/api-keys'}),{code:'ONBOARDING_KEY_RECOVERY'});
});
