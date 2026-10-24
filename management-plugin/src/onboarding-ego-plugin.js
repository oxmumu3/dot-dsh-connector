/** Bounded Ego v2 phases. The caller owns the Space, page selection and persistence. */
import {buildDotVerificationPrompt} from './onboarding-browser.js';

const pluginIdPattern=/^plugin_asdk_app_[A-Za-z0-9_-]{1,128}$/;
const requestPattern=/^dsh_connect_[a-f0-9]{32}$/;
const invalid=()=>Object.assign(new Error('Official connection page could not be verified.'),{code:'ONBOARDING_PAGE_CHANGED'});
function name(value){if(typeof value!=='string'||!value.trim()||value.trim()!==value||value.length>120||/[\u0000-\u001f\u007f\u2028\u2029]/.test(value))throw invalid();return value;}
function stateInput(value={}){
 if(!value||Object.getPrototypeOf(value)!==Object.prototype)throw invalid();
 const result={};
 for(const key of ['plugin_intent','plugin_connected'])if(value[key]!==undefined){if(typeof value[key]!=='boolean')throw invalid();result[key]=value[key];}
 if(value.plugin_id!==undefined){if(typeof value.plugin_id!=='string'||!pluginIdPattern.test(value.plugin_id))throw invalid();result.plugin_id=value.plugin_id;}
 if(value.plugin_absence_fingerprint!==undefined&&value.plugin_absence_fingerprint!==null){if(typeof value.plugin_absence_fingerprint!=='string'||value.plugin_absence_fingerprint.length>32768||value.plugin_absence_fingerprint.split('|').some(id=>id&&!pluginIdPattern.test(id)))throw invalid();result.plugin_absence_fingerprint=value.plugin_absence_fingerprint;}
 if(value.plugin_absence_since!==undefined&&value.plugin_absence_since!==null){if(!Number.isSafeInteger(value.plugin_absence_since)||value.plugin_absence_since<0)throw invalid();result.plugin_absence_since=value.plugin_absence_since;}
 if(value.verification_pending_request!==undefined&&value.verification_pending_request!==null){if(typeof value.verification_pending_request!=='string'||!requestPattern.test(value.verification_pending_request))throw invalid();result.verification_pending_request=value.verification_pending_request;}
 if(value.verification_uncertain_request!==undefined&&value.verification_uncertain_request!==null){if(typeof value.verification_uncertain_request!=='string'||!requestPattern.test(value.verification_uncertain_request))throw invalid();result.verification_uncertain_request=value.verification_uncertain_request;}
 if(value.verification_request_ids!==undefined){if(!Array.isArray(value.verification_request_ids)||value.verification_request_ids.length>32||value.verification_request_ids.some(id=>typeof id!=='string'||!requestPattern.test(id)))throw invalid();result.verification_request_ids=[...value.verification_request_ids];}
 return result;
}

