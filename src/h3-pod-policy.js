// Execution profiles affect compute admission only, never the creative graph.
export const DEFAULT_H3_PROFILE={id:'h3-5090',gpu:'NVIDIA GeForce RTX 5090',cloud:'COMMUNITY',min_cuda:'13.0',min_vram_gb:31,max_hourly_usd:.71,billable_hourly_usd:.73,startup_seconds:2100,stalled_seconds:600,upload_seconds:60,seconds_per_video_second:{'480p':18,'720p':35}};
export function eligibleProfiles(profiles){
 return (profiles??[DEFAULT_H3_PROFILE]).filter(p=>p.id==='h3-5090'||p.enabled&&p.validated_at&&p.validation_evidence&&p.image_digest).filter(p=>p.enabled!==false&&!p.suspended_at);
}
export function infrastructureFailure(code=''){
 if(/OOM|OUT_OF_MEMORY/i.test(code))return {scope:'profile',retry:false,reason:'gpu_oom'};
 if(/CREDENTIAL|AUTH|HTTP_401|HTTP_403/i.test(code))return {scope:'system',retry:false,reason:'credentials_invalid'};
 if(/MODEL_|IMPORT|MODULE|INVALID|CONFIG|FILE_NOT_FOUND|VALUEERROR|TYPEERROR|SYNTAXERROR/i.test(code))return {scope:'profile',retry:false,reason:'profile_configuration'};
 return {scope:'machine',retry:true,reason:'host_failed'};
}
export function clipAdmissionSeconds(job,profile=DEFAULT_H3_PROFILE){
 return Math.ceil(profile.upload_seconds+job.durationSeconds*profile.seconds_per_video_second[job.resolution]);
}
export function managedStopReason(run,pod,state,now,profile=DEFAULT_H3_PROFILE){
 let reason=run.phase==='draining'?run.reason:null;
 if(pod.gpu?.id!==profile.gpu||pod.gpu?.count!==1||pod.cloud!==profile.cloud||!Number.isFinite(pod.cost)||pod.cost>profile.max_hourly_usd)return 'unexpected_gpu_or_price';
 if(run.phase==='blocked'||!state.enabled)return reason||'disabled';
 if(reason)return reason;
 if(run.boot_error)return run.profile_id?infrastructureFailure(run.boot_error).reason:'startup_failed';
 const age=now-Date.parse(run.created_at),rate=profile.billable_hourly_usd*1e6;
 if(now>=Date.parse(run.deadline_at)||age*rate/3600000+30000>=run.reserved_microusd)return 'budget_deadline';
 if(!run.ready_at){
  // boot_updated_at is advanced only by a new stage or increased byte count.
  const progress=Date.parse(run.boot_updated_at||run.created_at);
  if(age>(run.profile_id?profile.startup_seconds*1000:600000)||now-progress>profile.stalled_seconds*1000)return 'startup_failed';
 }
 if(run.phase==='running'&&!state.pending&&!state.running&&run.idle_since&&now-Date.parse(run.idle_since)>=90000)return 'idle';
 if(run.needs_rotation&&!state.running)return 'insufficient_run_window';
 if(pod.status==='EXITED')return 'worker_exited';
 return null;
}
