// Only server-held production records may establish approval. Never accept a
// client creative-memory assertion as proof that a still passed review.
const canonical=v=>JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
const approvalDecision='Product, character and scene images approved before animation.';
function retryData(data,ignoreObserved=false,ignoreSelection=false){
 const copy=structuredClone(data);
 if(ignoreSelection)for(const scene of copy?.scenes||[])delete scene.selectedVersionId;
 if(ignoreObserved&&copy?.creativeMemory)delete copy.creativeMemory.observedStates;
 if(copy?.creativeMemory?.decisions){let found=false;copy.creativeMemory.decisions=copy.creativeMemory.decisions.filter(d=>{if(d!==approvalDecision)return true;if(found)return false;found=true;return true;});}
 return canonical(copy);
}
export function recoveredStillApprovals(project,productions,visited=new Set(),reviewVersion=''){
 for(const p of productions){
  if(visited.has(p.id))continue;
  if(p.user_id!==project.user_id||p.project_id!==project.id||p.status!=='failed'||p.expected_revision!==project.revision)continue;
  // Selecting completed clips advances revision without changing the approved
  // stills. Only an exact server-held prepare/select write can prove that state.
  const write=Object.entries(p.steps||{}).find(([key,step])=>(key==='prepare'||/^select-\d+$/.test(key))
   &&step.status==='done'&&step.result?.revision===project.revision
   &&canonical(step.result.data)===canonical(project.data)&&canonical(step.result.brand_snapshot)===canonical(project.brand_snapshot));
  if(!write)continue;
  const saved=write[1].result,selected=write[0].startsWith('select-');
  const plan=p.steps?.plan?.result?.scenes,timing=p.steps?.timing?.result;
  if(!Array.isArray(plan)||!Array.isArray(timing))continue;
  const approvals={},prefix=reviewVersion?`${reviewVersion}-`:'';
  const collection=Object.entries(p.steps||{}).find(([key,step])=>[0,1,2].some(n=>key===`${prefix}image-review-${n}`)&&step.status==='done'&&step.result?.verdict==='pass'&&Array.isArray(step.result.issues)&&!step.result.issues.length&&canonical(step.result.assetIds)===canonical((project.data.scenes||[]).map(s=>s.imageAssetId)))?.[1].result;
  for(const scene of project.data.scenes||[]){
   const sourceId=timing.find(t=>t.id===scene.id)?.planSceneId,index=plan.findIndex(s=>s.id===sourceId);
   if(index<0||!scene.imageAssetId)continue;
   for(let attempt=2;attempt>=0;attempt--){
    const check=p.steps[`${prefix}still-check-${index}-${attempt}`],report=check?.result;
    if(check?.status==='done'&&report?.verdict==='pass'&&Array.isArray(report.issues)&&!report.issues.length&&report.assetIds?.[index]===scene.imageAssetId){
     approvals[scene.id]={assetId:scene.imageAssetId,report,productionId:p.id,reviewVersion,collectionReport:collection||null};break;
    }
   }
  }
  // A failed retry may have saved the unchanged project after restoring these
  // approvals. Follow only its server-held, older snapshot; allow a duplicate
  // approval note and report-backed observations, never changed creative input.
  const snapshot=p.snapshot;
  if(snapshot?.id===project.id&&snapshot.user_id===project.user_id&&snapshot.revision<project.revision
   &&retryData(snapshot.data,true,selected)===retryData(saved.data,true,selected)&&canonical(snapshot.brand_snapshot)===canonical(saved.brand_snapshot)){
   const inherited=recoveredStillApprovals(snapshot,productions,new Set([...visited,p.id]),reviewVersion);
   // Recovery rehydrates observations from immutable passing reports. Accept
   // that derived change only when every saved observation is report-backed.
   const observed=saved.data?.creativeMemory?.observedStates;
   const backed=retryData(snapshot.data,false,selected)===retryData(saved.data,false,selected)||(Array.isArray(observed)&&observed.length>0
    &&observed.length===project.data.scenes.length&&new Set(observed.map(o=>o.sceneId)).size===observed.length
    &&observed.every(o=>inherited[o.sceneId]?.assetId===o.assetId
     &&inherited[o.sceneId].report.observedStates?.some(v=>canonical(v)===canonical(o))));
   if(backed)for(const scene of project.data.scenes||[])if(!approvals[scene.id]&&inherited[scene.id]?.assetId===scene.imageAssetId)approvals[scene.id]=inherited[scene.id];
  }
  if(Object.keys(approvals).length)return approvals;
 }
 return {};
}
// Enqueued clips survive a later prompt failure. Reuse only a version recorded
// by an exact server-held project write, never a client-supplied version ID.
export function recoveredClipVersions(project,productions,visited=new Set()){
 const result={};
 for(const p of productions){
  if(visited.has(p.id))continue;
  if(p.user_id!==project.user_id||p.project_id!==project.id||p.status!=='failed'||p.expected_revision!==project.revision)continue;
  const proven=Object.entries(p.steps||{}).some(([key,s])=>(key==='prepare'||/^select-\d+$/.test(key))&&s.status==='done'&&s.result?.revision===project.revision&&canonical(s.result.data)===canonical(project.data)&&canonical(s.result.brand_snapshot)===canonical(project.brand_snapshot));
  if(!proven)continue;
  const snapshot=p.snapshot;
  if(snapshot?.id===project.id&&snapshot.user_id===project.user_id&&snapshot.revision<project.revision&&retryData(snapshot.data,false,true)===retryData(project.data,false,true)&&canonical(snapshot.brand_snapshot)===canonical(project.brand_snapshot)){
   Object.assign(result,recoveredClipVersions(snapshot,productions,new Set([...visited,p.id])));
  }
  for(const [key,step] of Object.entries(p.steps||{})){
   const v=step.result;if(!/^clip-\d+$/.test(key)||step.status!=='done'||v?.user_id!==project.user_id||v.project_id!==project.id||!v.id||!v.job_id)continue;
   const scene=project.data.scenes.find(s=>s.id===v.scene_id);if(!scene||scene.selectedVersionId)continue;
   const actual={...scene};delete actual.selectedVersionId;
   const saved={...v.snapshot?.scene};delete saved.selectedVersionId;
   if(canonical(actual)===canonical(saved))result[scene.id]??=v;
  }
 }
 return result;
}
