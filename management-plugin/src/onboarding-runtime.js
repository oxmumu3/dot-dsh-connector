/** Host-owned, non-blocking first connection workflow. All public views are allowlisted. */
import {join} from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {createOnboardingStore,readPrivateStateFile} from './onboarding-store.js';
import {createTunnelRuntime} from './onboarding-tunnel.js';
import {createCredentialLifecycle} from './onboarding-credentials.js';
const MESSAGES={idle:'连接 Dot 后，就能读取项目并给 Harness 派任务。',preparing:'正在检查这台电脑的连接环境。',installing:'正在准备官方连接组件。',login:'请在打开的官方页面登录自己的 OpenAI 账号。',authorize:'请在官方页面确认这台电脑的连接与工具权限。',connecting:'正在连接本机 Harness 与你的 Dot。',verifying:'正在用真实 Dot 读取项目并完成一个小任务。',ready:'Dot 已连接，可以读取项目并给 Harness 派任务。',cancelled:'连接已暂停，可以稍后继续。',blocked:'连接尚未完成。请重试或打开官方页面继续。',external:'当前使用已有外部连接。插件保留其配置，不会接管服务。'};
MESSAGES.restoring='本机通道已启动，正在等待 Dot 首次调用核实连接。上次读取和任务验证记录已保留。';
const ERRORS={RESTORE_UNAVAILABLE:'本机连接尚未恢复。上次验证记录已保留，可继续连接或重新验证。',MCP_ENTRY_UNAVAILABLE:'本机 MCP 入口无法使用当前 Harness 的 Node 启动。请检查本机运行环境后重试。',ONBOARDING_PAGE_CHANGED:'官方页面已变化。请打开连接窗口查看当前步骤，再继续连接。',ONBOARDING_KEY_RECOVERY:'请打开官方页面重新生成本机连接密钥；已建通道会保留。',ONBOARDING_AUTH_TIMEOUT:'登录或授权尚未完成。请打开官方页面继续。',ONBOARDING_BROWSER_CLOSED:'连接窗口已关闭。请继续连接以重新打开。',ONBOARDING_LOCKED:'另一个连接向导正在使用此安装。请先关闭原向导。',ONBOARDING_PRIVATE_STATE:'连接状态目录需要本人独占访问。请检查本机诊断后重试。',SETUP_RUNNING:'请先停止本插件拥有的本机服务，再重新开始连接。',VERIFY_TIMEOUT:'尚未核实 Dot 的实际读取和任务结果。可以继续验证。',TUNNEL_INTEGRITY:'官方组件下载校验未通过，请重试。',TUNNEL_DOWNLOAD:'官方组件暂时无法下载，请检查网络后重试。',TUNNEL_ARCHIVE:'官方组件解压校验未通过，请重试。',BROWSER_UNAVAILABLE:'无法打开官方连接窗口，请重试。',LOCAL_UNAVAILABLE:'本机服务尚未就绪，请查看本机诊断后重试。',CONNECTION_FAILED:'连接尚未完成，请重新打开官方页面继续。'};
const failure=code=>Object.assign(new Error(ERRORS[code]??ERRORS.CONNECTION_FAILED),{code});
ERRORS.ONBOARDING_AUTH_BROWSER_REJECTED='Google 拒绝了当前登录。点“继续连接”返回 OpenAI 官方入口重新登录；若账号已有 OpenAI 邮箱密码或其他官方登录方式，也可在官方页面选择。若仍被 Google 拒绝且没有其他登录方式，需要由官方处理；插件不会绕过登录限制。已建连接已保留。';
ERRORS.VERIFY_TASK_FAILED='Harness 验证任务未完成。请打开验证任务查看失败原因，处理后重新验证。';
ERRORS.VERIFY_TASK_CANCELLED='Harness 验证任务已取消。可以打开验证任务核对，准备好后重新验证。';
ERRORS.VERIFY_TIMEOUT='尚未收到完整验证结果，连接通道已保留。请查看连接窗口；如有工具授权请先确认，再重试连接。';
Object.assign(ERRORS,{
 KEY_RENEW_UNVERIFIED:'新授权尚未通过连接验证，原授权已保留。请检查网络或官方授权后继续更新。',
 KEY_RENEW_CONTINUE:'连接授权已更新。请继续首次连接，完成 Dot 读取与任务验证。',
 ONBOARDING_EGO_SPACE_MISSING:'原连接窗口已关闭。请重新打开连接窗口，现有账号授权与任务会保留。',
 EGO_BROWSER_UNAVAILABLE:'连接窗口需要 Ego。点击“安装 Ego 并继续”，插件会准备官方浏览器；已有连接和任务会保留。',
 EGO_SETUP_REQUIRED:'请完成已打开的 Ego 首次设置；无需导入其他浏览器的数据。完成后点击“我已完成，继续连接”。',
 EGO_INSTALL_DOWNLOAD:'Ego 暂时无法下载。请检查网络后点击“重试安装 Ego”。',
 EGO_INSTALL_INTEGRITY:'Ego 安装文件未通过官方签名校验，已停止安装。可以重试下载。',
 EGO_INSTALL_FAILED:'Ego 尚未准备好。请检查系统提示后重试，已有应用不会被覆盖。',
 ONBOARDING_EGO_CONTROL:'Ego 连接窗口正由你操作或已暂停。完成当前操作后，回到这里点击“继续连接”。',
 ONBOARDING_EGO_HANDOFF:'请在 Ego 窗口完成登录、选择或确认授权，再回到这里点击“继续连接”。',
 ONBOARDING_EGO_BINDING_RECOVERY:'原 Ego 连接窗口的创建结果尚未确认。请保留原窗口检查连接，不会另开窗口重复创建。',
 ONBOARDING_EGO_FINALIZATION_RECOVERY:'连接窗口的收尾或恢复结果尚未确认。已有连接配置和验证记录已保留。请保留原 Ego 窗口并查看本机诊断；自动操作已停止，不会重复收尾或另建窗口。',
 ONBOARDING_EGO_TIMEOUT:'刚才的窗口操作结果尚未确认。请检查原 Ego 窗口，再点击“继续连接”。',
 ONBOARDING_EGO_OUTPUT_LIMIT:'连接窗口返回异常内容，自动操作已暂停。请检查原 Ego 窗口后继续。',
 ONBOARDING_EGO_BUSY:'连接窗口正在执行前一步操作，请稍后继续。',
 ONBOARDING_DOT_SEND_UNCONFIRMED:'自检消息的发送结果尚未确认，正在保留原请求核对，请勿重复发送。',
});
const blank=()=>({tunnel_online:false,chatgpt_connected:false,dot_read:false,task_complete:false});
const terminal=new Set(['idle','ready','restoring','cancelled','blocked','external']);
const BROWSER_STEPS={
 browser_install:{phase:'installing',message:'正在准备官方连接窗口。'},
 platform_login:{phase:'login',waiting_for:'login',message:'请在 Ego 官方页面登录自己的 OpenAI 账号，完成后回到这里点“继续连接”。'},
 tunnel_scope:{phase:'authorize',waiting_for:'workspace',message:'请确认连接通道所在的 OpenAI workspace，完成后回到这里点“继续连接”。'},
 tunnel_confirm:{phase:'authorize',waiting_for:'authorization',message:'请在官方页面确认创建本机专用连接通道，完成后回到这里点“继续连接”。'},
 key_project:{phase:'authorize',waiting_for:'project',message:'请确认连接通道使用的 OpenAI 项目，完成后回到这里点“继续连接”。'},
 key_confirm:{phase:'authorize',waiting_for:'authorization',message:'请确认创建专用运行密钥。创建后请保留“Save your key／保存密钥”窗口，回到这里点“继续连接”；无需复制密钥。'},
 chatgpt_login:{phase:'login',waiting_for:'login',message:'请在 Ego 登录使用 Dot 的 ChatGPT 账号，完成后回到这里点“继续连接”。'},
 plugin_confirm:{phase:'authorize',waiting_for:'authorization',message:'请确认把 Harness 工具加入自己的 Dot，并完成官方连接授权，再回到这里点“继续连接”。'},
 plugin_connect:{phase:'connecting',waiting_for:'authorization',message:'请在官方页面确认连接与工具授权，再回到这里点“继续连接”。'},
 dot_verify:{phase:'verifying',message:MESSAGES.verifying},
};
function view(phase='idle',verification=blank(),error){return{phase,step:phase,message:MESSAGES[phase]??MESSAGES.blocked,...phase==='login'?{waiting_for:'login'}:phase==='authorize'?{waiting_for:'authorization'}:{},actions:{start:phase==='idle',resume:['cancelled','blocked','ready','restoring'].includes(phase),cancel:phase==='restoring'||!terminal.has(phase),open:['login','authorize','connecting','verifying','ready','blocked'].includes(phase)},verification:{...verification},...error?{error}:{}};}
export const externalConnectionStatus=()=>view('external');
const stamp=value=>typeof value==='string'?Date.parse(value):NaN;
const taskIdentity=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,200}$/.test(value);
function verificationTask(value){
 if(!value||!taskIdentity(value.job_id)||!taskIdentity(value.session_id)||!['accepted','starting','running','cancel_requested','succeeded','failed','cancelled','unknown'].includes(value.status))return;
 const count=value=>Number.isSafeInteger(value)&&value>0?Math.min(value,1000):0;
 return{job_id:value.job_id,session_id:value.session_id,status:value.status,pending_approvals:count(value.pending_approvals),user_question_count:count(value.user_question_count)};
}
/** Reads only authenticated manager receipts. Browser UI text is never evidence. */
export function createOnboardingVerifier({call,now=Date.now,healthFreshMs=35000}={}){
 if(typeof call!=='function')throw failure('LOCAL_UNAVAILABLE');
 return async({requestId,startedAt,signal}={})=>{
  const start=stamp(startedAt);let current=now();const fresh=value=>Number.isFinite(stamp(value))&&stamp(value)>=start&&stamp(value)<=current;
  const overview=await call('manager_overview',{include_control:false},signal),c=overview?.connection??{};current=now();
  const checked=stamp(c.cloud_checked_at),tunnel_online=c.cloud_state==='online'&&c.cloud_source==='official_tunnel_health'&&checked>=start&&checked<=current&&current-checked<=healthFreshMs&&fresh(c.cloud_last_interaction_at);
  let dot_read=false,offset=0;
  for(let page=0;page<5;page++){
   const events=await call('manager_events',{category:'read',outcome:'succeeded',limit:100,offset},signal);
   current=now();dot_read=Array.isArray(events?.items)&&events.items.some(e=>e?.tool==='harness_list_workspaces'&&e.outcome==='succeeded'&&fresh(e.created_at));
   if(dot_read||!Number.isSafeInteger(events?.next_offset)||events.next_offset<=offset)break;offset=events.next_offset;
  }
  const jobs=await call('manager_jobs',{request_id:requestId,archived:false,limit:100,offset:0},signal);current=now();let task_complete=false,task,task_absent=false;
  const completeEmpty=value=>Array.isArray(value?.items)&&value.items.length===0&&value.total===0&&value.offset===0&&value.next_offset===null&&(value.has_more===undefined||value.has_more===false);
  if(completeEmpty(jobs)){const archived=await call('manager_jobs',{request_id:requestId,archived:true,limit:100,offset:0},signal);current=now();task_absent=completeEmpty(archived);}
  for(const item of (Array.isArray(jobs?.items)?jobs.items:[]).slice(0,100)){
   if(item?.request_id!==requestId||!fresh(item.created_at)||typeof item.job_id!=='string')continue;
   const detail=await call('manager_job',{job_id:item.job_id},signal),job=detail?.job;current=now();
   if(detail.cached===true||!job||job.request_id!==requestId||job.execution_kind!=='native'||!fresh(job.created_at)||(job.job_id!==undefined&&job.job_id!==item.job_id))continue;
   task=verificationTask({...job,job_id:item.job_id});
   if(job.status!=='succeeded'||job.reason!=='completed'||!fresh(job.finished_at)||typeof job.result!=='string'||!job.result.includes('DSH_SELF_TEST_OK:'+requestId)||typeof job.session_id!=='string'||!job.session_id||typeof job.message_id!=='string'||!job.message_id||!Number.isSafeInteger(job.turn)||job.turn<0)continue;
   task_complete=true;break;
  }
  return{tunnel_online:Boolean(tunnel_online&&now()>=checked&&now()-checked<=healthFreshMs),dot_read,task_complete,task_absent,...task?{task}:{}};
 };
}
/** Current transport health is independent of a saved successful self-test. */
export function createTransportHealth({call,now=Date.now,healthFreshMs=35000}={}){
 return async({startedAt,signal}={})=>{
  if(typeof call!=='function')return{tunnel_online:false};
  const result=await call('manager_overview',{include_control:false},signal),c=result?.connection??{},current=now(),checked=stamp(c.cloud_checked_at),start=stamp(startedAt);
  const fresh=c.cloud_source==='official_tunnel_health'&&Number.isFinite(checked)&&checked>=start&&checked<=current&&current-checked<=healthFreshMs;
  return{tunnel_online:fresh&&c.cloud_state==='online',...fresh&&c.cloud_state==='unknown'&&c.cloud_reason==='awaiting_first_call'?{awaiting_first_call:true}:{}};
 };
}
const defaultBrowser=async options=>(await import('./onboarding-ego.js')).createEgoOnboardingBrowser(options);
const defaultEgoInstaller=async()=>(await import('./onboarding-ego-install.js')).createEgoInstaller();
const egoSetupCodes=new Set(['EGO_BROWSER_UNAVAILABLE','EGO_SETUP_REQUIRED','EGO_INSTALL_DOWNLOAD','EGO_INSTALL_INTEGRITY','EGO_INSTALL_FAILED']);
const sleep=(ms,signal)=>new Promise((done,reject)=>{const abort=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);reject(Object.assign(new Error('Cancelled.'),{name:'AbortError'}));};const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);done();},ms);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();});
export function createOnboardingRuntime({local,browserFactory=defaultBrowser,egoInstallerFactory=defaultEgoInstaller,tunnelFactory=createTunnelRuntime,store:providedStore,now=Date.now,verify:providedVerify,transportHealth:providedTransportHealth,call,directory:requestedDirectory,pollMs=1000,verifyTimeoutMs=180000,monitorMs=5000}={}){
 let state=view(),store=providedStore,browser,tunnel,flight,controller,generation=0,closed=false,monitor,monitoring,lastVerifiedAt,verificationSource,cleanupPending=false,credentials,credentialView,renewalPurpose=false,canRenew=false;
 const verify=providedVerify??(call?createOnboardingVerifier({call,now}):undefined);
 const transportHealth=providedTransportHealth??createTransportHealth({call,now});
 const snapshot=()=>structuredClone({...state,...lastVerifiedAt?{last_verified_at:lastVerifiedAt}:{},...verificationSource?{verification_source:verificationSource}:{},...cleanupPending?{cleanup_pending:true}:{},...credentialView?{credential:credentialView}:{},...renewalPurpose?{purpose:'key-renewal'}:{},actions:{...state.actions,renew:canRenew&&!closed&&!flight,restart_key:renewalPurpose&&!flight&&['ONBOARDING_KEY_RECOVERY','KEY_RENEW_UNVERIFIED'].includes(state.error?.code),reopen:!flight&&state.error?.code==='ONBOARDING_EGO_SPACE_MISSING'&&Boolean(browser),open:state.actions.open&&Boolean(browser)&&!egoSetupCodes.has(state.error?.code)&&state.error?.code!=='ONBOARDING_EGO_SPACE_MISSING',cancel:state.actions.cancel||state.phase==='blocked'&&Boolean(browser||tunnel)}});
 const valid=g=>!closed&&g===generation&&!controller?.signal.aborted;
 const update=(phase,g,error)=>{if(valid(g))state={...view(phase,state.verification,error),...phase==='blocked'&&state.verification_task?{verification_task:state.verification_task}:{}};};
 async function loadCredentials(directory,metadata){
  credentials??=createCredentialLifecycle({directory,withOwnership:operation=>store.withOwnership(operation),now});await credentials.recover();credentialView=await credentials.status();canRenew=Boolean(metadata.tunnel_id);
 }
 async function releaseResources(){const resources=[browser,tunnel];browser=undefined;tunnel=undefined;await Promise.allSettled(resources.map(r=>r?.close()));}
 const progress=g=>value=>{if(!valid(g))return;const step=Object.hasOwn(BROWSER_STEPS,value?.step??'')?BROWSER_STEPS[value.step]:undefined;if(step){state={...view(step.phase,state.verification),...step,step:value.step};return;}const phase=['preparing','installing','login','authorize','connecting','verifying'].includes(value?.phase)?value.phase:undefined;if(phase)update(phase,g);};
 async function localReady(result){if(!result||result.phase==='blocked'||result.error)throw failure(result?.error?.code==='SETUP_RUNNING'?'SETUP_RUNNING':'LOCAL_UNAVAILABLE');return result;}
 async function verifyUntil({signal,g,metadata}){
  if(!verify)throw failure('LOCAL_UNAVAILABLE');let remaining=verifyTimeoutMs,previous=now(),wasWaiting=false;
  for(;;){
   if(!valid(g))return;const receipt=await verify({requestId:metadata.request_id,startedAt:metadata.attempt_started_at,signal});if(!valid(g))return;
   state.verification={tunnel_online:receipt?.tunnel_online===true,chatgpt_connected:state.verification.chatgpt_connected,dot_read:receipt?.dot_read===true,task_complete:receipt?.task_complete===true};
   if(Object.values(state.verification).every(Boolean)){const completed=new Date(now()).toISOString();await store.update({completed_at:completed});lastVerifiedAt=completed;verificationSource='current_attempt';update('ready',g);return;}
   const task=verificationTask(receipt?.task),harnessWaiting=task&&['accepted','starting','running'].includes(task.status)&&(task.pending_approvals>0||task.user_question_count>0);
   let pending;try{pending=await browser?.pendingAction?.({signal,onProgress:progress(g)});}catch(error){if(!valid(g))return;if(['ONBOARDING_EGO_CONTROL','ONBOARDING_EGO_HANDOFF','ONBOARDING_AUTH_BROWSER_REJECTED'].includes(error?.code))throw error;}
   if(!valid(g))return;
   const dotWaiting=pending?.step==='dot_tool_approval',waiting=Boolean(harnessWaiting||dotWaiting);
   if(task)state.verification_task=task;else delete state.verification_task;
   if(task?.status==='failed')throw failure('VERIFY_TASK_FAILED');
   if(task?.status==='cancelled')throw failure('VERIFY_TASK_CANCELLED');
   const current=now();if(!wasWaiting&&!waiting)remaining-=Math.max(0,current-previous);previous=current;wasWaiting=Boolean(waiting);
   if(harnessWaiting){state.waiting_for=task.user_question_count>0?'harness_answer':'harness_approval';state.message=task.user_question_count>0?'验证任务需要你回答问题。请打开下方任务，回答后会自动继续验证。':'验证任务正在等待你的审批。请打开下方任务，确认后会自动继续验证。';}
   else if(dotWaiting){state.waiting_for='dot_authorization';state.message='请在连接窗口确认这次自检的工具使用权限。确认后会自动继续验证。';}
   else{delete state.waiting_for;state.message='正在核实 Dot 读取与验证任务。若 Dot 提示工具权限，请在连接窗口确认。';}
   if(!waiting&&remaining<=0)throw failure('VERIFY_TIMEOUT');
   await sleep(pollMs,signal);
  }
 }
 async function completeBrowser(g,signal){
  const finished=browser;if(typeof finished?.complete!=='function')return;
  let confirmed=false;try{confirmed=(await finished.complete({signal}))?.completed===true;}catch{}
  if(!valid(g))return;cleanupPending=!confirmed;
  // Finalization cannot invalidate the saved task proof or stop its transport.
  // Detach the finished/uncertain browser so the UI cannot offer a stale handle.
  if(browser===finished){browser=undefined;try{await finished.close?.();}catch{}}
 }
 async function run(g,signal,{forceResend=false,newAttempt=false,resumeAuthorized=false}={}){
  try{
   await releaseResources();if(!valid(g))return;
   await localReady(await local.prepare());if(!valid(g))return;
   const reference=await local.onboardingReference(),directory=requestedDirectory??reference.directory;
   store??=createOnboardingStore({directory,now:()=>new Date(now()).toISOString()});let metadata=await store.acquire();if(!valid(g))return;await loadCredentials(directory,metadata);if(!valid(g))return;if(metadata.completed_at)lastVerifiedAt=metadata.completed_at;
   const freshRequest=newAttempt||!metadata.request_id||!metadata.attempt_started_at||stamp(metadata.completed_at)>=stamp(metadata.attempt_started_at);
   if(freshRequest){metadata=await store.update({request_id:'dsh_connect_'+randomBytes(16).toString('hex'),attempt_started_at:new Date(now()).toISOString(),verification_sent:false});}
   metadata=await store.update({activated:true});
   // The observer must read this exact private file before any new manager is started.
   await local.setCloudHealthFile(join(directory,'health.url'));if(!valid(g))return;
   await localReady(await local.start());if(!valid(g))return;
   const identity={directory,runtimeKeyFile:join(directory,'runtime.key'),installationId:metadata.installation_id,pluginName:'DeepSeek Harness · '+metadata.installation_id,tunnelName:'dsh-dot-'+metadata.installation_id};
   browser=await browserFactory(identity);if(!valid(g)){await releaseResources();return;}
   await browser.prepare({signal,onProgress:progress(g),resumeAuthorized});if(!valid(g))return;
   let hasKey=false;try{hasKey=Boolean((await readPrivateStateFile(identity.runtimeKeyFile,4096)).trim());}catch(e){if(e.code!=='ENOENT')throw e;}
   if(!metadata.tunnel_id||!hasKey){update('authorize',g);const provisioned=await browser.provision({signal,onProgress:progress(g)});if(!valid(g))return;
    if(!(await readPrivateStateFile(identity.runtimeKeyFile,4096)).trim())throw failure('ONBOARDING_PRIVATE_STATE');await credentials.recordProvisioned(provisioned);credentialView=await credentials.status();
    // Persist expiry before the marker that makes future runs skip provisioning.
    const patch={tunnel_id:provisioned?.tunnel_id};for(const key of ['organization_id','workspace_id'])if(provisioned?.[key]!==undefined)patch[key]=provisioned[key];metadata=await store.update(patch);canRenew=true;
   }
   update('installing',g);tunnel=await tunnelFactory({directory,installationId:metadata.installation_id});await tunnel.prepare({signal,onProgress:progress(g)});if(!valid(g))return;
   update('connecting',g);await tunnel.start({tunnel_id:metadata.tunnel_id,runtimeKeyFile:identity.runtimeKeyFile,mcpCommand:reference.mcpCommand,signal});if(!valid(g))return;
   const connected=await browser.connectPlugin({tunnel_id:metadata.tunnel_id,signal,onProgress:progress(g)});if(!valid(g))return;if(connected?.connected!==true)throw failure('CONNECTION_FAILED');
   if(connected.plugin_id)metadata=await store.update({plugin_id:connected.plugin_id});state.verification.chatgpt_connected=true;update('verifying',g);
   // A retry may dispatch only after a fresh authenticated check still finds no
   // task. A late/active/completed task is observed rather than sent again.
   let dispatch=true,retrySend=false;
   if(resumeAuthorized&&!freshRequest){
    if(!verify)throw failure('LOCAL_UNAVAILABLE');
    const existing=await verify({requestId:metadata.request_id,startedAt:metadata.attempt_started_at,signal});if(!valid(g))return;
    dispatch=existing?.task_absent===true&&existing?.task===undefined&&existing?.task_complete===false;
    retrySend=dispatch&&forceResend&&metadata.verification_sent===true&&existing?.tunnel_online===true;
   }
   if(dispatch){const sent=await browser.verifyDot({requestId:metadata.request_id,forceResend:retrySend,signal,onProgress:progress(g)});if(!valid(g))return;if(sent?.sent===true)metadata=await store.update({verification_sent:true});}
   await verifyUntil({signal,g,metadata});
   if(valid(g)&&state.phase==='ready')await completeBrowser(g,signal);
   if(valid(g)&&state.phase==='ready')supervise(g,()=>transportHealth({startedAt:metadata.attempt_started_at,signal}));
  }catch(error){if(!valid(g))return;const code=Object.hasOwn(ERRORS,error?.code)?error.code:'CONNECTION_FAILED';const handoff=code==='ONBOARDING_EGO_HANDOFF'&&Object.hasOwn(BROWSER_STEPS,state.step)?{step:state.step,message:BROWSER_STEPS[state.step].message,waiting_for:BROWSER_STEPS[state.step].waiting_for}:undefined;update('blocked',g,{code,message:handoff?.message??ERRORS[code]});if(handoff)state={...state,...handoff};if(!['VERIFY_TIMEOUT','ONBOARDING_AUTH_BROWSER_REJECTED','ONBOARDING_EGO_HANDOFF','ONBOARDING_EGO_CONTROL','ONBOARDING_EGO_TIMEOUT'].includes(code)){const failedTunnel=tunnel;tunnel=undefined;await failedTunnel?.close();}}
 }
 function supervise(g,read,{allowPending=false,startupUntil=0}={}){
  let settled=startupUntil===0;
  // A health failure does not invalidate the saved task proof. Keep observing
  // this same transport so a fresh receipt can recover its public state.
  const active=()=>valid(g)&&(['ready','restoring'].includes(state.phase)||!settled&&state.phase==='connecting'||state.phase==='blocked'&&state.error?.code==='CONNECTION_FAILED');
  const offline=()=>{if(active()){state.verification.tunnel_online=false;if(!settled&&now()<startupUntil)return;settled=true;update('blocked',g,{code:'CONNECTION_FAILED',message:ERRORS.CONNECTION_FAILED});}};
  const check=()=>{if(!active()||monitoring)return;const probe=Promise.resolve().then(read).then(receipt=>{
   if(!active())return;
   if(receipt?.tunnel_online===true){settled=true;state.verification.tunnel_online=true;if(state.phase!=='ready'){update('ready',g);if(verificationSource==='saved_receipt')state.message='本机连接已恢复；读取和任务能力沿用有日期的上次验证记录。';}}
   else if(allowPending&&receipt?.awaiting_first_call===true){settled=true;state.verification.tunnel_online=false;if(state.phase!=='restoring')update('restoring',g);}
   else offline();
  },offline);monitoring=probe;probe.finally(()=>{if(monitoring===probe)monitoring=undefined;}).catch(()=>{});};
  monitor=setInterval(check,monitorMs);monitor.unref?.();if(startupUntil)check();
 }
 async function restoreTransport(g,signal,reference){
  try{
   await releaseResources();if(!valid(g))return;const metadata=await store.acquire();if(!valid(g))return;
   if(!metadata.activated||!metadata.completed_at||!metadata.tunnel_id)throw failure('RESTORE_UNAVAILABLE');
   lastVerifiedAt=metadata.completed_at;verificationSource='saved_receipt';state.verification={tunnel_online:false,chatgpt_connected:true,dot_read:true,task_complete:true};
   const directory=requestedDirectory??reference.directory,runtimeKeyFile=join(directory,'runtime.key');await loadCredentials(directory,metadata);if(!valid(g))return;if(!(await readPrivateStateFile(runtimeKeyFile,4096)).trim())throw failure('RESTORE_UNAVAILABLE');
   await local.setCloudHealthFile(join(directory,'health.url'));if(!valid(g))return;await localReady(await local.start());if(!valid(g))return;
   tunnel=await tunnelFactory({directory,installationId:metadata.installation_id});await tunnel.prepare({signal});if(!valid(g))return;
   await tunnel.start({tunnel_id:metadata.tunnel_id,runtimeKeyFile,mcpCommand:reference.mcpCommand,signal});if(!valid(g))return;
   const startedAt=new Date(now()).toISOString(),deadline=now()+Math.min(verifyTimeoutMs,45000),read=()=>transportHealth({startedAt,signal});
   while(now()<deadline){const health=await read();if(!valid(g))return;state.verification.tunnel_online=health?.tunnel_online===true;if(state.verification.tunnel_online){update('ready',g);state.message='本机连接已恢复；读取和任务能力沿用有日期的上次验证记录。';supervise(g,read,{allowPending:true});return;}if(health?.awaiting_first_call===true){update('restoring',g);supervise(g,read,{allowPending:true});return;}await sleep(pollMs,signal);}
   throw failure('RESTORE_UNAVAILABLE');
  }catch(error){if(!valid(g))return;const code=Object.hasOwn(ERRORS,error?.code)?error.code:'RESTORE_UNAVAILABLE';update('blocked',g,{code,message:ERRORS[code]});const failed=tunnel;tunnel=undefined;await failed?.close();}
 }
 function beginRestore(metadata,reference){
  if(closed||flight||['ready','restoring'].includes(state.phase))return snapshot();clearInterval(monitor);controller=new AbortController();const g=++generation;lastVerifiedAt=metadata.completed_at;verificationSource='saved_receipt';state=view('connecting',{tunnel_online:false,chatgpt_connected:true,dot_read:true,task_complete:true});
  const current=Promise.resolve().then(()=>restoreTransport(g,controller.signal,reference));flight=current;current.finally(()=>{if(flight===current)flight=undefined;}).catch(()=>{});return snapshot();
 }
 function begin({forceResend=false,resumeAuthorized=false}={}){if(closed)return snapshot();if(flight||!terminal.has(state.phase)||['ready','restoring'].includes(state.phase)&&!forceResend)return snapshot();renewalPurpose=false;const newAttempt=forceResend&&state.phase==='blocked'&&['failed','cancelled'].includes(state.verification_task?.status),retrySend=forceResend&&state.phase==='blocked'&&state.error?.code==='VERIFY_TIMEOUT'&&!state.verification_task;clearInterval(monitor);controller=new AbortController();const g=++generation;verificationSource='current_attempt';state=view('preparing');const current=Promise.resolve().then(()=>run(g,controller.signal,{forceResend:retrySend,newAttempt,resumeAuthorized}));flight=current;current.finally(()=>{if(flight===current)flight=undefined;}).catch(()=>{});return snapshot();}
 async function runRenew(g,signal,{restartKey=false}={}){
  let switched=false,committed=false,candidateDigest,metadata,reference,directory;
  const startCanonical=async()=>{const current=tunnel;tunnel=undefined;await current?.close();if(!valid(g))return;const next=await tunnelFactory({directory,installationId:metadata.installation_id});if(!valid(g)){await next?.close();return;}tunnel=next;await tunnel.prepare({signal});if(!valid(g))return;await tunnel.start({tunnel_id:metadata.tunnel_id,runtimeKeyFile:join(directory,'runtime.key'),mcpCommand:reference.mcpCommand,signal});};
  try{
   reference=await local.onboardingReference();if(!valid(g))return;directory=requestedDirectory??reference.directory;store??=createOnboardingStore({directory,now:()=>new Date(now()).toISOString()});metadata=await store.acquire();if(!valid(g))return;
   if(!metadata.tunnel_id)throw failure('RESTORE_UNAVAILABLE');await loadCredentials(directory,metadata);if(!valid(g))return;let renewalId=await credentials.begin();credentialView=await credentials.status();if(!valid(g))return;
   const priorBrowser=browser;browser=undefined;await priorBrowser?.close();if(!valid(g))return;
   const nextBrowser=await browserFactory({directory,runtimeKeyFile:join(directory,'runtime.key'),installationId:metadata.installation_id,pluginName:'DeepSeek Harness · '+metadata.installation_id,tunnelName:'dsh-dot-'+metadata.installation_id});if(!valid(g)){await nextBrowser?.close();return;}browser=nextBrowser;
   await browser.prepare({signal,onProgress:progress(g),resumeAuthorized:true,purpose:'key-renewal'});if(!valid(g))return;
   if(restartKey){await browser.abandonRenewal({renewalId,signal});if(!valid(g))return;await credentials.abandon(renewalId);renewalId=await credentials.begin();credentialView=await credentials.status();if(!valid(g))return;}
   const receipt=await browser.renewRuntimeKey({renewalId,signal,onProgress:progress(g)});if(!valid(g))return;await credentials.recordCandidate(receipt);candidateDigest=await credentials.candidateDigest(renewalId);if(!valid(g))return;
   await local.setCloudHealthFile(join(directory,'health.url'));if(!valid(g))return;await localReady(await local.start());if(!valid(g))return;
   // The old key and its transport stay intact through every human handoff.
   // Stop only this instance's transport before validating the replacement.
   update('connecting',g);state.message='正在验证新的连接授权，原连接与任务记录会保留。';const old=tunnel;tunnel=undefined;await old?.close();switched=true;if(!valid(g))return;
   const startedAt=new Date(now()).toISOString();const candidateTunnel=await tunnelFactory({directory,installationId:metadata.installation_id});if(!valid(g)){await candidateTunnel?.close();return;}tunnel=candidateTunnel;await tunnel.prepare({signal});if(!valid(g))return;
   await tunnel.start({tunnel_id:metadata.tunnel_id,runtimeKeyFile:credentials.candidatePath(renewalId),mcpCommand:reference.mcpCommand,signal});if(!valid(g))return;
   const deadline=now()+Math.min(verifyTimeoutMs,45000);let accepted=false;
   do{const health=await transportHealth({startedAt,signal});if(!valid(g))return;if(health?.tunnel_online===true||health?.awaiting_first_call===true){accepted=true;break;}await sleep(pollMs,signal);}while(now()<deadline);
   if(!accepted)throw failure('KEY_RENEW_UNVERIFIED');await credentials.commit(renewalId,candidateDigest);committed=true;credentialView=await credentials.status();if(!valid(g))return;
   // The official process reads the key from its launch path. Restart it on
   // the canonical file before removing the candidate path from use.
   await startCanonical();if(!valid(g))return;renewalPurpose=false;const canonicalStartedAt=new Date(now()).toISOString();
   if(metadata.completed_at){lastVerifiedAt=metadata.completed_at;verificationSource='saved_receipt';state.verification={tunnel_online:false,chatgpt_connected:true,dot_read:true,task_complete:true};update('connecting',g);state.message='连接授权已更新，正在恢复本机通道。';await completeBrowser(g,signal);if(valid(g))supervise(g,()=>transportHealth({startedAt:canonicalStartedAt,signal}),{allowPending:true,startupUntil:stamp(canonicalStartedAt)+Math.min(verifyTimeoutMs,45000)});}
   else{update('blocked',g,{code:'KEY_RENEW_CONTINUE',message:ERRORS.KEY_RENEW_CONTINUE});}
  }catch(error){
   if(!valid(g))return;
   if(switched){try{
    const recovered=await credentials.recover();
    // A commit can throw after replacement. Only its finalized journal and
    // exact candidate bytes establish that recovery accepted the new key.
    if(!committed&&recovered?.renewal===null&&candidateDigest&&createHash('sha256').update(await readPrivateStateFile(join(directory,'runtime.key'),4096)).digest('hex')===candidateDigest)committed=true;
    credentialView=await credentials.status();await startCanonical();
   }catch{}if(!valid(g))return;}
   if(committed)renewalPurpose=false;
   const code=committed?'RESTORE_UNAVAILABLE':Object.hasOwn(ERRORS,error?.code)?error.code:'KEY_RENEW_UNVERIFIED';
   const handoff=code==='ONBOARDING_EGO_HANDOFF'&&Object.hasOwn(BROWSER_STEPS,state.step)?{step:state.step,message:BROWSER_STEPS[state.step].message,waiting_for:BROWSER_STEPS[state.step].waiting_for}:undefined;
   update('blocked',g,{code,message:handoff?.message??ERRORS[code]});if(handoff)state={...state,...handoff};
  }
 }
 function beginRenew(options={}){if(closed||flight||!canRenew)return snapshot();clearInterval(monitor);controller=new AbortController();const g=++generation;renewalPurpose=true;state=view('preparing',state.verification);state.message='正在准备更新连接授权，无需复制密钥。';const current=Promise.resolve().then(()=>runRenew(g,controller.signal,options));flight=current;current.finally(()=>{if(flight===current)flight=undefined;}).catch(()=>{});return snapshot();}
 function reopenBrowser(){if(closed||flight||!browser||state.error?.code!=='ONBOARDING_EGO_SPACE_MISSING')return snapshot();clearInterval(monitor);controller=new AbortController();const g=++generation,signal=controller.signal;update('preparing',g);state.message='正在重新打开连接窗口，保留原来的账号授权与任务。';const current=Promise.resolve().then(async()=>{try{await browser.replaceMissingBinding({signal});if(!valid(g))return;if(renewalPurpose)await runRenew(g,signal);else await run(g,signal,{resumeAuthorized:true});}catch(error){if(valid(g)){const code=Object.hasOwn(ERRORS,error?.code)?error.code:'ONBOARDING_EGO_BINDING_RECOVERY';update('blocked',g,{code,message:ERRORS[code]});}}});flight=current;current.finally(()=>{if(flight===current)flight=undefined;}).catch(()=>{});return snapshot();}
 function prepareEgo(){
  if(closed||flight||state.phase!=='blocked')return snapshot();clearInterval(monitor);controller=new AbortController();const signal=controller.signal,g=++generation;state=view('installing',state.verification);state.message='正在准备 Ego 连接窗口。完成后将继续原来的连接。';
  const current=Promise.resolve().then(async()=>{
   try{
    const installer=await egoInstallerFactory();if(!valid(g))return;
    const result=await installer.prepare({signal});if(!valid(g))return;
    if(result?.ready===true){update('preparing',g);if(renewalPurpose)await runRenew(g,signal);else await run(g,signal,{resumeAuthorized:true});return;}
    if(result?.needsOnboarding!==true)throw failure('EGO_INSTALL_FAILED');
    update('blocked',g,{code:'EGO_SETUP_REQUIRED',message:ERRORS.EGO_SETUP_REQUIRED});state.message=ERRORS.EGO_SETUP_REQUIRED;state.waiting_for='browser_setup';
   }catch(error){if(!valid(g))return;const code=error?.code==='EGO_INSTALL_SIGNATURE'?'EGO_INSTALL_INTEGRITY':egoSetupCodes.has(error?.code)?error.code:'EGO_INSTALL_FAILED';update('blocked',g,{code,message:ERRORS[code]});}
  });flight=current;current.finally(()=>{if(flight===current)flight=undefined;}).catch(()=>{});return snapshot();
 }
 return{
  async status(){if(credentials)try{credentialView=await credentials.status();}catch{}return snapshot();},async start(){return begin();},async renew(){return beginRenew();},async restartkey(){return snapshot().actions.restart_key?beginRenew({restartKey:true}):snapshot();},async reopen(){return reopenBrowser();},async resume(){return state.phase==='blocked'&&egoSetupCodes.has(state.error?.code)?prepareEgo():renewalPurpose?beginRenew():begin({forceResend:true,resumeAuthorized:true});},
  async cancel(){if(closed)return snapshot();const renewing=renewalPurpose;generation++;controller?.abort();clearInterval(monitor);state=view('cancelled',blank());if(renewing){await flight?.catch(()=>{});await releaseResources();renewalPurpose=false;try{const reference=await local.onboardingReference(),metadata=await store.read();flight=undefined;if(metadata.completed_at)return beginRestore(metadata,reference);}catch{}return snapshot();}if(store)await store.update({activated:false}).catch(()=>{});await releaseResources();return snapshot();},
  async open(){try{await browser?.focus();}catch{}return snapshot();},
  async restore(){try{const reference=await local.onboardingReference({verify:false});store??=createOnboardingStore({directory:requestedDirectory??reference.directory});const metadata=await store.read();if(metadata.activated)return metadata.completed_at?beginRestore(metadata,reference):begin();}catch{}return snapshot();},
  async close(){if(closed)return;closed=true;generation++;controller?.abort();clearInterval(monitor);await releaseResources();await flight?.catch(()=>{});await store?.close();},
 };
}
