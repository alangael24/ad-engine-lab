import {repairOnOriginalTimeline} from '../assets/editorial-timeline.js';
import {remember} from '../assets/creative-context.js';
import {repairScenes,validateReview} from '../assets/quality-model.js';
import {pathToFileURL} from 'node:url';
import {validatePlan,alignScenes} from '../assets/production-model.js';
import {createProductionProviders} from './production-providers.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export async function stableId(scope,key){const b=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(scope+':'+key))).slice(0,16);b[6]=(b[6]&15)|80;b[8]=(b[8]&63)|128;const h=Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;}
export function productionApi({appUrl,token,workerId,fetchImpl=fetch}){
 const u=new URL(appUrl);if(u.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(u.hostname))throw Error('HTTPS required');
 if(!token||token.length<32||!/^[\w-]{1,80}$/.test(workerId||''))throw Error('Missing production configuration');
 return async(action,body={})=>{const r=await fetchImpl(u.origin+'/api/studio-production-worker',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({action,workerId,...body}),signal:AbortSignal.timeout(action==='write'&&body.data?.action==='version'?90000:30000)});const d=await r.json();if(!r.ok)throw Object.assign(Error(d.code),{code:d.code});return d;};
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
  await invoke('heartbeat');await providers.ready?.();if(typeof providers.review!=='function'||typeof providers.reviewImages!=='function')throw Error('PRODUCTION_QUALITY_OFFLINE');
  let project=structuredClone(job.snapshot);
  if(providers.context)project={...project,...await providers.context(project,invoke)};
  const existing=project.data.scenes||[],revision=existing.length>0;
  const plan=await once('plan','planning',async()=>revision?{
   continuity:`Preserve the existing product, characters, setting and visual style. ${project.data.videoContinuity||''} ${project.data.referenceNotes||''} ${JSON.stringify(project.data.creative||{})}`,
   scenes:existing.map(s=>({...s,motion:s.motion||'Follow the approved scene direction; preserve continuity.'}))
  }:validatePlan(await providers.plan(project,invoke),project.data.scriptDraft));
  const reuseNarration=revision&&project.data.narrationAssetId&&project.data.timingConfirmed;
  const narration=reuseNarration?{assetId:project.data.narrationAssetId}:await once('narration','narration',()=>providers.speech(project,plan,invoke,job.id));
  const timeline=await once('timing','timing',()=>reuseNarration?existing.map(s=>({...s,planSceneId:s.id})):alignScenes(plan,narration.alignment,narration.duration).map(({narrationStart,...s})=>s));
  // Existing stills anchor regenerated scenes even when the first shot changes.
  const images=[],existingAnchor=existing.find(s=>s.imageAssetId);
  const reusable=s=>s.selectedVersionId&&(reuseNarration||timeline.filter(t=>t.planSceneId===s.id).every(t=>t.id===s.id&&t.end-t.start<=s.end-s.start));
  for(const [i,s] of plan.scenes.entries())images.push(s.imageAssetId||reusable(s)?{assetId:s.imageAssetId||null}:await once(`image-${i}`,'images',()=>providers.image({project,plan,index:i,previous:images.at(-1),anchor:existingAnchor?{assetId:existingAnchor.imageAssetId}:images[0],invoke,jobId:job.id})));
  // Fail closed on still quality: no clip/version request precedes this gate.
  for(let round=0;round<=2;round++){
   const report=await once(`image-review-${round}`,'images',()=>providers.reviewImages({project,plan,images,invoke}));
   const reviewScenes=plan.scenes.map((s,i)=>({...s,start:i,end:i+1}));
   validateReview(report,reviewScenes);
   if(JSON.stringify(report.assetIds)!==JSON.stringify(images.map(x=>x.assetId)))throw Error('PRODUCTION_IMAGE_REVIEW_INVALID');
   if(report.verdict==='pass'){
    project=remember(project,{decision:'Product, character and scene images approved before animation.',approvedAssets:images.map(x=>x.assetId)});break;
   }
   project=remember(project,{rejection:report.issues.map(x=>`${x.sceneId}: ${x.evidence}`).join('; ')});
   await write(`image-rejection-${round}`,'images','save_project',project.data);
   if(round===2||report.verdict!=='repair'||report.issues.some(x=>x.action!=='replace_image'))throw Error('PRODUCTION_IMAGES_BLOCKED');
   for(const issue of report.issues){
    const index=plan.scenes.findIndex(x=>x.id===issue.sceneId),scene=plan.scenes[index];
    if(scene.visual===issue.visual&&scene.motion===issue.motion)throw Error('PRODUCTION_REPAIR_NO_CHANGE');
    scene.visual=issue.visual;scene.motion=issue.motion;
    const old=images[index].assetId;
    images[index]=await once(`repair-image-${round+100}-${index}`,'images',()=>providers.image({project,plan,index,previous:images[index-1],anchor:images.find((_,i)=>!report.issues.some(x=>x.sceneId===plan.scenes[i].id)),invoke,jobId:job.id}));
    if(images[index].assetId===old)throw Error('PRODUCTION_REPAIR_NO_CHANGE');
   }
  }
  const scenes=timeline.map(s=>{
   const old=existing.find(p=>p.id===s.id),keep=old?.selectedVersionId&&old.imageAssetId===images[plan.scenes.findIndex(p=>p.id===s.planSceneId)].assetId&&(reuseNarration||s.end-s.start<=old.end-old.start);
   const approved=plan.scenes.find(p=>p.id===s.planSceneId);
   return {...s,visual:approved.visual,motion:approved.motion,imageAssetId:images[plan.scenes.findIndex(p=>p.id===s.planSceneId)].assetId,selectedVersionId:keep?old.selectedVersionId:null};
  });
  await write('prepare','images','save_project',{...project.data,videoContinuity:plan.continuity,narrationAssetId:narration.assetId,timingConfirmed:true,scenes});
  for(const [i,s] of scenes.entries()){
   if(s.selectedVersionId)continue;
   const source=await once(`source-${i}`,'clips',()=>providers.clip?.({project,plan,scene:s,index:i,invoke})||{});
   const v=await write(`clip-${i}`,'clips','version',{requestId:await stableId(job.id,`clip-${i}`),sceneId:s.id,assetId:source.assetId||null});
   await wait(c=>{const version=c.versions.find(x=>x.id===v.id);if(version?.status==='failed'||version?.status==='canceled')throw Error('PRODUCTION_CLIP_FAILED');return version?.status==='succeeded';});
   await write(`select-${i}`,'clips','select_version',{versionId:v.id});
  }
  // Render candidates remain private until their exact immutable output passes review.
  for(let round=0;round<=2;round++){
   const renderKey=round?`render-${round}`:'render';
   const render=await write(renderKey,'assembly','render',{requestId:await stableId(job.id,renderKey)});
   await wait(c=>{const r=c.renders.find(x=>x.id===render.id);if(r?.status==='failed')throw Error('PRODUCTION_RENDER_FAILED');return r?.status==='succeeded';});
   const current=await invoke('inspect');
   const reviewedScenes=current.renders.find(r=>r.id===render.id)?.manifest?.scenes||current.project.data.scenes;
   const review=await once(`quality-${round}`,'quality',async()=>{
    const report=await providers.review({renderId:render.id,invoke});validateReview(report,reviewedScenes);
    if(report.renderId!==render.id)throw Error('PRODUCTION_QUALITY_INVALID');return report;
   });
   if(review.verdict==='pass'){
    await invoke('complete',{key:'completed',renderId:render.id});return {ok:true,renderId:render.id,quality:review.verdict};
   }
   if(round===2)throw Error('PRODUCTION_QUALITY_BLOCKED');
   if(review.issues.length&&review.issues.every(x=>['caption','timing'].includes(x.kind))){
    const corrected=remember(current.project,{rejection:JSON.stringify(review.issues),decision:'The next edit must correct the final-review caption/timing defects before delivery.'});
    await write(`editorial-feedback-${round}`,'repair','save_project',corrected.data);
    continue;
   }
   if(review.verdict!=='repair')throw Error('PRODUCTION_QUALITY_BLOCKED');
   // Persist the repair decision BEFORE external requests: same keys resume completed work.
   const next=await once(`repair-plan-${round}`,'repair',()=>repairScenes(current.project,repairOnOriginalTimeline(review,current.project.data.scenes,reviewedScenes)));
   const repaired=remember({data:structuredClone(next)},{rejection:review.issues.map(x=>`${x.sceneId}: ${x.evidence}`).join('; ')}).data,repairPlan={continuity:plan.continuity,scenes:repaired.scenes};
   for(const issue of review.issues.slice(0,3)){
    const index=repaired.scenes.findIndex(s=>s.id===issue.sceneId),scene=repaired.scenes[index];
    if(!scene.imageAssetId){
     const image=await once(`repair-image-${round}-${index}`,'repair',()=>providers.image({project:{...current.project,referenceEvidence:project.referenceEvidence,data:repaired},plan:repairPlan,index,previous:index?{assetId:repaired.scenes[index-1].imageAssetId}:null,anchor:existingAnchor?{assetId:existingAnchor.imageAssetId}:images[0],invoke,jobId:job.id}));
     scene.imageAssetId=image.assetId;
    }
   }
   const repairedImages=repaired.scenes.map(s=>({assetId:s.imageAssetId}));
   const stillReview=await once(`repair-still-review-${round}`,'images',()=>providers.reviewImages({project:{...current.project,referenceEvidence:project.referenceEvidence,data:repaired},plan:repairPlan,images:repairedImages,invoke}));
   validateReview(stillReview,repairPlan.scenes.map((s,i)=>({...s,start:i,end:i+1})));
   if(stillReview.verdict!=='pass'||JSON.stringify(stillReview.assetIds)!==JSON.stringify(repairedImages.map(x=>x.assetId)))throw Error('PRODUCTION_IMAGES_BLOCKED');
   await write(`repair-save-${round}`,'repair','save_project',repaired);
   for(const issue of review.issues.slice(0,3)){
    const index=repaired.scenes.findIndex(s=>s.id===issue.sceneId),scene=repaired.scenes[index],key=`repair-clip-${round}-${index}`;
    const source=await once(`repair-source-${round}-${index}`,'repair',()=>providers.clip?.({project:{...current.project,referenceEvidence:project.referenceEvidence,data:repaired},plan:repairPlan,scene,index,invoke})||{});
    const version=await write(key,'repair','version',{requestId:await stableId(job.id,key),sceneId:scene.id,assetId:source.assetId||null});
    await wait(c=>{const v=c.versions.find(v=>v.id===version.id);if(v?.status==='failed'||v?.status==='canceled')throw Error('PRODUCTION_CLIP_FAILED');return v?.status==='succeeded';});
    await write(`repair-select-${round}-${index}`,'repair','select_version',{versionId:version.id});
   }
  }

 }catch(e){const code=e.code||e.message;await api('fail',{...identity,data:{code:/^[A-Z_]{1,80}$/.test(code)?code:'PRODUCTION_PROVIDER'}}).catch(()=>{});return {ok:false,code:/^[A-Z_]{1,80}$/.test(code)?code:'PRODUCTION_PROVIDER'};}
 finally{clearInterval(timer);}
}
export async function main(){
 const api=productionApi({appUrl:process.env.CREATIVE_RUSH_URL,token:process.env.PRODUCTION_WORKER_TOKEN,workerId:process.env.PRODUCTION_WORKER_ID});
 const providers=createProductionProviders(process.env);await providers.ready();let stop=false;for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>{stop=true;});
 while(!stop){try{const {job}=await api('claim');if(job){const r=await processProduction(job,api,providers);console.log(JSON.stringify({job:job.id,...r}));}else await sleep(5000);}catch{console.error('production_worker_unavailable');await sleep(10000);}}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{console.error('Production providers are not configured');process.exitCode=1;});
