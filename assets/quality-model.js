// Only the trusted worker can approve a render; model output is a bounded repair proposal.
export const QUALITY_VERSION=2;
// Shared by still, video and editing reviews; technical gates remain independent.
export const MATERIAL_REVIEW_RULES=`Judge observable impact on the finished ad, not literal compliance with incidental motion wording. Accept small natural camera, hand, gesture and texture variations when identity, product, framing, message and cut continuity remain intact. A motion difference alone is not a defect. Main brand-name changes, material anatomy/identity changes, important product cropping or occlusion, misleading actions and contradictory cut states remain defects. Early action completion is acceptable only if it does not conflict with timed narration, the next shot or an explicit required hold/intermediate state. Respect explicit customer timing and pose requirements. Never infer that a constraint is incidental merely because it is difficult to generate. For every reported issue, evidence must identify the visible change, its timestamp and its concrete impact on an approved requirement or viewer understanding. Do not request regeneration for cosmetic preferences or tiny unreadable label details; do flag a visibly changed main brand name. Focused confirmation must establish both that the change exists and that its impact warrants repair. If evidence cannot establish a material requirement, do not invent one. Prefer a safe trim or edit using existing footage when it preserves all approved speech and required timing; regenerate only the affected asset when necessary. A pass means no observable material defect in the supplied evidence, not proof of perfection or of unobserved audio/motion.`;
const fail=(detail='review_contract')=>{throw Object.assign(Error('PRODUCTION_QUALITY_INVALID'),{detail});};
const text=(s,max)=>{if(typeof s!=='string'||!s.trim()||s.length>max)fail('text_limit_'+max);return s.trim();};
export const reviewSchema={type:'object',additionalProperties:false,properties:{verdict:{type:'string',enum:['pass','repair','blocked']},summary:{type:'string',minLength:1,maxLength:1500},issues:{type:'array',maxItems:24,items:{type:'object',additionalProperties:false,properties:{sceneId:{type:'string'},relatedSceneId:{type:['string','null']},kind:{type:'string',enum:['repetition','mismatch','continuity','artifact','caption','timing']},at:{type:'number',description:'Absolute output timestamp within this exact scene start and end. Use a supplied sample timestamp, not a frame number.'},evidence:{type:'string',minLength:1,maxLength:1200},action:{type:'string',enum:['replace_clip','replace_image','none']},visual:{type:'string',maxLength:800},motion:{type:'string',maxLength:400}},required:['sceneId','relatedSceneId','kind','at','evidence','action','visual','motion']}}},required:['verdict','summary','issues']};
export function validateReview(raw,scenes){
 if(!raw||!['pass','repair','blocked'].includes(raw.verdict)||!Array.isArray(raw.issues)||raw.issues.length>24)fail();
 const issues=raw.issues.map(i=>{
  const s=scenes.find(s=>s.id===i.sceneId);
  if(!s||!['repetition','mismatch','continuity','artifact','caption','timing'].includes(i.kind)||!Number.isFinite(i.at)||i.at<s.start||i.at>s.end||!['replace_clip','replace_image','none'].includes(i.action)||(i.relatedSceneId!=null&&(!scenes.some(s=>s.id===i.relatedSceneId)||i.relatedSceneId===s.id)))fail('scene_id_timestamp_or_action');
  if(['caption','timing'].includes(i.kind)&&i.action!=='none')fail('caption_timing_not_generatable');
  return {sceneId:s.id,relatedSceneId:i.relatedSceneId??null,kind:i.kind,at:i.at,evidence:text(i.evidence,1200),action:i.action,visual:i.action==='none'?'':text(i.visual,800),motion:i.action==='none'?'':text(i.motion,400)};
 });
 if((raw.verdict==='pass')!==(!issues.length)||raw.verdict==='repair'&&issues.some(i=>i.action==='none'))fail('verdict_issue_contradiction');
 const actions=issues.filter(i=>i.action!=='none');if(new Set(actions.map(i=>i.sceneId)).size!==actions.length)fail('multiple_repairs_same_scene');
 return {verdict:raw.verdict,summary:text(raw.summary,1500),issues};
}
export function repeatedSources(scenes){
 const issues=[];
 for(let i=0;i<scenes.length;i++)for(let j=0;j<i;j++){
  const a=scenes[i],b=scenes[j],key=s=>s.sourceKey||(s.media?`${s.media.bucket}/${s.media.path}`:s.selectedVersionId);
  const from=s=>s.sourceStart??0,to=s=>s.sourceEnd??from(s)+s.end-s.start;
  if(key(a)&&key(a)===key(b)&&Math.min(to(a),to(b))-Math.max(from(a),from(b))>.08)issues.push({sceneId:a.id,relatedSceneId:b.id,at:a.start,kind:'repetition',evidence:'The same source interval is reused in separate scenes.'});
 }
 return issues;
}
export function repairScenes(project,review){
 const r=validateReview(review,project.data.scenes);
 if(r.verdict!=='repair')throw Error('PRODUCTION_QUALITY_BLOCKED');
 const data=structuredClone(project.data);
 for(const issue of r.issues.slice(0,3)){const s=data.scenes.find(s=>s.id===issue.sceneId);s.visual=issue.visual;s.motion=issue.motion;s.selectedVersionId=null;if(issue.action==='replace_image')s.imageAssetId=null;}
 // Voice, script, order, timing and unaffected scene media are copied verbatim.
 return data;
}
