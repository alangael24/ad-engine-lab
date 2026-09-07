import test from 'node:test';
import assert from 'node:assert/strict';
import {remember,creativeContext,normalizeCreativeMemory} from '../assets/creative-context.js';
import {projectData} from '../assets/studio-model.js';
import {sceneVideoContext} from '../src/h3-prompts.js';
import {editFingerprint,verifyNarrationCoverage} from '../workers/video-use/agent.mjs';

test('shared direction, preferences and rejections survive serialization and reach motion planning',()=>{
 const scene={id:crypto.randomUUID(),text:'Hello',visual:'Skeleton in shower',motion:'Turn',start:0,end:3,imageAssetId:crypto.randomUUID(),selectedVersionId:null};
 const p=remember({brand_snapshot:{product:'Shower'},data:{title:'Test',referenceUrl:'',referenceNotes:'',aspectRatio:'9:16',scenes:[scene],videoContinuity:'Large expressive eyes',creativeMemory:{preferences:['Warm lighting']}}},{rejection:'No hollow black eyes',decision:'Use installed shower',approvedAssets:[scene.imageAssetId]});
 p.data=projectData(p.data);
 assert.deepEqual(creativeContext(p).rejections,['No hollow black eyes']);
 assert.equal(sceneVideoContext(p,scene.id).projectMemory.direction,'Large expressive eyes');
 assert.deepEqual(sceneVideoContext(p,scene.id).projectMemory.preferences,['Warm lighting']);
 assert.throws(()=>normalizeCreativeMemory(null),/STUDIO_INVALID/);
});
test('render fingerprint ignores commentary but detects actual cuts, captions and overlay-byte changes',async()=>{
 const edl={ranges:[{source:'S01',start:0,end:2}],grade:'none',overlays:[{file:'effect.mov',start_in_output:0,duration:1}]};
 const read=async()=>Buffer.from('version1'),hash=await editFingerprint(edl,read);
 assert.equal(await editFingerprint({...edl,ranges:edl.ranges.map(r=>({...r,note:'Fixed!',beat:'more exciting'}))},read),hash);
 assert.equal(await editFingerprint({...edl,quality_notes:'Now fixed!',total_duration_s:2},read),hash);
 assert.notEqual(await editFingerprint({...edl,grade:'eq=saturation=0'},read),hash);
 assert.notEqual(await editFingerprint(edl,async()=>Buffer.from('version2')),hash);
 assert.notEqual(await editFingerprint({...edl,subtitles:'master.srt'},read),hash);
});
test('flexible edit can trim silence but cannot drop, duplicate or reorder approved words',()=>{
 const transcripts={S01:{words:[{type:'word',text:'Hello',start:.3,end:.7},{type:'word',text:'world.',start:2,end:2.4}]}};
 const edl={ranges:[{source:'S01',start:.2,end:.8},{source:'S01',start:1.9,end:2.5}]};
 assert.equal(verifyNarrationCoverage(edl,transcripts,'Hello world.'),true);
 for(const ranges of [[edl.ranges[0]],[...edl.ranges].reverse(),[...edl.ranges,edl.ranges[1]]])assert.throws(()=>verifyNarrationCoverage({ranges},transcripts,'Hello world.'),/approved narration/);
});

test('creative finishing supplies actual shots, reference and cached voice timing without calling a media API', {skip:!process.env.VIDEO_USE_PYTHON},async()=>{
 const {mkdtemp,mkdir,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path');
 const {processCommand}=await import('../workers/video-use/sandbox.mjs'),{finishCreativeProject}=await import('../workers/creative-edit.mjs');
 const root=await mkdtemp(join(tmpdir(),'creative-finish-'));
 try{
  const path=join(root,'raw.mp4');await processCommand('ffmpeg',['-v','error','-y','-f','lavfi','-i','testsrc2=size=320x180:rate=24:duration=2','-f','lavfi','-i','sine=frequency=440:duration=2','-c:v','libx264','-c:a','aac','-shortest',path]);
  const still=crypto.randomUUID(),id=crypto.randomUUID(),project={brand_snapshot:{product:'Fixture'},data:{scriptDraft:'Hello world.',referenceUrl:'https://reference.test',videoContinuity:'Expressive eyes',creativeMemory:{approvedAssets:[still],rejections:['No black hollow eyes']},scenes:[{id,imageAssetId:still,start:0,end:2,text:'Hello world.',visual:'A wave',motion:'Raise hand'}]}};
  let called=false;
  const result=await finishCreativeProject({root:join(root,'job'),project,shots:[{sceneId:id,path}],narration:path,words:[{type:'word',text:'Hello',start:.3,end:.6},{type:'word',text:'world.',start:1,end:1.4}],reference:{path},strategy:'Preserve the script and trim silence.',sandboxOptions:{python:process.env.VIDEO_USE_PYTHON},fetchImpl:async()=>{throw Error('No provider calls allowed');},run:async input=>{
   called=true;assert.equal(input.mode,'edit');assert.equal(input.approvedScript,project.data.scriptDraft);assert.equal(input.sources.S99.reference,true);assert.equal(input.sources.S01.sceneId,id);assert.deepEqual(input.memory.rejections,['No black hollow eyes']);assert.equal(input.transcripts.S01.words[0].start,.3);
   return {status:'succeeded',edl:{ranges:[{source:'S01',start:.2,end:1.5}]},usage:{calls:0}};
  }});
  assert.ok(called);assert.equal(result.status,'succeeded');
 }finally{await rm(root,{recursive:true,force:true});}
});
