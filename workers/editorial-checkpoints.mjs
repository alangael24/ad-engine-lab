import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {productionWorkflow} from '../assets/production-workflow.js';
export const CHECKPOINT_VERSION='editorial-recovery-v1';
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().filter(k=>x[k]!==undefined).map(k=>[k,canonical(x[k])])):x;
export const checkpointKey=x=>createHash('sha256').update(JSON.stringify(canonical(x))).digest('hex');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
// Only the worker API can select the owner/project namespace. Never accept a
// storage path or credentials from a saved model response.
export function remoteCheckpoints(api,identity,{fetchImpl=fetch}={}){
 const verifiedMedia=new Set();
 const action=(op,key,value)=>api('checkpoint',{...identity,op,key,value});
 return {
  get:async key=>(await action('get',key)).checkpoint,
  claim:async(key,{artifact=false}={})=>(await action(artifact?'claim_artifact':'claim',key)).checkpoint,
  save:async(key,state,value)=>action('save',key,{state,value}),
  async putMedia(path){
   const bytes=await readFile(path),hash=sha(bytes);if(bytes.length>52428800)throw Error('EDITORIAL_MEDIA_TOO_LARGE');
   if(verifiedMedia.has(hash))return hash;
   const {uploadUrl,downloadUrl}=await api('checkpoint_media',{...identity,key:hash});
   const r=await fetchImpl(uploadUrl,{method:'PUT',headers:{'content-type':'video/mp4','x-upsert':'false'},body:bytes,signal:AbortSignal.timeout(120000)});
   // A duplicate upload is only accepted after verifying the existing bytes.
   if(!r.ok){if(![400,409].includes(r.status))throw Error('EDITORIAL_CHECKPOINT_UPLOAD');await this.getMedia(hash,path,downloadUrl);}
   verifiedMedia.add(hash);return hash;
  },
  async getMedia(hash,path,url){
   if(!/^[a-f0-9]{64}$/.test(hash))throw Error('EDITORIAL_CHECKPOINT_INVALID');
   const downloadUrl=url||(await api('checkpoint_media',{...identity,key:hash})).downloadUrl;
   const r=await fetchImpl(downloadUrl,{redirect:'error',signal:AbortSignal.timeout(120000)});if(!r.ok)throw Error('EDITORIAL_CHECKPOINT_MEDIA_MISSING');
   let size=0;const chunks=[];for await(const chunk of r.body){size+=chunk.length;if(size>52428800)throw Error('EDITORIAL_MEDIA_TOO_LARGE');chunks.push(chunk);}
   const bytes=Buffer.concat(chunks);if(sha(bytes)!==hash)throw Error('EDITORIAL_CHECKPOINT_HASH');await writeFile(path,bytes);verifiedMedia.add(hash);return path;
  }
 };
}
function reused(usage,receipt){
 usage.reusedCalls||=[];
 for(const c of receipt?.calls||[])if(!usage.reusedCalls.some(x=>x.id===c.id))usage.reusedCalls.push(c);
 // Historical charges remain on their original run; reuse is not billed again.
}
export function checkpointedCall(call,checkpoints,{scope='' }={}){
 if(!checkpoints)return call;
 return async args=>{
  const {role,name,schema,system,context,images=[],env,usage,onUsage}=args;
  const key=checkpointKey([CHECKPOINT_VERSION,scope,productionWorkflow(env),role,name,schema,system,context,images]);
  for(let retry=0;retry<2;retry++){
   const slot=checkpointKey([key,retry]),old=await checkpoints.get(slot);
   if(old?.state==='done'){reused(usage,old.value.usage);if(onUsage)await onUsage(usage);return structuredClone(old.value.result);}
   if(old?.state==='started')throw Error('EDITORIAL_CHECKPOINT_UNCERTAIN');
   if(old?.state==='failed'){
    reused(usage,old.value.usage);
    if(old.value.usage?.unknown)throw Error('EDITORIAL_CHECKPOINT_UNCERTAIN');
    if(retry===1)throw Error(old.value.error||'EDITORIAL_RETRY_EXHAUSTED');
    continue;
   }
   const claim=await checkpoints.claim(slot);
   if(!claim.claimed)throw Error('EDITORIAL_CHECKPOINT_BUSY');
   const start=usage.calls.length;
   const receipt=()=>{const calls=usage.calls.slice(start);return {calls,total:calls.reduce((n,c)=>n+(c.cost||0),0),unknown:calls.some(c=>c.cost==null)};};
   let result;
   try{
    result=await call({...args,onUsage:async()=>{
     await checkpoints.save(slot,'started',{usage:receipt()});
     if(onUsage)await onUsage(usage);
    }});
   }catch(e){
    await checkpoints.save(slot,'failed',{error:e.message,usage:receipt()});throw e;
   }
   // If this write fails, leave the in-flight marker. Do not call the provider
   // again: its response could have been charged and persisted remotely.
   await checkpoints.save(slot,'done',{result,usage:receipt()});return result;
  }
 };
}

// Rendered bytes are saved before visual review. A failed review/registration
// can therefore resume without rerendering the same EDL on another host.
export function checkpointedRender(render,checkpoints,{scope=''}={}){
 if(!checkpoints)return render;
 return async args=>{
  const {edl,scenes,words,narration,duration,aspectRatio,root}=args;
  const sources=[];
  for(const s of scenes){const {path,url,...meta}=s;sources.push({meta,sha256:sha(await readFile(path))});}
  const key=checkpointKey([CHECKPOINT_VERSION,'render',scope,edl,sources,words,sha(await readFile(narration)),duration,aspectRatio]);
  await mkdir(root,{recursive:true});
  const old=await checkpoints.get(key);
  if(old?.state==='done')return {...old.value.result,path:await checkpoints.getMedia(old.value.media,root+'/recovered.mp4')};
  const claim=await checkpoints.claim(key,{artifact:true});if(!claim.claimed)throw Error('EDITORIAL_CHECKPOINT_BUSY');
  const result=await render(args),media=await checkpoints.putMedia(result.path),{path,...saved}=result;
  await checkpoints.save(key,'done',{media,result:saved});return result;
 };
}
