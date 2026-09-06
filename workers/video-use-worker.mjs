import {mkdir,readFile,writeFile,copyFile,chmod,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {runVideoUse} from './video-use/agent.mjs';
import {createSandbox,processCommand,safePath} from './video-use/sandbox.mjs';
const here=dirname(fileURLToPath(import.meta.url));
export function videoEditApi({appUrl,token,workerId,fetchImpl=fetch}){
 const u=new URL(appUrl);if(u.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(u.hostname))throw Error('HTTPS required');
 if(!token||token.length<32||!/^[\w-]{1,80}$/.test(workerId))throw Error('Worker configuration required');
 return async(action,body={})=>{const r=await fetchImpl(u.origin+'/api/video-edit-worker',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({action,workerId,...body}),signal:AbortSignal.timeout(25000)});const d=await r.json();if(!r.ok)throw Object.assign(Error(d.code||'Worker API failed'),{code:d.code});return d;};
}
async function mediaBytes(url,fetchImpl){
 const u=new URL(url);if(u.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(u.hostname))throw Error('HTTPS required');
 const r=await fetchImpl(url,{redirect:'error',signal:AbortSignal.timeout(120000)});if(!r.ok)throw Error('Source download failed');
 let size=0;const chunks=[];for await(const b of r.body){size+=b.length;if(size>52428800)throw Error('Source exceeds 50 MB');chunks.push(b);}return Buffer.concat(chunks);
}
export async function prepareInputs(job,root,{env=process.env,fetchImpl=fetch,signal,sandboxOptions={},cachedTranscripts={}}={}){
 await mkdir(resolve(root,'sources'),{recursive:true});await mkdir(resolve(root,'cache'),{recursive:true});await mkdir(resolve(root,'edit/transcripts'),{recursive:true});await chmod(resolve(root,'edit'),0o777);
 const sb=await createSandbox(root,{...sandboxOptions,signal});const sources={},transcripts={};
 for(const s of job.sources){
  if(!/^S\d{2}$/.test(s.id))throw Error('Invalid source ID');
  const source=resolve(root,'sources',s.id+'.mp4'),bytes=s.path?await readFile(s.path):await mediaBytes(s.url,fetchImpl),hash=createHash('sha256').update(bytes).digest('hex');
  await writeFile(source,bytes);
  const meta=JSON.parse(await sb.run(['ffprobe','-v','error','-show_format','-show_streams','-of','json',`${sb.root}/sources/${s.id}.mp4`]));
  const video=meta.streams.find(x=>x.codec_type==='video'),duration=Number(meta.format.duration);
  if(!video||video.width>4096||video.height>4096||!Number.isFinite(duration)||duration<.2||duration>600)throw Error('Unsupported source dimensions or duration');
  sources[s.id]={name:s.name,reference:s.reference===true,duration,width:video.width,height:video.height,sha256:hash};
  const transcript=resolve(root,'cache',s.id+'.json'),fingerprint=transcript+'.sha256';let cached=false;
  try{cached=(await readFile(fingerprint,'utf8'))===hash;}catch{}
  if(!cached){
   let t;
   if(cachedTranscripts[s.id]){const fixture=cachedTranscripts[s.id];if(fixture.sha256!==hash)throw Error('Cached transcript does not match source hash');t=JSON.parse(await readFile(fixture.path,'utf8'));}
   else if(!meta.streams.some(x=>x.codec_type==='audio'))t={text:'',words:[]};
   else{
    if(!env.ELEVENLABS_API_KEY)throw Error('SCRIBE_NOT_CONFIGURED');
    const audio=resolve(root,'edit',s.id+'.wav');await sb.run(['ffmpeg','-v','error','-y','-i',`${sb.root}/sources/${s.id}.mp4`,'-vn','-ac','1','-ar','16000','-c:a','pcm_s16le',`${sb.edit}/${s.id}.wav`]);
    const form=new FormData();form.append('file',new Blob([await readFile(await safePath(resolve(root,'edit'),audio))],{type:'audio/wav'}),s.id+'.wav');form.append('model_id','scribe_v1');form.append('timestamps_granularity','word');form.append('diarize','true');form.append('tag_audio_events','true');
    const r=await fetchImpl('https://api.elevenlabs.io/v1/speech-to-text',{method:'POST',headers:{'xi-api-key':env.ELEVENLABS_API_KEY},body:form,signal:signal?AbortSignal.any([signal,AbortSignal.timeout(180000)]):AbortSignal.timeout(180000)});if(!r.ok)throw Error('Transcription failed');t=await r.json();
   }
   if(!Array.isArray(t.words)||t.words.some(w=>!Number.isFinite(w.start)||!Number.isFinite(w.end)||w.start<0||w.end<w.start||w.end>duration+.5))throw Error('Word-level transcript required');
   await writeFile(transcript,JSON.stringify(t));await writeFile(fingerprint,hash);
  }
  transcripts[s.id]=JSON.parse(await readFile(transcript,'utf8'));
  await writeFile(await safePath(resolve(root,'edit'),'transcripts/'+s.id+'.json'),JSON.stringify(transcripts[s.id]));
 }
 await sb.run([sb.python,`${sb.vendor}/helpers/pack_transcripts.py`,'--edit-dir',sb.edit]);
 return {sources,transcripts};
}
export async function processVideoEdit(job,api,{env=process.env,fetchImpl=fetch,run=runVideoUse,sandboxOptions={},cachedTranscripts={}}={}){
 if(!/^[\da-f-]{36}$/.test(job.sessionId)||!/^[\da-f-]{36}$/.test(job.id))throw Error('Invalid job identity');
 const root=resolve(env.VIDEO_USE_WORKDIR||'./.video-use-jobs',job.sessionId),identity={jobId:job.id,leaseToken:job.leaseToken},abort=new AbortController();
 let beating=false,last=Date.now();const timer=setInterval(async()=>{if(beating)return;beating=true;try{await api('heartbeat',identity);last=Date.now();}catch(e){if(e.code==='LEASE_LOST'||Date.now()-last>90000)abort.abort();}finally{beating=false;}},20000);
 const deadline=setTimeout(()=>abort.abort(),30*60*1000);
 try{
  await api('heartbeat',identity);
  const input=await prepareInputs(job,root,{env,fetchImpl,signal:abort.signal,sandboxOptions,cachedTranscripts});
  const result=await run({root,mode:job.kind==='edit'?'edit':'plan',request:job.request,strategy:job.kind==='edit'?job.strategy:'',memory:job.memory,env,fetchImpl,signal:abort.signal,sandboxOptions,...input});
  const {path,...publicResult}=result;
  if(path){
   const verifiedPath=await safePath(resolve(root,'edit'),path);const bytes=await readFile(verifiedPath);if(bytes.length>52428800)throw Error('Output exceeds 50 MB');
   const {url}=await api('upload',identity);const r=await fetchImpl(url,{method:'PUT',headers:{'content-type':'video/mp4','x-upsert':'false'},body:bytes,signal:AbortSignal.timeout(120000)});if(!r.ok&&![400,409].includes(r.status))throw Error('Result upload failed');
   await copyFile(verifiedPath,await safePath(resolve(root,'edit'),job.id+'.mp4'));
  }
  await writeFile(await safePath(resolve(root,'edit'),job.id+'.result.json'),JSON.stringify(publicResult,null,2));
  await api('finish',{...identity,result:publicResult});return publicResult;
 }catch(e){
  await mkdir(resolve(root,'edit'),{recursive:true});await writeFile(await safePath(resolve(root,'edit'),job.id+'.error.txt'),e.message).catch(()=>{});
  if(!abort.signal.aborted)await api('finish',{...identity,result:{status:'failed',message:e.message==='SCRIBE_NOT_CONFIGURED'?'Falta conectar la transcripción de audio. Tu material sigue guardado.':'No pude terminar esta edición. Tu material y la versión anterior siguen guardados.'}}).catch(()=>{});
  return {status:'failed',error:e.message};
 }finally{clearInterval(timer);clearTimeout(deadline);}
}
export async function main(){
 const env=process.env;if(!env.REFERENCE_FLASH_KEY||!env.ELEVENLABS_API_KEY)throw Error('Configure Flash and Scribe before advertising availability');
 // Fail closed: never advertise a worker that cannot create its sandbox.
 if(process.platform!=='darwin')await processCommand('docker',['image','inspect',env.VIDEO_USE_IMAGE||'creativerush-video-use:1']);
 const check=await mkdtemp(resolve(tmpdir(),'video-use-ready-'));
 try{await mkdir(resolve(check,'edit'));await chmod(resolve(check,'edit'),0o777);const sb=await createSandbox(check,{python:env.VIDEO_USE_PYTHON});await sb.run([sb.python,'-c','import PIL, numpy, subprocess; subprocess.run(["ffmpeg","-version"],check=True,stdout=subprocess.DEVNULL); subprocess.run(["ffprobe","-version"],check=True,stdout=subprocess.DEVNULL)'],30000);}finally{await rm(check,{recursive:true,force:true});}
 const api=videoEditApi({appUrl:env.CREATIVE_RUSH_URL,token:env.VIDEO_USE_WORKER_TOKEN,workerId:env.VIDEO_USE_WORKER_ID||'video-use-1'});
 let stopped=false;for(const s of ['SIGINT','SIGTERM'])process.on(s,()=>stopped=true);
 while(!stopped){try{const {job}=await api('claim');if(job)await processVideoEdit(job,api,{sandboxOptions:{python:env.VIDEO_USE_PYTHON}});}catch{console.error('video_use_worker_unavailable');}await new Promise(r=>setTimeout(r,5000));}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(e.message);process.exitCode=1;});
