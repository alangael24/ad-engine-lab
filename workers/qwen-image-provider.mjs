// One logical request survives a coordinator restart; the GPU queue owns it.
export async function qwenImage({prompt,size,references,includeFilmstrip,invoke},{pollMs=3000,wait=ms=>new Promise(r=>setTimeout(r,ms)),maxWaitMs=45*60*1000}={}){
 const key=invoke.costStep;
 if(!/^(image-\d+|repair-image-\d+-\d+)$/.test(key||''))throw Error('QWEN_IMAGE_STEP_REQUIRED');
 const start=Date.now();let job=await invoke('qwen_enqueue',{key,request:{prompt,size,references,includeFilmstrip}});
 while(job.status!=='succeeded'){
  if(['failed','uncertain'].includes(job.status))throw Error(job.error||'QWEN_IMAGE_FAILED');
  if(Date.now()-start>maxWaitMs)throw Error('QWEN_IMAGE_WAIT_TIMEOUT');
  await wait(pollMs);job=await invoke('qwen_status',{id:job.id});
 }
 // Registration is independent of expensive generation. Replaying only this
 // operation uses the same asset UUID and already-uploaded PNG.
 const registered=await invoke('register',{assetId:job.asset_id,kind:'image'});
 return {assetId:registered.result.id,provider:'qwen21-batch-v1',qwenJobId:job.id,qwenRunId:job.run_id,
  receipt:job.receipt,activeComputeUsd:job.active_usd,costBasis:'Run controller settles allocated whole-session compute after GPU deletion; reservation retained until then'};
}
