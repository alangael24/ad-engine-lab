// Used by the independent minute cron, not by the GPU or an LLM.
const GPU='NVIDIA GeForce RTX 5090';
export async function tickManagedPod(env,{fetchImpl=fetch,now=()=>Date.now()}={}){
 if(env.H3_BACKEND!=='pod')return {status:'disabled'};
 const origin=new URL(env.CREATIVE_RUSH_URL);
 if(origin.protocol!=='https:'||!env.RUNPOD_CONTROL_API_KEY||!env.PRODUCTION_WORKER_TOKEN||!env.GENERATION_WORKER_TOKEN
  ||!/^ghcr\.io\/alangael24\/creativerush-h3-pod@sha256:[a-f0-9]{64}$/.test(env.H3_POD_IMAGE||''))throw Error('POD_CONFIG');
 const owner='podctl_'+crypto.randomUUID();let token;
 const state=async(action,data={})=>{
   const r=await fetchImpl(origin.origin+'/api/gpu-pod',{method:'POST',headers:{authorization:`Bearer ${env.PRODUCTION_WORKER_TOKEN}`,'content-type':'application/json','user-agent':'CreativeRush-Worker/1.0'},body:JSON.stringify({owner,action,token,data}),redirect:'manual',signal:AbortSignal.timeout(20000)});
  if(!r.ok)throw Error('POD_STATE_UNAVAILABLE');return r.json();
 };
 const control=async(path,method='GET',body)=>{
   const r=await fetchImpl('https://api.runpod.io/v2'+path,{method,headers:{authorization:`Bearer ${env.RUNPOD_CONTROL_API_KEY}`,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),redirect:'manual',signal:AbortSignal.timeout(20000)});
  if(r.status===404)return null;
  if(!r.ok)throw Error('POD_CONTROL_UNCONFIRMED');
  return r.status===204?{}:r.json();
 };
 let s=await state('acquire');if(s.busy)return {status:'busy'};token=s.token;
 try{
  let run=s.run;
  if(!run?.id||run.phase==='closed'){
   if(!s.enabled||!s.pending||s.running)return {status:'idle'};
   const catalog=await control('/catalog/gpus/'+encodeURIComponent(GPU)+'?include=AVAILABILITY&product=POD&cloud=COMMUNITY&minCudaVersion=13.0');
   const rate=catalog?.price?.community;
   if(!Number.isFinite(rate)||rate>0.71||!['LOW','MEDIUM','HIGH'].includes(catalog?.availability))return {status:'no_approved_capacity'};
   s=await state('begin');run=s.run;
   // Intent is committed before POST. An uncertain POST is NEVER sent twice.
   await state('heartbeat');
   try{
    const pod=await control('/pods','POST',{name:run.name,cloud:'COMMUNITY',image:env.H3_POD_IMAGE,
     disk:30,ports:[],gpu:{id:GPU,count:1,minCudaVersion:'13.0'},mounts:{persistent:{path:'/workspace',size:100}},
     startSsh:false,startJupyter:false,env:{CREATIVE_RUSH_URL:origin.origin,GENERATION_WORKER_TOKEN:env.GENERATION_WORKER_TOKEN,
      H3_POD_RUN_ID:run.id,H3_WORKER_ID:run.worker_prefix,H3_POD_DEADLINE:run.deadline_at}});
    if(pod?.id)await state('attach',{podId:pod.id});
   }catch{return {status:'create_ack_unknown'};}
   return {status:'preparing',runId:run.id};
  }
  if(!run.pod_id){
   const all=await control('/pods');if(!all||!Array.isArray(all.pods))throw Error('POD_LIST_UNAVAILABLE');
   const matches=all.pods.filter(p=>p.name===run.name);
   if(matches.length>1){await state('block',{reason:'duplicate_pod_names'});return {status:'blocked'};}
   if(matches.length===1){s=await state('attach',{podId:matches[0].id});run=s.run;}
   else {if(now()-Date.parse(run.created_at)>600000)await state('block',{reason:'create_unresolved'});return {status:'reconciling_creation'};}
  }
  const pod=await control('/pods/'+run.pod_id);
  if(!pod){if(run.phase==='draining')await state('close');else await state('block',{reason:'provider_absence_unresolved'});return {status:'absent'};}
  // Name + stored ID identify only this controller's own resource.
  if(pod.id!==run.pod_id||pod.name!==run.name)throw Error('POD_OWNERSHIP_MISMATCH');
  const age=now()-Date.parse(run.created_at);
  let reason=run.phase==='draining'?run.reason:null;
  if(pod.gpu?.id!==GPU||pod.gpu?.count!==1||pod.cloud!=='COMMUNITY'||!Number.isFinite(pod.cost)||pod.cost>0.71)reason='unexpected_gpu_or_price';
  if(run.phase==='blocked'||!s.enabled)reason=reason||'disabled';
  if(now()>=Date.parse(run.deadline_at)||age*730000/3600000+30000>=run.reserved_microusd)reason='budget_deadline';
  if(!run.ready_at&&(run.boot_error||age>600000))reason='startup_failed';
  if(run.phase==='running'&&!s.pending&&!s.running&&run.idle_since&&now()-Date.parse(run.idle_since)>=90000)reason='idle';
  if(pod.status==='EXITED')reason=reason||'worker_exited';
  if(!reason)return {status:run.phase,podId:pod.id};
  await state('drain',{reason}); // Atomic drain prevents a new claim racing shutdown.
  if(pod.status!=='EXITED')await control('/pods/'+pod.id+'/action','POST',{action:'stop'});
  await state('heartbeat');
  const stopped=await control('/pods/'+pod.id);
  if(stopped&&(stopped.status!=='EXITED'||stopped.runtime))return {status:'stopping'};
  // All completed clips were uploaded by h3-worker before completion. On hard
  // failure unresolved jobs remain recoverable/refundable; no blind resubmit.
  if(stopped)await control('/pods/'+pod.id+'/action','POST',{action:'terminate'});
  if(await control('/pods/'+pod.id))return {status:'deleting'};
  await state('close');return {status:'deleted',reason,podId:pod.id};
 }finally{await state('release').catch(()=>{});}
}
