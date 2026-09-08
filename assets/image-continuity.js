// Versioned, bounded shot packets derived from continuity labs 05–09 and UGC01.
const invalid=()=>{throw Error('PRODUCTION_PLAN');};
export const shotContractSchema={type:'object',additionalProperties:false,properties:{
 productVisible:{type:'boolean'},characterVisible:{type:'boolean'},
 transition:{type:'string',enum:['cut','continuous_camera','state_change','location_change']},
 camera:{type:'string',maxLength:300},state:{type:'string',maxLength:500},
 endState:{type:'string',maxLength:500},
 preserve:{type:'array',maxItems:8,items:{type:'string',maxLength:200}},
 change:{type:'array',maxItems:8,items:{type:'string',maxLength:200}},
 productViewAssetIds:{type:'array',maxItems:3,items:{type:'string'}}
},required:['productVisible','characterVisible','transition','camera','state','preserve','change','productViewAssetIds']};
export function normalizeShotContract(raw){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))invalid();
 const out={};
 for(const [key,schema] of Object.entries(shotContractSchema.properties)){
  const v=raw[key];
  if(key==='endState'&&v===undefined)continue; // Existing saved projects remain readable.
  if(schema.type==='boolean'){if(typeof v!=='boolean')invalid();out[key]=v;}
  else if(schema.type==='string'){if(typeof v!=='string'||!v.trim()||v.length>(schema.maxLength||100)||(schema.enum&&!schema.enum.includes(v)))invalid();out[key]=v.trim();}
  else {if(!Array.isArray(v)||v.length>schema.maxItems||v.some(x=>typeof x!=='string'||!x.trim()||x.length>(schema.items.maxLength||36)))invalid();out[key]=v.map(x=>x.trim());}
 }
 if(out.productViewAssetIds.some(x=>!UUID.test(x))||(!out.productVisible&&out.productViewAssetIds.length))invalid();
 return out;
}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const DIRECTOR_CONTINUITY_RULES=`For EVERY scene supply shotContract, including endState. Plan a separate approved opening still for each intentional angle/crop/location cut; do not ask one H3 clip to morph between locations. State is the opening; endState is the required visible ending. Specify anatomical holding hand (not just screen side), object contact and grounded/carried state across cuts. New shots may change screen side without changing anatomical hand. Match prior ending to next opening unless a deliberate temporal ellipsis explains the change. Continuous camera motion is not a cut; never claim last-frame chaining unless an actual reviewed video frame was supplied. Keep one main action and a useful ending per clip. For a reverse angle require a genuinely different viewpoint, not merely a turned head.  Keep full project context here, but scope each image to its visible entities. Make preserve and state self-contained for visible character identity, wardrobe and material/style; never say only "same character" when no original character image exists. Specify camera/crop, actual desired state (holder, location, open/closed, count and detached parts), preserve/change, and transition type. A reaction can have productVisible=false even when narration mentions the product. Never force offscreen product/furniture into a close-up. A new location replaces the old world. Select productViewAssetIds only from supplied productViews and only for surfaces visible in this shot; do not invent asset IDs. If a required product face is undocumented, choose a supported view instead of inventing its features. An ordinary cut tolerates minor pose/scale differences; continuous_camera requires fixed relative pose/contact. No claim that planned state was observed.`;
export const STILL_CONTINUITY_RULES=`Review visible material errors only. Ignore tiny texture, hair, finger marks and small crop differences unless they harm identity, narrative action or a required continuous seam. Offscreen product/fixtures are not defects. Respect intentional state/location changes; compare expected count, holder/contact, detached parts and visible physical faces. Do not move control features between product faces or invent undocumented geometry. In summary, describe the ACTUAL target state: holder/screen side, location, open/closed, count, pose and accepted minor deviations. Do not substitute intended prompt state for observed evidence. Stills cannot prove motion or lip sync.`;
export function imagePacket(project,plan,index,{anchor,previous}={}){
 const scene=plan.scenes[index];if(!scene)invalid();
 const shot=scene.shotContract?normalizeShotContract(scene.shotContract):null;
 const m=project.data.creativeMemory||{},refs=[];
 const add=(assetId,role)=>{if(assetId&&!refs.some(x=>x.assetId===assetId))refs.push({assetId,role});};
 if(!shot||shot.productVisible){
  add(project.brand_snapshot?.productAssetId,'Original product external identity only; exclude source props, backdrop and promotional panels.');
  for(const id of shot?.productViewAssetIds||[]){const view=(m.productViews||[]).find(v=>v.assetId===id);if(!view)invalid();add(id,`Original visible product face; observed features: ${view.features}`);}
 }
 if(!shot||shot.characterVisible)for(const id of m.characterAssetIds||[])add(id,'Original character identity only; not pose, source location or lighting.');
 // Unreviewed, replaced or rejected generated images must not become identity/state evidence.
 const approved=new Set(m.approvedAssets||[]);
 if(!shot||shot.characterVisible){if(approved.has(anchor?.assetId))add(anchor.assetId,'Accepted project identity anchor; preserve only named unchanged properties.');}
 if(approved.has(previous?.assetId))add(previous.assetId,'Accepted prior state only; CURRENT crop, action and location override old state and offscreen objects.');
 if(shot?.transition!=='location_change')for(const id of (m.referenceAssetIds||[]).slice(0,1))add(id,'Style/material only for visible entities; not product identity or mandatory scene inventory.');
 const state=(m.observedStates||[]).find(x=>x.assetId===previous?.assetId&&approved.has(x.assetId));
 return {version:4,shot,references:refs,previousObservedState:state||null,
  includeFilmstrip:shot?.transition!=='location_change',
  context:shot?{preferences:m.preferences||[],product:shot.productVisible?{name:project.brand_snapshot?.name,appearance:project.brand_snapshot?.appearance}:undefined}:null};
}
