import {runClipBuffer} from './production-clip-buffer.mjs';
import {repairOnOriginalTimeline} from '../assets/editorial-timeline.js';
import {measuredEditorialCost} from '../src/production-spend.js';
import {patchNarration} from './narration-revision.mjs';
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
 return async(action,body={})=>{const r=await fetchImpl(u.origin+'/api/studio-production-worker',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({action,workerId,...body}),signal:AbortSignal.timeout(action==='prepare_clip'||action==='write'&&body.data?.action==='version'?960000:30000)});const d=await r.json();if(!r.ok)throw Object.assign(Error(d.code),{code:d.code});return d;};
}
export async function processProduction(job,api,providers,{pollMs=3000,deadlineMs=90*60*1000}={}){
 const identity={jobId:job.id,leaseToken:job.lease_token},started=Date.now();let lost=false,beating=false,last=Date.now();
 const invoke=async(action,data={})=>{if(lost)throw Error('LEASE_LOST');const r=await api(action,{...identity,data});return r.value??r;};
 const timer=setInterval(async()=>{if(beating)return;beating=true;try{await invoke('heartbeat');last=Date.now();}catch(e){if(e.code==='LEASE_LOST'||e.code==='STUDIO_CONFLICT'||Date.now()-last>100000)lost=true;}finally{beating=false;}},20000);
 const check=()=>{if(lost)throw Error('LEASE_LOST');if(Date.now()-started>deadlineMs)throw Error('PRODUCTION_TIMEOUT');};
 const once=async(key,stage,fn)=>{check();const s=await invoke('begin_step',{key,stage});if(s.status==='done')return s.result;invoke.costStep=key;const result=await fn();check();await invoke('finish_step',{key,stage,result});return result;};
 const write=async(key,stage,action,data)=>{check();return (await invoke('write',{key,stage,action,data})).result;};
 const wait=async(predicate)=>{while(true){check();const current=await invoke('inspect');const value=predicate(current);if(value)return value;await sleep(pollMs);}};
 try{
  await invoke('heartbeat');await providers.ready?.();if(typeof providers.review!=='function'||typeof providers.reviewImages!=='function')throw Error('PRODUCTION_QUALITY_OFFLINE');
  let project=structuredClone(job.snapshot);
  if(providers.context)project={...project,...await providers.context(project,invoke)};
  const existing=project.data.scenes||[],revision=existing.length>0,reuseApprovedStills=revision&&!!project.data.editing?.baseRenderId;
  const plan=await once('plan','planning',async()=>revision?{
   // Reference notes and format settings already travel in creativeContext.
   // Re-appending them here grows the persisted direction on every retry.
   continuity:project.data.videoContinuity||'Preserve the existing product, characters, setting and visual style.',
   scenes:existing.map(s=>({...s,motion:s.motion||'Follow the approved scene direction; preserve continuity.'}))
  }:await (async()=>{const raw=await providers.plan(project,invoke);return {...validatePlan(raw,project.data.scriptDraft),providerUsage:raw.providerUsage||null};})());
  // A retry may replay an older cached plan created before this normalization.
  if(revision)plan.continuity=project.data.videoContinuity||'Preserve the existing product, characters, setting and visual style.';
  if(providers.prepareImageReview)plan.imageContracts=await once('material-contracts-v1','planning',()=>providers.prepareImageReview(project,plan));
  const reviewPrefix=providers.imageReviewVersion?'material-v1-':'';
  const reuseNarration=revision&&project.data.narrationAssetId&&project.data.timingConfirmed;
  const narration=reuseNarration?{assetId:project.data.narrationAssetId}:project.data.narrationRevision?await patchNarration(project,plan,providers,invoke,once,job.id):await once('narration','narration',()=>providers.speech(project,plan,invoke,job.id));
  const timeline=await once('timing','timing',()=>reuseNarration?existing.map(s=>({...s,planSceneId:s.id})):narration.timeline||alignScenes(plan,narration.alignment,narration.duration).map(({narrationStart,...s})=>s));
  // Existing stills anchor regenerated scenes even when the first shot changes.
  const imageRepairCounts=plan.scenes.map(()=>0),imageApprovals=new Map();
  const images=[],existingAnchor=existing.find(s=>s.imageAssetId);
  const reusable=s=>s.selectedVersionId&&(reuseNarration||timeline.filter(t=>t.planSceneId===s.id).every(t=>t.id===s.id&&t.end-t.start<=s.end-s.start));
  for(const [i,s] of plan.scenes.entries()){
   images.push(s.imageAssetId||reusable(s)?{assetId:s.imageAssetId||null}:await once(`image-${i}`,'images',()=>providers.image({project,plan,index:i,previous:images.at(-1),anchor:existingAnchor?{assetId:existingAnchor.imageAssetId}:images[0],invoke,jobId:job.id})));
   const recovered=project.recoveredStillApprovals?.[s.id];
   if(recovered?.assetId&&recovered.assetId===images[i].assetId){imageApprovals.set(s.id,recovered);continue;}
   // Production providers review each still before the next one may inherit it.
   if(providers.reviewImage&&!(reuseApprovedStills&&s.imageAssetId))for(let attempt=0;attempt<=2;attempt++){
    const key=1000+i*3+attempt;
    const report=await once(`${reviewPrefix}still-check-${i}-${attempt}`,'images',()=>providers.reviewImage({project,plan,images,index:i,invoke}));
    validateReview(report,plan.scenes.map((x,j)=>({...x,start:j,end:j+1})));
    if(JSON.stringify(report.assetIds)!==JSON.stringify(images.map(x=>x.assetId))||report.issues.some(x=>x.sceneId!==s.id))throw Error('PRODUCTION_IMAGE_REVIEW_INVALID');
    if(report.verdict==='pass'){
     imageApprovals.set(s.id,{assetId:images[i].assetId,report});
     project=remember(project,{approvedAssets:images.map(x=>x.assetId),observedStates:report.observedStates||[]});
     break;
    }
    project=remember(project,{rejection:report.issues.map(x=>`${x.sceneId}: ${x.evidence}`).join('; '),rejectedAssets:report.issues.map(x=>images[plan.scenes.findIndex(s=>s.id===x.sceneId)]?.assetId)});
    await write(`image-rejection-${key}`,'images','save_project',project.data);
    if(attempt===2||report.verdict!=='repair'||report.issues.some(x=>x.action!=='replace_image'))throw Error('PRODUCTION_IMAGES_BLOCKED');
    const issue=report.issues[0];
    if(!issue||(s.visual===issue.visual&&s.motion===issue.motion))throw Error('PRODUCTION_REPAIR_NO_CHANGE');
    s.visual=issue.visual;s.motion=issue.motion;
    const old=images[i].assetId;imageRepairCounts[i]++;
    images[i]=await once(`repair-image-${key}-${i}`,'images',()=>providers.image({project,plan,index:i,previous:images[i-1],anchor:images[0],invoke,jobId:job.id}));
    if(old===images[i].assetId)throw Error('PRODUCTION_REPAIR_NO_CHANGE');
   }
  }
  // Fail closed on still quality: no clip/version request precedes this gate.
  for(let round=0;round<=2;round++){
   const unchanged=reuseApprovedStills&&images.every((im,i)=>im.assetId===existing.find(s=>s.id===plan.scenes[i].id)?.imageAssetId);
   const checked=plan.scenes.every((s,i)=>imageApprovals.get(s.id)?.assetId===images[i].assetId);
   const report=!providers.imageReviewVersion&&checked?{verdict:'pass',summary:'Every immutable still already passed its own contextual review.',issues:[],assetIds:images.map(x=>x.assetId),observedStates:[...imageApprovals.values()].flatMap(x=>x.report.observedStates||[]),reusedReviews:true}:!providers.imageReviewVersion&&unchanged?{verdict:'pass',summary:'Conservadas las imágenes existentes.',issues:[],assetIds:images.map(x=>x.assetId)}:await once(`${reviewPrefix}image-review-${round}`,'images',()=>providers.reviewImages({project,plan,images,invoke}));
   const reviewScenes=plan.scenes.map((s,i)=>({...s,start:i,end:i+1}));
   validateReview(report,reviewScenes);
   if(JSON.stringify(report.assetIds)!==JSON.stringify(images.map(x=>x.assetId)))throw Error('PRODUCTION_IMAGE_REVIEW_INVALID');
   if(report.verdict==='pass'){
    project=remember(project,{decision:'Product, character and scene images approved before animation.',approvedAssets:images.map(x=>x.assetId),observedStates:report.observedStates||[]});break;
   }
   project=remember(project,{rejection:report.issues.map(x=>`${x.sceneId}: ${x.evidence}`).join('; '),rejectedAssets:report.issues.map(x=>images[plan.scenes.findIndex(s=>s.id===x.sceneId)]?.assetId)});
   await write(`image-rejection-${round}`,'images','save_project',project.data);
   if(round===2||report.verdict!=='repair'||report.issues.some(x=>x.action!=='replace_image'))throw Error('PRODUCTION_IMAGES_BLOCKED');
   for(const issue of report.issues){
    if(project.data.editing?.scoped&&!project.data.editing.changedSceneIds.includes(issue.sceneId))throw Error('PRODUCTION_REPAIR_OUTSIDE_SCOPE');
    const index=plan.scenes.findIndex(x=>x.id===issue.sceneId),scene=plan.scenes[index];
    if(scene.visual===issue.visual&&scene.motion===issue.motion)throw Error('PRODUCTION_REPAIR_NO_CHANGE');
    scene.visual=issue.visual;scene.motion=issue.motion;
    if(imageRepairCounts[index]>=2)throw Error('PRODUCTION_IMAGES_BLOCKED');
    imageRepairCounts[index]++;const old=images[index].assetId;
    images[index]=await once(`repair-image-${round+100}-${index}`,'images',()=>providers.image({project,plan,index,previous:images[index-1],anchor:images.find((_,i)=>!report.issues.some(x=>x.sceneId===plan.scenes[i].id)),invoke,jobId:job.id}));
    if(images[index].assetId===old)throw Error('PRODUCTION_REPAIR_NO_CHANGE');
   }
  }
  const scenes=timeline.map(s=>{
   const old=existing.find(p=>p.id===s.id),keep=old?.selectedVersionId&&old.imageAssetId===images[plan.scenes.findIndex(p=>p.id===s.planSceneId)].assetId&&(reuseNarration||s.end-s.start<=old.end-old.start);
   const approved=plan.scenes.find(p=>p.id===s.planSceneId);
   return {...s,visual:approved.visual,motion:approved.motion,...(approved.shotContract?{shotContract:approved.shotContract}:{}),imageAssetId:images[plan.scenes.findIndex(p=>p.id===s.planSceneId)].assetId,selectedVersionId:keep?old.selectedVersionId:null};
  });
  const {narrationRevision,...savedData}=project.data;
  await write('prepare','images','save_project',{...savedData,videoContinuity:plan.continuity,narrationAssetId:narration.assetId,timingConfirmed:true,scenes});
  const generateClips=async(entries,clipProject,clipPlan)=>runClipBuffer(entries,{
   prepare:async({scene,index,key,sourceKey,stage})=>{
    const source=await once(sourceKey,stage,()=>providers.clip?.({project:clipProject,plan:clipPlan,scene,index,invoke})||{});
    const data={requestId:await stableId(job.id,key),sceneId:scene.id,assetId:source.assetId||null};
    await invoke('prepare_clip',{key,stage,data});return data;
   },
   submit:({key,stage},data)=>write(key,stage,'version',data),
   inspect:()=>invoke('inspect'),
   select:({selectKey,stage},version)=>write(selectKey,stage,'select_version',{versionId:version.id}),
   check,pollMs
  });
  await generateClips(scenes.flatMap((scene,index)=>scene.selectedVersionId?[]:[{
   scene,index,key:`clip-${index}`,sourceKey:`source-${index}`,selectKey:`select-${index}`,stage:'clips'
  }]),project,plan);
  // Render candidates remain private until their exact immutable output passes review.
  for(let round=0;round<=2;round++){
   const renderKey=round?`render-${round}`:'render';
   const render=await write(renderKey,'assembly','render',{requestId:await stableId(job.id,renderKey)});
   await wait(c=>{const r=c.renders.find(x=>x.id===render.id);if(r?.status==='failed')throw Error('PRODUCTION_RENDER_FAILED');return r?.status==='succeeded';});
   const current=await invoke('inspect');
   const editingCost=measuredEditorialCost(current.renders.find(r=>r.id===render.id)?.manifest?.editorial?.usage);
   if(editingCost!==null)await invoke('record_cost',{key:renderKey+'-editor',costUsd:editingCost});
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
   if(project.data.editing?.scoped&&review.issues.some(i=>!project.data.editing.changedSceneIds.includes(i.sceneId)))throw Error('PRODUCTION_REPAIR_OUTSIDE_SCOPE');
   // Persist the repair decision BEFORE external requests: same keys resume completed work.
   const next=await once(`repair-plan-${round}`,'repair',()=>repairScenes(current.project,repairOnOriginalTimeline(review,current.project.data.scenes,reviewedScenes)));
   const repaired=remember({data:structuredClone(next)},{rejection:review.issues.map(x=>`${x.sceneId}: ${x.evidence}`).join('; '),rejectedAssets:review.issues.filter(x=>x.action==='replace_image').map(x=>current.project.data.scenes.find(s=>s.id===x.sceneId)?.imageAssetId)}).data,repairPlan={continuity:plan.continuity,scenes:repaired.scenes};
   for(const issue of review.issues.slice(0,3)){
    const index=repaired.scenes.findIndex(s=>s.id===issue.sceneId),scene=repaired.scenes[index];
    if(!scene.imageAssetId){
     const image=await once(`repair-image-${round}-${index}`,'repair',()=>providers.image({project:{...current.project,referenceEvidence:project.referenceEvidence,data:repaired},plan:repairPlan,index,previous:index?{assetId:repaired.scenes[index-1].imageAssetId}:null,anchor:existingAnchor?{assetId:existingAnchor.imageAssetId}:images[0],invoke,jobId:job.id}));
     scene.imageAssetId=image.assetId;
    }
   }
   if(plan.imageContracts)repairPlan.imageContracts=repairPlan.scenes.map(s=>{const source=timeline.find(t=>t.id===s.id)?.planSceneId||s.id;const c=plan.imageContracts.find(c=>c.sceneId===source);if(!c)throw Error('PRODUCTION_IMAGE_CONTRACT_MISSING');return {...c,sceneId:s.id};});
   const repairedImages=repaired.scenes.map(s=>({assetId:s.imageAssetId}));
   const stillReview=await once(`${reviewPrefix}repair-still-review-${round}`,'images',()=>providers.reviewImages({project:{...current.project,referenceEvidence:project.referenceEvidence,data:repaired},plan:repairPlan,images:repairedImages,invoke}));
   validateReview(stillReview,repairPlan.scenes.map((s,i)=>({...s,start:i,end:i+1})));
   if(stillReview.verdict!=='pass'||JSON.stringify(stillReview.assetIds)!==JSON.stringify(repairedImages.map(x=>x.assetId)))throw Error('PRODUCTION_IMAGES_BLOCKED');
   Object.assign(repaired,remember({data:repaired},{approvedAssets:repairedImages.map(x=>x.assetId),observedStates:stillReview.observedStates||[]}).data);
   await write(`repair-save-${round}`,'repair','save_project',repaired);
   await generateClips(review.issues.slice(0,3).map(issue=>{
    const index=repaired.scenes.findIndex(s=>s.id===issue.sceneId);
    return {scene:repaired.scenes[index],index,key:`repair-clip-${round}-${index}`,sourceKey:`repair-source-${round}-${index}`,selectKey:`repair-select-${round}-${index}`,stage:'repair'};
   }),{...current.project,referenceEvidence:project.referenceEvidence,data:repaired},repairPlan);
  }

 }catch(e){const code=e.code||e.message;await api('fail',{...identity,data:{code:/^[A-Z][A-Z0-9_]{0,79}$/.test(code)?code:'PRODUCTION_PROVIDER'}}).catch(()=>{});return {ok:false,code:/^[A-Z][A-Z0-9_]{0,79}$/.test(code)?code:'PRODUCTION_PROVIDER'};}
 finally{clearInterval(timer);}
}
export async function main(){
 const api=productionApi({appUrl:process.env.CREATIVE_RUSH_URL,token:process.env.PRODUCTION_WORKER_TOKEN,workerId:process.env.PRODUCTION_WORKER_ID});
 const providers=createProductionProviders(process.env);await providers.ready();let stop=false;for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>{stop=true;});
 while(!stop){try{const {job}=await api('claim');if(job){const r=await processProduction(job,api,providers);console.log(JSON.stringify({job:job.id,...r}));}else await sleep(5000);}catch{console.error('production_worker_unavailable');await sleep(10000);}}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{console.error('Production providers are not configured');process.exitCode=1;});
