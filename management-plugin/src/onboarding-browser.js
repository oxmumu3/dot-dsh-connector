/** Visible first-use automation of official pages. Login and final grants stay with the human. */
import {join,dirname,isAbsolute,resolve,sep} from 'node:path';
import {rename,unlink,lstat} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {randomBytes} from 'node:crypto';
import {canonicalPrivatePath,ensurePrivateDirectory,readPrivateStateFile,writeNewPrivateStateFile} from './onboarding-store.js';
const require=createRequire(import.meta.url);
const URLS={tunnels:'https://platform.openai.com/settings/organization/tunnels',keys:'https://platform.openai.com/settings/organization/api-keys',plugins:'https://chatgpt.com/plugins',dot:'https://chatgpt.com/dots/home'};
const MESSAGES={BROWSER_UNAVAILABLE:'无法准备独立连接窗口，请检查网络后重试。',ONBOARDING_PRIVATE_STATE:'连接目录需要本人独占访问。',ONBOARDING_PAGE_CHANGED:'官方页面已变化，自动配置已暂停。请保留连接窗口并查看当前步骤。',ONBOARDING_KEY_RECOVERY:'此安装的密钥创建尚未完整记录。请在官方页面核对这条专用密钥，避免重复创建。',ONBOARDING_AUTH_TIMEOUT:'仍在等待官方页面的登录或授权。请打开连接窗口继续。',ONBOARDING_BROWSER_CLOSED:'连接窗口已关闭，可以重新打开后继续。'};
MESSAGES.ONBOARDING_AUTH_BROWSER_REJECTED='Google 拒绝了当前连接窗口。点“继续连接”返回 OpenAI 官方入口；只有该账号已有 OpenAI 邮箱密码或其他官方登录方式时才能改用。若该账号只能通过 Google 登录，当前版本无法完成自动连接。已建连接已保留。';
const fail=code=>Object.assign(new Error(MESSAGES[code]??MESSAGES.ONBOARDING_PAGE_CHANGED),{code});
const aborted=()=>Object.assign(new Error('Connection setup cancelled.'),{name:'AbortError'});
const check=signal=>{if(signal?.aborted)throw aborted();};
const pause=(ms,signal)=>new Promise((yes,no)=>{const abort=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);no(aborted());};const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);yes();},ms);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();});
export function isOfficialOnboardingUrl(value,kind){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&u.origin===(kind==='platform'?'https://platform.openai.com':kind==='chatgpt'?'https://chatgpt.com':'');}catch{return false;}}
export function buildDotVerificationPrompt({pluginName,requestId}={}){
 if(typeof pluginName!=='string'||pluginName.length>120||/[\r\n\0]/.test(pluginName)||typeof requestId!=='string'||!/^dsh_connect_[a-f0-9]{32}$/.test(requestId))throw fail('ONBOARDING_PAGE_CHANGED');
 return `请为刚连接的个人插件「${pluginName}」做一次连接自检，只使用这个插件。先调用 harness_list_workspaces 读取项目列表的元数据，只选择 task_available === true 的真实已登记项目，创建一个 Harness 原生任务；不要选择 harness-memory、harness-skills 等只读范围。若没有可派任务的项目，请明确提示我回到 Harness 添加项目后继续，不要创建任务。创建时 request_id 必须为 ${requestId}。该任务的完整要求是：只回复 DSH_SELF_TEST_OK:${requestId}，不要读取或修改文件，不要执行命令，不要联网。若同一 request_id 已有任务，查询原任务，不要另建。查询到这个任务真正完成后汇报结果；不要把已受理或运行中当成完成。此自检不授权其它任务。`;
}
const progress=(fn,phase,step,message,waiting_for)=>fn?.({phase,step,message,...waiting_for?{waiting_for}:{}});
const safeEnvironment=directory=>{const env={PLAYWRIGHT_BROWSERS_PATH:directory,PLAYWRIGHT_SKIP_BROWSER_GC:'1',ELECTRON_RUN_AS_NODE:'1'};for(const name of ['PATH','HOME','TMPDIR','TEMP','TMP','SystemRoot','HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','http_proxy','https_proxy','all_proxy','no_proxy','NODE_EXTRA_CA_CERTS','SSL_CERT_FILE','SSL_CERT_DIR'])if(process.env[name])env[name]=process.env[name];return env;};
function childResult(args,{env,signal,maximum=8192,timeoutMs=600000,spawnImpl=spawn,killGroupImpl=process.kill}={}){
 return new Promise((yes,no)=>{
  check(signal);
  // detached creates a new group for this invocation; never signal a discovered/reused PID.
  const detached=process.platform!=='win32',child=spawnImpl(process.execPath,args,{env,detached,shell:false,stdio:['ignore','pipe','ignore'],windowsHide:true});
  let chunks=[],size=0,settled=false;
  const killOwned=()=>{try{if(detached&&Number.isSafeInteger(child.pid)&&child.pid>0)killGroupImpl(-child.pid,'SIGTERM');else child.kill('SIGTERM');}catch{}};
  const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);error?no(error):yes(result);};
  const abort=()=>{killOwned();finish(aborted());};
  const timer=setTimeout(()=>{killOwned();finish(fail('BROWSER_UNAVAILABLE'));},timeoutMs);
  signal?.addEventListener('abort',abort,{once:true});
  child.stdout.on('data',b=>{size+=b.length;if(size<=maximum)chunks.push(b);});
  child.once('error',()=>finish(fail('BROWSER_UNAVAILABLE')));
  child.once('exit',code=>finish(code===0&&size<=maximum?null:fail('BROWSER_UNAVAILABLE'),Buffer.concat(chunks).toString('utf8')));
  if(signal?.aborted)abort();
 });
}
/** Browser bytes come from the pinned official Playwright distribution, never a user's Chrome. */
export async function installOnboardingBrowser({directory,signal,spawnImpl=spawn,killGroupImpl=process.kill}={}){
 await ensurePrivateDirectory(directory,{create:true});const entry=require.resolve('playwright-core'),cli=join(dirname(entry),'cli.js'),env=safeEnvironment(directory);
 await childResult([cli,'install','chromium','--no-shell'],{env,signal,maximum:1024*1024,spawnImpl,killGroupImpl});
 const executablePath=await queryOnboardingBrowserExecutable({directory,signal,spawnImpl,killGroupImpl});
 const info=await lstat(executablePath);if(!info.isFile()||info.isSymbolicLink())throw fail('BROWSER_UNAVAILABLE');return{executablePath};
}
/** Query the same resolved package entry that the native installer uses; no download or launch. */
export async function queryOnboardingBrowserExecutable({directory,signal,spawnImpl=spawn,killGroupImpl=process.kill}={}){
 await ensurePrivateDirectory(directory);const entry=require.resolve('playwright-core'),env=safeEnvironment(directory);
 const script=`const imported=await import(${JSON.stringify(pathToFileURL(entry).href)});const chromium=imported.chromium??imported.default?.chromium;if(typeof chromium?.executablePath!=='function')process.exit(1);process.stdout.write(chromium.executablePath());`;
 const executablePath=(await childResult(['--input-type=module','-e',script],{env,signal,spawnImpl,killGroupImpl})).trim();
 if(!isAbsolute(executablePath)||resolve(executablePath)!==executablePath||!executablePath.startsWith(directory+sep))throw fail('BROWSER_UNAVAILABLE');return executablePath;
}

