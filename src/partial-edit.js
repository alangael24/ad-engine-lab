import {alignmentWords} from '../assets/editorial-timeline.js';
import {own} from './studio.js';
const sameScenes=(a,b)=>a.length===b.length&&a.every((s,i)=>s.id===b[i].id&&s.text===b[i].text&&(s.versionId||s.selectedVersionId)===b[i].selectedVersionId&&Math.abs(s.start-b[i].start)<.002&&Math.abs(s.end-b[i].end)<.002);
export async function projectFingerprint(data){
 const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(canonical(data))));
 return Array.from(new Uint8Array(bytes),n=>n.toString(16).padStart(2,'0')).join('');
}
export async function approvedBase(db,user,project,{explicit=true}={}){
 const id=explicit&&project.data.editing?.baseRenderId;
 if(id){
  const r=await own(db,'studio_renders',user,id);
  if(r.project_id!==project.id||r.status!=='succeeded'||r.quality_status&&r.quality_status!=='passed'||!r.manifest?.editorial?.edit)throw Error('EDITORIAL_BASE_REQUIRED');
  return r;
 }
 const q=await db.from('studio_renders').select('*').eq('user_id',user).eq('project_id',project.id).eq('status','succeeded').order('created_at',{ascending:false}).limit(100);
 if(q.error)throw q.error;
 const fingerprint=await projectFingerprint(project.data);
 return q.data.find(r=>(!r.quality_status||r.quality_status==='passed')&&r.manifest?.editorial?.edit&&(r.project_revision===project.revision||r.manifest.editorial.projectFingerprint===fingerprint)&&sameScenes(r.manifest.originalScenes||r.manifest.scenes,project.data.scenes))||null;
}
export async function narrationAlignment(db,user,project,assetId){
 const history=await db.from('studio_productions').select('steps').eq('user_id',user).eq('project_id',project).order('created_at',{ascending:false}).limit(100);
 if(history.error)throw history.error;
 for(const h of history.data)for(const step of Object.values(h.steps||{}))if(step.status==='done'&&step.result?.assetId===assetId&&step.result.alignment)return step.result.alignment;
 throw Error('EDITORIAL_ALIGNMENT_REQUIRED');
}
export async function editorialRevisionContext(db,user,project){
 const alignment=await narrationAlignment(db,user,project.id,project.data.narrationAssetId),words=alignmentWords(alignment);
 const r=await approvedBase(db,user,project);
 return {project,words,base:r?{id:r.id,scenes:r.manifest.originalScenes||r.manifest.scenes,edl:r.manifest.editorial.edit,words:r.manifest.editorial.words||[]}:null};
}
