/** Bounded Ego v2 plans for official Platform pages. DOM observations never contain key values. */
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {canonicalPrivatePath} from './onboarding-store.js';
const invalid=()=>Object.assign(new Error('ONBOARDING_PRIVATE_STATE'),{code:'ONBOARDING_PRIVATE_STATE'});
function inspectPlatform({tunnelName,keyName}){
 const visible=el=>Boolean(el&&el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden'&&getComputedStyle(el).display!=='none');
 const all=(selector,root=document)=>Array.from(root.querySelectorAll(selector)).filter(visible);
 const text=el=>(el?.textContent??'').trim();
 const name=el=>el.getAttribute('aria-label')??((el.getAttribute('aria-labelledby')??'').split(/\s+/).map(id=>document.getElementById(id)?.textContent??'').join(' ').trim()||Array.from(el.labels??[]).map(text).join(' ').trim()||text(el));
 const exact=(selector,match,root=document)=>all(selector,root).filter(el=>typeof match==='string'?name(el)===match:match.test(name(el)));
 const one=items=>items.length===1?items[0]:undefined;
 const css=el=>{if(!el)return;const path=[];for(let current=el;current&&current!==document.documentElement;current=current.parentElement){if(current.id&&document.querySelectorAll('#'+CSS.escape(current.id)).length===1){path.unshift('#'+CSS.escape(current.id));break;}const tag=current.tagName.toLowerCase(),siblings=Array.from(current.parentElement?.children??[]).filter(x=>x.tagName===current.tagName);path.unshift(tag+':nth-of-type('+(siblings.indexOf(current)+1)+')');if(path.length>32)return;}const selector=path.join(' > ');return document.querySelectorAll(selector).length===1?'loc=css:'+selector:undefined;};
 if(all('input[type="email"],input[type="password"],input[autocomplete="one-time-code"],input[autocomplete="username"]').length)return{kind:'login'};
 const dialogs=all('[role="dialog"],dialog[open]');let dialog=dialogs[0],popover;
 if(dialogs.length>1){
  if(dialogs.length!==2)return{kind:'changed'};
  dialog=one(dialogs.filter(el=>all('input[placeholder="My Test Key"]',el).length===1));
  if(!dialog)return{kind:'changed'};
  const popup=dialogs.find(el=>el!==dialog),trigger=one(all('[aria-controls]',dialog).filter(el=>el.getAttribute('aria-controls')===popup.id)),list=one(all('[role="listbox"]',popup));
  if(!popup.id||!trigger||trigger.getAttribute('aria-haspopup')!=='dialog'||trigger.getAttribute('aria-expanded')!=='true'||!list)return{kind:'changed'};
  const labels=all(':scope > button',trigger.parentElement),controls=all(':scope > [role="button"][aria-haspopup="dialog"]',trigger.parentElement);
  const options=all('[role="option"]',list),ids=['api.organization.tunnel.read','api.organization.tunnel.use'];
  if(labels.length===1&&text(labels[0])==='Tunnels'&&controls.length===1&&controls[0]===trigger){
   if(list.getAttribute('aria-multiselectable')!=='true'||options.length!==2||!ids.every(id=>options.filter(el=>el.getAttribute('data-option-id')===id).length===1))return{kind:'changed'};
   popover={kind:'permissions',options};
  }else if(list.getAttribute('aria-multiselectable')!=='true'&&/^(Select project\.\.\.|选择项目\.\.\.)$/.test(name(trigger)))popover={kind:'project',options};
  else if(list.getAttribute('aria-multiselectable')!=='true'&&/^(Expiry|有效期)/i.test(name(trigger))&&options.filter(el=>/^(30 days|30天|30 天)$/i.test(name(el))).length===1)popover={kind:'expiry',options};
  else return{kind:'changed'};
 }
 if(dialog){
  if(exact('h1,h2,h3,[role="heading"]',/^(Save your key|保存.*密钥|保存.*金鑰)$/i,dialog).length===1)return{kind:'key_saved_dialog'};
  const tunnelNameField=one(all('input[placeholder="e.g. West Coast MCP tunnel"]',dialog));
  if(tunnelNameField){const description=one(all('textarea[placeholder="Add a short description to help your team."],input[placeholder="Add a short description to help your team."]',dialog));return{kind:'tunnel_draft',name:tunnelNameField.value,nameSelector:css(tunnelNameField),descriptionSelector:css(description)};}
  const keyNameField=one(all('input[placeholder="My Test Key"]',dialog));
  if(keyNameField){
   if(keyNameField.value!==keyName)return{kind:'key_name',name:keyNameField.value,selector:css(keyNameField)};
   const restricted=one(exact('[role="radio"],input[type="radio"]',/^(Restricted|受限|限制)$/i,dialog));
   if(!restricted)return{kind:'changed'};
   if(restricted.getAttribute('aria-checked')!=='true'&&restricted.checked!==true)return{kind:'click',selector:css(restricted),step:'key_confirm'};
   if(popover?.kind==='permissions'){const missing=popover.options.find(el=>el.getAttribute('aria-selected')!=='true');return missing?{kind:'click',selector:css(missing),step:'key_confirm'}:{kind:'escape'};}
   if(all('[role="listbox"][aria-multiselectable="true"]').length)return{kind:'changed'};
   const tunnel=one(exact('button','Tunnels',dialog));const resourceRow=tunnel?.parentElement,container=resourceRow?.parentElement;
   const controls=resourceRow?all('[role="button"][aria-haspopup="dialog"],button[aria-haspopup="dialog"]',resourceRow):[];
   if(!tunnel||controls.length!==1||!container)return{kind:'changed'};
   if(/^(None|无|無)$/.test(text(controls[0])))return{kind:'click',selector:css(controls[0]),step:'key_confirm'};
   let tunnels=0;const rows=Array.from(container.children).filter(el=>el.querySelector(':scope > button')||el.querySelector(':scope > [role="button"][aria-haspopup="dialog"]'));
   if(rows.length<2)return{kind:'changed'};
   for(const row of rows){const labels=row.querySelectorAll(':scope > button'),controls=row.querySelectorAll(':scope > [role="button"][aria-haspopup="dialog"]');if(labels.length!==1||controls.length!==1)return{kind:'changed'};if(text(labels[0])==='Tunnels'){tunnels++;if(text(controls[0])!=='All selected')return{kind:'changed'};}else if(text(controls[0])!=='None')return{kind:'changed'};}
   if(tunnels!==1||exact('*','2 selected permissions',dialog).filter(el=>!Array.from(el.children).some(child=>text(child)==='2 selected permissions')).length!==1)return{kind:'changed'};
   const project=one(exact('button,[role="button"]',/^(Select project\.\.\.|选择项目\.\.\.)$/,dialog));
   if(project){const options=popover?.kind==='project'?popover.options:[];if(options.length===1)return{kind:'click',selector:css(options[0]),step:'key_project'};return options.length?{kind:'project_wait'}:{kind:'click',selector:css(project),step:'key_project'};}
   const expiry=one(exact('button,[role="button"]',/^(Expiry|有效期)/i,dialog)),value=one(Array.from(dialog.querySelectorAll('input#project-key-expiration')));
   if(!expiry||!value)return{kind:'changed'};
   if(value.value!=='30'){const thirty=popover?.kind==='expiry'?one(popover.options.filter(el=>/^(30 days|30天|30 天)$/i.test(name(el)))):undefined;return{kind:'click',selector:css(thirty??expiry),step:'key_confirm'};}
   if(!/^(Expiry|有效期).*30\s*(天|days)$/i.test(name(expiry)))return{kind:'changed'};
   return{kind:'key_ready'};
  }
  return{kind:'changed'};
 }
 const keyList=location.pathname.endsWith('/api-keys');const wanted=keyList?keyName:tunnelName;
 const rows=all('tr,[role="row"]'),matches=rows.filter(row=>all('td,th,[role="cell"],[role="rowheader"],span,div',row).some(cell=>text(cell)===wanted));
 if(matches.length>1)return{kind:'changed'};
 if(matches.length===1){
  if(keyList)return{kind:'key_exists'};
  // textContent joins adjacent table cells without separators. Match complete
  // identifiers inside this exact row's cells, never substrings of row text.
  const row=matches[0],cells=all('td,th,[role="cell"],[role="rowheader"]',row).filter(cell=>cell.closest('tr,[role="row"]')===row).map(text);
  const tids=cells.filter(value=>/^tunnel_[A-Za-z0-9_-]{8,128}$/.test(value));
  const workspaces=cells.filter(value=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value));
  const orgs=cells.filter(value=>/^org-[A-Za-z0-9_-]{8,120}$/.test(value));
  if(tids.length!==1||workspaces.length>1||orgs.length>1)return{kind:'changed'};
  if(workspaces.length===1)return{kind:'tunnel_ready',tunnel_id:tids[0],tunnel_name:tunnelName,workspace_id:workspaces[0],...orgs.length===1?{organization_id:orgs[0]}:{}};
  return{kind:'workspace_wait'};
 }
 const tables=all('table,[role="table"]'),busy=all('[aria-busy="true"],[role="progressbar"]').length,search=all('input[type="search"],[role="searchbox"]').some(el=>el.value?.trim());
 let complete=tables.length===1&&!busy&&!search;
 if(complete){const count=tables[0].getAttribute('aria-rowcount');if(count!==null&&Number(count)>all('tr,[role="row"]',tables[0]).length)complete=false;}
 const next=exact('button,[role="button"]',/^(Next|Next page|下一页|下一頁)$/i);if(next.length>1||next.some(el=>!el.disabled&&el.getAttribute('aria-disabled')!=='true'))complete=false;
 if(!next.length&&exact('nav,[role="navigation"]',/pagination|分页|分頁/i).length)complete=false;
 if(keyList){const region=one(exact('[role="region"]','API keys')),chips=one(all('.api-keys-filter-chips'));if(!region||!chips||chips.children.length!==1||chips.children[0].tagName!=='BUTTON'||text(chips.children[0])!=='Add filter')complete=false;const totals=region?exact('*',/^\d+\s+results?$/i,region).filter(el=>!Array.from(el.children).some(child=>/^\d+\s+results?$/i.test(text(child)))):[];const count=Number(text(totals[0]).match(/^\d+/)?.[0]);if(totals.length!==1||count!==rows.filter(row=>exact('button',/^View details for /,row).length).length)complete=false;}
 const create=one(exact('button,[role="button"]',keyList?/^(Create new secret key|创建新密钥)$/:/^(Create tunnel|创建隧道)$/));return{kind:keyList?'key_list':'tunnel_list',complete,createSelector:css(create)};
}

