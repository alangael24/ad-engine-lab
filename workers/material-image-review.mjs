import {createHash} from 'node:crypto';
import {IMAGE_REVIEW_POLICY_VERSION,validateImageContract,imageAssessmentSchema} from '../assets/image-review-policy.js';
import {creativeShotRule} from '../assets/creative-formats.js';
import {productionWorkflow} from '../assets/production-workflow.js';
import {runImageReviewPilot} from './image-review-pilot.mjs';
import {editorialCall} from './editorial-models.mjs';
import {readBounded,imageType} from '../src/generations.js';
const hash=x=>createHash('sha256').update(typeof x==='string'||Buffer.isBuffer(x)?x:JSON.stringify(x)).digest('hex');
const fatal=e=>Object.assign(e,{fatal:true});
export function materialImageReviewEnabled(env={}){
 const mode=env.PRODUCTION_IMAGE_REVIEW_MODE||'material-v1';
 if(!['material-v1','legacy'].includes(mode))throw Error('PRODUCTION_IMAGE_REVIEW_CONFIG');
 return mode==='material-v1'&&productionWorkflow(env).version==='astra-deepseek-v1';
}
// Frozen from the approved plan BEFORE any image inspection. No crop, typography,
// subtitle area, absent character or invisible product constraints are invented.
export function prepareImageContracts(project,plan){
 return plan.scenes.map(scene=>{
  const shot=scene.shotContract,criteria=[];
  const add=(id,kind,requirement,impact,risk='normal')=>criteria.push({id,kind,requirement:requirement.slice(0,1500),blocking:true,impact,risk});
  if(shot?.productVisible!==false&&project.brand_snapshot?.productAssetId)add('product','product_identity',(shot?.productVisible===true?'The approved shot explicitly requires the referenced product/brand to be visible. Preserve its recognizable identity and visible physical parts. ':'Identity check only IF the referenced product or brand is visible. Attaching a reference does not require showing it in every shot. If absent and not explicitly required by the shot, report met with difference none; do not report unverifiable. ')+(project.brand_snapshot.appearance||''),'The viewer must recognize the advertised product.');
  if(shot?.characterVisible)add('character','character_identity','Preserve the visible character identity and wardrobe specified here: '+(shot.preserve||[]).join('; '),'Identity changes must not break the story.');
  add('opening','action','Show the planned OPENING, not the future motion/end state: '+(shot?.state||scene.visual),'The opening must support this scene’s message and physical action.');
  if(shot?.preserve?.length)add('invariants','product_relation','Preserve only required visible relations/properties: '+shot.preserve.join('; '),'A material change must not contradict the approved scene.');
  const style=[creativeShotRule(project.data.creative,project.data),plan.continuity].filter(Boolean).join('\n');
  if(style)add('style','style','Follow the explicit material/style and recurring visible identities in the approved direction. Do not require offscreen objects or infer cartoon-only from vague 3D wording. '+style,'The scene must belong to the approved visual world.');
  add('artifacts','artifact','No conspicuous malformed anatomy or broken product geometry that interferes with understanding this shot. Ignore insignificant surface/texture details.','Visible deformation must not undermine the scene.');
  return validateImageContract({version:IMAGE_REVIEW_POLICY_VERSION,sceneId:scene.id,revision:hash({scene,style,criteria}).slice(0,20),criteria,unresolved:[]});
 });
}
// Every paid call owns a durable, lease-fenced checkpoint and budget entry.
// Completed provider responses are saved before downstream policy/repair work.
export function materialCheckpointStore(invoke){
 return {
  async load(key){try{const s=await invoke('begin_step',{key,stage:'images'});return s.status==='done'?s.result:null;}catch(e){throw fatal(e);}},
  async save(key,result){try{await invoke('finish_step',{key,stage:'images',result});}catch(e){throw fatal(e);}},
 };
}
export async function reviewMaterialImages({project,plan,images,invoke,env={},fetchImpl=fetch,targetIndex,callModel=editorialCall}){
 if(!plan.imageContracts||images.some(x=>!x.assetId)||images.length!==(targetIndex==null?plan.scenes.length:targetIndex+1))throw Error('PRODUCTION_IMAGE_REVIEW_INVALID');
 const contracts=new Map(plan.imageContracts.map(c=>[c.sceneId,validateImageContract(c)]));
 const cache=new Map(),media=new Map();
 async function asset(id){
  if(cache.has(id))return cache.get(id);
  const {url}=await invoke('asset',{assetId:id});const r=await fetchImpl(url,{redirect:'error',signal:AbortSignal.timeout(60000)});
  if(!r.ok)throw Error('PRODUCTION_REFERENCE_REQUIRED');
  const bytes=Buffer.from(await readBounded(r,6291456)),[mime]=imageType(bytes),sha256=hash(bytes);
  media.set(sha256,`data:${mime};base64,${bytes.toString('base64')}`);const evidence={assetId:id,sha256};cache.set(id,evidence);return evidence;
 }
 const packets=[];
 for(const [i,scene] of plan.scenes.entries()){
  if(targetIndex!=null&&i!==targetIndex)continue;
  const contract=contracts.get(scene.id);if(!contract)throw Error('PRODUCTION_IMAGE_CONTRACT_MISSING');
  const refs=[],seen=new Set(),add=async(id,role)=>{if(id&&!seen.has(id)){seen.add(id);refs.push({...await asset(id),role});}};
  if(scene.shotContract?.productVisible!==false){await add(project.brand_snapshot?.productAssetId,'Original product identity only');for(const id of scene.shotContract?.productViewAssetIds||[])await add(id,'Original visible product face');}
  if(scene.shotContract?.characterVisible!==false)for(const id of project.data.creativeMemory?.characterAssetIds||[])await add(id,'Original character identity');
  for(const id of (project.data.creativeMemory?.referenceAssetIds||[]).slice(0,1))await add(id,'Approved style only');
  if(i>0)await add(images[0].assetId,'Recurring generated identity anchor; not proof of correctness');
  await add(images[i-1]?.assetId,'Prior opening for continuity; not proof of correctness or final video state');
  if(project.referenceEvidence?.[0]){
   const url=project.referenceEvidence[0],m=/^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/=]+)$/.exec(url);
   if(!m)throw Error('PRODUCTION_REFERENCE_REQUIRED');const bytes=Buffer.from(m[2],'base64');if(bytes.length>6291456)throw Error('PRODUCTION_REFERENCE_REQUIRED');imageType(bytes);
   const sha256=hash(bytes);media.set(sha256,url);refs.push({sha256,role:'Original filmstrip: style only, not required props or identities'});
  }
  const target=await asset(images[i].assetId);packets.push({contract,imageSha256:target.sha256,references:refs});
 }
 const store=materialCheckpointStore(invoke),keyFor=k=>'material-call-'+hash(k);
 const metered=async(role,name,schema,system,context,visuals,key)=>{
  const usage={total:0,calls:[],unknown:false};
  try{
   const result=await callModel({role,name,schema,system,context,images:visuals,usage,env,fetchImpl,onUsage:async ledger=>{
    const amount=ledger.calls.reduce((n,c)=>n+(Number.isFinite(c.cost)?c.cost:c.reserved),0);
    try{await invoke(ledger.unknown||ledger.calls.some(c=>c.status==='started')?'reserve_cost':'record_cost',{key,costUsd:amount});}catch(e){throw fatal(e);}
   }});
   return {result,usage,costUsd:usage.unknown?null:usage.total};
  }catch(e){e.usage=usage;e.costUsd=usage.unknown?null:usage.total;throw e;}
 };
 const result=await runImageReviewPilot({packets,modelIds:{primary:'deepseek-flash',secondary:'gpt-6-astra'},auditSeed:'material-production-v1',auditRate:targetIndex==null?.25:0,deferStyle:targetIndex!=null,
  load:k=>store.load(keyFor(k)),save:(k,v)=>store.save(keyFor(k),v),
  review:async request=>{
   // Deduplicate references and explicitly map each image to its numbered input.
   const digests=[...new Set(request.packets.flatMap(p=>[p.imageSha256,...p.references.map(r=>r.sha256)]))];
   const context={packets:request.packets.map(p=>({...p,targetImage:digests.indexOf(p.imageSha256)+1,references:p.references.map(r=>({...r,inputImage:digests.indexOf(r.sha256)+1}))}))};
   const key=keyFor('image-review-pilot:'+hash(request));
   const schema={type:'object',properties:{assessments:{type:'array',items:imageAssessmentSchema}},required:['assessments'],additionalProperties:false};
   const paid=await metered(request.stage==='inspect'?'inspector':'director','inspect_material_images',schema,request.system,context,digests.map(d=>media.get(d)),key);
   return {...paid.result,raw:paid.result,usage:paid.usage,costUsd:paid.costUsd};
  }
 });
 const issues=[];
 for(const d of result.decisions){
  if(d.decision==='approve')continue;
  const i=plan.scenes.findIndex(s=>s.id===d.sceneId),scene=plan.scenes[i];
  const evidence=(d.blocking.map(x=>`${x.observation} Impact: ${x.consequence}`).join('; ')||d.unresolved.join('; ')).slice(0,1200);
  const base={sceneId:d.sceneId,relatedSceneId:null,kind:'mismatch',at:i,evidence,action:'none',visual:'',motion:''};
  if(d.decision==='repair'){
   const context={scene:{text:scene.text,visual:scene.visual,motion:scene.motion},contract:contracts.get(scene.id),confirmedDefects:d.blocking};
   const key='material-call-'+hash({repair:context,asset:images[i].assetId}),prior=await store.load(key);
   let paid=prior;
   if(!paid){try{paid=await metered('editor','repair_material_still',{type:'object',properties:{visual:{type:'string',maxLength:800},motion:{type:'string',maxLength:400}},required:['visual','motion'],additionalProperties:false},'Repair only the independently confirmed material defects. Preserve the frozen contract, script, identity and style. Return a self-contained English opening-still visual (max 800 characters) and motion (max 400). No subjective improvements.',context,[],key);await store.save(key,paid);}catch(e){if(e.fatal)throw e;await store.save(key,{error:e.message,usage:e.usage||null,costUsd:e.costUsd??null});paid=null;}}
   const p=paid?.result;
   if(p&&typeof p.visual==='string'&&p.visual.trim()&&p.visual.length<=800&&typeof p.motion==='string'&&p.motion.trim()&&p.motion.length<=400&&(p.visual!==scene.visual||p.motion!==scene.motion))Object.assign(base,{action:'replace_image',visual:p.visual,motion:p.motion});
  }
  issues.push(base);
 }
 if(result.status==='contract_blocked')throw Error('PRODUCTION_IMAGE_CONTRACT_UNRESOLVED');
 return {verdict:issues.length?issues.some(i=>i.action==='none')?'blocked':'repair':'pass',summary:issues.length?'Defectos materiales confirmados o evidencia pendiente.':'Sin defectos materiales observables en los criterios revisados.',issues,assetIds:images.map(x=>x.assetId),observedStates:result.decisions.filter(d=>d.decision==='approve').map(d=>({sceneId:d.sceneId,assetId:images[plan.scenes.findIndex(s=>s.id===d.sceneId)].assetId,summary:(()=>{const record=result.records.find(r=>r.sceneId===d.sceneId),confirmed=new Map([...record.confirmed,...(result.style.find(s=>s.sceneId===d.sceneId)?.checks||[])].map(c=>[c.criterionId,c]));return record.primary.checks.map(c=>(confirmed.get(c.criterionId)||c).observation).join('; ').slice(0,1200);})()})),policyVersion:IMAGE_REVIEW_POLICY_VERSION,collectionGate:targetIndex==null,costUsd:0,ledger:result.calls,escalations:result.escalations,decisions:result.decisions};
}
