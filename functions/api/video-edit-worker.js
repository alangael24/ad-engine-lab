import {verifyWorker} from './worker.js';
import {getSupabaseAdmin,json} from '../../src/backend.js';
import {readJson,rpc,UUID,ApiError} from '../../src/generations.js';
import {own,signed} from '../../src/studio.js';
import {videoEditError} from '../../src/video-use.js';
export async function onRequestPost(context){try{
 await verifyWorker(context.request,context.env.VIDEO_USE_WORKER_TOKEN);
 const db=getSupabaseAdmin(context.env),b=await readJson(context.request,250000);
 if(!/^[\w-]{1,80}$/.test(b.workerId||''))throw new ApiError('UNAUTHORIZED');
 const args={p_worker:b.workerId,p_action:b.action,p_id:b.jobId||null,p_lease:b.leaseToken||null,p_result:b.result||null};
 if(b.action==='claim'){
  if(context.env.VIDEO_USE_ENABLED!=='true')return json({job:null});
  const job=await rpc(db,'video_edit_work',args);if(!job)return json({job:null});
  const sources=[];for(const [i,ref] of job.session.sources.entries()){
   const a=await own(db,'studio_assets',job.user_id,ref.id);
   if(a.kind!=='clip'||a.bucket!=='studio-media')throw Error('VIDEO_EDIT_INVALID');
   sources.push({id:`S${String(i+1).padStart(2,'0')}`,assetId:a.id,name:a.name,reference:ref.reference,url:await signed(db,a.bucket,a.storage_path)});
  }
  return json({job:{id:job.id,sessionId:job.session_id,leaseToken:job.lease_token,kind:job.kind,request:job.request.message,strategy:job.session.strategy,sources,memory:JSON.stringify({history:job.session.history,previousEdit:job.session.result?.edl})}});
 }
 if(!UUID.test(b.jobId||'')||!UUID.test(b.leaseToken||''))throw new ApiError('LEASE_LOST');
 if(b.action==='heartbeat')return json(await rpc(db,'video_edit_work',args));
 const q=await db.from('video_edit_jobs').select('*').eq('id',b.jobId).eq('worker_id',b.workerId).eq('lease_token',b.leaseToken).maybeSingle();if(q.error)throw q.error;const j=q.data;
 if(!j)throw new ApiError('LEASE_LOST');
 if(b.action==='finish'&&['succeeded','failed'].includes(j.status))return json({status:j.status});
 if(j.status!=='running'||Date.parse(j.lease_expires_at)<=Date.now())throw new ApiError('LEASE_LOST');
 const path=`${j.user_id}/video-edit/${j.id}.mp4`;
 if(b.action==='upload'){const r=await db.storage.from('studio-media').createSignedUploadUrl(path);if(r.error)throw r.error;return json({url:r.data.signedUrl});}
 if(b.action==='finish'){
  if(b.result?.status==='succeeded'){const r=await db.storage.from('studio-media').info(path),size=r.data?.size??r.data?.metadata?.size,mime=r.data?.contentType??r.data?.metadata?.mimetype;if(r.error||!size||size>52428800||mime!=='video/mp4')throw new ApiError('RESULT_NOT_READY');}
  return json(await rpc(db,'video_edit_work',args));
 }
 throw Error('VIDEO_EDIT_INVALID');
}catch(e){return videoEditError(e);}}