/** Arm only a trusted final click on this exact, still-restricted draft in this document. */
export function armEgoKeyCapture({keyName,nonce,markerName}){
 const prior=globalThis[markerName];if(prior?.nonce===nonce)return true;
 const visible=el=>el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden';
 const matches=dialog=>{
  const field=dialog?.querySelector('input[placeholder="My Test Key"]');if(field?.value!==keyName||dialog.querySelector('input#project-key-expiration')?.value!=='30')return false;
  const restricted=Array.from(dialog.querySelectorAll('[role="radio"],input[type="radio"]')).filter(el=>/^(Restricted|受限|限制)$/i.test((el.getAttribute('aria-label')??(Array.from(el.labels??[]).map(label=>label.textContent).join(' ').trim()||el.textContent)).trim()));if(restricted.length!==1||restricted[0].getAttribute('aria-checked')!=='true'&&restricted[0].checked!==true)return false;
  const counts=Array.from(dialog.querySelectorAll('*')).filter(el=>el.textContent.trim()==='2 selected permissions'&&!Array.from(el.children).some(child=>child.textContent.trim()==='2 selected permissions'));if(counts.length!==1)return false;
  const labels=Array.from(dialog.querySelectorAll('button')).filter(el=>el.textContent.trim()==='Tunnels');if(labels.length!==1)return false;
  const rows=Array.from(labels[0].parentElement?.parentElement?.children??[]).filter(row=>row.querySelector(':scope > button')||row.querySelector(':scope > [role="button"][aria-haspopup="dialog"]'));
  if(rows.length<2)return false;let tunnels=0;for(const row of rows){const names=row.querySelectorAll(':scope > button'),controls=row.querySelectorAll(':scope > [role="button"][aria-haspopup="dialog"]');if(names.length!==1||controls.length!==1)return false;const isTunnel=names[0].textContent.trim()==='Tunnels';if(isTunnel)tunnels++;if(controls[0].textContent.trim()!==(isTunnel?'All selected':'None'))return false;}return tunnels===1;
 };
 const dialogs=Array.from(document.querySelectorAll('[role="dialog"],dialog[open]')).filter(visible);if(dialogs.length!==1||!matches(dialogs[0]))return false;
 if(prior?.listener)document.removeEventListener('click',prior.listener,true);
 const checkpoint={nonce,armed:false,listener:null};checkpoint.listener=event=>{
  if(!event.isTrusted)return;checkpoint.armed=false;
  const button=event.target?.closest?.('button,[role="button"]'),dialog=button?.closest('[role="dialog"],dialog[open]');
  if(button&&/^(Create secret key|Create new secret key|创建密钥|创建新密钥)$/i.test((button.getAttribute('aria-label')??button.textContent).trim())&&matches(dialog))checkpoint.armed=true;
 };
 globalThis[markerName]=checkpoint;document.addEventListener('click',checkpoint.listener,true);return true;
}

