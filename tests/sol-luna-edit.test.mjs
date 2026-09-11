import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {validateSimpleEdit,simpleEditTimeline} from '../assets/simple-edit.js';
import {editorialCall,priceUsage} from '../workers/editorial-models.mjs';
import {finishSolLunaProject,validateEditorialReview} from '../workers/sol-luna-edit.mjs';
import {wordCaptions} from '../workers/simple-ad-renderer.mjs';
import {command,probe} from '../workers/studio-renderer.mjs';
import {reviewProduction} from '../workers/production-quality.mjs';
const scene={id:'one',source:'S01',number:1,start:0,end:2,frames:48,text:'Hello world.',visual:'A moving colored pattern.',motion:'Motion continues.'};
const words=[{text:'Hello',type:'word',start:.1,end:.7},{text:'world.',type:'word',start:.9,end:1.5}];
const edl={segments:[{source:'S01',in:0,out:2,frames:48,crop:1}],captions:true,captionGroups:[[0,1]],captionColor:'white',captionSize:46,hook:''};
const plan={direction:'Clear movement, readable words.',scenes:[{source:'S01',direction:'Keep the moving pattern.'}],captions:true,captionColor:'white',hook:''};
const pass={verdict:'pass',summary:'Revisado.',issues:[],coverage:['one']};
const env={PRODUCTION_WORKFLOW_PROFILE:'sol-luna-v1',OPENAI_API_KEY:'fixture-sol',REFERENCE_FLASH_KEY:'fixture-luna'};
test('picture EDL preserves exact scene duration and excludes overlapping footage',()=>{
 assert.deepEqual(validateSimpleEdit(edl,[scene],words),edl);
 assert.equal(simpleEditTimeline([scene],edl.segments)[0].end,2);
 for(const patch of [{frames:47},{in:1.8},{out:4},{crop:2},{source:'S02'}])assert.throws(()=>validateSimpleEdit({...edl,segments:[{...edl.segments[0],...patch}]},[scene],words));
 assert.throws(()=>validateSimpleEdit({...edl,segments:[{source:'S01',in:0,out:1,frames:24,crop:1},{source:'S01',in:.5,out:1.5,frames:24,crop:1}]},[scene],words),/REUSE/);
 assert.throws(()=>validateSimpleEdit({...edl,captionGroups:[[1,1]]},[scene],words),/COVERAGE/);
 assert.throws(()=>validateEditorialReview({...pass,coverage:[]},[scene]),/COVERAGE/);
});
test('caption rendering derives text from original words and does not execute ASS injection',()=>{
 const ass=wordCaptions({...edl,hook:'{\\pos(1,1)}hello'},words,720,1280);
 assert.match(ass,/Hello world\./);assert.doesNotMatch(ass,/\{\\pos\(1,1\)\}/);
 assert.doesNotMatch(wordCaptions({...edl,captions:false,hook:''},words,720,1280),/Dialogue:/);
});
test('Sol uses OpenAI, Luna uses OpenCode with no images; usage survives incomplete responses',async()=>{
 for(const role of ['director','editor']){
  const usage={total:0,calls:[],unknown:false};
  const result=await editorialCall({role,name:'test',schema:{type:'object'},system:'test',context:{},usage,env,fetchImpl:async(url,init)=>{
   assert.match(url,role==='director'?/^https:\/\/api.openai.com\//:/^https:\/\/opencode.ai\//);
   const b=JSON.parse(init.body);assert.equal(b.store,false);assert.equal(b.input[1].content.length,1);
   return new Response('data: '+JSON.stringify({type:'response.completed',response:{status:'completed',model:b.model,usage:{input_tokens:100,output_tokens:20,input_tokens_details:{cached_tokens:50}},output:[{type:'function_call',name:'test',arguments:'{"ok":true}'}]}})+'\n\n');
  }});
  assert.equal(result.ok,true);assert.ok(usage.total>0);assert.equal(usage.calls.length,1);
 }
 const usage={total:0,calls:[],unknown:false};
 await assert.rejects(editorialCall({role:'editor',name:'test',schema:{},system:'',context:{},usage,env,fetchImpl:async()=>new Response('data: '+JSON.stringify({type:'response.incomplete',response:{usage:{input_tokens:50,output_tokens:10}}})+'\n\n')}),/INCOMPLETE/);
 assert.ok(usage.total>0);assert.equal(usage.calls[0].status,'failed');
 await assert.rejects(editorialCall({role:'editor',name:'test',schema:{},system:'',context:{},images:['data:...'],usage,env}),/ROLE/);
 assert.ok(priceUsage('director',{input_tokens:100,output_tokens:10}).cost>priceUsage('editor',{input_tokens:100,output_tokens:10}).cost);
});
test('budget admission blocks before spending and missing usage cannot be counted as free',async()=>{
 const args={role:'director',name:'test',schema:{},system:'',context:{},usage:{total:1.99,calls:[],unknown:false},env,fetchImpl:()=>assert.fail('must not call')};
 await assert.rejects(editorialCall(args),/BUDGET/);
 args.usage={total:0,calls:[],unknown:false};args.fetchImpl=async()=>new Response('',{status:429});
 await assert.rejects(editorialCall(args),/UNAVAILABLE/);assert.equal(args.usage.unknown,true);
 args.fetchImpl=()=>assert.fail('no automatic second charge');await assert.rejects(editorialCall(args),/BUDGET/);
});
test('Sol directs, Luna edits, Sol reviews; one repair requires a changed EDL',async()=>{
 const root=await mkdtemp(join(tmpdir(),'sol-luna-test-'));try{
  const img=join(root,'panel.jpg');await writeFile(img,'fixture');const seen=[];let reviews=0;
  const options={root,project:{data:{scriptDraft:scene.text,scenes:[scene],aspectRatio:'9:16'}},shots:[],words,narration:'fixture',env,
   auditCaptions:async({review})=>review,prepare:async()=>({scenes:[scene],words,narration:'fixture',duration:2}),boards:async()=>['data:image/jpeg;base64,fixture'],render:async()=>({path:join(root,'final.mp4')}),evidence:async()=>({sha256:'a'.repeat(64),duration:2,sheets:[img],sampleTimes:[],duplicates:[]}),
   call:async a=>{seen.push(a.role+':'+a.name);if(a.name==='direct_edit')return plan;if(a.name==='edit_ad'){assert.equal(a.images,undefined);return {...edl,captionSize:reviews?44:46};}return ++reviews===1?{verdict:'blocked',summary:'Caption covers product.',coverage:['one'],issues:[{sceneId:'one',relatedSceneId:null,kind:'caption',at:1,evidence:'Caption covers the product; reduce size.',action:'none',visual:'',motion:''}]}:pass;}};
  const r=await finishSolLunaProject(options);assert.equal(r.status,'succeeded');assert.equal(r.review.verdict,'pass');assert.deepEqual(seen,['director:direct_edit','editor:edit_ad','director:review_edit','editor:edit_ad','director:review_edit']);
  reviews=0;options.call=async a=>a.name==='direct_edit'?plan:a.name==='edit_ad'?edl:{verdict:'blocked',summary:'Caption defect.',coverage:['one'],issues:[{sceneId:'one',relatedSceneId:null,kind:'caption',at:1,evidence:'Caption unreadable.',action:'none',visual:'',motion:''}]};
  await assert.rejects(finishSolLunaProject(options),/NO_CHANGE/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('real FFmpeg render preserves continuous audio and cached Sol review binds exact file hash',{skip:!process.env.TEST_MEDIA},async()=>{
 const root=await mkdtemp(join(tmpdir(),'simple-media-test-'));try{
  const src=join(root,'source.mp4'),audio=join(root,'voice.wav');
  await command('ffmpeg',['-v','error','-y','-f','lavfi','-i','testsrc2=size=320x180:rate=24:duration=2','-an','-c:v','libx264',src]);
  await command('ffmpeg',['-v','error','-y','-f','lavfi','-i','sine=frequency=440:duration=2','-c:a','pcm_s16le',audio]);
  const project={data:{scenes:[scene],scriptDraft:scene.text,aspectRatio:'16:9'}};
  const r=await finishSolLunaProject({root:join(root,'job'),project,shots:[{sceneId:scene.id,path:src}],narration:audio,words,env,call:async a=>a.name==='direct_edit'?plan:a.name==='edit_ad'?edl:pass});
  assert.equal(r.status,'succeeded');assert.equal(r.review.model,'gpt-5.6-sol');assert.equal(Number((await probe(r.path)).format.duration),2);
  const bytes=await readFile(r.path),manifest={scenes:[scene],editorial:{version:'sol-luna-v1',sha256:r.review.sha256,review:r.review,usage:r.usage}};
  const fetchImpl=async url=>{assert.equal(url,'https://fixture/media');return new Response(bytes);};
  const invoke=async()=>({url:'https://fixture/media',manifest,project});
  const review=await reviewProduction({renderId:'render-one',invoke,env,fetchImpl});assert.equal(review.renderId,'render-one');
  manifest.editorial.sha256='b'.repeat(64);await assert.rejects(reviewProduction({renderId:'render-one',invoke,env,fetchImpl}),/QUALITY_INVALID/);
 }finally{await rm(root,{recursive:true,force:true});}
});