/** DOM reads only. No events, storage, cookies, network or page-side mutation. */
function inspectPage(input){
 const norm=value=>(value??'').replace(/\s+/g,' ').trim();
 const visible=el=>Boolean(el&&el.getClientRects().length&&!el.closest('[aria-hidden="true"],[hidden]')&&getComputedStyle(el).visibility!=='hidden'&&getComputedStyle(el).display!=='none');
 const list=(root,css)=>Array.from(root.querySelectorAll(css)).filter(visible);
 const label=el=>{
  const explicit=el.getAttribute('aria-label');if(explicit)return norm(explicit);
  const refs=el.getAttribute('aria-labelledby');if(refs){const text=norm(refs.split(/\s+/).map(id=>document.getElementById(id)?.textContent??'').join(' '));if(text)return text;}
  if(el.labels?.length)return norm(Array.from(el.labels).map(x=>x.textContent).join(' '));
  return norm(el.textContent)||norm(el.getAttribute('title'));
 };
 const selector=el=>{
  if(!el||el.getRootNode()!==document)return null;
  const tag=el.localName;if(!/^[a-z][a-z0-9-]*$/.test(tag))return null;
  // Attribute values stay quoted CSS data; never use field contents or page text.
  const quote=value=>'"'+value.replace(/["\\\u0000-\u001f\u007f]/g,char=>'\\'+char.codePointAt(0).toString(16)+' ')+'"';
  const attributes=['role','aria-label','aria-labelledby','name','type','contenteditable','placeholder'].flatMap(key=>{const value=el.getAttribute(key);return typeof value==='string'&&value.length>0&&value.length<=256?['['+key+'='+quote(value)+']']:[];});
  const semantic=tag+attributes.join('');
  const unique=css=>{try{const matches=document.querySelectorAll(css);return matches.length===1&&matches[0]===el;}catch{return false;}};
  if(unique(semantic))return'loc=css:'+semantic;
  const parts=[];for(let current=el;current&&current.nodeType===1&&parts.length<32;current=current.parentElement){
   const currentTag=current.localName;if(!/^[a-z][a-z0-9-]*$/.test(currentTag))return null;
   const peers=current.parentElement?Array.from(current.parentElement.children).filter(sibling=>sibling.localName===currentTag):[current];
   parts.unshift(current===el&&attributes.length?semantic:currentTag+':nth-of-type('+(peers.indexOf(current)+1)+')');
   const css=parts.join(' > ');if(unique(css))return'loc=css:'+css;
  }
  return null;
 };
 const one=(items)=>items.length===1?items[0]:undefined;
 const control=(root,css,pattern)=>one(list(root,css).filter(el=>pattern.test(label(el))));
 const button=(root,pattern)=>control(root,'button,[role="button"]',pattern);
 const enabled=el=>Boolean(el&&!el.disabled&&el.getAttribute('aria-disabled')!=='true');
 const equalElements=(root,text)=>list(root,'*').filter(el=>norm(el.textContent)===text&&!Array.from(el.children).some(child=>norm(child.textContent)===text));
 const dialogs=list(document,'[role="dialog"],dialog');
 if(document.querySelectorAll('*').length>20000)return{changed:true};
 const login=Boolean(list(document,'input[type="email"],input[type="password"],input[autocomplete="username"],input[autocomplete="current-password"],input[autocomplete="one-time-code"]').length||control(document,'button,a,[role="button"],[role="link"]',/^(?:log\s?in(?:\s+or\s+sign\s?up)?|sign\s?in|登录|登入|登录或注册|登入或註冊)$/i));
 if(login)return{login:true};
 if(input.mode==='dot'){
  const explicit=list(document,'button,[role="button"]').some(el=>/^(Allow once|Allow this tool|Approve tool use|允许一次|允許一次|允许使用工具|允许调用工具)$/i.test(label(el)));
  const approval=explicit||dialogs.some(dialog=>{
   const tool=list(dialog,'h1,h2,h3,h4,h5,h6,[role="heading"]').some(el=>/tool|工具/i.test(label(el)))||equalElements(dialog,input.pluginName).length===1;
   return tool&&Boolean(button(dialog,/^(Allow|Approve|允许|允許|批准)$/i));
  });
  const editors=list(document,'div[role="textbox"][contenteditable="true"]').filter(el=>['消息','Message'].includes(label(el)));
  const editor=one(editors),editorText=editor?norm(editor.innerText??editor.textContent):'';
  const sent=equalElements(document,norm(input.prompt)).some(el=>!el.isContentEditable&&!el.closest('[contenteditable="true"],textarea,input')&&!el.querySelector('[contenteditable="true"],textarea,input'));
  const send=button(document,/^(发送|Send)$/i);
  return{approval,sent,editor:selector(editor),editorEmpty:editorText==='',editorMatches:editorText===norm(input.prompt),send:selector(send),sendEnabled:enabled(send)};
 }
 const links=list(document,'a[href]').filter(el=>label(el)===input.pluginName);
 const matches=links.map(el=>({element:el,match:el.getAttribute('href')?.match(/^\/plugins\/(plugin_asdk_app_[A-Za-z0-9_-]{1,128})$/)}));
 const idMatches=matches.filter(x=>x.match);
 const uniqueId=idMatches.length===1?idMatches[0].match[1]:undefined;
 const title=one(list(document,'h1,[role="heading"][aria-level="1"]').filter(el=>label(el)===input.pluginName));
 const manage=control(document,'a[href], [role="link"][href]',/^(管理|Manage)$/i);
 const expectedId=input.pluginId??uniqueId;
 const linked=list(document,'*').filter(el=>/^(关联日期|關聯日期|Connected on|Date connected|Connection date|Associated date)$/i.test(norm(el.textContent))&&!Array.from(el.children).some(child=>/^(关联日期|關聯日期|Connected on|Date connected|Connection date|Associated date)$/i.test(norm(child.textContent))));
 let association=false;if(linked.length===1){const labelEl=linked[0],siblings=Array.from(labelEl.parentElement?.children??[]).filter(el=>el!==labelEl&&!el.contains(labelEl));const text=siblings.length===1?norm(siblings[0].textContent):'';association=text.length>=4&&text.length<=80&&/[0-9]/.test(text);}
 let collection;
 const nav=one(list(document,'nav,[role="navigation"]').filter(el=>/^(自定义|Custom)$/.test(label(el))));
 if(nav&&!nav.querySelector('[aria-busy="true"],[role="status"],[role="progressbar"]')&&!Array.from(nav.querySelectorAll('input')).some(el=>el.value.trim())){
  const sections=Array.from(nav.querySelectorAll('div')).filter(el=>el.children.length===2&&['已安装','Installed'].includes(norm(el.children[0].textContent))&&el.children[1].classList.contains('group/nav-list'));
  if(sections.length===1){const anchors=Array.from(sections[0].children[1].querySelectorAll('a[href^="/plugins/plugin_asdk_app_"]'));const ids=anchors.map(el=>el.getAttribute('href')?.match(/^\/plugins\/(plugin_asdk_app_[A-Za-z0-9_-]{1,128})$/)?.[1]);if(ids.every(Boolean)&&ids.length<=128)collection={fingerprint:ids.sort().join('|'),target:anchors.some(el=>norm(el.textContent)===input.pluginName)};}
 }
 const searchReady=list(document,'input[placeholder]').some(el=>['搜索插件','Search plugins'].includes(el.getAttribute('placeholder'))&&!el.value.trim());
 const result={ambiguous:idMatches.length>1||links.length>1,pluginId:uniqueId,exactPluginText:equalElements(document,input.pluginName).length>0,title:Boolean(title),manage:expectedId&&manage?.getAttribute('href')==='/settings/plugins-settings/'+expectedId?selector(manage):null,uninstall:Boolean(button(document,/^(卸载|Uninstall)$/i)),association,collection,searchReady,add:selector(button(document,/^(添加|Add)$/i)),custom:selector(control(document,'button,[role="button"],[role="menuitem"]',/^(添加自定义 MCP 服务器|Add custom MCP server)$/i)),dialogCount:dialogs.length};
 if(dialogs.length===1){
  const dialog=dialogs[0];
  const field=(names,placeholders)=>one(list(dialog,'input,textarea,[role="textbox"]').filter(el=>names.test(label(el))||placeholders.includes(el.getAttribute('placeholder'))));
  const nameField=field(/^(名称|Name)$/i,['自定义工具','Custom tools','Custom tool']);
  const description=field(/^(描述|Description)$/i,['用几句话说明它的功能','Describe what it does in a few words']);
  const tunnel=button(dialog,/^(隧道|Tunnel)$/i),id=one(list(dialog,'input[placeholder="tunnel_..."]'));
  const select=one(list(dialog,'select'));
  const nameValue=nameField?.value??'',descriptionValue=description?.value??'',idValue=id?.value??'';
  result.draft={name:selector(nameField),description:selector(description),tunnel:selector(tunnel),id:selector(id),auth:selector(select),nameEmpty:nameValue==='',nameMatches:nameValue===input.pluginName,descriptionEmpty:descriptionValue==='',descriptionMatches:descriptionValue===input.description,idEmpty:idValue==='',idMatches:idValue===input.tunnelId,authNone:select?.value==='NONE',authSupportsNone:Boolean(select&&Array.from(select.options).some(option=>option.value==='NONE'&&!option.disabled))};
 }
 return result;
}

async function pluginPhase(page,input,inspect){
 const pending=(step,patch={})=>({status:'pending',step,...Object.keys(patch).length?{patch}:{}});
 let url;try{url=new URL(await page.url());}catch{return pending('plugin_page');}
 if(url.origin==='https://accounts.google.com'&&!url.username&&!url.password&&/^\/(?:v[0-9]+\/)?signin\/rejected\/?$/.test(url.pathname)){
  if(!input.allowNavigate||!input.recoverRejected)throw Object.assign(new Error('ONBOARDING_AUTH_BROWSER_REJECTED'),{code:'ONBOARDING_AUTH_BROWSER_REJECTED'});
  await page.goto('https://chatgpt.com/plugins');return pending('chatgpt_login');
 }
 const official=url.protocol==='https:'&&url.origin==='https://chatgpt.com'&&!url.username&&!url.password;
 if(!official){if(input.allowNavigate&&['about:blank','chrome://new-tab-page/'].includes(url.href)){await page.goto('https://chatgpt.com/plugins');return{status:'pending',step:'plugin_page',navigated:true};}return pending('chatgpt_login');}
 if(/^\/(?:auth|log[-_]?in|sign[-_]?in|sign[-_]?up)(?:\/|$)/i.test(url.pathname))return pending('chatgpt_login');
 if(url.pathname!=='/plugins'&&!/^\/plugins\/plugin_asdk_app_[A-Za-z0-9_-]{1,128}$/.test(url.pathname)&&!/^\/settings\/plugins-settings\/plugin_asdk_app_[A-Za-z0-9_-]{1,128}$/.test(url.pathname)){
  if(input.allowNavigate){await page.goto('https://chatgpt.com/plugins');return{status:'pending',step:'plugin_page',navigated:true};}return pending('plugin_page');
 }
 const seen=await page.evaluate(inspect,{mode:'plugin',pluginName:input.pluginName,pluginId:input.state.plugin_id,tunnelId:input.tunnelId,description:input.description});
 if(seen.login)return pending('chatgpt_login');
 if(seen.changed||seen.ambiguous||seen.dialogCount>1)return pending('plugin_page_changed');
 if(seen.pluginId&&input.state.plugin_id&&seen.pluginId!==input.state.plugin_id)return pending('plugin_page_changed');
 const id=input.state.plugin_id??seen.pluginId;
 if(id&&!input.state.plugin_id)return{status:'pending',step:'plugin_found',plugin_id:id,patch:{plugin_id:id}};
 if(id){
  const detail='/plugins/'+id,settings='/settings/plugins-settings/'+id;
  if(url.pathname===settings&&seen.title&&seen.uninstall&&seen.association)return{status:'connected',plugin_id:id,plugin_name:input.pluginName,connected:true,patch:{plugin_id:id,plugin_connected:true}};
  if(url.pathname===detail&&seen.title&&seen.manage){await page.click(seen.manage);return{status:'pending',step:'plugin_connection_check',navigated:true};}
  if(url.pathname==='/plugins'&&input.allowNavigate){await page.goto('https://chatgpt.com'+detail);return{status:'pending',step:'plugin_connection_check',navigated:true};}
  return pending('plugin_confirm');
 }
 if(seen.draft){
  const d=seen.draft;
  if(!d.name||!d.description||(!d.nameEmpty&&!d.nameMatches)||(!d.descriptionEmpty&&!d.descriptionMatches&&!d.nameMatches)||(!d.idEmpty&&!d.idMatches))return pending('plugin_other_draft');
  if(!d.nameMatches||d.descriptionEmpty){if(!d.nameMatches)await page.fill(d.name,input.pluginName);if(d.descriptionEmpty)await page.fill(d.description,input.description);return{status:'draft',step:'plugin_details'};}
  if(!d.id){if(!d.tunnel)return pending('plugin_page_changed');await page.click(d.tunnel);return{status:'draft',step:'plugin_tunnel'};}
  if(!d.auth||!d.authSupportsNone)return pending('plugin_page_changed');
  if(!d.idMatches||!d.authNone){if(!d.idMatches)await page.fill(d.id,input.tunnelId);if(!d.authNone)await page.selectOption(d.auth,'NONE');return{status:'draft',step:'plugin_tunnel'};}
  return{status:'draft',step:'plugin_confirm',waiting_for:'authorization',patch:{plugin_intent:true}};
 }
 if(seen.custom){await page.click(seen.custom);return{status:'pending',step:'plugin_form'};}
 if(seen.exactPluginText||seen.collection?.target)return pending('plugin_connection_check');
 if(!seen.collection||!seen.searchReady)return pending('plugin_list_loading',{plugin_absence_fingerprint:null,plugin_absence_since:null});
 if(input.state.plugin_intent){
  if(input.state.plugin_absence_fingerprint!==seen.collection.fingerprint||!Number.isSafeInteger(input.state.plugin_absence_since)||input.state.plugin_absence_since>input.now)return pending('plugin_list_stabilizing',{plugin_absence_fingerprint:seen.collection.fingerprint,plugin_absence_since:input.now});
  if(input.now-input.state.plugin_absence_since<5000)return pending('plugin_list_stabilizing');
 }
 if(!seen.add)return pending('plugin_page_changed');
 await page.click(seen.add);return{status:'pending',step:'plugin_add_menu'};
}

async function dotPhase(page,input,inspect){
 const pending=step=>({status:'pending',step});
 const sent=()=>({status:'sent',sent:true,request_id:input.requestId,patch:{verification_pending_request:null,verification_request_ids:[...new Set([...(input.state.verification_request_ids??[]),input.requestId])].slice(-32)}});
 if(input.mode==='verify'&&input.state.verification_uncertain_request===input.requestId)return pending('dot_send_unconfirmed');
 if(input.mode==='verify'&&!input.forceResend&&(input.verificationSent||input.state.verification_request_ids?.includes(input.requestId)))return sent();
 let url;try{url=new URL(await page.url());}catch{return pending('dot_page');}
 if(url.origin==='https://accounts.google.com'&&!url.username&&!url.password&&/^\/(?:v[0-9]+\/)?signin\/rejected\/?$/.test(url.pathname)){
  if(input.mode!=='verify'||!input.allowNavigate||!input.recoverRejected)throw Object.assign(new Error('ONBOARDING_AUTH_BROWSER_REJECTED'),{code:'ONBOARDING_AUTH_BROWSER_REJECTED'});
  await page.goto('https://chatgpt.com/dots/home');return pending('chatgpt_login');
 }
 const official=url.protocol==='https:'&&url.origin==='https://chatgpt.com'&&!url.username&&!url.password;
 if(!official){if(input.mode==='verify'&&input.allowNavigate&&['about:blank','chrome://new-tab-page/'].includes(url.href)){await page.goto('https://chatgpt.com/dots/home');return{status:'pending',step:'dot_page',navigated:true};}return pending('chatgpt_login');}
 if(/^\/(?:auth|log[-_]?in|sign[-_]?in|sign[-_]?up)(?:\/|$)/i.test(url.pathname))return pending('chatgpt_login');
 if(!/^\/dots(?:\/|$)/.test(url.pathname))return pending('dot_page');
 const seen=await page.evaluate(inspect,{mode:'dot',pluginName:input.pluginName,prompt:input.prompt});
 if(seen.login)return pending('chatgpt_login');
 if(seen.approval)return{status:'approval',step:'dot_tool_approval',waiting_for:'authorization'};
 if(input.mode==='pending')return pending('dot_running');
 if(seen.sent&&!input.forceResend)return sent();
 if(input.state.verification_pending_request&&input.state.verification_pending_request!==input.requestId)return pending('dot_other_verification');
 if(input.state.verification_pending_request===input.requestId&&!seen.editorMatches)return pending('dot_send_unconfirmed');
 if(!seen.editor)return pending('dot_editor_loading');
 if(!seen.editorEmpty&&!seen.editorMatches)return pending('dot_existing_draft');
 if(!seen.editorMatches){await page.fill(seen.editor,input.prompt);return{status:'draft',step:'dot_prompt_ready'};}
 if(!seen.send||!seen.sendEnabled)return pending('dot_send_loading');
 if(input.state.verification_pending_request!==input.requestId)return{status:'draft',step:'dot_send_ready',patch:{verification_pending_request:input.requestId}};
 await page.click(seen.send);return sent();
}

function script(phase,input){return`const receipt = await (${phase.toString()})(page, ${JSON.stringify(input)}, ${inspectPage.toString()});\nemit(receipt);`;}
/** Apply receipt.patch before the next phase. Absence fingerprints stay in provider memory. */
export function buildPluginPhaseScript({pluginName,tunnelId,state={},allowNavigate=false,recoverRejected=false,now=Date.now()}={}){
 if(typeof tunnelId!=='string'||!/^tunnel_[A-Za-z0-9_-]{8,128}$/.test(tunnelId)||typeof allowNavigate!=='boolean'||typeof recoverRejected!=='boolean'||!Number.isSafeInteger(now)||now<0)throw invalid();
 const validated=stateInput(state);if(state.tunnel_id!==undefined&&state.tunnel_id!==tunnelId)throw invalid();
 return script(pluginPhase,{pluginName:name(pluginName),tunnelId,state:validated,allowNavigate,recoverRejected,now,description:'读取本人 Harness 项目、派发并跟进原生任务，沿用本机审批设置。'});
}
/** Pass a dedicated verification page. A sent receipt records dispatch, not task completion. */
export function buildDotPhaseScript({pluginName,prompt,requestId,mode='verify',verificationSent=false,state={},allowNavigate=false,forceResend=false,recoverRejected=false}={}){
 name(pluginName);if(typeof requestId!=='string'||!requestPattern.test(requestId)||!['verify','pending'].includes(mode)||typeof verificationSent!=='boolean'||typeof allowNavigate!=='boolean'||typeof forceResend!=='boolean'||typeof recoverRejected!=='boolean')throw invalid();
 const expected=buildDotVerificationPrompt({pluginName,requestId});if(prompt!==undefined&&prompt!==expected)throw invalid();
 return script(dotPhase,{pluginName,prompt:expected,requestId,mode,verificationSent,state:stateInput(state),allowNavigate,forceResend,recoverRejected});
}
