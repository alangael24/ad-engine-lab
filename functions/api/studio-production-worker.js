import {qwenProductionAction} from '../../src/qwen-images.js';
import {editorialReviewModelMatches} from '../../assets/production-workflow.js';
import {recoverableProductionStep} from '../../src/production-step-recovery.js';
import {readProductionClipProgress} from '../../src/h3-production-status.js';
import {paidStep,measuredStepCost} from '../../src/production-spend.js';
import {recoveredStillApprovals,recoveredClipVersions} from '../../src/recovered-still-approvals.js';
import {narrationAlignment,approvedBase} from '../../src/partial-edit.js';
import {validateReview,QUALITY_VERSION} from '../../assets/quality-model.js';
import {prepareSceneVideoPrompt,previousVideoRequest} from '../../src/h3-prompts.js';
import {getSupabaseAdmin,json} from '../../src/backend.js';
import {readJson,rpc,UUID,ApiError,generationAvailability} from '../../src/generations.js';
import {verifyWorker} from './worker.js';
import {signed,own} from '../../src/studio.js';
import {productionError} from '../../src/studio-production.js';
import {projectData,scenePrompt} from '../../assets/studio-model.js';
export async function onRequestPost(context){try{
 await verifyWorker(context.request,context.env.PRODUCTION_WORKER_TOKEN);
 const db=getSupabaseAdmin(context.env),b=await readJson(context.request,150000);
 if(!/^[\w-]{1,80}$/.test(b.workerId||''))throw new ApiError('UNAUTHORIZED');
 const args={p_worker:b.workerId,p_action:b.action,p_id:b.jobId||null,p_lease:b.leaseToken||null,p_data:b.data||{}};
 if(b.action==='claim'){
  if(context.env.PRODUCTION_ENABLED!=='true')return json({job:null});
  return json({job:await rpc(db,'studio_production_work',args)});
 }
 if(!UUID.test(b.jobId||'')||!UUID.test(b.leaseToken||''))throw new ApiError('LEASE_LOST');
 if(b.action==='inspect'){
  const value=await rpc(db,'studio_production_work',args);
  const production=await rpc(db,'studio_production_work',{...args,p_action:'heartbeat'});
  // studio_read intentionally omits manifests for the browser. The worker
  // needs actual editorial receipts to settle spend before the final gate.
  const receipts=await db.from('studio_renders').select('id,manifest').eq('project_id',production.project_id).eq('production_id',production.id);
  if(receipts.error)throw receipts.error;
  const manifests=new Map((receipts.data||[]).map(r=>[r.id,{scenes:r.manifest?.scenes,editorial:{usage:r.manifest?.editorial?.usage}}]));
  return json({value:{...value,renders:value.renders.map(r=>({...r,...(manifests.has(r.id)?{manifest:manifests.get(r.id)}:{})})),compute:await readProductionClipProgress(db,production)}});
 }
 if(['heartbeat','yield_gpu','complete','fail'].includes(b.action))return json({value:await rpc(db,'studio_production_work',args)});
 const j=await rpc(db,'studio_production_work',{...args,p_action:'heartbeat'});
 const reserve=async(key,kind,units=1)=>rpc(db,'reserve_production_spend',{p_worker:b.workerId,p_job:j.id,p_lease:b.leaseToken,p_key:key,p_kind:kind,p_units:units});
 if(['qwen_enqueue','qwen_status'].includes(b.action))return json({value:await qwenProductionAction(db,j,b.action,b.data)});
 if(b.action==='record_cost'||b.action==='reserve_cost'){
  const amount=b.data?.costUsd;
  if(!Number.isFinite(amount)||amount<0||amount>100)throw Error('PRODUCTION_INVALID');
  return json({value:await rpc(db,'account_production_spend',{p_worker:b.workerId,p_job:j.id,p_lease:b.leaseToken,p_key:b.data.key,p_action:b.action==='record_cost'?'settle':'reserve',p_amount:Math.ceil(amount*1000000)})});
 }
 if(b.action==='begin_step'){
  const key=b.data?.key,kind=paidStep(key);
  if(!j.steps?.[key]&&recoverableProductionStep(key)){
   const recovered=await rpc(db,'recover_production_step',{p_worker:b.workerId,p_job:j.id,p_lease:b.leaseToken,p_key:key,p_stage:b.data.stage});
   if(recovered)return json({value:recovered});
  }

  let existingEditorialReview=false;
  if(/^quality-\d+$/.test(key)){
   const round=Number(key.split('-')[1]),renderId=j.steps?.[round?'render-'+round:'render']?.result?.id;
   if(renderId){
    const r=await own(db,'studio_renders',j.user_id,renderId),e=r.manifest?.editorial,v=e?.review;
    existingEditorialReview=r.production_id===j.id&&r.project_revision===j.expected_revision&&r.status==='succeeded'&&e?.version==='sol-luna-v1'&&v?.version===QUALITY_VERSION&&editorialReviewModelMatches(v)&&/^[a-f0-9]{64}$/.test(e.sha256||'')&&v.sha256===e.sha256;
   }
  }
  if(kind&&!existingEditorialReview&&!(key==='narration'&&j.snapshot?.data?.narrationRevision)&&!(kind==='planning'&&j.snapshot?.data?.scenes?.length)&&j.steps?.[key]?.status!=='done')await reserve(key,kind,/^(image-review-|repair-still-review-)/.test(key)?Math.max(1,j.steps?.plan?.result?.scenes?.length||j.snapshot?.data?.scenes?.length||1):1);
  return json({value:await rpc(db,'studio_production_work',args)});
 }
 if(b.action==='creative_context'){
  const project=await own(db,'studio_projects',j.user_id,j.project_id);
  // Check the CPU coordinator before spending on planning, voice or images.
  // A serverless endpoint may be scaled to zero; no warm GPU is required here.
  const scenes=j.snapshot?.data?.scenes||[];
  if((!scenes.length||scenes.some(s=>!s.selectedVersionId))&&!await generationAvailability(db,context.env))throw Error('PRODUCTION_GENERATION_OFFLINE');
  if(j.snapshot?.data?.editing?.baseRenderId)await approvedBase(db,j.user_id,j.snapshot);
  let referenceEvidence=[];
  if(project.data.referenceAnalysisId){
   const a=await own(db,'studio_reference_analyses',j.user_id,project.data.referenceAnalysisId);
   if(a.project_id!==j.project_id||a.status!=='succeeded')throw Error('PRODUCTION_REFERENCE_REQUIRED');
   referenceEvidence=a.result?.visualEvidence||[];
   if(!referenceEvidence.length)throw Error('PRODUCTION_REFERENCE_REQUIRED');
  }
  const prior=await db.from('studio_productions').select('id,user_id,project_id,status,expected_revision,steps,snapshot').eq('user_id',j.user_id).eq('project_id',j.project_id).eq('status','failed').order('created_at',{ascending:false}).limit(100);
  if(prior.error)throw prior.error;
  // The worker replays the immutable input snapshot, not today's project.
  // Its own prepare/select writes advance the current revision; using that
  // revision here loses inherited approvals after a coordinator restart.
  // The heartbeat above still fences user edits and obsolete leases.
  return json({value:{referenceEvidence,recoveredClipVersions:recoveredClipVersions(j.snapshot,prior.data||[]),recoveredStillApprovals:recoveredStillApprovals(j.snapshot,prior.data||[],new Set(),b.data?.imageReviewVersion||'')}});
 }
 if(b.action==='review_media'){
  const r=await own(db,'studio_renders',j.user_id,b.data?.renderId);
  if(r.production_id!==j.id||r.project_id!==j.project_id||r.project_revision!==j.expected_revision||r.status!=='succeeded')throw Error('PRODUCTION_QUALITY_INVALID');
  return json({url:await signed(db,'studio-media',r.result_path),manifest:r.manifest,project:await own(db,'studio_projects',j.user_id,j.project_id)});
 }
 if(b.action==='finish_step'){
  const cost=measuredStepCost(b.data?.result);
  if(paidStep(b.data?.key)&&cost!=null){
   // A reused editorial review has no new reservation; an older retry may
   // still have one. Settle that reservation only if it actually exists.
   let settle=cost>0;
   if(!settle){const prior=await db.from('production_spend_reservations').select('step_key').eq('job_id',j.id).eq('step_key',b.data.key).maybeSingle();if(prior.error)throw prior.error;settle=!!prior.data;}
   if(settle)await rpc(db,'account_production_spend',{p_worker:b.workerId,p_job:j.id,p_lease:b.leaseToken,p_key:b.data.key,p_action:'settle',p_amount:Math.ceil(cost*1000000)});
  }

  if(b.data?.stage==='quality'){
   const r=await own(db,'studio_renders',j.user_id,b.data?.result?.renderId),report=b.data.result;
   if(r.production_id!==j.id||r.project_revision!==j.expected_revision||r.status!=='succeeded'||report.version!==QUALITY_VERSION||!/^[a-f0-9]{64}$/.test(report.sha256||''))throw Error('PRODUCTION_QUALITY_INVALID');
   if(r.manifest.editorial?.sha256&&r.manifest.editorial.sha256!==report.sha256)throw Error('PRODUCTION_QUALITY_INVALID');
   validateReview(report,r.manifest.scenes);
   if(!Array.isArray(report.sampleTimes)||report.sampleTimes.length!==r.manifest.scenes.length||r.manifest.scenes.some(s=>!report.sampleTimes.some(t=>t.sceneId===s.id&&t.times?.length===3&&t.times.every(n=>Number.isFinite(n)&&n>=s.start&&n<=s.end))))throw Error('PRODUCTION_QUALITY_INVALID');
  }
  return json({value:await rpc(db,'studio_production_work',args)});
 }
 if(b.action==='asset'){
  const a=await own(db,'studio_assets',j.user_id,b.data?.assetId);return json({asset:a,url:await signed(db,a.bucket,a.storage_path)});
 }
 if(b.action==='narration_source'){
  if(b.data?.assetId!==j.snapshot?.data?.narrationRevision?.assetId)throw Error('PRODUCTION_NARRATION_BASE');
  const a=await own(db,'studio_assets',j.user_id,b.data.assetId);if(a.kind!=='narration')throw Error('PRODUCTION_NARRATION_BASE');
  return json({value:{alignment:await narrationAlignment(db,j.user_id,j.project_id,a.id)}});
 }
 if(b.action==='upload'||b.action==='register'){
  const d=b.data;if(!UUID.test(d?.assetId||'')||!['image','narration'].includes(d.kind))throw Error('PRODUCTION_INVALID');
  const bucket=d.kind==='image'?'generation-references':'studio-media';
  const ext=d.kind==='image'?'png':'mp3',mime=d.kind==='image'?'image/png':'audio/mpeg',path=`${j.user_id}/production/${j.id}/${d.assetId}.${ext}`;
  if(b.action==='upload'){const u=await db.storage.from(bucket).createSignedUploadUrl(path);if(u.error)throw u.error;return json({uploadUrl:u.data.signedUrl});}
  const info=await db.storage.from(bucket).info(path),size=info.data?.size??info.data?.metadata?.size,type=info.data?.contentType??info.data?.metadata?.mimetype;
  if(info.error||!size||size>(d.kind==='image'?6291456:20971520)||type!==mime)throw new ApiError('RESULT_NOT_READY');
  if(d.kind==='narration'&&(!Number.isFinite(d.duration)||d.duration<=0||d.duration>120))throw Error('PRODUCTION_TIMING');
  return json({value:await rpc(db,'studio_production_work',{...args,p_action:'write',p_data:{key:`asset-${d.assetId}`,stage:j.stage,action:'register_asset',assetId:d.assetId,data:{kind:d.kind,name:d.kind==='image'?'Imagen del anuncio':'Narración del anuncio',bucket,storage_path:path,mime_type:mime,size_bytes:size,duration_seconds:d.kind==='image'?null:d.duration}}})});
 }
 if(b.action==='write'||b.action==='prepare_clip'){
  const preparing=b.action==='prepare_clip';
  const d={...b.data,...(preparing?{action:'version'}:{})};if(!['save_project','version','select_version','render'].includes(d.action))throw Error('PRODUCTION_INVALID');
  if(d.action==='save_project')d.data=projectData(d.data);
  if(d.action==='version'){
   if(!/^[a-z0-9_-]{1,65}$/.test(d.key||'')||!UUID.test(d.data?.requestId||'')||!UUID.test(d.data?.sceneId||''))throw Error('PRODUCTION_INVALID');
   const request={requestId:d.data.requestId,sceneId:d.data.sceneId,assetId:d.data.assetId||null,instruction:'Producción automática'};
   const previous=await previousVideoRequest(db,j.user_id,j.project_id,request);
   if(previous)d.data=previous;
   else{
    if(!request.assetId&&!await generationAvailability(db,context.env))throw new ApiError('WORKER_OFFLINE');
    const p=await own(db,'studio_projects',j.user_id,j.project_id);
    if(!request.assetId){
     const scene=p.data.scenes.find(s=>s.id===request.sceneId);
     if(!scene)throw Error('PRODUCTION_INVALID');
     await reserve(d.key,'clip',Math.ceil((scene.end-scene.start)/5));
    }
    // Persist the expensive prompt independently of enqueueing the GPU job.
    // A lost enqueue response can reuse both this prompt and the request ID.
    const promptKey=d.key+'-prompt';
    let checkpoint;
    if(!request.assetId){
     if(j.steps?.[promptKey]?.status!=='done')await reserve(promptKey,'planning');
     checkpoint=await rpc(db,'studio_production_work',{...args,p_action:'begin_step',p_data:{key:promptKey,stage:d.stage}});
    }
    if(checkpoint?.status==='done'){
     const saved=checkpoint.result;
     if(!saved||Object.keys(request).some(k=>saved[k]!==request[k])||typeof saved.prompt!=='string')throw new ApiError('IDEMPOTENCY_CONFLICT');
     d.data=saved;
    }else{
     const promptEnv={...context.env,PRODUCTION_ON_USAGE:async usage=>{
      const unknown=usage.calls.some(c=>!Number.isFinite(c.cost));
      const amount=usage.calls.reduce((n,c)=>n+(Number.isFinite(c.cost)?c.cost:c.reserved),0);
      await rpc(db,'account_production_spend',{p_worker:b.workerId,p_job:j.id,p_lease:b.leaseToken,p_key:d.key+'-prompt',p_action:unknown?'reserve':'settle',p_amount:Math.ceil(amount*1000000)});
     }};
     const prompt=request.assetId?scenePrompt(p,request.sceneId):await prepareSceneVideoPrompt(db,j.user_id,p,request.sceneId,'',promptEnv);
     d.data={...request,prompt};
     if(!request.assetId)await rpc(db,'studio_production_work',{...args,p_action:'finish_step',p_data:{key:promptKey,stage:d.stage,result:d.data}});
    }
   }
   if(preparing)return json({value:{prepared:true}});
  }
  if(d.action==='render'&&j.steps?.[d.key]?.status!=='done'){await reserve(d.key,'assembly');await reserve(d.key+'-editor','editing');}
  return json({value:await rpc(db,'studio_production_work',{...args,p_data:d})});
 }
 throw Error('PRODUCTION_INVALID');
}catch(e){return productionError(e);}}
