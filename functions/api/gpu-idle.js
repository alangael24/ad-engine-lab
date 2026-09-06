import {getSupabaseAdmin,json} from '../../src/backend.js';
import {rpc} from '../../src/generations.js';
import {verifyWorker} from './worker.js';
export async function onRequestPost({request,env}){
 try{
  await verifyWorker(request,env.PRODUCTION_WORKER_TOKEN);
  if(env.GPU_IDLE_ENABLED!=='true')return json({stop:false,reason:'disabled'});
  const seconds=Number(env.GPU_IDLE_SECONDS||600);
  if(!Number.isInteger(seconds)||seconds<300||seconds>86400)throw Error('INVALID_IDLE_TIMEOUT');
  return json(await rpc(getSupabaseAdmin(env),'gpu_idle_check',{p_idle_seconds:seconds}));
 }catch{return json({stop:false,error:'GPU_IDLE_CHECK_FAILED'},503);}
}
