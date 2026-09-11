import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {command} from './studio-renderer.mjs';
import {reviewSchema,validateReview,MATERIAL_REVIEW_RULES} from '../assets/quality-model.js';
export const CAPTION_EVIDENCE_RULES='Caption timing is measured against exact 24fps output frames and the supplied word intervals. A filmstrip sample outside a caption interval is not evidence of a missing subtitle. Tiny fades or sub-frame endpoint rounding are not material defects. Check legibility, wording, duplicate layers and occlusion at interior frames before requesting edits.';
export function captionAuditSamples(edl,words,scenes,sceneIds){
 const groups=edl.captionGroups.filter(([a,b])=>scenes.some(s=>sceneIds.includes(s.id)&&words[a].start<s.end&&words[b].end>s.start));
 if(!groups.length||groups.length>12)return null;
 return groups.map(([a,b])=>{const start=words[a].start,end=words[b].end;
  const frames=[...new Set([.2,.5,.8].map(f=>Math.ceil((start+(end-start)*f)*24)).filter(n=>n/24>start+.001&&n/24<end-.001))];
  return {text:words.slice(a,b+1).map(w=>w.text).join(' '),start,end,frames};
 });
}
export async function verifyCaptionFindings({review,path,edl,scenes,words,root,call,usage,env,signal,fetchImpl,makeEvidence=captionEvidence}){
 const targets=[...new Set(review.issues.filter(i=>i.kind==='caption').map(i=>i.sceneId))];
 if(!targets.length||targets.length>2||!edl.captions)return review;
 const groups=captionAuditSamples(edl,words,scenes,targets);
 if(!groups||groups.some(g=>!g.frames.length))return review;
 const images=await makeEvidence(path,groups,root,{signal});
 const frameLayout=groups.flatMap((g,group)=>g.frames.map(frame=>({group:group+1,frame,time:frame/24}))).map((f,i)=>({...f,sheet:Math.floor(i/12)+1,row:Math.floor((i%12)/3)+1,column:i%3+1}));
 const selected=scenes.filter(s=>targets.includes(s.id));
 const schema={...reviewSchema,properties:{...reviewSchema.properties,coverage:{type:'array',items:{type:'string'}}},required:[...reviewSchema.required,'coverage']};
 const raw=await call({role:'director',name:'verify_captions',schema,system:MATERIAL_REVIEW_RULES+' '+CAPTION_EVIDENCE_RULES+' Independently confirm or dismiss the alleged caption defects using these exact interior frames. Sheets contain three columns in reading order; frameLayout identifies each unannotated cell. Inspect all supplied caption groups. Return coverage for exactly the supplied scenes in order. Report only caption issues with action none. Do not restyle the video or waive unrelated findings.',context:{scenes:selected.map(({path,...s})=>s),groups,frameLayout,allegations:review.issues.filter(i=>i.kind==='caption'),sourceCaptionScenes:edl.sourceCaptionScenes||[],captionFadeMs:edl.captionFadeMs||0},images,usage,env,signal,fetchImpl});
 const checked=validateReview(raw,selected);
 if(JSON.stringify(raw.coverage)!==JSON.stringify(selected.map(s=>s.id))||checked.issues.some(i=>i.kind!=='caption'||i.action!=='none'))throw Error('EDITORIAL_CAPTION_AUDIT_INVALID');
 const issues=[...review.issues.filter(i=>i.kind!=='caption'||!targets.includes(i.sceneId)),...checked.issues];
 const verdict=!issues.length?'pass':issues.some(i=>i.action==='none')?'blocked':'repair';
 const audit={sceneIds:targets,groups,verdict:checked.verdict,summary:checked.summary};
 await writeFile(resolve(root,'audit.json'),JSON.stringify(audit,null,2));
 return {...review,issues,verdict,summary:!issues.length?checked.summary:review.summary,captionAudit:audit};
}
export async function captionEvidence(path,groups,root,{signal}={}){
 await mkdir(root,{recursive:true});const frames=[];
 for(const [g,item] of groups.entries())for(const n of item.frames){
  const f=resolve(root,`g${g}-frame${n}.jpg`);
  // Keep evidence unobscured. Cell identities live in frameLayout, avoiding a
  // drawtext/fontconfig dependency on both minimal workers and developer Macs.
  await command('ffmpeg',['-v','error','-y','-i',path,'-vf',`select=eq(n\\,${n}),setpts=PTS-STARTPTS,scale=300:-2`,'-an','-fps_mode','vfr','-frames:v','1','-threads','1','-update','1',f],{signal});frames.push(f);
 }
 const images=[];
 for(let i=0;i<frames.length;i+=12){
  const files=frames.slice(i,i+12),list=resolve(root,`list${i}.txt`),sheet=resolve(root,`sheet${i}.jpg`);
  await writeFile(list,files.map(p=>`file '${p.replaceAll("'","'\\''")}'`).join('\n'));
  await command('ffmpeg',['-v','error','-y','-f','concat','-safe','0','-i',list,'-vf',`tile=3x${Math.ceil(files.length/3)}:nb_frames=${files.length}:padding=8:margin=8`,'-frames:v','1','-update','1',sheet],{signal});
  images.push('data:image/jpeg;base64,'+(await readFile(sheet)).toString('base64'));
 }return images;
}
