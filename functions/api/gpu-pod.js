import {getSupabaseAdmin,json} from '../../src/backend.js';
import {readJson,rpc,apiError} from '../../src/generations.js';
import {verifyWorker} from './worker.js';
export async function onRequestPost({request,env}){
 try{
  const body=await readJson(request);
  if(body.action==='ready'){
   await verifyWorker(request,env.GENERATION_WORKER_TOKEN);
   await rpc(getSupabaseAdmin(env),'h3_pod_ready',{p_run:body.runId,p_worker:body.workerId});
   return json({ok:true});
  }
  await verifyWorker(request,env.PRODUCTION_WORKER_TOKEN);
  return json(await rpc(getSupabaseAdmin(env),'h3_pod_work',{p_owner:body.owner,p_action:body.action,p_token:body.token||null,p_data:body.data||{}}));
 }catch(e){return apiError(e);}
}
