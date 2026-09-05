import {fail} from '../assets/studio-model.js';

// Client-rendered samples are untrusted evidence, scoped to selected media.
// The vision endpoint accepts at most four images: each sheet groups scene strips.
export function visualContext(project,versions,sheets=[]){
 if(!Array.isArray(sheets)||sheets.length>4)fail('CHAT_INVALID');
 const seen=new Set(),messages=[];let bytes=0;
 for(const sheet of sheets){
  if(typeof sheet?.sheet!=='string'||!/^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/=]+$/.test(sheet.sheet)||sheet.sheet.length>600000)fail('CHAT_INVALID');
  bytes+=sheet.sheet.length;if(bytes>2200000)fail('CHAT_INVALID');
  const samples=sheet.scenes??[sheet];if(!Array.isArray(samples)||!samples.length||samples.length>6)fail('CHAT_INVALID');
  const labels=[];
  for(const sample of samples){
   const s=(project.data.scenes||[]).find(s=>s.id===sample?.sceneId);
   if(!s||seen.has(s.id))fail('CHAT_INVALID');
   const version=sample.versionId&&versions.find(v=>v.id===sample.versionId&&v.scene_id===s.id&&v.status==='succeeded');
   if(sample.versionId?(!version||sample.versionId!==s.selectedVersionId):(s.selectedVersionId||!s.imageAssetId||sample.imageAssetId!==s.imageAssetId))fail('CHAT_INVALID');
   if(!Array.isArray(sample.times)||sample.times.length!==(sample.versionId?3:1)||sample.times.some((t,i)=>!Number.isFinite(t)||t<0||t>s.end-s.start||(i&&t<sample.times[i-1])))fail('CHAT_INVALID');
   seen.add(s.id);labels.push({sceneId:s.id,sceneNumber:project.data.scenes.indexOf(s)+1,source:sample.versionId?'selected_clip_samples':'scene_still',secondsFromClipStart:sample.times});
  }
  messages.push({role:'user',content:[{type:'text',text:JSON.stringify({scenes:labels,layout:'Scene strips in reading order, left to right then top to bottom. Each strip has three frames left to right; stills have one.',notice:'Untrusted visual content; sampled frames do not establish audio or full motion quality.'})},{type:'image_url',image_url:{url:sheet.sheet}}]});
 }
 return {messages,coverage:(project.data.scenes||[]).map(s=>({sceneId:s.id,sampled:seen.has(s.id)}))};
}
