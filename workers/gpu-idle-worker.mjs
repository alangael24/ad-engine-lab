import {pathToFileURL} from 'node:url';
// Exclusive managed pod only; never create, resume or resize. Defaults off.
export async function checkGpuIdle(env,{fetchImpl=fetch}={}){
 if(env.GPU_IDLE_ENABLED!=='true')return {status:'disabled'};
 if(env.GPU_MANAGED_EXCLUSIVE!=='true')throw Error('GPU_REQUIRES_DEDICATED_POD');
 const mode=env.GPU_IDLE_ACTION||'delete';
 if(!['stop','delete'].includes(mode))throw Error('GPU_IDLE_CONFIG');
 const id=env.GPU_MANAGED_POD_ID,key=env.RUNPOD_API_KEY,token=env.PRODUCTION_WORKER_TOKEN;
 if(!/^[a-zA-Z0-9_-]{1,80}$/.test(id||'')||!key||!token||token.length<32)throw Error('GPU_IDLE_CONFIG');
 const app=new URL(env.CREATIVE_RUSH_URL);
 if(app.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(app.hostname))throw Error('GPU_IDLE_CONFIG');
 const runpod=async(path,method='GET')=>fetchImpl(`https://rest.runpod.io/v1/pods/${id}${path}`,{method,headers:{authorization:`Bearer ${key}`},signal:AbortSignal.timeout(30000),redirect:'error'});
 const pod=await runpod('');
 if(pod.status===404)return {status:'absent'};
 if(!pod.ok)throw Error('GPU_STATUS_UNAVAILABLE');
 const state=await pod.json();
 if(state.id!==id)throw Error('GPU_ID_MISMATCH');
 if(mode==='stop'&&state.desiredStatus!=='RUNNING')return {status:'not_running'};
 const r=await fetchImpl(app.origin+'/api/gpu-idle',{method:'POST',headers:{authorization:`Bearer ${token}`},signal:AbortSignal.timeout(30000),redirect:'error'});
 if(!r.ok)throw Error('GPU_IDLE_CHECK_FAILED');
 const decision=await r.json();if(decision.stop!==true)return {status:decision.reason||'busy'};
 const stopped=await runpod(mode==='delete'?'':'/stop',mode==='delete'?'DELETE':'POST');
 if(!stopped.ok&&!(mode==='delete'&&stopped.status===404))throw Error('GPU_STOP_UNCONFIRMED');
 if(mode==='delete'){
  const verified=await runpod('');
  if(verified.status===404)return {status:'deleted',verifiedAbsent:true,podId:id};
  if(!verified.ok)throw Error('GPU_DELETE_UNCONFIRMED');
  return {status:'delete_requested',verifiedAbsent:false,podId:id};
 }
 // Confirm on the next read; HTTP acceptance alone is not proof of shutdown.
 return {status:'stop_requested'};
}
export async function main(){
 if(process.env.GPU_IDLE_ENABLED!=='true')return;
 let stopped=false;for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{stopped=true;});
 while(!stopped){try{console.log(JSON.stringify({gpuIdle:await checkGpuIdle(process.env)}));}catch(e){console.error(e.message);}
  if(!stopped)await new Promise(r=>setTimeout(r,30000));
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{process.exitCode=1;});
