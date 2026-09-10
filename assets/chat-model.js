import {remember} from './creative-context.js';
import {projectData,fail,ID} from './studio-model.js';
import {LOCAL_EDIT_OPS,normalizeEditing,voiceRevision} from './partial-edit.js';
export {WORKFLOW_MODEL as CHAT_MODEL} from './model-routing.js';
export const OPS=['clarify','set_hook','draft_script','set_look','edit_scene','remove_scene','move_scene','select_version','undo','render','produce','batch','edit_text','finish_edit',...LOCAL_EDIT_OPS];
export function validateEdit(raw){
 if(!raw||!OPS.includes(raw.operation)||typeof raw.message!=='string'||!raw.message.trim()||raw.message.length>1000)fail('CHAT_INVALID');
 const edit={operation:raw.operation,message:raw.message.trim()};
 if(LOCAL_EDIT_OPS.includes(edit.operation)){
  if(edit.operation==='trim_scene'){
   if(!ID.test(raw.sceneId||''))fail('CHAT_INVALID');
   const range=normalizeEditing({sceneRanges:{[raw.sceneId]:{in:raw.start,out:raw.end,crop:raw.crop??1}}}).sceneRanges[raw.sceneId];
   Object.assign(edit,{sceneId:raw.sceneId,start:range.in,end:range.out,crop:range.crop});
  }else{
   if(edit.operation==='set_caption_color'&&!['white','yellow'].includes(raw.value)||edit.operation==='set_captions'&&!['on','off'].includes(raw.value)||edit.operation==='set_overlay_hook'&&(typeof raw.value!=='string'||raw.value.length>100))fail('CHAT_INVALID');
   edit.value=raw.value;
  }
  return edit;
 }
 if(edit.operation==='batch'){
  if(!Array.isArray(raw.changes)||raw.changes.length<1||raw.changes.length>12)fail('CHAT_INVALID');
  edit.changes=raw.changes.map(c=>{if(!c||['batch','clarify','undo','render','produce'].includes(c.operation))fail('CHAT_INVALID');return validateEdit({...c,message:edit.message});});
  return edit;
 }
 if(['set_hook','draft_script','set_look','edit_scene','edit_text','finish_edit'].includes(edit.operation)){
  if(typeof raw.value!=='string'||!raw.value.trim()||raw.value.length>(edit.operation==='draft_script'?10000:['set_hook','edit_text'].includes(edit.operation)?500:800))fail('CHAT_INVALID');edit.value=raw.value.trim();
 }
 if(['edit_scene','edit_text','remove_scene','move_scene','select_version'].includes(edit.operation)){if(!ID.test(raw.sceneId||''))fail('CHAT_INVALID');edit.sceneId=raw.sceneId;}
 if(edit.operation==='select_version'){if(!ID.test(raw.versionId||''))fail('CHAT_INVALID');edit.versionId=raw.versionId;}
 if(edit.operation==='move_scene'){if(!Number.isInteger(raw.position)||raw.position<1||raw.position>24)fail('CHAT_INVALID');edit.position=raw.position;}
 if(edit.operation==='set_look'&&!['clay','3d','auto'].includes(edit.value))fail('CHAT_INVALID');
 if(edit.operation==='finish_edit'&&raw.sceneId){if(!ID.test(raw.sceneId))fail('CHAT_INVALID');edit.sceneId=raw.sceneId;}
 return edit;
}
export function applyEdit(project,edit,versions=[]){
 if(edit.operation==='batch'){let p=structuredClone(project);for(const c of edit.changes)p.data=applyEdit(p,c,versions);return projectData(p.data);}
 const d=structuredClone(project.data),op=edit.operation;
 if(['clarify','undo','render','produce'].includes(op))return null;
 const idx=d.scenes.findIndex(s=>s.id===edit.sceneId),s=d.scenes[idx];
 if(LOCAL_EDIT_OPS.includes(op)){
  if(!d.scenes.length)fail('CHAT_INVALID');
  d.editing=normalizeEditing(d.editing||{});
  if(op==='trim_scene'){
   if(!s)fail('STUDIO_NOT_FOUND');const speed=(edit.end-edit.start)/(s.end-s.start);
   if(speed<.75||speed>1.6)fail('CHAT_INVALID');
   d.editing.sceneRanges[s.id]={in:edit.start,out:edit.end,crop:edit.crop??1};
  }else if(op==='set_caption_color')d.editing.settings.captionColor=edit.value;
  else if(op==='set_captions')d.editing.settings.captions=edit.value==='on';
  else d.editing.settings.hook=edit.value.trim();
  return projectData(d);
 }
 if(['edit_scene','edit_text','remove_scene','move_scene','select_version'].includes(op)&&!s)fail('STUDIO_NOT_FOUND');
 if(op==='finish_edit'){if(!d.scenes.length||edit.sceneId&&!s)fail('CHAT_INVALID');if(edit.sceneId){d.editing=normalizeEditing(d.editing||{});d.editing.sceneInstructions[edit.sceneId]=edit.value;}d.creativeMemory=remember({data:d},{decision:edit.value}).data.creativeMemory;}else if(op==='set_hook'){
  const prior=voiceRevision(d);if(prior)d.narrationRevision=prior;
  if(d.scenes.length){d.scenes[0].text=edit.value;d.scriptDraft=d.scenes.map(x=>x.text).join('\n');}
  else{d.scriptDraft=(d.scriptDraft||'').replace(/^[\s\S]*?(?:[.!?](?:\s|$)|\n|$)/,()=>edit.value+' ');}
  d.narrationAssetId=null;d.timingConfirmed=false;for(const x of d.scenes)delete x.narrationStart;
 }else if(op==='draft_script'){
  if(d.scenes.length)fail('CHAT_SCRIPT_EXISTS');d.scriptDraft=edit.value;d.narrationAssetId=null;d.timingConfirmed=false;
 }else if(op==='set_look'){
  d.creative={...d.creative,look:edit.value};for(const x of d.scenes){x.selectedVersionId=null;x.imageAssetId=null;}
 }else if(op==='edit_scene'){s.visual=edit.value;delete s.motion;s.selectedVersionId=null;s.imageAssetId=null;}
 else if(op==='edit_text'){const prior=voiceRevision(d);if(prior)d.narrationRevision=prior;s.text=edit.value;d.scriptDraft=d.scenes.map(x=>x.text).join('\n');d.narrationAssetId=null;d.timingConfirmed=false;for(const x of d.scenes)delete x.narrationStart;}
 else if(op==='select_version'){
  if(!versions.some(v=>v.id===edit.versionId&&v.scene_id===s.id&&v.status==='succeeded'))fail('STUDIO_NOT_READY');s.selectedVersionId=edit.versionId;
 }else if(['remove_scene','move_scene'].includes(op)){
  if(op==='remove_scene'&&d.scenes.length===1)fail('CHAT_LAST_SCENE');
  for(const x of d.scenes)x.narrationStart=x.narrationStart??x.start;
  const [item]=d.scenes.splice(idx,1);
  if(op==='move_scene'){if(edit.position>d.scenes.length+1)fail('CHAT_INVALID');d.scenes.splice(edit.position-1,0,item);}
  let t=0;for(const x of d.scenes){const duration=x.end-x.start;x.start=t;t=Math.round((t+duration)*1000)/1000;x.end=t;}
  d.scriptDraft=d.scenes.map(x=>x.text).join('\n');
 }
 return projectData(d);
}

// The server derives follow-up work from the resulting media, not the model's promises.
export function editFollowup(project,edit,next){
 const changes=edit.operation==='batch'?edit.changes:[edit];
 if(!next||!next.scenes.length)return null;
 if(next.editing?.baseRenderId&&changes.every(c=>['finish_edit',...LOCAL_EDIT_OPS].includes(c.operation)))return 'render';
 if(changes.some(c=>['set_hook','edit_text','set_look','edit_scene','finish_edit'].includes(c.operation))&&project.data.scenes.length)return 'produce';
 if(changes.some(c=>['remove_scene','move_scene','select_version',...LOCAL_EDIT_OPS].includes(c.operation)))return 'render';
 return null;
}
