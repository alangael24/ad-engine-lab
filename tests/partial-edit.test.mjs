import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,copyFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {applyEdit,validateEdit,editFollowup} from '../assets/chat-model.js';
import {normalizeEditing,revisionScope,rebaseApprovedEdit,reviewNeighbors} from '../assets/partial-edit.js';
import {patchNarration,revisionAudioPlan,composeNarration} from '../workers/narration-revision.mjs';
import {finishSolLunaProject} from '../workers/sol-luna-edit.mjs';
import {renderSimpleAd} from '../workers/simple-ad-renderer.mjs';
import {command,probe} from '../workers/studio-renderer.mjs';
import {paidStep} from '../src/production-spend.js';
import {processProduction} from '../workers/production-worker.mjs';

const ids=Array.from({length:3},()=>crypto.randomUUID()),assetId=crypto.randomUUID();
const scenes=ids.map((id,i)=>({id,source:`S0${i+1}`,sourceDuration:5,frames:72,number:i+1,start:i*3,end:i*3+3,text:['Uno.','Dos.','Tres.'][i],visual:`Action ${i}`,imageAssetId:crypto.randomUUID(),selectedVersionId:crypto.randomUUID()}));
const words=scenes.map(s=>({type:'word',text:s.text,start:s.start+.2,end:s.start+1}));
const edl={segments:scenes.map(s=>({source:s.source,in:.2,out:3.2,frames:72,crop:1})),captions:true,captionColor:'white',captionSize:46,captionGroups:[[0,0],[1,1],[2,2]],hook:'Original'};
const project={id:crypto.randomUUID(),data:{title:'Test',brandId:null,aspectRatio:'9:16',referenceUrl:'',referenceNotes:'',scriptDraft:'Uno. Dos. Tres.',narrationAssetId:assetId,timingConfirmed:true,scenes}};
const base={id:crypto.randomUUID(),edl,scenes,words};
function alignment(text,start=0){return {characters:[...text],character_start_times_seconds:[...text].map((_,i)=>start+i*.15),character_end_times_seconds:[...text].map((_,i)=>start+i*.15+.1)};}
const originalAlignment={characters:[],character_start_times_seconds:[],character_end_times_seconds:[]};
for(const s of scenes){const a=alignment(s.text+' ',s.start+.2);for(const k of Object.keys(a))originalAlignment[k].push(...a[k]);}

