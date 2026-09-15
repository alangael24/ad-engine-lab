// Only server-held production records may establish approval. Never accept a
// client creative-memory assertion as proof that a still passed review.
const canonical=v=>JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
const approvalDecision='Product, character and scene images approved before animation.';
function retryData(data){
 const copy=structuredClone(data);
 if(copy?.creativeMemory?.decisions){let found=false;copy.creativeMemory.decisions=copy.creativeMemory.decisions.filter(d=>{if(d!==approvalDecision)return true;if(found)return false;found=true;return true;});}
 return canonical(copy);
}
export function recoveredStillApprovals(project,productions,visited=new Set()){
 for(const p of productions){
  if(visited.has(p.id))continue;
  if(p.user_id!==project.user_id||p.project_id!==project.id||p.status!=='failed'||p.expected_revision!==project.revision)continue;
  const saved=p.steps?.prepare?.result;
  if(p.steps?.prepare?.status!=='done'||saved?.revision!==project.revision||canonical(saved.data)!==canonical(project.data)||canonical(saved.brand_snapshot)!==canonical(project.brand_snapshot))continue;
  const plan=p.steps?.plan?.result?.scenes,timing=p.steps?.timing?.result;
  if(!Array.isArray(plan)||!Array.isArray(timing))continue;
  const approvals={};
  for(const scene of project.data.scenes||[]){
   const sourceId=timing.find(t=>t.id===scene.id)?.planSceneId,index=plan.findIndex(s=>s.id===sourceId);
   if(index<0||!scene.imageAssetId)continue;
   for(let attempt=2;attempt>=0;attempt--){
    const check=p.steps[`still-check-${index}-${attempt}`],report=check?.result;
    if(check?.status==='done'&&report?.verdict==='pass'&&Array.isArray(report.issues)&&!report.issues.length&&report.assetIds?.[index]===scene.imageAssetId){
     approvals[scene.id]={assetId:scene.imageAssetId,report,productionId:p.id};break;
    }
   }
  }
  // A failed retry may have saved the unchanged project after restoring these
  // approvals. Follow only its server-held, older snapshot; ignore solely a
  // duplicate system approval note, never changed preferences or scene content.
  const snapshot=p.snapshot;
  if(snapshot?.id===project.id&&snapshot.user_id===project.user_id&&snapshot.revision<project.revision
   &&retryData(snapshot.data)===retryData(saved.data)&&canonical(snapshot.brand_snapshot)===canonical(saved.brand_snapshot)){
   const inherited=recoveredStillApprovals(snapshot,productions,new Set([...visited,p.id]));
   for(const scene of project.data.scenes||[])if(!approvals[scene.id]&&inherited[scene.id]?.assetId===scene.imageAssetId)approvals[scene.id]=inherited[scene.id];
  }
  if(Object.keys(approvals).length)return approvals;
 }
 return {};
}
