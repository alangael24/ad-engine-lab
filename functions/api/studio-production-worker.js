import {paidStep} from '../../src/production-spend.js';
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
 if(['heartbeat','inspect','complete','fail'].includes(b.action))return json({value:await rpc(db,'studio_production_work',args)});
 const j=await rpc(db,'studio_production_work',{...args,p_action:'heartbeat'});
 const reserve=async(key,kind,units=1)=>rpc(db,'reserve_production_spend',{p_worker:b.workerId,p_job:j.id,p_lease:b.leaseToken,p_key:key,p_kind:kind,p_units:units});
 if(b.action==='begin_step'){
  const key=b.data?.key,kind=paidStep(key);
  if(kind&&!(kind==='planning'&&j.snapshot?.data?.scenes?.length)&&j.steps?.[key]?.status!=='done')await reserve(key,kind,/^(image-review-|repair-still-review-)/.test(key)?Math.max(1,j.steps?.plan?.result?.scenes?.length||j.snapshot?.data?.scenes?.length||1):1);
  return json({value:await rpc(db,'studio_production_work',args)});
 }
 if(b.action==='creative_context'){
  const project=await own(db,'studio_projects',j.user_id,j.project_id);
  let referenceEvidence=[];
  if(project.data.referenceAnalysisId){
   const a=await own(db,'studio_reference_analyses',j.user_id,project.data.referenceAnalysisId);
   if(a.project_id!==j.project_id||a.status!=='succeeded')throw Error('PRODUCTION_REFERENCE_REQUIRED');
   referenceEvidence=a.result?.visualEvidence||[];
   if(!referenceEvidence.length)throw Error('PRODUCTION_REFERENCE_REQUIRED');
  }
  return json({value:{referenceEvidence}});
 }
 if(b.action==='review_media'){
  const r=await own(db,'studio_renders',j.user_id,b.data?.renderId);
  if(r.production_id!==j.id||r.project_id!==j.project_id||r.project_revision!==j.expected_revision||r.status!=='succeeded')throw Error('PRODUCTION_QUALITY_INVALID');
  return json({url:await signed(db,'studio-media',r.result_path),manifest:r.manifest,project:await own(db,'studio_projects',j.user_id,j.project_id)});
 }
 if(b.action==='finish_step'){
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
 if(b.action==='write'){
  const d={...b.data};if(!['save_project','version','select_version','render'].includes(d.action))throw Error('PRODUCTION_INVALID');
  if(d.action==='save_project')d.data=projectData(d.data);
  if(d.action==='version'){
   if(!UUID.test(d.data?.requestId||'')||!UUID.test(d.data?.sceneId||''))throw Error('PRODUCTION_INVALID');
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
    const prompt=request.assetId?scenePrompt(p,request.sceneId):await prepareSceneVideoPrompt(db,j.user_id,p,request.sceneId,'',context.env);
    d.data={...request,prompt};
   }
  }
  if(d.action==='render'&&j.steps?.[d.key]?.status!=='done'){await reserve(d.key,'assembly');await reserve(d.key+'-editor','planning',120);}
  return json({value:await rpc(db,'studio_production_work',{...args,p_data:d})});
 }
 throw Error('PRODUCTION_INVALID');
}catch(e){return productionError(e);}}
