import {projectData,fail,ID} from './studio-model.js';
export const CHAT_MODEL='deepseek-v4-flash-vision-exp';
export const OPS=['clarify','set_hook','draft_script','set_look','edit_scene','remove_scene','move_scene','select_version','undo','render','produce'];
export function validateEdit(raw){
 if(!raw||!OPS.includes(raw.operation)||typeof raw.message!=='string'||!raw.message.trim()||raw.message.length>1000)fail('CHAT_INVALID');
 const edit={operation:raw.operation,message:raw.message.trim()};
 if(['set_hook','draft_script','set_look','edit_scene'].includes(edit.operation)){
  if(typeof raw.value!=='string'||!raw.value.trim()||raw.value.length>(edit.operation==='draft_script'?10000:edit.operation==='set_hook'?500:800))fail('CHAT_INVALID');edit.value=raw.value.trim();
 }
 if(['edit_scene','remove_scene','move_scene','select_version'].includes(edit.operation)){if(!ID.test(raw.sceneId||''))fail('CHAT_INVALID');edit.sceneId=raw.sceneId;}
 if(edit.operation==='select_version'){if(!ID.test(raw.versionId||''))fail('CHAT_INVALID');edit.versionId=raw.versionId;}
 if(edit.operation==='move_scene'){if(!Number.isInteger(raw.position)||raw.position<1||raw.position>24)fail('CHAT_INVALID');edit.position=raw.position;}
 if(edit.operation==='set_look'&&!['clay','3d','auto'].includes(edit.value))fail('CHAT_INVALID');
 return edit;
}
export function applyEdit(project,edit,versions=[]){
 const d=structuredClone(project.data),op=edit.operation;
 if(['clarify','undo','render','produce'].includes(op))return null;
 const idx=d.scenes.findIndex(s=>s.id===edit.sceneId),s=d.scenes[idx];
 if(['edit_scene','remove_scene','move_scene','select_version'].includes(op)&&!s)fail('STUDIO_NOT_FOUND');
 if(op==='set_hook'){
  if(d.scenes.length){d.scenes[0].text=edit.value;d.scenes[0].selectedVersionId=null;d.scriptDraft=d.scenes.map(x=>x.text).join('\n');}
  else{d.scriptDraft=(d.scriptDraft||'').replace(/^[\s\S]*?(?:[.!?](?:\s|$)|\n|$)/,()=>edit.value+' ');}
  d.narrationAssetId=null;d.timingConfirmed=false;for(const x of d.scenes)delete x.narrationStart;
 }else if(op==='draft_script'){
  if(d.scenes.length)fail('CHAT_SCRIPT_EXISTS');d.scriptDraft=edit.value;d.narrationAssetId=null;d.timingConfirmed=false;
 }else if(op==='set_look'){
  d.creative={...d.creative,look:edit.value};for(const x of d.scenes)x.selectedVersionId=null;
 }else if(op==='edit_scene'){s.visual=edit.value;s.selectedVersionId=null;}
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
