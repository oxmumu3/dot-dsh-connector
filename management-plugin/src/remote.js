/** The same strict descriptor factories serve the native Host and Client. */
export function createManagementRemote(z) {
 const page={offset:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),limit:z.number().int().min(1).max(100).optional()};
 const jobId=z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
 const statuses=['accepted','starting','running','cancel_requested','succeeded','failed','cancelled','unknown'];
 const definitions=[
  ['overview','manager_overview',z.strictObject({include_control:z.boolean().optional()})],
  ['events','manager_events',z.strictObject({...page,category:z.enum(['read','task','control']).optional(),outcome:z.enum(['pending','succeeded','failed','unknown','denied']).optional()})],
  ['jobs','manager_jobs',z.strictObject({...page,status:z.enum(statuses).optional(),workspace_id:z.string().min(1).max(512).optional(),request_id:jobId.optional(),archived:z.boolean().optional()})],
  ['job','manager_job',z.strictObject({job_id:jobId})],
  ['setPaused','manager_set_paused',z.strictObject({paused:z.boolean()})],
  ['cancel','manager_cancel',z.strictObject({job_id:jobId})],
  ['workerPoll','manager_worker_poll',z.strictObject({})],
  ['archive','manager_archive',z.strictObject({job_id:jobId,archived:z.boolean().optional()})],
  ['followup','manager_followup',z.strictObject({job_id:jobId,task:z.string().trim().min(1).max(8000),request_id:jobId,mode:z.enum(['after_complete','queue','steer']).optional()})],
  ...['Status','Prepare','Start','Stop'].map(name=>[`setup${name}`,`manager_setup_${name.toLowerCase()}`,z.strictObject({})]),
  ...['Status','Start','Resume','Cancel','Open','Renew','RestartKey','Reopen'].map(name=>[`setupConnect${name}`,`manager_setup_connect_${name.toLowerCase()}`,z.strictObject({})]),
 ];
 const descriptors=definitions.map(([method,,schema])=>({
  id:`dot-dsh-management#dotDshManagement/${method}`,
  service:'dotDshManagement',namespace:'dotDshManagement',method,
  invocation:{kind:'direct'},cancellation:{parameter:'signal'},
  parameters:[{name:'request',wire:'request',source:'json',codec:{mode:'strict',typeSymbol:`dot-dsh-management#${method}Request`,create:()=>schema},strictCodec:{mode:'strict',typeSymbol:`dot-dsh-management#${method}Request`,create:()=>schema}}],
  result:{mode:'strict',typeSymbol:`dot-dsh-management#${method}Result`,create:()=>z.json()},
 }));
 return {package:'dot-dsh-management',descriptors,
  methods:Object.fromEntries(definitions.map(([method,tool,schema])=>[method,{tool,schema}])),
 };
}
