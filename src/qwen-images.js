import {rpc,UUID,ApiError} from './generations.js';
import {own,signed} from './studio.js';
export const QWEN_IMAGE_VERSION='qwen21-batch-v1';
export async function qwenProductionAction(db,production,action,data){
 if(action==='qwen_enqueue'){
  const r=data?.request,key=data?.key;
  if(!/^(image-\d+|repair-image-\d+-\d+)$/.test(key||'')||typeof r?.prompt!=='string'||!r.prompt.trim()||r.prompt.length>32000||!['1024x1536','1536x1024','1024x1024'].includes(r.size)||!Array.isArray(r.references)||r.references.length>6||r.references.some(id=>!UUID.test(id)))throw Error('PRODUCTION_INVALID');
  for(const id of r.references){const a=await own(db,'studio_assets',production.user_id,id);if(a.kind!=='image')throw Error('PRODUCTION_REFERENCE_REQUIRED');}
  let filmstrip=null;
  if(r.includeFilmstrip&&production.snapshot?.data?.referenceAnalysisId){
   const a=await own(db,'studio_reference_analyses',production.user_id,production.snapshot.data.referenceAnalysisId);
   if(a.project_id!==production.project_id||a.status!=='succeeded')throw Error('PRODUCTION_REFERENCE_REQUIRED');
   filmstrip=a.result?.visualEvidence?.[0]||null;
  }
  const request={version:QWEN_IMAGE_VERSION,prompt:r.prompt,size:r.size,references:r.references,filmstrip};
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(request)));
  const fingerprint=Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('');
  const old=await db.from('qwen_image_jobs').select('id').eq('production_id',production.id).eq('step_key',key).maybeSingle();if(old.error)throw old.error;
  if(!old.data){
   const control=await db.from('qwen_image_control').select('current_run,enabled,commercial_authorized').eq('id',true).single();if(control.error)throw control.error;
   if(!control.data.enabled||!control.data.commercial_authorized)throw Error('QWEN_DISABLED');
   const run=control.data.current_run?await db.from('qwen_image_runs').select('phase,ready_at').eq('id',control.data.current_run).single():null;
   if(run?.error)throw run.error;
   if(!run?.data?.ready_at||run.data.phase!=='running'){
    const reservation=await db.from('production_spend_reservations').select('estimated_microusd').eq('job_id',production.id).eq('step_key',key).single();if(reservation.error)throw reservation.error;
    await rpc(db,'account_production_spend',{p_worker:production.worker_id,p_job:production.id,p_lease:production.lease_token,p_key:key,p_action:'reserve',p_amount:Math.max(400000,reservation.data.estimated_microusd)});
   }
  }
  return rpc(db,'qwen_image_work',{p_action:'enqueue',p_data:{productionId:production.id,key,fingerprint,request}});
 }
 const {data:q,error}=await db.from('qwen_image_jobs').select('*').eq('id',data?.id).eq('production_id',production.id).single();
 if(error||!q)throw new ApiError('NOT_FOUND');
 return q;
}
export async function qwenJobMedia(db,q){
 const {data:p,error}=await db.from('studio_productions').select('user_id').eq('id',q.production_id).single();if(error)throw error;
 const refs=[];
 for(const id of q.request.references){const a=await own(db,'studio_assets',p.user_id,id);refs.push(await signed(db,a.bucket,a.storage_path));}
 const path=`${p.user_id}/production/${q.production_id}/${q.asset_id}.png`;
 return {refs,path};
}
