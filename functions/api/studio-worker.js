import {editorialTimeline,alignmentWords} from '../../assets/editorial-timeline.js';
import {simpleEditTimeline,SIMPLE_EDIT_VERSION} from '../../assets/simple-edit.js';
import {validateReview,QUALITY_VERSION} from '../../assets/quality-model.js';
import {getSupabaseAdmin,json} from '../../src/backend.js';
import {readJson,rpc,ApiError,UUID} from '../../src/generations.js';
import {verifyWorker} from './worker.js';
import {studioError,signed,own} from '../../src/studio.js';
export async function onRequestPost(context){try{
 await verifyWorker(context.request,context.env.STUDIO_WORKER_TOKEN);
 const db=getSupabaseAdmin(context.env),b=await readJson(context.request);
 if(!/^[a-zA-Z0-9_-]{1,80}$/.test(b.workerId||''))throw new ApiError('UNAUTHORIZED');
 const args={p_worker:b.workerId,p_action:b.action,p_id:b.jobId||null,p_lease:b.leaseToken||null,p_success:b.success===true};
 if(b.action==='claim'){
  const r=await rpc(db,'studio_render_worker',args);if(!r)return json({job:null});
  const manifest=structuredClone(r.manifest);
  manifest.narration={url:await signed(db,manifest.narration.bucket,manifest.narration.path)};
  for(const s of manifest.scenes){s.url=await signed(db,s.media.bucket,s.media.path);delete s.media;}
  let editorial=null;
  try{if(r.production_id){
   const project=await own(db,'studio_projects',r.user_id,r.project_id);
   if(project.revision!==r.project_revision)throw Error('STUDIO_CONFLICT');
   const history=await db.from('studio_productions').select('steps').eq('user_id',r.user_id).eq('project_id',r.project_id).order('created_at',{ascending:false}).limit(50);
   if(history.error)throw history.error;
   const narration=history.data.map(x=>x.steps?.narration?.result).find(x=>x?.assetId===project.data.narrationAssetId&&x.alignment);
   const words=alignmentWords(narration?.alignment);
   if(project.data.referenceAnalysisId){const a=await own(db,'studio_reference_analyses',r.user_id,project.data.referenceAnalysisId);if(a.project_id!==r.project_id||a.status!=='succeeded')throw Error('EDITORIAL_INVALID');project.referenceEvidence=a.result?.visualEvidence||[];}
   editorial={project,words};
  }
  }catch(error){await rpc(db,'studio_render_worker',{p_worker:b.workerId,p_action:'complete',p_id:r.id,p_lease:r.lease_token,p_success:false});throw error;}
  return json({job:{id:r.id,leaseToken:r.lease_token,manifest,editorial}});
 }
 if(!UUID.test(b.jobId||'')||!UUID.test(b.leaseToken||''))throw new ApiError('LEASE_LOST');
 const q=await db.from('studio_renders').select('*').eq('id',b.jobId).eq('worker_id',b.workerId).eq('lease_token',b.leaseToken).maybeSingle();
 if(q.error)throw q.error;const r=q.data;if(!r)throw new ApiError('LEASE_LOST');
 if(b.action==='complete'&&['succeeded','failed'].includes(r.status))return json({status:r.status});
 if(r.status!=='running'||Date.parse(r.lease_expires_at)<=Date.now())throw new ApiError('LEASE_LOST');
 if(r.production_id){const parent=await own(db,'studio_productions',r.user_id,r.production_id);if(parent.status!=='running'||parent.expected_revision!==r.project_revision){await rpc(db,'studio_render_worker',{...args,p_action:'complete',p_success:false});throw new ApiError('LEASE_LOST');}}
 if(b.action==='heartbeat')return json(await rpc(db,'studio_render_worker',args));
 const path=`${r.user_id}/renders/${r.id}.mp4`;
 if(b.action==='upload'){
  const s=await db.storage.from('studio-media').createSignedUploadUrl(path);if(s.error)throw s.error;return json({uploadUrl:s.data.signedUrl});
 }
 if(b.action==='begin_editorial')return json(await rpc(db,'studio_editorial_begin',{p_worker:b.workerId,p_id:r.id,p_lease:b.leaseToken}));
 if(b.action==='editorial'){
  const original=r.manifest.originalScenes||r.manifest.scenes;
  const scenes=b.version===SIMPLE_EDIT_VERSION?simpleEditTimeline(original,b.segments):editorialTimeline(original,b.ranges);
  const editorial={sha256:b.sha256,usage:b.usage||null,message:String(b.message||'').slice(0,3000)};
  if(b.version===SIMPLE_EDIT_VERSION){
   const review=b.review;
   validateReview(review,scenes);
   if(review.version!==QUALITY_VERSION||!Number.isFinite(review.duration)||review.editorialVersion!==SIMPLE_EDIT_VERSION||review.model!=='gpt-5.6-sol'||review.sha256!==b.sha256||!['pass','repair'].includes(review.verdict)||JSON.stringify(review.coverage)!==JSON.stringify(scenes.map(s=>s.id))||Math.abs(review.duration-scenes.at(-1).end)>.15)throw Error('EDITORIAL_REVIEW_INVALID');
   editorial.version=SIMPLE_EDIT_VERSION;editorial.review=review;
  }
  return json(await rpc(db,'studio_editorial_manifest',{p_worker:b.workerId,p_id:r.id,p_lease:b.leaseToken,p_scenes:scenes,p_editorial:editorial}));
 }
 if(b.action==='complete'){
  if(b.success&&r.production_id&&!r.manifest.editorial)throw Error('EDITORIAL_REQUIRED');
  if(b.success){const x=await db.storage.from('studio-media').info(path),size=x.data?.size??x.data?.metadata?.size,mime=x.data?.contentType??x.data?.metadata?.mimetype;
   if(x.error||!size||size>52428800||mime!=='video/mp4')throw new ApiError('RESULT_NOT_READY');}
  return json(await rpc(db,'studio_render_worker',args));
 }
 throw new ApiError('INVALID_GENERATION');
}catch(error){return studioError(error);}}
export function onRequest(){return new Response(null,{status:405});}