test('caption and overlay changes preserve all speech, selected clips and images',()=>{
 const edit=validateEdit({operation:'batch',message:'Texto actualizado.',changes:[{operation:'set_caption_color',value:'yellow'},{operation:'set_overlay_hook',value:'Mira esto'}]});
 const d=applyEdit(project,edit);assert.equal(d.narrationAssetId,assetId);assert.equal(d.scriptDraft,project.data.scriptDraft);assert.deepEqual(d.scenes.map(s=>s.selectedVersionId),scenes.map(s=>s.selectedVersionId));assert.equal(editFollowup(project,edit,d),'render');
 const result=rebaseApprovedEdit(base,scenes,words,{...d.editing,...revisionScope(project.data,d,edit)});
 assert.deepEqual(result.segments,edl.segments);assert.deepEqual(result.captionGroups,edl.captionGroups);assert.equal(result.captionColor,'yellow');assert.equal(result.hook,'Mira esto');
 const off=rebaseApprovedEdit(base,scenes,words,{settings:{captions:false}});assert.deepEqual(off.captionGroups,[]);
 const on=rebaseApprovedEdit({...base,edl:off},scenes,words,{settings:{captions:true}});assert.equal(on.captions,true);assert.ok(on.captionGroups.length);
});
test('trim changes one scene, reordering follows stable IDs, invalid requests fail closed',()=>{
 const edit=validateEdit({operation:'trim_scene',sceneId:ids[1],start:.1,end:3.7,crop:1.04,message:'Más rápido.'});
 const d=applyEdit(project,edit),result=rebaseApprovedEdit(base,scenes,words,{...d.editing,...revisionScope(project.data,d,edit)});
 assert.deepEqual(result.segments[0],edl.segments[0]);assert.deepEqual(result.segments[2],edl.segments[2]);assert.equal(result.segments[1].out,3.7);assert.equal(d.narrationAssetId,assetId);
 const reversed=[scenes[2],scenes[0],scenes[1]].map((s,i)=>({...s,source:`S0${i+1}`,start:i*3,end:i*3+3}));
 const moved=rebaseApprovedEdit(base,reversed,words,{scoped:true,changedSceneIds:[ids[2]]});assert.equal(moved.segments.length,3);
 assert.deepEqual(reviewNeighbors(scenes,[ids[1]]),ids);
 assert.throws(()=>normalizeEditing({baseRenderId:'bad'}),/INVALID/);
 assert.throws(()=>applyEdit(project,{...edit,end:100}),/INVALID/);
 assert.throws(()=>validateEdit({...edit,start:2,end:1}),/INVALID/);
 assert.throws(()=>rebaseApprovedEdit(base,[...scenes.slice(0,2),{...scenes[2],selectedVersionId:crypto.randomUUID()}],words,{scoped:true,changedSceneIds:[ids[1]]}),/UNSCOPED/);
});
test('voice replacement keeps a stable audio snapshot and only synthesizes the changed phrase once',async()=>{
 let data=applyEdit(project,validateEdit({operation:'edit_text',sceneId:ids[1],value:'Nuevo.',message:'Cambio.'}));
 assert.equal(data.narrationRevision.assetId,assetId);assert.equal(data.scenes[1].selectedVersionId,scenes[1].selectedVersionId);
 const p={...project,data},plan={scenes:data.scenes},steps=new Map();let calls=0,compositions=0;
 const once=async(key,stage,fn)=>{if(!steps.has(key))steps.set(key,await fn());return steps.get(key);};
 const providers={speech:async q=>{calls++;assert.equal(q.data.scriptDraft,'Nuevo.');return {assetId:crypto.randomUUID(),duration:2.5,alignment:alignment('Nuevo.',.1)};},composeSpeech:async({plan,parts})=>{compositions++;assert.equal(parts.filter(p=>p.reused).length,2);return {...revisionAudioPlan(plan,parts,originalAlignment),assetId:crypto.randomUUID()};}};
 const invoke=async()=>({alignment:originalAlignment});
 const result=await patchNarration(p,plan,providers,invoke,once,'job');assert.deepEqual(result.timeline.map(s=>[s.start,s.end]),[[0,3],[3,5.5],[5.5,8.5]]);
 assert.equal(result.alignment.characters.join('').replace(/\s+/g,' ').trim(),'Uno. Nuevo. Tres.');
 assert.deepEqual(await patchNarration(p,plan,providers,invoke,once,'job'),result);assert.equal(calls,1);assert.equal(compositions,1);assert.equal(paidStep(`narration-scene-${ids[1]}`),'narration');
 await assert.rejects(patchNarration(p,plan,providers,async()=>({}),async(k,s,fn)=>fn(),'other'),/PRODUCTION_NARRATION_BASE/);assert.equal(calls,1);
});
test('one voice phrase preserves other caption groups after changed word counts and timings',()=>{
 const originalWords=Array.from({length:9},(_,i)=>({text:'w'+i,start:Math.floor(i/3)*3+i%3*.3+.2,end:Math.floor(i/3)*3+i%3*.3+.4}));
 const original={...base,words:originalWords,edl:{...edl,captionGroups:[[0,0],[1,2],[3,5],[6,7],[8,8]]}};
 const changed=[originalWords[0],originalWords[1],originalWords[2],{text:'New.',start:3.2,end:3.7},...originalWords.slice(6).map(w=>({...w,start:w.start-.5,end:w.end-.5}))];
 const shorter=scenes.map((s,i)=>i===1?{...s,end:5.5}:i===2?{...s,start:5.5,end:8.5}:s);
 const output=rebaseApprovedEdit(original,shorter,changed,{scoped:true,changedSceneIds:[ids[1]]});
 assert.deepEqual(output.captionGroups,[[0,0],[1,2],[3,3],[4,5],[6,6]]);
 assert.deepEqual(output.segments[0],edl.segments[0]);assert.deepEqual(output.segments[2],edl.segments[2]);
});
test('production changes one spoken phrase without re-generating any images or existing clips',async()=>{
 const data=applyEdit(project,{operation:'edit_text',sceneId:ids[1],value:'Nuevo.'}),steps=new Map(),voice=crypto.randomUUID();
 data.editing={baseRenderId:base.id,scoped:true,changedSceneIds:[ids[1]]};
 let current={...project,data},rendered,spoken=0;
 const api=async(action,{data:d}={})=>{
  if(action==='begin_step')return steps.get(d.key)||{status:'started'};
  if(action==='finish_step'){steps.set(d.key,{status:'done',result:d.result});return {};}
  if(action==='narration_source')return {alignment:originalAlignment};
  if(action==='write'){
   if(d.action==='save_project'){current={...current,data:d.data};return {result:current};}
   if(d.action==='render'){rendered={id:crypto.randomUUID(),status:'succeeded'};return {result:rendered};}
   assert.fail('no clip/version writes expected');
  }
  if(action==='inspect')return {project:current,versions:[],renders:rendered?[rendered]:[]};
  if(action==='fail')assert.fail(d.code);return {};
 };
 const providers={speech:async p=>{spoken++;assert.equal(p.data.scriptDraft,'Nuevo.');return {assetId:crypto.randomUUID(),duration:2.5,alignment:alignment('Nuevo.',.1)};},composeSpeech:async({plan,parts})=>({...revisionAudioPlan(plan,parts,originalAlignment),assetId:voice}),image:()=>assert.fail('no new images'),clip:()=>assert.fail('no H3 calls'),reviewImage:()=>assert.fail('no unchanged still review'),reviewImages:()=>assert.fail('no unchanged still review'),review:async({renderId})=>({renderId,verdict:'pass',summary:'New voice and cuts verified.',issues:[]})};
 const result=await processProduction({id:crypto.randomUUID(),lease_token:crypto.randomUUID(),snapshot:current},api,providers,{pollMs:0});
 assert.equal(result.ok,true);assert.equal(spoken,1);assert.equal(current.data.narrationAssetId,voice);assert.equal(current.data.narrationRevision,undefined);
 assert.deepEqual(current.data.scenes.map(s=>s.selectedVersionId),scenes.map(s=>s.selectedVersionId));assert.deepEqual(current.data.scenes.map(s=>s.imageAssetId),scenes.map(s=>s.imageAssetId));
});
test('local export skips director planning/editor calls, preserves all other cuts, and reviews the actual file',async()=>{
 const root=await mkdtemp(join(tmpdir(),'partial-edit-'));try{
  const panel=join(root,'panel.jpg');await writeFile(panel,'fixture');let rendered,calls=[];
  const opts={root,project:{...project,data:{...project.data,editing:{baseRenderId:base.id,scoped:true,changedSceneIds:[],settings:{captionColor:'yellow'}}}},shots:[],words,narration:'fixture',base,
   prepare:async()=>({scenes,words,narration:'fixture',duration:9}),boards:()=>assert.fail('no re-analysis of unchanged source clips'),render:async args=>{rendered=args.edl;return {path:join(root,'final.mp4')};},evidence:async()=>({sha256:'a'.repeat(64),duration:9,sheets:[panel],duplicates:[],sampleTimes:[]}),call:async args=>{calls.push(args.name);assert.equal(args.name,'review_edit');return {verdict:'pass',summary:'Revisado.',issues:[],coverage:ids};}};
  const result=await finishSolLunaProject(opts);assert.equal(result.status,'succeeded');assert.deepEqual(calls,['review_edit']);assert.deepEqual(rendered.segments,edl.segments);assert.equal(rendered.captionColor,'yellow');assert.deepEqual(result.edl.words,words);
  opts.project.data.editing={baseRenderId:base.id,scoped:true,changedSceneIds:[ids[1]],sceneInstructions:{[ids[1]]:'Use faster movement.'}};
  let attempts=0;opts.call=async args=>{assert.equal(args.name,'edit_scene_ranges');attempts++;return {...edl,segments:edl.segments.map((s,i)=>({...s,out:i===0?3.4:s.out}))};};
  await assert.rejects(finishSolLunaProject(opts),/UNSCOPED/);assert.equal(attempts,2);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('real renderer reuses every encoded scene for a caption change, even after source paths change',{skip:!process.env.TEST_MEDIA},async()=>{
 const root=await mkdtemp(join(tmpdir(),'partial-edit-media-'));try{
  const src=join(root,'source.mp4'),voice=join(root,'voice.wav');
  await command('ffmpeg',['-v','error','-y','-f','lavfi','-i','testsrc2=size=320x180:rate=24:duration=4','-an','-c:v','libx264',src]);
  await command('ffmpeg',['-v','error','-y','-f','lavfi','-i','sine=frequency=440:duration=9','-c:a','pcm_s16le',voice]);
  const input={scenes:scenes.map(s=>({...s,path:src,sourceDuration:4})),words,narration:voice,duration:9,aspectRatio:'16:9',cacheDirectory:join(root,'cache'),edl};
  const a=await renderSimpleAd({...input,root:join(root,'first')});assert.equal(a.reuse.encoded,1);assert.equal(a.reuse.reused,2);
  const src2=join(root,'download-new-path.mp4');await copyFile(src,src2);
  const b=await renderSimpleAd({...input,scenes:input.scenes.map(s=>({...s,path:src2})),edl:{...edl,captionColor:'yellow'},root:join(root,'second')});
  assert.deepEqual(b.reuse,{reused:3,encoded:0});assert.equal(Number((await probe(b.path)).format.duration),9);
  const hash=async path=>createHash('sha256').update(await readFile(path)).digest('hex');
  assert.equal(await hash(join(root,'first','picture.mp4')),await hash(join(root,'second','picture.mp4')));assert.notEqual(await hash(a.path),await hash(b.path));
  const c=await renderSimpleAd({...input,edl:{...edl,segments:edl.segments.map((s,i)=>i===1?{...s,in:.1,out:3.7}:s)},root:join(root,'third')});assert.deepEqual(c.reuse,{reused:2,encoded:1});
 }finally{await rm(root,{recursive:true,force:true});}
});
test('real audio splice conserves unchanged parts and exports an aligned replacement',{skip:!process.env.TEST_MEDIA},async()=>{
 const root=await mkdtemp(join(tmpdir(),'partial-voice-media-'));try{
  const original=join(root,'old.wav'),replacement=join(root,'new.wav');
  for(const [path,duration,hz] of [[original,9,440],[replacement,2.5,880]])await command('ffmpeg',['-v','error','-y','-f','lavfi','-i',`sine=frequency=${hz}:duration=${duration}`,'-c:a','pcm_s16le',path]);
  const fresh=crypto.randomUUID(),plan={scenes:scenes.map((s,i)=>i===1?{...s,text:'Nuevo.'}:s)},parts=scenes.map((s,i)=>i===1?{assetId:fresh,sceneId:s.id,start:0,duration:2.5,alignment:alignment('Nuevo.',.1)}:{assetId,sceneId:s.id,start:s.start,duration:3,reused:true});
  let saved;
  const result=await composeNarration({project,plan,revision:{assetId},parts,invoke:async(action,data)=>action==='narration_source'?{alignment:originalAlignment}:{url:data.assetId===assetId?'https://fixture/old':'https://fixture/new'},fetchImpl:async url=>new Response(await readFile(url.endsWith('old')?original:replacement)),save:async(bytes,duration)=>{saved=join(root,'result.mp3');await writeFile(saved,bytes);assert.ok(Math.abs(duration-8.5)<.15);return {assetId:crypto.randomUUID()};}});
  assert.deepEqual(result.reusedScenes,[ids[0],ids[2]]);assert.deepEqual(result.generatedScenes,[ids[1]]);
  assert.ok(Math.abs(Number((await probe(saved)).format.duration)-8.5)<.15);
  for(const [at,hz] of [[1,440],[4,880],[7,440]]){
   const raw=await command('ffmpeg',['-v','error','-ss',String(at),'-i',saved,'-t','0.5','-af','astats=metadata=1:reset=0,ametadata=print:file=-','-f','null','-']);
   const rate=Number([...raw.matchAll(/Zero_crossings_rate=([\d.]+)/g)].at(-1)?.[1]);assert.ok(Math.abs(rate-hz*2/44100)<.004,`At ${at}s expected ${hz}Hz; crossing rate ${rate}`);
  }
 }finally{await rm(root,{recursive:true,force:true});}
});
