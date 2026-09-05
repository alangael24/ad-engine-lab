import {getSupabaseAdmin,json} from '../../src/backend.js';
import {readJson,rpc,ApiError,UUID} from '../../src/generations.js';
import {verifyWorker} from './worker.js';
import {studioError,signed} from '../../src/studio.js';
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
  return json({job:{id:r.id,leaseToken:r.lease_token,manifest}});
 }
 if(!UUID.test(b.jobId||'')||!UUID.test(b.leaseToken||''))throw new ApiError('LEASE_LOST');
 if(b.action==='heartbeat')return json(await rpc(db,'studio_render_worker',args));
 const q=await db.from('studio_renders').select('*').eq('id',b.jobId).eq('worker_id',b.workerId).eq('lease_token',b.leaseToken).maybeSingle();
 if(q.error)throw q.error;const r=q.data;if(!r)throw new ApiError('LEASE_LOST');
 if(b.action==='complete'&&['succeeded','failed'].includes(r.status))return json({status:r.status});
 if(r.status!=='running'||Date.parse(r.lease_expires_at)<=Date.now())throw new ApiError('LEASE_LOST');
 const path=`${r.user_id}/renders/${r.id}.mp4`;
 if(b.action==='upload'){
  const s=await db.storage.from('studio-media').createSignedUploadUrl(path);if(s.error)throw s.error;return json({uploadUrl:s.data.signedUrl});
 }
 if(b.action==='complete'){
  if(b.success){const x=await db.storage.from('studio-media').info(path),size=x.data?.size??x.data?.metadata?.size,mime=x.data?.contentType??x.data?.metadata?.mimetype;
   if(x.error||!size||size>52428800||mime!=='video/mp4')throw new ApiError('RESULT_NOT_READY');}
  return json(await rpc(db,'studio_render_worker',args));
 }
 throw new ApiError('INVALID_GENERATION');
}catch(error){return studioError(error);}}
export function onRequest(){return new Response(null,{status:405});}