async function launchBrowser(profile,options){const{chromium}=await import('playwright-core');return chromium.launchPersistentContext(profile,options);}
async function visible(locator){try{return await locator.count()===1&&await locator.isVisible();}catch{return false;}}
async function firstVisible(...locators){for(const locator of locators)if(await visible(locator))return locator;}
const role=(scope,name)=>scope.getByRole('button',{name,exact:true});
const placeholder=(scope,name)=>scope.getByPlaceholder(name,{exact:true});
async function uniqueDialog(page){const dialogs=page.getByRole('dialog');const count=await dialogs.count();let found;for(let i=0;i<count;i++)if(await dialogs.nth(i).isVisible()){if(found)throw fail('ONBOARDING_PAGE_CHANGED');found=dialogs.nth(i);}return found;}
const metadataFields=new Set(['version','installation_id','tunnel_name','plugin_name','plugin_id','tunnel_id','organization_id','workspace_id','tunnel_intent','key_intent','key_saved','plugin_intent','plugin_connected','verification_request_ids']);
export function createOnboardingBrowser({directory,runtimeKeyFile,tunnelName,pluginName,installationId,launch=launchBrowser,install=installOnboardingBrowser,pollMs=400,waitTimeoutMs=900000,pageReadyTimeoutMs=20000}={}){
 canonicalPrivatePath(directory);canonicalPrivatePath(runtimeKeyFile);if(runtimeKeyFile!==join(directory,'runtime.key')||typeof installationId!=='string'||! /^[a-f0-9]{32}$/.test(installationId)||tunnelName!=='dsh-dot-'+installationId||typeof pluginName!=='string'||pluginName.length>120||/[\r\n\0]/.test(pluginName))throw fail('ONBOARDING_PRIVATE_STATE');
 const metadataFile=join(directory,'browser-state.json'),profile=join(directory,'browser-profile'),browsers=join(directory,'browsers');let context,page,state,closed=false;
 async function readState(){await ensurePrivateDirectory(directory);try{const value=JSON.parse(await readPrivateStateFile(metadataFile));if(!value||Object.getPrototypeOf(value)!==Object.prototype||Object.keys(value).some(k=>!metadataFields.has(k))||value.version!==1||value.installation_id!==installationId||value.tunnel_name!==tunnelName||value.plugin_name!==pluginName)throw fail('ONBOARDING_PRIVATE_STATE');for(const k of ['tunnel_id','organization_id','workspace_id','plugin_id'])if(value[k]!==undefined&&(typeof value[k]!=='string'||! /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value[k])))throw fail('ONBOARDING_PRIVATE_STATE');for(const k of ['tunnel_intent','key_intent','key_saved','plugin_intent','plugin_connected'])if(value[k]!==undefined&&typeof value[k]!=='boolean')throw fail('ONBOARDING_PRIVATE_STATE');if(!Array.isArray(value.verification_request_ids)||value.verification_request_ids.length>32||value.verification_request_ids.some(x=>!/^dsh_connect_[a-f0-9]{32}$/.test(x)))throw fail('ONBOARDING_PRIVATE_STATE');return value;}catch(e){if(e.code!=='ENOENT')throw fail('ONBOARDING_PRIVATE_STATE');return{version:1,installation_id:installationId,tunnel_name:tunnelName,plugin_name:pluginName,verification_request_ids:[]};}}
 async function save(patch){const next={...state,...patch},temporary=join(directory,'browser-'+randomBytes(12).toString('hex')+'.tmp');try{await ensurePrivateDirectory(directory);await writeNewPrivateStateFile(temporary,JSON.stringify(next)+'\n');await rename(temporary,metadataFile);state=next;}finally{await unlink(temporary).catch(()=>{});}}
 function alive(signal){check(signal);if(closed||!context||page?.isClosed?.())throw fail('ONBOARDING_BROWSER_CLOSED');}
 async function wait(test,{signal,code='ONBOARDING_AUTH_TIMEOUT',timeout=waitTimeoutMs}={}){const until=Date.now()+timeout;do{alive(signal);const result=await test();if(result)return result;await pause(pollMs,signal);}while(Date.now()<until);throw fail(code);}
 function checkAuthenticationPage(){
  let url;try{url=new URL(page.url());}catch{return;}
  if(url.origin==='https://accounts.google.com'&&!url.username&&!url.password&&/^\/(?:v[0-9]+\/)?signin\/rejected\/?$/.test(url.pathname))throw fail('ONBOARDING_AUTH_BROWSER_REJECTED');
 }
 async function navigate(url,kind,signal){alive(signal);await page.goto(url,{waitUntil:'domcontentloaded',timeout:45000});await wait(async()=>{checkAuthenticationPage();return isOfficialOnboardingUrl(page.url(),kind);},{signal});}
 async function authenticationPending(kind){
  checkAuthenticationPage();
  if(!isOfficialOnboardingUrl(page.url(),kind))return true;
  if(/^\/(?:auth(?:\/|$)|log[-_]?in(?:\/|$)|sign[-_]?in(?:\/|$)|sign[-_]?up(?:\/|$))/i.test(new URL(page.url()).pathname))return true;
  const names=/^(?:log\s?in(?:\s+or\s+sign\s?up)?|sign\s?in|登录|登入|登录或注册|登入或註冊)$/i;
  for(const kind of ['button','link']){const controls=page.getByRole(kind,{name:names});for(let i=0;i<await controls.count();i++)if(await controls.nth(i).isVisible())return true;}
  const fields=page.locator('input[type="email"], input[type="password"], input[autocomplete="username"], input[autocomplete="current-password"], input[autocomplete="one-time-code"]');
  for(let i=0;i<await fields.count();i++)if(await fields.nth(i).isVisible())return true;
  return false;
 }
 async function waitForPageReady(test,{kind,signal}={}){
  // Official origins also serve logged-out entry screens. Only start the short DOM
  // deadline after those screens disappear; login/MFA retains the human timeout.
  let unreadySince;
  return wait(async()=>{
   if(await authenticationPending(kind)){unreadySince=undefined;return;}
   const result=await test();if(result)return result;
   unreadySince??=Date.now();if(Date.now()-unreadySince>=pageReadyTimeoutMs)throw fail('ONBOARDING_PAGE_CHANGED');
  },{signal});
 }
 async function safe(operation){try{return await operation();}catch(e){if(e?.name==='AbortError')throw aborted();if(Object.hasOwn(MESSAGES,e?.code))throw fail(e.code);if(e?.message?.includes('has been closed'))throw fail('ONBOARDING_BROWSER_CLOSED');throw fail('ONBOARDING_PAGE_CHANGED');}}
 async function tunnelReceipt(){if(!isOfficialOnboardingUrl(page.url(),'platform'))return;const rows=page.getByRole('row').filter({has:page.getByText(tunnelName,{exact:true})});if(await rows.count()!==1)return;const text=await rows.innerText(),id=text.match(/\btunnel_[A-Za-z0-9_-]{8,128}\b/);if(!id)return;const org=text.match(/\borg-[A-Za-z0-9_-]+\b/),workspace=text.match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i);return{tunnel_id:id[0],tunnel_name:tunnelName,...org?{organization_id:org[0]}:{},...workspace?{workspace_id:workspace[0]}:{}};}
 async function searchCompleteTable(name,{signal}={}){
  // Only a complete, unfiltered official table can prove that a pending draft created no resource.
  for(let visited=0;visited<20;visited++){
   alive(signal);if(!isOfficialOnboardingUrl(page.url(),'platform'))throw fail('ONBOARDING_PAGE_CHANGED');
   const exact=page.getByRole('row').filter({has:page.getByText(name,{exact:true})});const count=await exact.count();if(count>1)throw fail('ONBOARDING_PAGE_CHANGED');if(count===1)return{found:true};
   const keyList=new URL(page.url()).pathname.endsWith('/api-keys'),region=page.getByRole('region',{name:'API keys',exact:true});if(keyList&&await region.count()!==1)return{complete:false};const tables=keyList?region.getByRole('table'):page.getByRole('table');if(await tables.count()!==1||!await tables.isVisible()||await page.locator('[aria-busy="true"], [role="progressbar"]').count())return{complete:false};
   const searches=page.locator('input[type="search"]');for(let i=0;i<await searches.count();i++)if((await searches.nth(i).inputValue()).trim())return{complete:false};
   const searchboxes=page.getByRole('searchbox');for(let i=0;i<await searchboxes.count();i++)if((await searchboxes.nth(i).inputValue()).trim())return{complete:false};
   if(keyList){const chips=page.locator('.api-keys-filter-chips');if(await chips.count()!==1)return{complete:false};if(!await chips.evaluate(bar=>bar.children.length===1&&bar.children[0].tagName==='BUTTON'&&bar.children[0].textContent.trim()==='Add filter'))return{complete:false};const countLabel=region.getByText(/^\d+\s+results?$/i);if(await countLabel.count()!==1)return{complete:false};const total=Number((await countLabel.innerText()).match(/^\d+/)?.[0]),rows=tables.getByRole('row').filter({has:page.getByRole('button',{name:/^View details for /})});if(!Number.isSafeInteger(total)||total!==await rows.count())return{complete:false};}
   const rowCount=await tables.getAttribute('aria-rowcount');if(rowCount!==null&&Number(rowCount)>await tables.getByRole('row').count())return{complete:false};
   const next=page.getByRole('button',{name:/^(Next|Next page|下一页|下一頁)$/i});if(await next.count()>1)return{complete:false};
   if(await next.count()===1&&await next.isEnabled()){await next.click();await pause(pollMs,signal);continue;}
   const pagination=page.getByRole('navigation',{name:/pagination|分页|分頁/i});if(await next.count()===0&&await pagination.count())return{complete:false};
   return{found:false,complete:true};
  }
  return{complete:false};
 }
 async function matchingKeyDraft(){if(!isOfficialOnboardingUrl(page.url(),'platform'))return;const dialog=await uniqueDialog(page);if(!dialog)return;const field=placeholder(dialog,'My Test Key');if(await field.count()===1&&await field.inputValue()===tunnelName+'-runtime')return dialog;}
 async function createdKey(){if(!isOfficialOnboardingUrl(page.url(),'platform')||!state.key_intent)return;const dialog=await uniqueDialog(page);if(!dialog)return;const heading=dialog.getByRole('heading',{name:/^(Save your key|保存.*密钥|保存.*金鑰)$/i});if(await heading.count()!==1)return;const field=dialog.locator('input[readonly], textarea[readonly]');if(await field.count()!==1)return;const value=await field.inputValue();if(!/^sk-[A-Za-z0-9_-]{20,1024}$/.test(value))return;return value;}
 async function existingKey(){try{await readPrivateStateFile(runtimeKeyFile,4096);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
 async function configurePermissions(dialog,signal){
  const restricted=dialog.getByRole('radio',{name:/^(Restricted|受限|限制)$/i});if(await restricted.count()!==1)throw fail('ONBOARDING_PAGE_CHANGED');await restricted.check();
  const tunnel=dialog.getByText('Tunnels',{exact:true});if(await tunnel.count()!==1)throw fail('ONBOARDING_PAGE_CHANGED');
  const row=tunnel.locator('xpath=ancestor-or-self::button[1]/..');const dropdown=row.getByRole('button').filter({hasText:/^(None|All selected|无|無)$/});if(await dropdown.count()!==1)throw fail('ONBOARDING_PAGE_CHANGED');await dropdown.click();
  const list=page.locator('[role="listbox"][aria-multiselectable="true"]');if(!await visible(list))throw fail('ONBOARDING_PAGE_CHANGED');
  for(const id of ['api.organization.tunnel.read','api.organization.tunnel.use']){const option=list.locator(`[role="option"][data-option-id="${id}"]`);if(await option.count()!==1)throw fail('ONBOARDING_PAGE_CHANGED');if(await option.getAttribute('aria-selected')!=='true')await option.click();}
  const selected=list.locator('[role="option"][aria-selected="true"]');if(await selected.count()!==2)throw fail('ONBOARDING_PAGE_CHANGED');
  for(let i=0;i<2;i++)if(!['api.organization.tunnel.read','api.organization.tunnel.use'].includes(await selected.nth(i).getAttribute('data-option-id')))throw fail('ONBOARDING_PAGE_CHANGED');
  await page.keyboard.press('Escape');check(signal);
  const allScoped=await row.locator('..').evaluate(container=>{
   const rows=Array.from(container.children).filter(el=>el.querySelector(':scope > button[disabled]')||el.querySelector(':scope > [role="button"][aria-haspopup="dialog"]'));
   if(rows.length<2)return false;let tunnels=0;
   for(const resource of rows){const labels=resource.querySelectorAll(':scope > button[disabled]'),controls=resource.querySelectorAll(':scope > [role="button"][aria-haspopup="dialog"]');if(labels.length!==1||controls.length!==1)return false;const name=labels[0].textContent.trim(),value=controls[0].textContent.trim();if(!name)return false;if(name==='Tunnels'){tunnels++;if(value!=='All selected')return false;}else if(value!=='None')return false;}
   return tunnels===1;
  });
  if(!allScoped||!await visible(dialog.getByText('2 selected permissions',{exact:true})))throw fail('ONBOARDING_PAGE_CHANGED');
 }
 async function prepareKey({signal,onProgress}){
  if(await existingKey()){if(state.key_saved)return;throw fail('ONBOARDING_KEY_RECOVERY');}
  let secret=await createdKey();const draft=await matchingKeyDraft();
  if(!secret&&draft){progress(onProgress,'authorize','key_confirm','专用运行密钥已填好，请核对后在官方页面确认创建。','authorization');secret=await wait(()=>createdKey(),{signal});}
  if(!secret){
   await navigate(URLS.keys,'platform',signal);progress(onProgress,'login','platform_login','请在官方页面登录自己的 OpenAI 账号。','login');
   const add=await waitForPageReady(()=>firstVisible(role(page,'Create new secret key'),role(page,'创建新密钥')),{kind:'platform',signal});if(state.key_intent){const listed=await searchCompleteTable(tunnelName+'-runtime',{signal});if(listed.found||listed.complete!==true)throw fail('ONBOARDING_KEY_RECOVERY');}await add.click();const dialog=await wait(()=>uniqueDialog(page),{signal,code:'ONBOARDING_PAGE_CHANGED',timeout:15000});
   const name=await firstVisible(placeholder(dialog,'My Test Key'));if(!name)throw fail('ONBOARDING_PAGE_CHANGED');await name.fill(tunnelName+'-runtime');
   await configurePermissions(dialog,signal);
   const project=await firstVisible(role(dialog,'Select project...'),role(dialog,'选择项目...'));
   if(project){await project.click();const options=page.getByRole('option');const count=await options.count();if(count===1)await options.click();else{progress(onProgress,'authorize','key_project','请在官方页面选择这个连接使用的 OpenAI 项目。','project');await wait(async()=>{const draft=await matchingKeyDraft();return draft&&!await firstVisible(role(draft,'Select project...'),role(draft,'选择项目...'));},{signal});}}
   const expiry=await firstVisible(dialog.getByRole('button',{name:/^(Expiry|有效期)/i}));if(!expiry)throw fail('ONBOARDING_PAGE_CHANGED');await expiry.click();const thirty=await firstVisible(page.getByRole('option',{name:/^(30 days|30天|30 天)$/i}),page.getByText('30天',{exact:true}),page.getByText('30 天',{exact:true}));if(!thirty)throw fail('ONBOARDING_PAGE_CHANGED');await thirty.click();const expiryValue=dialog.locator('input#project-key-expiration');if(await expiryValue.count()!==1||await expiryValue.inputValue()!=='30'||!await visible(dialog.getByRole('button',{name:/^(Expiry|有效期).*30\s*(天|days)$/i})))throw fail('ONBOARDING_PAGE_CHANGED');
   await save({key_intent:true});progress(onProgress,'authorize','key_confirm','专用运行密钥已填好，仅授予 Tunnels 读取和使用权限；有效期30天。请核对后确认创建。','authorization');
   // Only the human presses the final Create. No checkbox or consequential confirmation is clicked here.
   secret=await wait(()=>createdKey(),{signal});
  }
  try{await writeNewPrivateStateFile(runtimeKeyFile,secret+'\n');}catch(e){if(e.code==='EEXIST')throw fail('ONBOARDING_KEY_RECOVERY');throw e;}finally{secret=undefined;}
  await save({key_saved:true});
 }
 async function installedCollection(){
  if(!isOfficialOnboardingUrl(page.url(),'chatgpt')||new URL(page.url()).pathname!=='/plugins')return;
  const nav=page.getByRole('navigation',{name:/^(自定义|Custom)$/});if(await nav.count()!==1)return;
  return nav.evaluate((root,name)=>{
   const sections=Array.from(root.querySelectorAll('div')).filter(el=>el.children.length===2&&['已安装','Installed'].includes(el.children[0].textContent.trim())&&el.children[1].classList.contains('group/nav-list'));
   if(sections.length!==1||root.querySelector('[aria-busy="true"], [role="status"], [role="progressbar"]'))return;
   if(Array.from(root.querySelectorAll('input')).some(input=>input.value.trim()))return;
   const anchors=Array.from(sections[0].children[1].querySelectorAll('a[href^="/plugins/plugin_asdk_app_"]'));
   if(anchors.some(a=>!/^\/plugins\/plugin_asdk_app_[A-Za-z0-9_-]+$/.test(a.getAttribute('href')??'')))return;
   return{fingerprint:anchors.map(a=>a.getAttribute('href')).sort().join('|'),target:anchors.some(a=>a.textContent.trim()===name)};
  },pluginName);
 }
 async function pluginDraftMayRestart(signal){
  if(state.plugin_id||await page.getByText(pluginName,{exact:true}).count())return false;
  if(!state.plugin_intent)return true;
  // A fresh full navigation has already happened. Wait for the main surface and a stable,
  // unfiltered installed collection before rebuilding a cancelled, unsubmitted draft.
  let fingerprint,stableSince=0;
  return wait(async()=>{
   const ready=await firstVisible(placeholder(page,'搜索插件'),placeholder(page,'Search plugins'));
   const collection=ready&&await installedCollection();
   if(!collection){fingerprint=undefined;stableSince=0;return;}
   if(collection.target)return{existing:true};
   if(collection.fingerprint!==fingerprint){fingerprint=collection.fingerprint;stableSince=Date.now();return;}
   if(Date.now()-stableSince>=5000)return{absent:true};
  },{signal,code:'ONBOARDING_PAGE_CHANGED',timeout:pageReadyTimeoutMs}).then(result=>result.absent===true);
 }
 async function pluginReceipt(signal){
  if(!isOfficialOnboardingUrl(page.url(),'chatgpt'))return;
  const path=new URL(page.url()).pathname;
  let id=state.plugin_id;
  if(!id){
   const link=page.getByRole('link',{name:pluginName,exact:true});if(await link.count()!==1)return;
   const href=await link.getAttribute('href'),match=href?.match(/^\/plugins\/(plugin_asdk_app_[A-Za-z0-9_-]+)$/);if(!match)return;
   id=match[1];await save({plugin_id:id});
  }
  const detail='/plugins/'+id,settings='/settings/plugins-settings/'+id;
  if(path===settings){
   const title=page.getByRole('heading',{name:pluginName,exact:true,level:1}),uninstall=await firstVisible(role(page,'卸载'),role(page,'Uninstall')),linked=page.getByText(/^(关联日期|關聯日期|Connected on|Date connected|Connection date|Associated date)$/i);
   if(!await visible(title)||!uninstall||await linked.count()!==1)return;
   const association=await linked.evaluate(label=>{const siblings=Array.from(label.parentElement?.children??[]).filter(el=>el!==label&&!el.contains(label));return siblings.length===1?siblings[0].textContent.trim():undefined;});
   // The account's locale determines the date format. Require a distinct actual
   // value alongside both the exact plugin title and an uninstall action.
   if(typeof association!=='string'||association.length<4||association.length>80||!/[0-9]/.test(association))return;
   return{plugin_id:id,plugin_name:pluginName,connected:true};
  }
  if(path===detail){
   if(!await visible(page.getByRole('heading',{name:pluginName,exact:true,level:1})))return;
   const manage=page.getByRole('link',{name:/^(管理|Manage)$/});if(await manage.count()!==1||await manage.getAttribute('href')!==settings)return;
   await navigate('https://chatgpt.com'+settings,'chatgpt',signal);return;
  }
  if(path==='/plugins'){await navigate('https://chatgpt.com'+detail,'chatgpt',signal);return;}
 }

 return{
  async prepare({signal,onProgress}={}){return safe(async()=>{check(signal);if(context&&!closed)return;await ensurePrivateDirectory(directory);await ensurePrivateDirectory(profile,{create:true});await ensurePrivateDirectory(browsers,{create:true});state=await readState();progress(onProgress,'installing','browser_install','正在准备独立连接窗口。');let installed;try{installed=await install({directory:browsers,signal,onProgress});check(signal);context=await launch(profile,{headless:false,executablePath:installed.executablePath,acceptDownloads:false,viewport:{width:1120,height:820},locale:'zh-CN',chromiumSandbox:true,ignoreDefaultArgs:['--unsafely-disable-devtools-self-xss-warnings'],env:safeEnvironment(browsers),timeout:45000});check(signal);}catch(e){const acquired=context;context=undefined;await acquired?.close().catch(()=>{});if(e?.name==='AbortError')throw e;throw fail('BROWSER_UNAVAILABLE');}closed=false;page=context.pages()[0]??await context.newPage();return{prepared:true};});},
  async provision({signal,onProgress}={}){return safe(async()=>{alive(signal);if(await existingKey()&&!state.key_saved)throw fail('ONBOARDING_KEY_RECOVERY');let receipt=state.tunnel_id?{tunnel_id:state.tunnel_id,tunnel_name:tunnelName,...state.organization_id?{organization_id:state.organization_id}:{},...state.workspace_id?{workspace_id:state.workspace_id}:{}}:undefined;
   if(!receipt){progress(onProgress,'login','platform_login','请在官方页面登录自己的 OpenAI 账号。','login');await navigate(URLS.tunnels,'platform',signal);await waitForPageReady(async()=>await tunnelReceipt()||firstVisible(role(page,'Create tunnel'),role(page,'创建隧道')),{kind:'platform',signal});receipt=await tunnelReceipt();if(!receipt){if(state.tunnel_intent){const listed=await searchCompleteTable(tunnelName,{signal});if(listed.found){receipt=await tunnelReceipt();if(!receipt)throw fail('ONBOARDING_PAGE_CHANGED');}else if(listed.complete!==true)throw fail('ONBOARDING_PAGE_CHANGED');}if(!receipt){const add=await waitForPageReady(()=>firstVisible(role(page,'Create tunnel'),role(page,'创建隧道')),{kind:'platform',signal});await add.click();const dialog=await wait(()=>uniqueDialog(page),{signal,code:'ONBOARDING_PAGE_CHANGED',timeout:15000});const name=await firstVisible(placeholder(dialog,'e.g. West Coast MCP tunnel'));const description=await firstVisible(placeholder(dialog,'Add a short description to help your team.'));if(!name||!description)throw fail('ONBOARDING_PAGE_CHANGED');await name.fill(tunnelName);await description.fill('Personal Dot connection to this DeepSeek Harness installation.');await save({tunnel_intent:true});progress(onProgress,'authorize','tunnel_scope','请选择自己的 ChatGPT workspace，核对连接范围后在官方页面确认创建。','workspace');}}
    receipt??=await wait(()=>tunnelReceipt(),{signal});if(!receipt.workspace_id){progress(onProgress,'authorize','tunnel_scope','请在官方页面为这条专用隧道关联自己的 ChatGPT workspace。','workspace');receipt=await wait(async()=>{const found=await tunnelReceipt();return found?.workspace_id?found:undefined;},{signal});}await save(receipt);
   }
   await prepareKey({signal,onProgress});return receipt;
  });},
  async connectPlugin({tunnel_id,signal,onProgress}={}){return safe(async()=>{alive(signal);if(tunnel_id!==state.tunnel_id||!/^tunnel_[A-Za-z0-9_-]{8,128}$/.test(tunnel_id??''))throw fail('ONBOARDING_PRIVATE_STATE');progress(onProgress,'login','chatgpt_login','请在官方页面登录自己的 ChatGPT 账号。','login');await navigate(URLS.plugins,'chatgpt',signal);const entry=await waitForPageReady(async()=>await pluginReceipt(signal)||firstVisible(role(page,'添加'),role(page,'Add'),placeholder(page,'搜索插件'),placeholder(page,'Search plugins')),{kind:'chatgpt',signal});if(entry.connected)return entry;
   if(await pluginDraftMayRestart(signal)){const add=await wait(()=>firstVisible(role(page,'添加'),role(page,'Add')),{signal,code:'ONBOARDING_PAGE_CHANGED',timeout:pageReadyTimeoutMs});await add.click();const customName=/^(添加自定义 MCP 服务器|Add custom MCP server)$/i;const custom=await wait(()=>firstVisible(page.getByRole('menuitem',{name:customName}),page.getByRole('button',{name:customName}),page.getByText(customName)),{signal,code:'ONBOARDING_PAGE_CHANGED',timeout:15000});await custom.click();const dialog=await wait(()=>uniqueDialog(page),{signal,code:'ONBOARDING_PAGE_CHANGED',timeout:15000});const name=await firstVisible(dialog.getByRole('textbox',{name:/^(名称|Name)$/i}),placeholder(dialog,'自定义工具'),placeholder(dialog,'Custom tools'),placeholder(dialog,'Custom tool'));const desc=await firstVisible(dialog.getByRole('textbox',{name:/^(描述|Description)$/i}),placeholder(dialog,'用几句话说明它的功能'),placeholder(dialog,'Describe what it does in a few words'));const tunnel=await firstVisible(role(dialog,'隧道'),role(dialog,'Tunnel'));if(!name||!desc||!tunnel)throw fail('ONBOARDING_PAGE_CHANGED');await name.fill(pluginName);await desc.fill('读取本人 Harness 项目、派发并跟进原生任务，沿用本机审批设置。');await tunnel.click();const id=await firstVisible(placeholder(dialog,'tunnel_...'));const auth=dialog.locator('select');if(!id||await auth.count()!==1)throw fail('ONBOARDING_PAGE_CHANGED');await id.fill(tunnel_id);await auth.selectOption('NONE');await save({plugin_intent:true});}
   progress(onProgress,'authorize','plugin_confirm','个人连接已填好。请核对后确认创建，并完成 ChatGPT 显示的连接授权。','authorization');const connected=await wait(()=>pluginReceipt(signal),{signal});await save({plugin_connected:true,plugin_id:connected.plugin_id});return connected;
  });},
  async verifyDot({requestId,forceResend=false,signal,onProgress}={}){return safe(async()=>{alive(signal);const prompt=buildDotVerificationPrompt({pluginName,requestId});if(state.verification_request_ids.includes(requestId)&&forceResend!==true)return{sent:true};progress(onProgress,'verifying','dot_verify','正在让你的 Dot 读取项目并运行一个只回复标记的自检任务。');await navigate(URLS.dot,'chatgpt',signal);const editor=await wait(async()=>{if(!isOfficialOnboardingUrl(page.url(),'chatgpt'))return;return firstVisible(page.locator('div[role="textbox"][aria-label="消息"][contenteditable="true"]'),page.locator('div[role="textbox"][aria-label="Message"][contenteditable="true"]'));},{signal});await editor.fill(prompt);const send=await firstVisible(role(page,'发送'),role(page,'Send'));if(!send||!await send.isEnabled())throw fail('ONBOARDING_PAGE_CHANGED');await send.click();await save({verification_request_ids:[...new Set([...state.verification_request_ids,requestId])].slice(-32)});return{sent:true};});},
  async pendingAction({signal}={}){return safe(async()=>{
   alive(signal);if(!isOfficialOnboardingUrl(page.url(),'chatgpt')||!/^\/dots(?:\/|$)/.test(new URL(page.url()).pathname))return;
   const explicit=page.getByRole('button',{name:/^(Allow once|Allow this tool|Approve tool use|允许一次|允許一次|允许使用工具|允许调用工具)$/i});
   for(let i=0;i<await explicit.count();i++)if(await explicit.nth(i).isVisible())return{step:'dot_tool_approval'};
   const dialogs=page.getByRole('dialog');for(let i=0;i<await dialogs.count();i++){
    const dialog=dialogs.nth(i);if(!await dialog.isVisible())continue;
    const toolContext=await firstVisible(dialog.getByRole('heading',{name:/tool|工具/i}),dialog.getByText(pluginName,{exact:true}));
    if(toolContext&&await firstVisible(dialog.getByRole('button',{name:/^(Allow|Approve|允许|允許|批准)$/i})))return{step:'dot_tool_approval'};
   }
  });},
  async focus(){if(!context||closed)throw fail('ONBOARDING_BROWSER_CLOSED');await page?.bringToFront();},
  async close(){if(closed)return;closed=true;const owned=context;context=undefined;page=undefined;await owned?.close().catch(()=>{});},
 };
}
