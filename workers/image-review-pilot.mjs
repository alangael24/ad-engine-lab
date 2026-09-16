import {createHash} from 'node:crypto';
import {IMAGE_REVIEW_POLICY_VERSION,IMAGE_INSPECTOR_RULES,validateImageContract,validateImageAssessment,imageEscalation,decideImage} from '../assets/image-review-policy.js';
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const digest=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
// The pilot produces decisions only. It cannot generate assets or submit H3 jobs.
// review/save/load adapters keep transports and durable storage outside policy.
export async function runImageReviewPilot({packets,review,save,load,auditRate,auditSeed,modelIds,deferStyle=false}){
 if(!Array.isArray(packets)||!packets.length||packets.length>24||new Set(packets.map(p=>p.contract?.sceneId)).size!==packets.length||typeof review!=='function'||typeof save!=='function'||typeof load!=='function'||!Number.isFinite(auditRate)||auditRate<0||auditRate>1||!auditSeed||!modelIds?.primary||!modelIds?.secondary)throw Error('IMAGE_REVIEW_PILOT_CONFIG');
 packets=freeze(structuredClone(packets));
 for(const p of packets){validateImageContract(p.contract);if(!digest(p.imageSha256)||!Array.isArray(p.references)||p.references.some(r=>!digest(r.sha256)))throw Error('IMAGE_REVIEW_PILOT_EVIDENCE');}
 const unresolved=packets.flatMap(p=>p.contract.unresolved.map(reason=>({sceneId:p.contract.sceneId,reason})));
 if(unresolved.length)return {version:IMAGE_REVIEW_POLICY_VERSION,status:'contract_blocked',unresolved,animationReady:false,calls:[],decisions:[]};
 const calls=[];
 async function call(role,stage,subset){
  const model=modelIds[role],request=freeze({version:IMAGE_REVIEW_POLICY_VERSION,model,stage,system:IMAGE_INSPECTOR_RULES,packets:subset});
  const key=`image-review-pilot:${hash(request)}`;let record=await load(key),reused=Boolean(record);
  const validate=record=>{
   if(record?.requestHash!==hash(request)||!Array.isArray(record.assessments)||record.assessments.length!==subset.length||new Set(record.assessments.map(a=>a.sceneId)).size!==subset.length)throw Error('IMAGE_REVIEW_PILOT_RESULT');
   for(const p of subset)validateImageAssessment(record.assessments.find(x=>x.sceneId===p.contract.sceneId),p.contract,p.scope);
  };
  if(record){try{validate(record);}catch(error){calls.push({key,model,stage,reused,usage:record.usage??null,costUsd:record.costUsd??null,error:'invalid_cached_review'});throw error;}}
  else {
   try{const response=await review(request);record={...response,requestHash:hash(request)};}
   catch(error){await save(key,{requestHash:hash(request),error:'review_transport_failed',raw:error.rawResponse??null,usage:error.usage??null,costUsd:error.costUsd??null});calls.push({key,model,stage,reused:false,usage:error.usage??null,costUsd:error.costUsd??null,error:'review_transport_failed'});throw error;}
   // Preserve usage and raw responses even when the output fails validation.
   // A failed checkpoint stops replay; retry policy belongs to the bounded adapter.
   await save(key,record);try{validate(record);}catch(error){calls.push({key,model,stage,reused:false,usage:record.usage??null,costUsd:record.costUsd??null,error:'invalid_review'});throw error;}
  }
  calls.push({key,model,stage,reused,usage:record.usage??null,costUsd:record.costUsd??null});return record.assessments;
 }
 const states=[];
 for(const p of packets){
  let primary,primaryUnavailable=false;
  try{primary=(await call('primary','inspect',[{...p,scope:p.contract.criteria.map(c=>c.id)}]))[0];}
  catch(error){if(error.fatal)throw error;primaryUnavailable=true;primary={sceneId:p.contract.sceneId,checks:p.contract.criteria.map(c=>({criterionId:c.id,status:'unverifiable',difference:'unverifiable',observation:'Primary reviewer did not return a valid assessment. This is a controller placeholder, not a visual finding.',consequence:''}))};}
  // Stable selection per scene+asset+contract. Reruns cannot redraw an easier audit.
  const audit=parseInt(hash({auditSeed,scene:p.contract.sceneId,image:p.imageSha256,contract:p.contract}).slice(0,8),16)/2**32<auditRate;
  const escalation=imageEscalation(p.contract,primary,{audit,deferStyle});
  states.push({packet:p,primary,primaryUnavailable,confirmed:[],audit,escalation});
 }
 // Bundle known-risk checks, rejection confirmations, sampled audits and style
 // into bounded collection batches, without expanding any criterion scope.
 const secondaryPackets=states.map(s=>({...s.packet,scope:[...s.escalation.criteria,...s.escalation.styleCriteria]})).filter(p=>p.scope.length);
 // Bound each transport while still covering every mandatory collection criterion.
 let secondary=[];for(let offset=0;offset<secondaryPackets.length;offset+=6)try{secondary.push(...await call('secondary','collection_gate',secondaryPackets.slice(offset,offset+6)));}catch(error){if(error.fatal)throw error;}
 const style=[];
 for(const s of states){
  const checks=secondary.find(x=>x.sceneId===s.packet.contract.sceneId)?.checks||[];
  s.confirmed=checks.filter(c=>s.escalation.criteria.includes(c.criterionId));
  style.push({sceneId:s.packet.contract.sceneId,checks:checks.filter(c=>s.escalation.styleCriteria.includes(c.criterionId))});
 }
 const decisions=states.map(s=>decideImage(s.packet.contract,s.primary,{confirmed:s.confirmed,style:style.find(x=>x.sceneId===s.packet.contract.sceneId)?.checks||[],audit:s.audit,deferStyle}));
 return {version:IMAGE_REVIEW_POLICY_VERSION,status:'reviewed',animationReady:decisions.every(d=>d.decision==='approve'),decisions,calls,records:states.map(s=>({sceneId:s.packet.contract.sceneId,audit:s.audit,primaryUnavailable:s.primaryUnavailable,primary:s.primary,confirmed:s.confirmed,escalation:s.escalation})),style};
}
