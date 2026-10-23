/** A small, bounded wait queue keeps overlapping page reads from appearing to be
 * authorization failures. Worker delivery has its own lightweight lane. */
export function createManagementQueue({parallel=2,capacity=16,timeoutMs=5000,available}={}){
 let active=0,closed=false;
 const pending=[];
 const failure=code=>Object.assign(new Error(code==='MANAGEMENT_BUSY'?'Management service is busy. Retry this read shortly.':'Management access denied.'),{code});
 const start=entry=>{
  clearTimeout(entry.timer);active++;
  Promise.resolve().then(()=>{if(closed)throw failure('MANAGEMENT_DENIED');available();return entry.work();})
   .then(entry.resolve,entry.reject).finally(()=>{active--;while(!closed&&active<parallel&&pending.length)start(pending.shift());});
 };
 return{
  run(work){
   if(closed)return Promise.reject(failure('MANAGEMENT_DENIED'));
   if(active>=parallel&&pending.length>=capacity)return Promise.reject(failure('MANAGEMENT_BUSY'));
   return new Promise((resolve,reject)=>{
    const entry={work,resolve,reject,timer:null};
    if(active<parallel)start(entry);
    else{
     pending.push(entry);
     entry.timer=setTimeout(()=>{const index=pending.indexOf(entry);if(index<0)return;pending.splice(index,1);reject(failure('MANAGEMENT_BUSY'));},timeoutMs);
    }
   });
  },
  close(){if(closed)return;closed=true;for(const entry of pending.splice(0)){clearTimeout(entry.timer);entry.reject(failure('MANAGEMENT_DENIED'));}},
 };
}
