/** Private renewal journal. No credential bytes or file paths leave this module. */
import {rename,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {canonicalPrivatePath,ensurePrivateDirectory,readPrivateStateFile,writeNewPrivateStateFile} from './onboarding-store.js';
const DAY=86400000;
const fail=()=>Object.assign(new Error('Private connection credential state is unavailable.'),{code:'ONBOARDING_PRIVATE_STATE'});
const idOK=id=>typeof id==='string'&&/^[a-f0-9]{32}$/.test(id);
const hash=value=>createHash('sha256').update(value).digest('hex');
const iso=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const plain=value=>value&&Object.getPrototypeOf(value)===Object.prototype;
const keys=(value,allowed)=>plain(value)&&Object.keys(value).every(key=>allowed.includes(key));
function metadata(value){
 if(!keys(value,['source','created_at','expires_at'])||!['estimated','unknown'].includes(value.source))throw fail();
 if(value.source==='unknown'){if(Object.keys(value).length!==1)throw fail();}
 else if(!iso(value.created_at)||!iso(value.expires_at)||Date.parse(value.expires_at)-Date.parse(value.created_at)!==30*DAY)throw fail();
 return value;
}
function validate(value){
 if(!keys(value,['version','current','renewal'])||value.version!==1)throw fail();metadata(value.current);
 if(value.renewal!==null){const r=value.renewal;if(!keys(r,['id','phase','metadata','candidate_digest','previous_digest'])||!idOK(r.id)||!['capturing','candidate_ready','committing'].includes(r.phase))throw fail();metadata(r.metadata);
  if(r.phase==='committing'){for(const key of ['candidate_digest','previous_digest'])if(typeof r[key]!=='string'||!/^[a-f0-9]{64}$/.test(r[key]))throw fail();}
  else if(r.candidate_digest!==undefined||r.previous_digest!==undefined)throw fail();
 }
 return value;
}
function observed(receipt,now){
 if(receipt?.expiry_source!=='creation_observed'||receipt.lifetime_days!==30||!iso(receipt.creation_observed_at)||Date.parse(receipt.creation_observed_at)>now)return{source:'unknown'};
 return{source:'estimated',created_at:receipt.creation_observed_at,expires_at:new Date(Date.parse(receipt.creation_observed_at)+30*DAY).toISOString()};
}
export function createCredentialLifecycle({directory,withOwnership,now=Date.now}={}){
 canonicalPrivatePath(directory);if(typeof withOwnership!=='function')throw fail();const file=join(directory,'key-lifecycle.json'),currentKey=join(directory,'runtime.key');
 const candidate=id=>{if(!idOK(id))throw fail();return join(directory,`runtime-next-${id}.key`);};
 async function read(){await ensurePrivateDirectory(directory);try{return validate(JSON.parse(await readPrivateStateFile(file,8192)));}catch(e){if(e.code==='ENOENT')return{version:1,current:{source:'unknown'},renewal:null};throw fail();}}
 async function atomic(path,value,own,temporary){const temp=temporary??join(directory,'credential-'+randomBytes(16).toString('hex')+'.tmp');try{await own();try{await writeNewPrivateStateFile(temp,value);}catch(e){if(!temporary||e.code!=='EEXIST'||await readPrivateStateFile(temp,4096)!==value)throw e;}await own();await rename(temp,path);}finally{await unlink(temp).catch(()=>{});}}
 const save=(value,own)=>atomic(file,JSON.stringify(validate(value))+'\n',own);
 async function key(path){const value=await readPrivateStateFile(path,4096);if(!value.trim()||value.includes('\0'))throw fail();return value;}
 async function cleanup(id){for(const path of [candidate(id),join(directory,`runtime-next-${id}.json`),join(directory,`runtime-previous-${id}.key`),join(directory,`runtime-promote-${id}.key`)]){try{await readPrivateStateFile(path,4096);await unlink(path);}catch(e){if(e.code!=='ENOENT')throw e;}}}
 async function recover(own){const value=await read();const r=value.renewal;if(r?.phase!=='committing')return value;
  // A crash can land on either side of the atomic key replacement. Only the
  // already-validated digest may finish that transaction; no new grant occurs.
  const currentDigest=hash(await key(currentKey));if(currentDigest===r.candidate_digest){await cleanup(r.id);await save({...value,current:r.metadata,renewal:null},own);return{...value,current:r.metadata,renewal:null};}
  if(currentDigest!==r.previous_digest||hash(await key(candidate(r.id)))!==r.candidate_digest)throw fail();
  const next={...value,renewal:{id:r.id,phase:'candidate_ready',metadata:r.metadata}};await save(next,own);return next;
 }
 return{
  candidatePath:candidate,
  async status(){const value=await read(),m=value.current;if(m.source==='unknown')return{state:'unknown',expiry_source:'unknown',renewal_pending:Boolean(value.renewal)};const remaining=Math.max(0,Math.ceil((Date.parse(m.expires_at)-now())/DAY));return{state:now()>=Date.parse(m.expires_at)?'expired':remaining<=7?'expiring':'valid',expiry_source:'estimated',expires_at:m.expires_at,days_remaining:remaining,renewal_pending:Boolean(value.renewal)};},
  recover:()=>withOwnership(own=>recover(own)),
  recordProvisioned:receipt=>withOwnership(async own=>{const value=await read(),m=observed(receipt,now());if(m.source==='unknown'||value.renewal||value.current.source!=='unknown')return;await save({...value,current:m},own);}),
  begin:()=>withOwnership(async own=>{const value=await recover(own);if(value.renewal)return value.renewal.id;const id=randomBytes(16).toString('hex');await save({...value,renewal:{id,phase:'capturing',metadata:{source:'unknown'}}},own);return id;}),
  abandon:id=>withOwnership(async own=>{const value=await recover(own);if(value.renewal?.id!==id)throw fail();await cleanup(id);await save({...value,renewal:null},own);}),
  recordCandidate:receipt=>withOwnership(async own=>{const value=await read(),r=value.renewal;if(!r||receipt?.candidate_saved!==true||receipt.renewal_id!==r.id||r.phase==='committing')throw fail();await key(candidate(r.id));await save({...value,renewal:{id:r.id,phase:'candidate_ready',metadata:observed(receipt,now())}},own);}),
  candidateDigest:id=>withOwnership(async()=>{const value=await read();if(value.renewal?.id!==id||value.renewal.phase!=='candidate_ready')throw fail();return hash(await key(candidate(id)));}),
  commit:(id,expectedDigest)=>withOwnership(async own=>{const value=await read(),r=value.renewal;if(r?.id!==id||r.phase!=='candidate_ready')throw fail();const next=await key(candidate(id));if(hash(next)!==expectedDigest)throw fail();const previous=await key(currentKey),backup=join(directory,`runtime-previous-${id}.key`);try{await writeNewPrivateStateFile(backup,previous);}catch(e){if(e.code!=='EEXIST'||await key(backup)!==previous)throw fail();}
   await save({...value,renewal:{...r,phase:'committing',candidate_digest:expectedDigest,previous_digest:hash(previous)}},own);
   await atomic(currentKey,next,own,join(directory,`runtime-promote-${id}.key`));await cleanup(id);await save({...value,current:r.metadata,renewal:null},own);
  }),
 };
}
