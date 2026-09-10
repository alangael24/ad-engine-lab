import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {command,probe} from './studio-renderer.mjs';
import {readBounded} from '../src/generations.js';
import {normalizeNarrationRevision} from '../assets/partial-edit.js';

// Generate only changed scenes under individual idempotent spending checkpoints.
export async function patchNarration(project,plan,providers,invoke,once,jobId){
 const revision=normalizeNarrationRevision(project.data.narrationRevision),parts=[];
 const source=await once('narration-base','narration',()=>invoke('narration_source',{assetId:revision.assetId}));
 // Reject missing alignment or unsafe original phrase boundaries before TTS.
 revisionAudioPlan({scenes:revision.scenes},revision.scenes.map(s=>({sceneId:s.id,assetId:revision.assetId,start:s.narrationStart,duration:s.end-s.start,reused:true})),source.alignment);
 for(const scene of plan.scenes){
  const old=revision.scenes.find(x=>x.id===scene.id);if(!old)throw Error('PRODUCTION_NARRATION_BASE');
  if(scene.text===old.text)parts.push({sceneId:scene.id,assetId:revision.assetId,start:old.narrationStart,duration:old.end-old.start,reused:true});
  else{
   const result=await once(`narration-scene-${scene.id}`,'narration',()=>providers.speech({...project,data:{...project.data,scriptDraft:scene.text}},{...plan,scenes:[scene]},invoke,jobId));
   if(!Number.isFinite(result.duration)||result.duration<.5||result.duration>15)throw Error('PRODUCTION_TIMING');
   parts.push({...result,sceneId:scene.id,start:0,reused:false});
  }
 }
 if(!providers.composeSpeech)throw Error('PRODUCTION_NARRATION_BASE');
 return once('narration','narration',()=>providers.composeSpeech({project,plan,revision,parts,invoke}));
}

export function revisionAudioPlan(plan,parts,originalAlignment){
 const alignment={characters:[],character_start_times_seconds:[],character_end_times_seconds:[]},timeline=[];let cursor=0;
 for(const [i,part] of parts.entries()){
  const scene=plan.scenes[i],a=part.reused?originalAlignment:part.alignment;
  if(scene.id!==part.sceneId||!Array.isArray(a?.characters)||a.characters.length!==a.character_start_times_seconds?.length||a.characters.length!==a.character_end_times_seconds?.length)throw Error('PRODUCTION_NARRATION_BASE');
  const indices=a.characters.map((_,j)=>j).filter(j=>a.character_start_times_seconds[j]>=part.start-.001&&a.character_start_times_seconds[j]<part.start+part.duration-.001);
  const norm=s=>(s.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu)||[]).join(' ');
  if(norm(indices.map(j=>a.characters[j]).join(''))!==norm(scene.text))throw Error('PRODUCTION_NARRATION_BOUNDARY');
  for(const j of indices){const start=a.character_start_times_seconds[j]-part.start,end=a.character_end_times_seconds[j]-part.start;
   if(!Number.isFinite(start)||!Number.isFinite(end)||start<-.001||end<start||end>part.duration+.03)throw Error('PRODUCTION_NARRATION_BOUNDARY');
   alignment.characters.push(a.characters[j]);alignment.character_start_times_seconds.push(cursor+Math.max(0,start));alignment.character_end_times_seconds.push(cursor+Math.min(part.duration,end));
  }
  if(i<parts.length-1){alignment.characters.push(' ');alignment.character_start_times_seconds.push(cursor+part.duration);alignment.character_end_times_seconds.push(cursor+part.duration);}
  const {narrationStart,...copy}=scene;timeline.push({...copy,planSceneId:scene.id,start:Math.round(cursor*1000)/1000,end:Math.round((cursor+part.duration)*1000)/1000});cursor+=part.duration;
 }
 if(cursor>120)throw Error('PRODUCTION_TIMING');return {alignment,timeline,duration:cursor};
}

export async function composeNarration({project,plan,revision,parts,invoke,fetchImpl=fetch,save}){
 const {alignment:originalAlignment}=await invoke('narration_source',{assetId:revision.assetId});
 const result=revisionAudioPlan(plan,parts,originalAlignment),dir=await mkdtemp(join(tmpdir(),'narration-revision-'));
 try{
  const files=new Map();
  for(const part of parts)if(!files.has(part.assetId)){
   const {url}=await invoke('asset',{assetId:part.assetId}),r=await fetchImpl(url,{redirect:'error',signal:AbortSignal.timeout(120000)});
   if(!r.ok)throw Error('PRODUCTION_NARRATION_BASE');const file=join(dir,`source-${files.size}.mp3`);await writeFile(file,await readBounded(r,20971520));files.set(part.assetId,file);
  }
  const paths=[...files.values()],filters=parts.map((p,i)=>`[${paths.indexOf(files.get(p.assetId))}:a]atrim=start=${p.start}:duration=${p.duration},asetpts=PTS-STARTPTS,aresample=44100,aformat=sample_fmts=fltp:channel_layouts=mono,apad,atrim=duration=${p.duration},afade=t=in:st=0:d=0.03,afade=t=out:st=${Math.max(0,p.duration-.03)}:d=0.03[a${i}]`);
  filters.push(parts.map((_,i)=>`[a${i}]`).join('')+`concat=n=${parts.length}:v=0:a=1[out]`);
  const out=join(dir,'narration.mp3');await command('ffmpeg',['-v','error','-y',...paths.flatMap(p=>['-i',p]),'-filter_complex',filters.join(';'),'-map','[out]','-c:a','libmp3lame','-b:a','192k',out]);
  const duration=Number((await probe(out)).format.duration);if(Math.abs(duration-result.duration)>.15)throw Error('PRODUCTION_TIMING');
  return {...result,...await save(await readFile(out),duration),reusedScenes:parts.filter(x=>x.reused).map(x=>x.sceneId),generatedScenes:parts.filter(x=>!x.reused).map(x=>x.sceneId)};
 }finally{await rm(dir,{recursive:true,force:true});}
}
