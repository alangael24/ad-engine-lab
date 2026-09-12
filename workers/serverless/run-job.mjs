import {H3Adapter} from '../h3-adapter.mjs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

export function storageUrl(value, origin, upload=false) {
  const url=new URL(value);
  if(url.protocol!=='https:' || url.origin!==origin || url.username || url.password
    || !url.pathname.startsWith(upload?'/storage/v1/object/upload/sign/':'/storage/v1/object/sign/')) throw Error('INVALID_STORAGE_URL');
  return url.href;
}

export async function runJob(input,{adapter=new H3Adapter('http://127.0.0.1:8188'),fetchImpl=fetch,env=process.env}={}) {
  if(!/^[a-zA-Z0-9_-]{1,100}$/.test(input.job?.id||''))throw Error('INVALID_JOB');
  const job=input.job,origin=env.H3_STORAGE_ORIGIN;
  if(job.referenceUrl)storageUrl(job.referenceUrl,origin);
  if(input.uploadUrl)storageUrl(input.uploadUrl,origin,true);
  else if(env.H3_ALLOW_SMOKE_OUTPUT!=='true')throw Error('UPLOAD_REQUIRED');
  const workflow=await adapter.build(job);
  // Retried delivery on the same worker can reuse Comfy's recorded result.
  const existing=await adapter.findSubmission(job.id);
  const promptId=existing||await adapter.submit(workflow,job.id);
  const video=await adapter.wait(promptId,()=>{},{timeoutMs:1080000});
  const bytes=Buffer.from(await video.arrayBuffer());
  const result={jobId:job.id,uploaded:!!input.uploadUrl,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),promptId};
  if(input.uploadUrl){
    // Retry upload only, never re-generate on a lost upload response.
    let uploaded=false;
    for(let attempt=0;attempt<3&&!uploaded;attempt++){
      try{const r=await fetchImpl(input.uploadUrl,{method:'PUT',redirect:'error',headers:{'content-type':'video/mp4','x-upsert':'false'},body:bytes,signal:AbortSignal.timeout(90000)});
        uploaded=r.ok||[400,409].includes(r.status);
      }catch{}
    }
    if(!uploaded)throw Error('UPLOAD_FAILED');
  }else{
    if(bytes.length>12*1024*1024)throw Error('SMOKE_OUTPUT_TOO_LARGE');
    result.base64=bytes.toString('base64');
  }
  return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{let raw='';for await(const chunk of process.stdin){raw+=chunk;if(raw.length>20000)throw Error('INPUT_TOO_LARGE');}
    console.log(JSON.stringify(await runJob(JSON.parse(raw))));
  }catch(error){console.error('H3_JOB_FAILED');process.exitCode=1;}
}
