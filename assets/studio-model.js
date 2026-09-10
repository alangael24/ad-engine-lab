import {normalizeShotContract} from './image-continuity.js';
import {normalizeEditing,normalizeNarrationRevision} from './partial-edit.js';
import {normalizeCreativeMemory} from './creative-context.js';
import {creativeSettings,creativeShotRule} from './creative-formats.js';
// Shared editorial rules, used by the browser and the authenticated API.
export const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function fail(code='STUDIO_INVALID'){throw Object.assign(new Error(code),{code});}
const string=(v,max,required=false)=>{if(typeof v!=='string'||v.trim().length>max||(required&&!v.trim()))fail();return v.trim();};
const id=v=>v==null||v===''?null:ID.test(v)?v:fail();
export function brandData(input){
 const sourceUrl=string(input.sourceUrl??'',2000);if(sourceUrl){let u;try{u=new URL(sourceUrl);}catch{fail();}if(u.protocol!=='https:'||u.username||u.password)fail();}
 return {sourceUrl,sourceText:string(input.sourceText??'',6000),name:string(input.name,80,true),product:string(input.product,600,true),appearance:string(input.appearance,600),benefits:string(input.benefits,600),claims:string(input.claims,600),avoid:string(input.avoid,600),voiceName:string(input.voiceName??'',100),voiceNotes:string(input.voiceNotes??'',300),productAssetId:id(input.productAssetId),voiceAssetId:id(input.voiceAssetId)};
}
export function projectData(input){
 const revisionFields={...(input.editing?{editing:normalizeEditing(input.editing)}:{}),...(input.narrationRevision?{narrationRevision:normalizeNarrationRevision(input.narrationRevision)}:{})};
 const referenceUrl=string(input.referenceUrl,2000);if(referenceUrl){let u;try{u=new URL(referenceUrl);}catch{fail();}if(!['https:','http:'].includes(u.protocol)||u.username||u.password)fail();}
 if(!['9:16','16:9','1:1'].includes(input.aspectRatio)||!Array.isArray(input.scenes)||input.scenes.length>24)fail();
 const ids=new Set();let previous=0;
 const scenes=input.scenes.map(s=>{
  if(!ID.test(s.id)||ids.has(s.id))fail();ids.add(s.id);
  const start=Number(s.start),end=Number(s.end);
  if(!Number.isFinite(start)||!Number.isFinite(end)||Math.abs(start-previous)>.025||end-start<.5||end-start>15||end>120)fail('STUDIO_TIMELINE');
  previous=end;
  const narrationStart=s.narrationStart==null?null:Number(s.narrationStart);
  if(narrationStart!==null&&(!Number.isFinite(narrationStart)||narrationStart<0||narrationStart+end-start>180))fail('STUDIO_AUDIO_TIMING');
  return {...(narrationStart!==null?{narrationStart}:{}),id:s.id,...(s.shotContract?{shotContract:normalizeShotContract(s.shotContract)}:{}),...(s.motion!=null?{motion:string(s.motion,400)}:{}),text:string(s.text,500,true),visual:string(s.visual,800,true),start:Math.round(start*1000)/1000,end:Math.round(end*1000)/1000,imageAssetId:id(s.imageAssetId),selectedVersionId:id(s.selectedVersionId)};
 });
 return {...revisionFields,...(input.creativeMemory?{creativeMemory:normalizeCreativeMemory(input.creativeMemory)}:{}),...(input.videoContinuity!=null?{videoContinuity:string(input.videoContinuity,2000)}:{}),scriptDraft:string(input.scriptDraft??'',10000),idea:string(input.idea??'',3000),creative:creativeSettings(input.creative),title:string(input.title,120,true),brandId:id(input.brandId),referenceUrl,referenceNotes:string(input.referenceNotes,1200),referenceAnalysisId:id(input.referenceAnalysisId),aspectRatio:input.aspectRatio,narrationAssetId:id(input.narrationAssetId),timingConfirmed:input.timingConfirmed===true,scenes};
}
export function draftScenes(script,duration,newId=()=>crypto.randomUUID()){
 const phrases=script.trim().match(/[^.!?¿]+[.!?]?/g)?.map(s=>s.trim()).filter(Boolean)||[];
 if(!phrases.length||phrases.length>24||!Number.isFinite(duration)||duration<phrases.length*.5||duration>120)fail('STUDIO_TIMELINE');
 const weights=phrases.map(p=>p.split(/\s+/).length),total=weights.reduce((a,b)=>a+b,0);let cursor=0;
 return phrases.map((text,i)=>{const start=cursor;cursor=i===phrases.length-1?duration:Math.round((cursor+duration*weights[i]/total)*1000)/1000;
  if(cursor-start>15)fail('STUDIO_LONG_SCENE');
  return {id:newId(),text,visual:'',start,end:cursor,imageAssetId:null,selectedVersionId:null};});
}
export function scenePrompt(project,sceneId,instruction=''){
 const list=project.data.scenes,idx=list.findIndex(s=>s.id===sceneId);if(idx<0)fail('STUDIO_NOT_FOUND');
 const s=list[idx],b=project.brand_snapshot;
 // Budgets preserve every category; a long brand field cannot erase the correction.
 const cut=(v,n)=>String(v||'').slice(0,n);
 const parts=[`Creative direction: ${creativeShotRule(project.data.creative)}.`, `Product: ${cut(b.name,50)}. ${cut(b.product,150)}`,`Identity: ${cut(b.appearance,160)}`,
  `Brand statements (preserve meaning; do not invent or strengthen): ${cut(b.claims,90)}. Do not show/claim: ${cut(b.avoid,110)}`,
  `Reference style only: ${cut(project.data.referenceNotes,260)}. Product photo defines geometry; style reference does not define product, person or claims.`,
  `Shot ${idx+1}/${list.length}, ${s.start}-${s.end}s. Narration: "${cut(s.text,170)}". Voiceover only; do not lip-sync or write text.`,
  `Show: ${cut(s.visual,300)}`,`Previous: ${cut(list[idx-1]?.visual,65)}. Next: ${cut(list[idx+1]?.visual,65)}.`,
  `Correction: ${cut(instruction,180)}. Preserve product geometry, subject and approved look.`];
 const correction=parts.pop();return parts.join('\n').slice(0,1599-correction.length)+'\n'+correction;
}
export function canAssemble(project,versions){
 return Boolean(project?.data.narrationAssetId&&project.data.timingConfirmed&&project.data.scenes.length&&project.data.scenes.every(s=>versions.some(v=>v.id===s.selectedVersionId&&v.status==='succeeded')));
}
