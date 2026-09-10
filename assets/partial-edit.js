// A revision changes selected layers; approved media and cut decisions stay immutable.
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const invalid=()=>{throw Object.assign(Error('CHAT_INVALID'),{code:'CHAT_INVALID'});};
export const LOCAL_EDIT_OPS=['set_caption_color','set_captions','set_overlay_hook','trim_scene'];
export function normalizeEditing(raw){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))invalid();
 const out={settings:{},sceneRanges:{},sceneInstructions:{},changedSceneIds:[]};
 if(raw.baseRenderId!=null){if(!uuid.test(raw.baseRenderId))invalid();out.baseRenderId=raw.baseRenderId;}
 if(raw.scoped!=null)out.scoped=raw.scoped===true;
 for(const [k,v] of Object.entries(raw.settings||{})){
  if(k==='captions'&&typeof v==='boolean'||k==='captionColor'&&['white','yellow'].includes(v)||k==='captionSize'&&Number.isInteger(v)&&v>=34&&v<=58||k==='hook'&&typeof v==='string'&&v.length<=100)out.settings[k]=v;else invalid();
 }
 for(const [id,r] of Object.entries(raw.sceneRanges||{})){
  if(!uuid.test(id)||!r||!Number.isFinite(r.in)||!Number.isFinite(r.out)||r.in<0||r.out-r.in<.15||r.out>180||!Number.isFinite(r.crop??1)||(r.crop??1)<1||(r.crop??1)>1.12)invalid();
  out.sceneRanges[id]={in:r.in,out:r.out,crop:r.crop??1};
 }
 if(!Array.isArray(raw.changedSceneIds??[])||(raw.changedSceneIds||[]).length>24||(raw.changedSceneIds||[]).some(id=>!uuid.test(id))||Object.keys(out.sceneRanges).length>24)invalid();
 for(const [id,value] of Object.entries(raw.sceneInstructions||{})){if(!uuid.test(id)||typeof value!=='string'||!value.trim()||value.length>800)invalid();out.sceneInstructions[id]=value;}
 if(Object.keys(out.sceneInstructions).length>24)invalid();
 out.changedSceneIds=[...new Set(raw.changedSceneIds||[])];return out;
}
export function normalizeNarrationRevision(raw){
 if(!raw||!uuid.test(raw.assetId)||!Array.isArray(raw.scenes)||!raw.scenes.length||raw.scenes.length>24)invalid();
 const ids=new Set();return {assetId:raw.assetId,scenes:raw.scenes.map(s=>{
  if(!uuid.test(s.id)||ids.has(s.id)||typeof s.text!=='string'||!s.text.trim()||s.text.length>500||![s.start,s.end,s.narrationStart??s.start].every(Number.isFinite)||s.start<0||s.end-s.start<.5||s.end-s.start>15||(s.narrationStart??s.start)<0||(s.narrationStart??s.start)+s.end-s.start>180)invalid();
  ids.add(s.id);return {id:s.id,text:s.text,start:s.start,end:s.end,narrationStart:s.narrationStart??s.start};
 })};
}
export function voiceRevision(data){
 if(data.narrationRevision)return data.narrationRevision;
 if(!data.narrationAssetId||!data.timingConfirmed)return null;
 return normalizeNarrationRevision({assetId:data.narrationAssetId,scenes:data.scenes});
}
export function revisionScope(before,after,edit){
 const changes=edit.operation==='batch'?edit.changes:[edit];
 const changed=new Set(after.scenes.filter(s=>{const old=before.scenes.find(x=>x.id===s.id);return !old||['text','visual','motion','imageAssetId','selectedVersionId'].some(k=>s[k]!==old[k]);}).map(s=>s.id));
 for(const c of changes)if(c.sceneId)changed.add(c.sceneId);
 const scoped=!changes.some(c=>c.operation==='set_look'||c.operation==='finish_edit'&&!c.sceneId);
 return {scoped,changedSceneIds:[...changed].filter(id=>after.scenes.some(s=>s.id===id))};
}
export function reviewNeighbors(scenes,ids){
 const indices=new Set();for(const id of ids){const i=scenes.findIndex(s=>s.id===id);if(i>=0)for(const n of [i-1,i,i+1])if(scenes[n])indices.add(n);}
 return [...indices].sort((a,b)=>a-b).map(i=>scenes[i].id);
}
export function applyLocalLayers(edl,editing,scenes){
 const out=structuredClone(edl);Object.assign(out,editing?.settings||{});
 if(!out.captions)out.captionGroups=[];
 for(const [id,r] of Object.entries(editing?.sceneRanges||{})){
  const s=scenes.find(s=>s.id===id);if(!s)continue;
  const rows=out.segments.filter(x=>x.source===s.source),index=out.segments.findIndex(x=>x.source===s.source);
  if(index<0)invalid();out.segments.splice(index,rows.length,{source:s.source,...r,frames:Math.round(s.end*24)-Math.round(s.start*24)});
 }
 return out;
}
export function rebaseApprovedEdit(base,scenes,words,editing){
 if(!base?.edl||!Array.isArray(base.scenes))throw Error('EDITORIAL_BASE_REQUIRED');
 const edl=structuredClone(base.edl);edl.segments=[];
 for(const [i,s] of scenes.entries()){
  const oldIndex=base.scenes.findIndex(x=>x.id===s.id),old=base.scenes[oldIndex];
  if(!old)throw Error('EDITORIAL_BASE_REQUIRED');
  const rows=base.edl.segments.filter(x=>x.source==='S'+String(oldIndex+1).padStart(2,'0'));
  const frames=Math.round(s.end*24)-Math.round(s.start*24),previousFrames=rows.reduce((n,r)=>n+r.frames,0);
  const sameMedia=(old.versionId||old.selectedVersionId)===(s.versionId||s.selectedVersionId);
  if(rows.length&&Math.abs(frames-previousFrames)<=1&&sameMedia){const kept=rows.map(r=>({...r,source:s.source}));kept.at(-1).frames+=frames-previousFrames;edl.segments.push(...kept);}
  else{
   if(editing?.scoped&&!(editing.changedSceneIds||[]).includes(s.id))throw Error('EDITORIAL_UNSCOPED_CHANGE');
   edl.segments.push({source:s.source,in:0,out:frames/24,frames,crop:1});
  }
 }
 // Re-index existing caption groups by stable scene ID. A new spoken phrase
 // changes only its own grouping; later captions keep their approved wording.
 if(JSON.stringify((base.words||[]).map(w=>w.text))!==JSON.stringify(words.map(w=>w.text))||editing?.settings?.captions===true&&!edl.captionGroups.length){
  const mapping=new Map(),preserved=new Map();
  const indices=(list,s)=>list.flatMap((w,i)=>w.start>=s.start-.015&&w.start<s.end-.015?[i]:[]);
  for(const scene of scenes){
   const old=base.scenes.find(s=>s.id===scene.id);if(!old)continue;
   const a=indices(base.words||[],old),b=indices(words,scene);
   if(a.length===b.length&&a.every((x,i)=>base.words[x].text===words[b[i]].text))a.forEach((x,i)=>mapping.set(x,b[i]));
  }
  for(const [a,b] of edl.captionGroups){
   const start=mapping.get(a);
   if(start!=null&&Array.from({length:b-a+1},(_,i)=>mapping.get(a+i)).every((n,i)=>n===start+i))preserved.set(start,start+b-a);
  }
  edl.captionGroups=[];let i=0;
  while(i<words.length){let j=preserved.get(i)??i;const scene=scenes.find(s=>words[i].start>=s.start-.015&&words[i].start<s.end);
   if(!preserved.has(i))while(j+1<words.length&&j-i<3&&!preserved.has(j+1)&&words[j+1].start<(scene?.end??Infinity)&&!/[.!?]$/.test(words[j].text))j++;
   edl.captionGroups.push([i,j]);i=j+1;
  }
 }
 if(editing?.settings?.captions!=null)edl.captions=editing.settings.captions;
 if(!edl.captions)edl.captionGroups=[];
 return applyLocalLayers(edl,editing,scenes);
}