export function buildEgoPlatformPhaseScript({directory,runtimeKeyFile,tunnelName,installationId,state={},recoverRejected=false}={}){
 canonicalPrivatePath(directory);canonicalPrivatePath(runtimeKeyFile);if(runtimeKeyFile!==join(directory,'runtime.key')||typeof installationId!=='string'||!/^[a-f0-9]{32}$/.test(installationId)||tunnelName!=='dsh-dot-'+installationId||typeof recoverRejected!=='boolean')throw invalid();
 const captureNonce=state.key_capture_nonce??randomBytes(16).toString('hex');if(!/^[a-f0-9]{32}$/.test(captureNonce))throw invalid();
 const input={directory,runtimeKeyFile,tunnelName,keyName:tunnelName+'-runtime',tunnelId:state.tunnel_id??null,tunnelIntent:state.tunnel_intent===true,keyIntent:state.key_intent===true,captureNonce:state.key_capture_nonce??null,nextCaptureNonce:captureNonce,markerName:'__dsh_ego_key_'+installationId,recoverRejected};
 return `const input=${JSON.stringify(input)};
 const failure=code=>Object.assign(new Error(code),{code});
 const u=new URL(await page.url());
 const pending=(step,waiting_for)=>({status:'pending',step,...waiting_for?{waiting_for}:{}});
 const target=input.tunnelId?'https://platform.openai.com/settings/organization/api-keys':'https://platform.openai.com/settings/organization/tunnels';
 if(u.origin==='https://accounts.google.com'&&!u.username&&!u.password&&/^\\/(?:v[0-9]+\\/)?signin\\/rejected\\/?$/.test(u.pathname)){
  if(!input.recoverRejected)throw failure('ONBOARDING_AUTH_BROWSER_REJECTED');
  await page.goto(target);return pending('platform_login','login');
 }
 if(u.href==='about:blank'){await page.goto(target);return pending('platform_login');}
 if(u.origin!=='https://platform.openai.com'||u.username||u.password)return pending('platform_login','login');
 const observed=await page.evaluate(${inspectPlatform.toString()},input);
 if(observed.kind==='login')return pending('platform_login','login');
 if(observed.kind==='changed')throw failure('ONBOARDING_PAGE_CHANGED');
 if(observed.kind==='tunnel_draft'){
  if(input.tunnelId||observed.name&&observed.name!==input.tunnelName)throw failure('ONBOARDING_PAGE_CHANGED');
  if(!observed.name){if(!observed.nameSelector||!observed.descriptionSelector)throw failure('ONBOARDING_PAGE_CHANGED');await page.fill(observed.nameSelector,input.tunnelName);await page.fill(observed.descriptionSelector,'Personal Dot connection to this DeepSeek Harness installation.');}
  return{status:'draft',step:'tunnel_confirm',waiting_for:'authorization',patch:{tunnel_intent:true}};
 }
 if(observed.kind==='key_saved_dialog'){
  if(!input.keyIntent||!input.captureNonce)throw failure('ONBOARDING_KEY_RECOVERY');
  const captureAllowed=await page.evaluate(input=>location.origin==='https://platform.openai.com'&&globalThis[input.markerName]?.nonce===input.captureNonce&&globalThis[input.markerName]?.armed===true,input);
  if(!captureAllowed)throw failure('ONBOARDING_KEY_RECOVERY');
  const {ensurePrivateDirectory,writeNewPrivateStateFile}=await import(${JSON.stringify(new URL('./onboarding-store.js',import.meta.url).href)});
  await ensurePrivateDirectory(input.directory);
  let secret=await page.evaluate(input=>{if(location.origin!=='https://platform.openai.com')return;const checkpoint=globalThis[input.markerName];if(!checkpoint?.armed||checkpoint.nonce!==input.captureNonce)return;const visible=el=>el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden';const dialogs=Array.from(document.querySelectorAll('[role="dialog"],dialog[open]')).filter(visible);if(dialogs.length!==1)return;const headings=Array.from(dialogs[0].querySelectorAll('h1,h2,h3,[role="heading"]')).filter(el=>/^(Save your key|保存.*密钥|保存.*金鑰)$/i.test(el.textContent.trim()));const fields=dialogs[0].querySelectorAll('input[readonly],textarea[readonly]');if(headings.length!==1||fields.length!==1||!/^sk-[A-Za-z0-9_-]{20,1024}$/.test(fields[0].value))return;document.removeEventListener('click',checkpoint.listener,true);delete globalThis[input.markerName];return fields[0].value;},input);
  if(typeof secret!=='string')throw failure('ONBOARDING_KEY_RECOVERY');
  try{await writeNewPrivateStateFile(input.runtimeKeyFile,secret+'\\n');}catch(e){if(e.code==='EEXIST')throw failure('ONBOARDING_KEY_RECOVERY');throw failure('ONBOARDING_PRIVATE_STATE');}finally{secret=undefined;}
  return{status:'key_saved',key_saved:true};
 }
 if(observed.kind==='tunnel_ready'&&!input.tunnelId)return{status:'tunnel_ready',tunnel_id:observed.tunnel_id,tunnel_name:observed.tunnel_name,workspace_id:observed.workspace_id,...observed.organization_id?{organization_id:observed.organization_id}:{}};
 if(observed.kind==='workspace_wait'&&!input.tunnelId)return pending('tunnel_scope','workspace');
 if(u.href.split('?')[0]!==target){await page.goto(target);return pending(input.tunnelId?'key_confirm':'platform_login');}
 if(observed.kind==='key_exists')throw failure('ONBOARDING_KEY_RECOVERY');
 if(observed.kind==='tunnel_list'||observed.kind==='key_list'){
  const prior=observed.kind==='tunnel_list'?input.tunnelIntent:input.keyIntent;
  if(prior&&!observed.complete)return pending(observed.kind==='key_list'?'key_confirm':'tunnel_confirm');
  if(!observed.createSelector)return pending('platform_login');
  await page.click(observed.createSelector);return pending(observed.kind==='key_list'?'key_confirm':'tunnel_confirm');
 }
 if(observed.kind==='key_name'){if(observed.name||!observed.selector)throw failure('ONBOARDING_PAGE_CHANGED');await page.fill(observed.selector,input.keyName);return pending('key_confirm');}
 if(observed.kind==='click'){if(!observed.selector)throw failure('ONBOARDING_PAGE_CHANGED');await page.click(observed.selector);return pending(observed.step);}
 if(observed.kind==='escape'){await page.keyboard.press('Escape');return pending('key_confirm');}
 if(observed.kind==='project_wait')return pending('key_project','project');
 if(observed.kind==='key_ready'){const armed=await page.evaluate(${armEgoKeyCapture.toString()},{keyName:input.keyName,nonce:input.nextCaptureNonce,markerName:input.markerName});if(!armed)throw failure('ONBOARDING_KEY_RECOVERY');return{status:'draft',step:'key_confirm',waiting_for:'authorization',patch:{key_intent:true,key_capture_nonce:input.nextCaptureNonce}};}
 return pending('platform_login');`;
}
