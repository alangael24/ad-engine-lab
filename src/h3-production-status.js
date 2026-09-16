// Only inspect the clips checkpointed by this production, never another order.
export function productionClipIds(production){return Object.entries(production.steps||{}).filter(([k,v])=>/^(?:repair-)?clip-\d+(?:-\d+)?$/.test(k)&&v.status==='done'&&v.result?.id).map(([,v])=>v.result.id);}
export function clipProgress(jobs,total=jobs.length){
 const complete=jobs.filter(j=>j.status==='succeeded').length,active=jobs.filter(j=>['queued','running'].includes(j.status));
 let state='generating';
 if(active.some(j=>j.provider_phase==='reconciling'||j.infra_runs>1&&j.status==='queued'))state='reassigning';
 else if(active.length&&!active.some(j=>j.status==='running'))state=active.some(j=>j.managed_run_id)?'preparing_generator':'waiting_capacity';
 const messages={waiting_capacity:'Esperando capacidad de procesamiento. Tu proyecto está guardado.',preparing_generator:'Preparando el generador. Tu proyecto está guardado.',reassigning:'Reasignando procesamiento. Conservamos los clips terminados.',generating:`Generando clips: ${complete} de ${total} guardados.`};
 return {state,message:messages[state],complete,total,waiting:active.length>0&&state!=='generating'};
}
export async function readProductionClipProgress(db,production){
 const ids=productionClipIds(production);if(!ids.length)return null;
 const versions=await db.from('studio_scene_versions').select('job_id').eq('project_id',production.project_id).eq('user_id',production.user_id).in('id',ids);
 if(versions.error)throw versions.error;
 const jobs=versions.data.map(v=>v.job_id).filter(Boolean);if(!jobs.length)return null;
 const result=await db.from('generation_jobs').select('status,provider_phase,managed_run_id,managed_deadline_at,infra_runs').eq('user_id',production.user_id).in('id',jobs);
 if(result.error)throw result.error;
 if(!result.data.some(j=>j.managed_deadline_at))return null;
 return clipProgress(result.data,Math.max(ids.length,production.steps?.timing?.result?.length||0));
}
