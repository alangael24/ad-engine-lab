import {createHash} from 'node:crypto';
import {finishCreativeProject} from './creative-edit.mjs';
import {finishProductionAd} from './sol-luna-edit.mjs';
import {pathToFileURL} from 'node:url';
import {mkdtemp,mkdir,rm,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {renderTimeline} from './studio-renderer.mjs';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
export function studioApi({appUrl,token,workerId,fetchImpl=fetch}){
 const u=new URL(appUrl);if(u.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(u.hostname))throw Error('HTTPS required');
 if(!token||token.length<32||!/^[\w-]{1,80}$/.test(workerId||''))throw Error('Missing worker configuration');
 return async(action,body={})=>{const r=await fetchImpl(`${u.origin}/api/studio-worker`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`},body:JSON.stringify({action,workerId,...body}),signal:AbortSignal.timeout(25000)});const p=await r.json();if(!r.ok)throw Object.assign(Error(p.code||'STUDIO_BACKEND'),{code:p.code});return p;};
}
async function download(url,path,fetchImpl){
 const u=new URL(url);if(u.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(u.hostname))throw Error('Insecure media URL');
 const r=await fetchImpl(url,{signal:AbortSignal.timeout(120000),redirect:'error'});if(!r.ok||Number(r.headers.get('content-length'))>52428800)throw Error('Media download failed');
 const chunks=[];let total=0;for await(const chunk of r.body){total+=chunk.length;if(total>52428800)throw Error('Media too large');chunks.push(chunk);}await writeFile(path,Buffer.concat(chunks));
}
export async function processRender(job,api,{fetchImpl=fetch,render=renderTimeline,edit,env=process.env}={}){
 edit ||= env.STUDIO_EDITORIAL_ENGINE==='legacy'?finishCreativeProject:finishProductionAd;
 const dir=await mkdtemp(join(tmpdir(),'creativerush-render-')),identity={jobId:job.id,leaseToken:job.leaseToken},abort=new AbortController();
 let beating=false,last=Date.now();const timer=setInterval(async()=>{if(beating)return;beating=true;try{await api('heartbeat',identity);last=Date.now();}catch(e){if(e.code==='LEASE_LOST'||Date.now()-last>110000)abort.abort();}finally{beating=false;}},20000);
 const deadline=setTimeout(()=>abort.abort(),40*60*1000);
 try{
  await api('heartbeat',identity);const m=structuredClone(job.manifest);m.narration.path=join(dir,'narration');await download(m.narration.url,m.narration.path,fetchImpl);
  for(const [i,s] of m.scenes.entries()){s.path=join(dir,`source-${i}.mp4`);await download(s.url,s.path,fetchImpl);}
  let result;
  if(job.editorial){
   await api('begin_editorial',identity);
   const auditDir=env.PRODUCTION_AUDIT_DIR||join(tmpdir(),'creativerush-cost-audit');await mkdir(auditDir,{recursive:true});
   const onUsage=async usage=>writeFile(join(auditDir,`${job.id}-${job.leaseToken}.json`),JSON.stringify({jobId:job.id,leaseToken:job.leaseToken,usage},null,2));
   const {project,words,base}=job.editorial;
   project.data={...project.data,scenes:m.scenes.map((s,i)=>({...project.data.scenes.find(x=>x.id===s.id),...s})),scriptDraft:m.scenes.map(s=>s.text).join(' ')};
   result=await edit({root:join(dir,'creative'),onUsage,project,shots:m.scenes.map(s=>({sceneId:s.id,path:s.path})),narration:m.narration.path,words,base,cacheDirectory:env.STUDIO_EDIT_CACHE_DIR||join(tmpdir(),'creativerush-edit-cache'),cacheNamespace:createHash('sha256').update(String(project.user_id)+':'+project.id).digest('hex'),strategy:`Finish the approved ad with clear pacing. Use readable word-synchronized captions by default; the latest customer request overrides defaults, including removing captions. Follow this approved direction and applied customer requests: ${JSON.stringify(project.data.creativeMemory||{})}. Keep every scene and spoken word in order; Keep the narration continuous; adjust picture timing without removing spoken audio. Match the reference.`,env,fetchImpl,signal:abort.signal,sandboxOptions:{python:env.VIDEO_USE_PYTHON}});
   if(result.status!=='succeeded'||!result.path)throw Error('EDITORIAL_REVIEW_BLOCKED');
   const sha256=createHash('sha256').update(await readFile(result.path)).digest('hex');
   await api('editorial',{...identity,ranges:result.edl.ranges,segments:result.edl.segments,version:result.edl.version,review:result.review,edit:result.edl.version?{captions:result.edl.captions,captionGroups:result.edl.captionGroups,captionColor:result.edl.captionColor,captionSize:result.edl.captionSize,hook:result.edl.hook,sourceCaptionScenes:result.edl.sourceCaptionScenes,captionFadeMs:result.edl.captionFadeMs,captionHighlight:result.edl.captionHighlight}:undefined,words:result.edl.words,sha256,usage:result.usage,message:result.message});
  }else result=await render(m,dir,{signal:abort.signal});
  if(abort.signal.aborted)throw Error('Lease lost');
  const {uploadUrl}=await api('upload',identity),r=await fetchImpl(uploadUrl,{method:'PUT',headers:{'content-type':'video/mp4','x-upsert':'false'},body:await readFile(result.path),signal:AbortSignal.timeout(120000)});
  if(!r.ok&&![400,409].includes(r.status))throw Error('Upload failed');
  await api('complete',{...identity,success:true});return true;
 }catch(error){if(!abort.signal.aborted)await api('complete',{...identity,success:false}).catch(()=>{});console.error('render_failed',job.id,error.code||'See worker diagnostics');return false;}
 finally{clearInterval(timer);clearTimeout(deadline);await rm(dir,{recursive:true,force:true});}
}
export async function main(){const api=studioApi({appUrl:process.env.CREATIVE_RUSH_URL,token:process.env.STUDIO_WORKER_TOKEN,workerId:process.env.STUDIO_WORKER_ID});let stop=false;for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>{stop=true;});
 while(!stop){try{const {job}=await api('claim');if(job)await processRender(job,api);else await delay(5000);}catch{console.error('studio_worker_unavailable');await delay(10000);}}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{console.error('Invalid studio worker configuration');process.exitCode=1;});
