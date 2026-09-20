// Separate durable queue, same independent minute watchdog as H3.
export async function tickQwenPod(env,{fetchImpl=fetch,now=()=>Date.now()}={}){
 if(env.QWEN_POD_CONTROLLER!=='true')return {status:'disabled'};
 const origin=new URL(env.CREATIVE_RUSH_URL);
 if(origin.protocol!=='https:'||!env.RUNPOD_CONTROL_API_KEY||!env.PRODUCTION_WORKER_TOKEN||!env.GENERATION_WORKER_TOKEN||!/^ghcr\.io\/alangael24\/creativerush-qwen-pod@sha256:[a-f0-9]{64}$/.test(env.QWEN_POD_IMAGE||''))throw Error('QWEN_CONFIG');
 const owner='qwenctl_'+crypto.randomUUID();let token;
 const state=async(action,data={})=>{
  const r=await fetchImpl(origin.origin+'/api/qwen-image-worker',{method:'POST',headers:{authorization:`Bearer ${env.PRODUCTION_WORKER_TOKEN}`,'content-type':'application/json','user-agent':'CreativeRush-Worker/1.0'},body:JSON.stringify({action,owner,token,data}),redirect:'manual',signal:AbortSignal.timeout(20000)});
  if(!r.ok)throw Error('QWEN_STATE_UNAVAILABLE');return r.json();
 };
 const control=async(path,method='GET',body)=>{
  const r=await fetchImpl('https://api.runpod.io/v2'+path,{method,headers:{authorization:`Bearer ${env.RUNPOD_CONTROL_API_KEY}`,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),redirect:'manual',signal:AbortSignal.timeout(20000)});
  if(r.status===404)return null;if(!r.ok)throw Error('QWEN_CONTROL_UNCONFIRMED');return r.status===204?{}:r.json();
 };
 let s=await state('acquire');if(s.busy)return {status:'busy'};token=s.token;
 try{
  let run=s.run;
  if(!run?.id||run.phase==='closed'){
   if(!s.enabled||!s.pending)return {status:'idle'};
   const gpu='NVIDIA GeForce RTX 5090',catalog=await control('/catalog/gpus/'+encodeURIComponent(gpu)+'?include=AVAILABILITY&product=POD&cloud=COMMUNITY&minCudaVersion=12.8');
   const rate=catalog?.price?.community;
   if(!Number.isFinite(rate)||rate>.71||!['LOW','MEDIUM','HIGH'].includes(catalog.availability))return {status:'no_approved_capacity'};
   s=await state('begin',{image:env.QWEN_POD_IMAGE,hourlyUsd:rate});run=s.run;
   // Persist intent first. Never repeat an uncertain create request.
   try{
    const pod=await control('/pods','POST',{name:run.name,cloud:'COMMUNITY',image:run.image_digest,disk:30,ports:[],gpu:{id:gpu,count:1,minCudaVersion:'12.8',minRamPerGpu:64},mounts:{persistent:{path:'/workspace',size:100}},startSsh:false,startJupyter:false,env:{CREATIVE_RUSH_URL:origin.origin,GENERATION_WORKER_TOKEN:env.GENERATION_WORKER_TOKEN,QWEN_RUN_ID:run.id,QWEN_DEADLINE:run.deadline_at}});
    if(pod?.id)await state('attach',{podId:pod.id});
   }catch{return {status:'creation_unconfirmed',runId:run.id};}
   return {status:'preparing',runId:run.id};
  }
  if(!run.pod_id){
   const all=await control('/pods');if(!Array.isArray(all?.pods))throw Error('QWEN_LIST_UNAVAILABLE');
   const matches=all.pods.filter(p=>p.name===run.name);
   if(matches.length>1){await state('block',{reason:'duplicate_pod_names'});return {status:'blocked'};}
   if(!matches.length){if(now()-Date.parse(run.created_at)>600000)await state('block',{reason:'creation_unresolved'});return {status:'reconciling_creation'};}
   s=await state('attach',{podId:matches[0].id});run=s.run;
  }
  const pod=await control('/pods/'+run.pod_id);
  if(pod&&(pod.id!==run.pod_id||pod.name!==run.name))throw Error('QWEN_OWNERSHIP_MISMATCH');
  const age=now()-Date.parse(run.created_at),idle=now()-Date.parse(run.last_job_at||run.created_at);
  let reason=run.phase==='draining'||run.phase==='blocked'?run.error||'draining':null;
  if(!pod)reason='provider_absent';
  else if(pod.gpu?.id!=='NVIDIA GeForce RTX 5090'||pod.gpu?.count!==1||pod.cloud!=='COMMUNITY'||!Number.isFinite(pod.cost)||pod.cost>.71)reason='unexpected_gpu_or_rate';
  else if(!s.enabled)reason='disabled';
  else if(now()>=Date.parse(run.deadline_at)||age*run.hourly_usd/3600000+.03>=s.budgetUsd)reason='budget_deadline';
  else if(!run.ready_at&&age>20*60*1000)reason='startup_failed';
  else if(run.ready_at&&now()-Date.parse(run.heartbeat_at||run.ready_at)>180000)reason='worker_lost';
  else if(!s.running&&!s.pending&&!s.holding&&idle>=90000)reason='idle';
  if(!reason)return {status:run.phase,podId:run.pod_id};
  await state('drain',{reason});
  if(pod)await control('/pods/'+pod.id+'/action','POST',{action:'terminate'});
  if(await control('/pods/'+run.pod_id))return {status:'deleting'};
  await state('close');return {status:'deleted',podId:run.pod_id,reason};
 }finally{await state('release').catch(()=>{});}
}
