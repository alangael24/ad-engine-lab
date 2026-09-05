import {pathToFileURL} from 'node:url';
import {validatePlan,alignScenes} from '../assets/production-model.js';
import {createProductionProviders} from './production-providers.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export async function stableId(scope,key){const b=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(scope+':'+key))).slice(0,16);b[6]=(b[6]&15)|80;b[8]=(b[8]&63)|128;const h=Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;}
export function productionApi({appUrl,token,workerId,fetchImpl=fetch}){
 const u=new URL(appUrl);if(u.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(u.hostname))throw Error('HTTPS required');
 if(!token||token.length<32||!/^[\w-]{1,80}$/.test(workerId||''))throw Error('Missing production configuration');
 return async(action,body={})=>{const r=await fetchImpl(u.origin+'/api/studio-production-worker',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({action,workerId,...body}),signal:AbortSignal.timeout(30000)});const d=await r.json();if(!r.ok)throw Object.assign(Error(d.code),{code:d.code});return d;};
}
export async function processProduction(job,api,providers,{pollMs=3000,deadlineMs=90*60*1000}={}){
 const identity={jobId:job.id,leaseToken:job.lease_token},started=Date.now();let lost=false,beating=false,last=Date.now();
 const invoke=async(action,data={})=>{if(lost)throw Error('LEASE_LOST');const r=await api(action,{...identity,data});return r.value??r;};
 const timer=setInterval(async()=>{if(beating)return;beating=true;try{await invoke('heartbeat');last=Date.now();}catch(e){if(e.code==='LEASE_LOST'||e.code==='STUDIO_CONFLICT'||Date.now()-last>100000)lost=true;}finally{beating=false;}},20000);
 const check=()=>{if(lost)throw Error('LEASE_LOST');if(Date.now()-started>deadlineMs)throw Error('PRODUCTION_TIMEOUT');};
 const once=async(key,stage,fn)=>{check();const s=await invoke('begin_step',{key,stage});if(s.status==='done')return s.result;const result=await fn();check();await invoke('finish_step',{key,stage,result});return result;};
 const write=async(key,stage,action,data)=>{check();return (await invoke('write',{key,stage,action,data})).result;};
 const wait=async(predicate)=>{while(true){check();const current=await invoke('inspect');const value=predicate(current);if(value)return value;await sleep(pollMs);}};
 try{
  await invoke('heartbeat');await providers.ready?.();
  const project=job.snapshot;
  const existing=project.data.scenes||[],revision=existing.length>0;
  const plan=await once('plan','planning',async()=>revision?{
   continuity:`Preserve the existing product, characters, setting and visual style. ${project.data.referenceNotes||''} ${JSON.stringify(project.data.creative||{})}`,
   scenes:existing.map(s=>({...s,motion:'Follow the approved scene direction; preserve continuity.'}))
  }:validatePlan(await providers.plan(project,invoke),project.data.scriptDraft));
  const reuseNarration=revision&&project.data.narrationAssetId&&project.data.timingConfirmed;
  const narration=reuseNarration?{assetId:project.data.narrationAssetId}:await once('narration','narration',()=>providers.speech(project,plan,invoke,job.id));
  const timeline=await once('timing','timing',()=>reuseNarration?existing.map(s=>({...s,planSceneId:s.id})):alignScenes(plan,narration.alignment,narration.duration).map(({narrationStart,...s})=>s));
  // Existing stills anchor regenerated scenes even when the first shot changes.
  const images=[],existingAnchor=existing.find(s=>s.imageAssetId);
  const reusable=s=>s.selectedVersionId&&(reuseNarration||timeline.filter(t=>t.planSceneId===s.id).every(t=>t.id===s.id&&t.end-t.start<=s.end-s.start));
  for(const [i,s] of plan.scenes.entries())images.push(s.imageAssetId||reusable(s)?{assetId:s.imageAssetId||null}:await once(`image-${i}`,'images',()=>providers.image({project,plan,index:i,previous:images.at(-1),anchor:existingAnchor?{assetId:existingAnchor.imageAssetId}:images[0],invoke,jobId:job.id})));
  const scenes=timeline.map(s=>{
   const old=existing.find(p=>p.id===s.id),keep=old?.selectedVersionId&&(reuseNarration||s.end-s.start<=old.end-old.start);
   return {...s,visual:revision?s.visual:`${s.visual}\nMovimiento: ${s.motion}`.slice(0,800),imageAssetId:images[plan.scenes.findIndex(p=>p.id===s.planSceneId)].assetId,selectedVersionId:keep?old.selectedVersionId:null};
  });
  await write('prepare','images','save_project',{...project.data,narrationAssetId:narration.assetId,timingConfirmed:true,scenes});
  for(const [i,s] of scenes.entries()){
   if(s.selectedVersionId)continue;
   const source=await once(`source-${i}`,'clips',()=>providers.clip?.({project,plan,scene:s,index:i,invoke})||{});
   const v=await write(`clip-${i}`,'clips','version',{requestId:await stableId(job.id,`clip-${i}`),sceneId:s.id,assetId:source.assetId||null});
   await wait(c=>{const version=c.versions.find(x=>x.id===v.id);if(version?.status==='failed'||version?.status==='canceled')throw Error('PRODUCTION_CLIP_FAILED');return version?.status==='succeeded';});
   await write(`select-${i}`,'clips','select_version',{versionId:v.id});
  }
  const render=await write('render','assembly','render',{requestId:await stableId(job.id,'render')});
  await wait(c=>{const r=c.renders.find(x=>x.id===render.id);if(r?.status==='failed')throw Error('PRODUCTION_RENDER_FAILED');return r?.status==='succeeded';});
  await invoke('complete',{key:'completed',renderId:render.id});return {ok:true,renderId:render.id};
 }catch(e){const code=e.code||e.message;await api('fail',{...identity,data:{code:/^[A-Z_]{1,80}$/.test(code)?code:'PRODUCTION_PROVIDER'}}).catch(()=>{});return {ok:false,code:/^[A-Z_]{1,80}$/.test(code)?code:'PRODUCTION_PROVIDER'};}
 finally{clearInterval(timer);}
}
export async function main(){
 const api=productionApi({appUrl:process.env.CREATIVE_RUSH_URL,token:process.env.PRODUCTION_WORKER_TOKEN,workerId:process.env.PRODUCTION_WORKER_ID});
 const providers=createProductionProviders(process.env);await providers.ready();let stop=false;for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>{stop=true;});
 while(!stop){try{const {job}=await api('claim');if(job){const r=await processProduction(job,api,providers);console.log(JSON.stringify({job:job.id,...r}));}else await sleep(5000);}catch{console.error('production_worker_unavailable');await sleep(10000);}}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{console.error('Production providers are not configured');process.exitCode=1;});
