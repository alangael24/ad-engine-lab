import {getSupabaseAdmin,json} from '../../src/backend.js';
import {readJson,rpc,apiError,ApiError,UUID} from '../../src/generations.js';
import {verifyWorker} from './worker.js';
import {qwenJobMedia} from '../../src/qwen-images.js';
const gpuActions=new Set(['progress','claim','upload','finish','fail']);
const controllerActions=new Set(['acquire','begin','attach','drain','close','release','block']);
export async function onRequestPost({request,env}){
 try{
  const b=await readJson(request,100000),gpu=gpuActions.has(b.action);
  if(!gpu&&!controllerActions.has(b.action))throw new ApiError('UNAUTHORIZED');
  await verifyWorker(request,gpu?env.GENERATION_WORKER_TOKEN:env.PRODUCTION_WORKER_TOKEN);
  const db=getSupabaseAdmin(env),data=gpu?b.data||{}:{...b.data,owner:b.owner,token:b.token};
  if(gpu&&!UUID.test(data.runId||''))throw new ApiError('UNAUTHORIZED');
  if(b.action==='upload'||b.action==='finish'){
   const {data:q,error}=await db.from('qwen_image_jobs').select('*').eq('id',data.id).eq('run_id',data.runId).eq('claim_token',data.claimToken).single();
   if(error||!q||!['running','succeeded'].includes(q.status))throw Error('LEASE_LOST');
   if(b.action==='finish'&&(!/^[a-f0-9]{64}$/.test(data.receipt?.sha256||'')||data.receipt?.fingerprint!==q.fingerprint||data.receipt?.version!==q.request.version))throw Error('QWEN_RECEIPT_INVALID');
   const {path}=await qwenJobMedia(db,q);
   if(b.action==='upload'){
    const {data:u,error:e}=await db.storage.from('generation-references').createSignedUploadUrl(path);if(e)throw e;
    return json({uploadUrl:u.signedUrl});
   }
   const {data:info,error:e}=await db.storage.from('generation-references').info(path);
   if(e||!(info?.size??info?.metadata?.size)||(info.size??info.metadata?.size)>6291456||(info.contentType??info.metadata?.mimetype)!=='image/png')throw Error('RESULT_NOT_READY');
  }
  const value=await rpc(db,'qwen_image_work',{p_action:b.action,p_data:data});
  if(b.action==='claim'&&value){const {refs}=await qwenJobMedia(db,value);return json({...value,referenceUrls:refs});}
  return json(value);
 }catch(e){return apiError(e);}
}
