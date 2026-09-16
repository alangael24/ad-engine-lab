import {getSupabaseAdmin,json} from '../../src/backend.js';
import {readJson,rpc,apiError,ApiError,RESULT_BUCKET} from '../../src/generations.js';
import {verifyWorker} from './worker.js';
export async function onRequestPost({request,env}){
 try{
  const body=await readJson(request);
  if(body.action==='download_progress'){
   await verifyWorker(request,env.GENERATION_WORKER_TOKEN);
   await rpc(getSupabaseAdmin(env),'h3_pod_download_progress',{p_run:body.runId,p_worker:body.workerId,p_bytes:body.bytes});
   return json({ok:true});
  }
  if(body.action==='boot_progress'){
   await verifyWorker(request,env.GENERATION_WORKER_TOKEN);
   await rpc(getSupabaseAdmin(env),'h3_pod_boot_progress',{p_run:body.runId,p_worker:body.workerId,p_stage:body.stage,p_error:body.error||null});
   return json({ok:true});
  }
  if(body.action==='ready'){
   await verifyWorker(request,env.GENERATION_WORKER_TOKEN);
   await rpc(getSupabaseAdmin(env),'h3_pod_ready',{p_run:body.runId,p_worker:body.workerId});
   return json({ok:true});
  }
  await verifyWorker(request,env.PRODUCTION_WORKER_TOKEN);
  const db=getSupabaseAdmin(env);
  if(body.action==='close'){
   // Only the controller, after confirmed deletion, may reconcile this run.
   const control=await db.from('h3_pod_control').select('*').eq('id',true).single();
   if(control.error)throw control.error;
   if(control.data.owner!==body.owner||control.data.token!==body.token||Date.parse(control.data.lease_until)<=Date.now())throw new ApiError('LEASE_LOST');
   const attempts=await db.from('h3_generation_attempts').select('id,output_path').eq('run_id',control.data.current_run).in('status',['running','reconciling']);
   if(attempts.error)throw attempts.error;
   const recovered=[];
   for(const attempt of attempts.data){
    const {data,error}=await db.storage.from(RESULT_BUCKET).info(attempt.output_path);
    if(error){
     if(String(error.statusCode||error.status)==='404'||['not_found','NoSuchKey'].includes(error.code))continue;
     throw new ApiError('RESULT_NOT_READY'); // storage outage is not proof of absence
    }
    const size=data?.size??data?.metadata?.size,mime=data?.contentType??data?.metadata?.mimetype;
    if(size>0&&size<=52428800&&mime==='video/mp4')recovered.push(attempt.id);
   }
   body.data={...body.data,recoveredAttemptIds:recovered};
  }
  return json(await rpc(db,'h3_pod_work',{p_owner:body.owner,p_action:body.action,p_token:body.token||null,p_data:body.data||{}}));
 }catch(e){return apiError(e);}
}
