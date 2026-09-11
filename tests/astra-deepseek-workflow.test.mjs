import {imageCost} from '../src/media-cost.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {productionWorkflow,editorialReviewModelMatches} from '../assets/production-workflow.js';
import {editorialCall,priceUsage} from '../workers/editorial-models.mjs';
import {validateSimpleEdit} from '../assets/simple-edit.js';
import {wordCaptions} from '../workers/simple-ad-renderer.mjs';
import {captionAuditSamples,verifyCaptionFindings,captionEvidence} from '../workers/caption-review.mjs';
import {checkGpuIdle} from '../workers/gpu-idle-worker.mjs';
import {finishSolLunaProject} from '../workers/sol-luna-edit.mjs';
import {command,probe} from '../workers/studio-renderer.mjs';
import {reviewProduction} from '../workers/production-quality.mjs';
const env={OPENAI_API_KEY:'fixture-astra',OPENCODE_API_KEY:'fixture-deepseek'};
const usage=()=>({total:0,calls:[],unknown:false});
const sse=x=>new Response('data: '+JSON.stringify(x)+'\n\ndata: [DONE]\n\n');
function response(body,raw,finish='stop'){
 if(body.model==='deepseek-flash')return sse({model:'deepseek-v4.1-flash',choices:[{delta:{content:JSON.stringify(raw)},finish_reason:finish}],usage:{prompt_tokens:100,completion_tokens:200,prompt_cache_hit_tokens:50}});
 return sse({type:'response.completed',response:{status:'completed',model:body.model,usage:{input_tokens:100,output_tokens:200,input_tokens_details:{cached_tokens:20,cache_write_tokens:10}},output:[{type:'function_call',name:body.tools[0].name,arguments:JSON.stringify(raw)}]}});
}
const scene={id:'one',source:'S01',start:0,end:2,frames:48,text:'Hola mundo.',visual:'Moving pattern.',motion:'Keeps moving.'};
const words=[{text:'Hola',start:.1,end:.7},{text:'mundo.',start:.9,end:1.5}];
const edl={segments:[{source:'S01',in:0,out:2,frames:48,crop:1}],captions:true,captionGroups:[[0,1]],captionColor:'yellow',captionSize:46,hook:'',captionFadeMs:0,captionHighlight:true,sourceCaptionScenes:[]};
const pass={verdict:'pass',summary:'Sin defectos materiales.',issues:[],coverage:['one']};
const caption={sceneId:'one',relatedSceneId:null,kind:'caption',at:1,evidence:'Missing phrase.',action:'none',visual:'',motion:''};
test('new workflow uses Astra for vision and DeepSeek text-only; legacy model pairs remain explicit',()=>{
 assert.equal(productionWorkflow().director,'gpt-6-astra');assert.equal(productionWorkflow().editor,'deepseek-flash');
 assert.equal(productionWorkflow({PRODUCTION_WORKFLOW_PROFILE:'sol-luna-v1'}).editor,'gpt-5.6-luna');
 assert.equal(editorialReviewModelMatches({workflowProfile:'astra-deepseek-v1',model:'gpt-6-astra'}),true);
 assert.equal(editorialReviewModelMatches({workflowProfile:'astra-deepseek-v1',model:'gpt-5.6-sol'}),false);
 assert.equal(editorialReviewModelMatches({model:'gpt-5.6-sol'}),true);
});
test('DeepSeek truncation gets one metered 16k retry; reasoning is low and tools/images stay absent',async()=>{
 const u=usage(),bodies=[];
 const r=await editorialCall({role:'editor',name:'edit',schema:{type:'object'},system:'Follow direction.',context:{},usage:u,env,fetchImpl:async(url,init)=>{
  assert.equal(url,'https://opencode.ai/zen/go/v1/chat/completions');assert.equal(init.headers.authorization,'Bearer fixture-deepseek');
  const b=JSON.parse(init.body);bodies.push(b);assert.equal(b.reasoning_effort,'low');assert.equal(b.tools,undefined);assert.equal(b.messages[1].content,'{}');
  return response(b,{ok:true},bodies.length===1?'length':'stop');
 }});
 assert.equal(r.ok,true);assert.deepEqual(bodies.map(b=>b.max_tokens),[12000,16000]);assert.equal(u.calls[0].status,'failed');assert.equal(u.calls[1].status,'completed');assert.equal(u.total,u.calls.reduce((n,x)=>n+x.cost,0));assert.equal(u.unknown,false);
});
test('unknown provider outcome never retries or becomes zero dollars',async()=>{
 const u=usage(),saved=[];let n=0;
 await assert.rejects(editorialCall({role:'editor',name:'edit',schema:{},system:'',context:{},usage:u,env,onUsage:async snapshot=>saved.push(snapshot),fetchImpl:async()=>{assert.equal(saved[0].calls[0].status,'started');n++;throw Error('network');}}));
 assert.equal(saved.at(-1).unknown,true);
 assert.equal(n,1);assert.equal(u.unknown,true);assert.equal(u.calls[0].cost,undefined);assert.ok(u.calls[0].reserved>0);
 await assert.rejects(editorialCall({role:'editor',name:'edit',schema:{},system:'',context:{},usage:u,env,fetchImpl:()=>assert.fail()}),/BUDGET/);
});
test('Astra preserves vision, low reasoning, standard cache-write accounting and request identity',async()=>{
 const u=usage();await editorialCall({role:'director',name:'review',schema:{type:'object'},system:'Observe.',context:{},images:['data:image/jpeg;base64,AA=='],usage:u,env,fetchImpl:async(url,init)=>{
  assert.equal(url,'https://api.openai.com/v1/responses');assert.equal(init.headers.authorization,'Bearer fixture-astra');const b=JSON.parse(init.body);assert.equal(b.model,'gpt-6-astra');assert.equal(b.reasoning.effort,'low');assert.equal(b.input[1].content[1].type,'input_image');return response(b,{ok:true});
 }});
 assert.equal(u.calls[0].writes,10);assert.equal(u.total,(70*10+20+10*12.5+200*50)/1e6);
 await assert.rejects(editorialCall({role:'editor',name:'edit',schema:{},system:'',context:{},images:['data:image/jpeg;base64,AA=='],usage:usage(),env}),/ROLE/);
});
test('timing tolerance permits floating-point noise but still rejects material overspeed',()=>{
 assert.doesNotThrow(()=>validateSimpleEdit({...edl,segments:[{...edl.segments[0],out:1.5-1e-12}]},[scene],words));
 assert.throws(()=>validateSimpleEdit({...edl,segments:[{...edl.segments[0],out:1.49}]},[scene],words),/SPEED/);
});
test('source captions avoid duplicate layers; boundaries and arbitrary IDs cannot bypass coverage',()=>{
 const source={...edl,sourceCaptionScenes:['S01']};assert.doesNotThrow(()=>validateSimpleEdit(source,[scene],words));
 assert.doesNotMatch(wordCaptions(source,words,720,1280,[scene]),/Dialogue:/);
 assert.match(wordCaptions(edl,words,720,1280,[scene]),/\\k/);assert.doesNotMatch(wordCaptions(edl,words,720,1280,[scene]),/\\fad/);
 assert.throws(()=>validateSimpleEdit({...edl,sourceCaptionScenes:['S99']},[scene],words));
 const second={...scene,id:'two',source:'S02',start:2,end:4};
 assert.throws(()=>validateSimpleEdit({...source,segments:[...edl.segments,{...edl.segments[0],source:'S02'}]},[scene,second],[words[0],{...words[1],end:2.2}]),/BOUNDARY/);
});
test('caption audit samples interior exact frames and cannot waive a product defect',async()=>{
 const samples=captionAuditSamples(edl,words,[scene],['one']);assert.ok(samples[0].frames.every(n=>n/24>.1&&n/24<1.5));
 const root=await mkdtemp(join(tmpdir(),'caption-audit-test-'));try{
  const product={...caption,kind:'product',action:'replace_image',visual:'Fix visible wrong shape.',motion:'Preserve contact.'};
  const r=await verifyCaptionFindings({review:{...pass,verdict:'blocked',issues:[caption,product]},path:'fixture',edl,scenes:[scene],words,root,call:async()=>pass,usage:usage(),env,makeEvidence:async()=>[]});
  assert.equal(r.verdict,'repair');assert.deepEqual(r.issues,[product]);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('exclusive idle pod is deleted and absence must be verified, with no startup calls',async()=>{
 const gpu={GPU_IDLE_ENABLED:'true',GPU_MANAGED_EXCLUSIVE:'true',GPU_MANAGED_POD_ID:'pod1',RUNPOD_API_KEY:'fixture',PRODUCTION_WORKER_TOKEN:'x'.repeat(40),CREATIVE_RUSH_URL:'https://app.test'};
 for(const absent of [true,false]){
  const seen=[];let deleted=false;
  const result=await checkGpuIdle(gpu,{fetchImpl:async(url,o)=>{seen.push(o.method);if(url.endsWith('/gpu-idle'))return Response.json({stop:true});if(o.method==='DELETE'){deleted=true;return new Response(null,{status:204});}if(deleted&&absent)return new Response(null,{status:404});return Response.json({id:'pod1',desiredStatus:'RUNNING'});}});
  assert.equal(result.verifiedAbsent,absent);assert.deepEqual(seen,['GET','POST','DELETE','GET']);
 }
});
test('real render runs Astra → DeepSeek → Astra and reuses only the matching hash-bound review',{skip:!process.env.TEST_MEDIA},async()=>{
 const root=await mkdtemp(join(tmpdir(),'astra-deepseek-media-'));try{
  const src=join(root,'src.mp4'),audio=join(root,'voice.wav');await command('ffmpeg',['-v','error','-y','-f','lavfi','-i','testsrc2=size=320x180:rate=24:duration=2','-an','-c:v','libx264',src]);await command('ffmpeg',['-v','error','-y','-f','lavfi','-i','sine=frequency=440:duration=2','-c:a','pcm_s16le',audio]);
  const project={data:{scenes:[scene],scriptDraft:'Hola mundo.',aspectRatio:'16:9'}},models=[];
  const fetchImpl=async(url,init)=>{const b=JSON.parse(init.body);models.push(b.model);return response(b,b.model==='deepseek-flash'?edl:b.tools[0].name==='direct_edit'?{direction:'Keep movement.',scenes:[{source:'S01',direction:'Continuous action.'}],captions:true,captionColor:'yellow',hook:''}:pass);};
  const r=await finishSolLunaProject({root:join(root,'job'),project,shots:[{sceneId:'one',path:src}],narration:audio,words,env,fetchImpl});assert.equal(r.status,'succeeded');assert.deepEqual(models,['gpt-6-astra','deepseek-flash','gpt-6-astra']);assert.equal(r.review.workflowProfile,'astra-deepseek-v1');assert.equal(Number((await probe(r.path)).format.duration),2);assert.ok(r.usage.total>0);
  const panels=await captionEvidence(r.path,captionAuditSamples(edl,words,[scene],['one']),join(root,'exact-caption-frames'));assert.equal(panels.length,1);assert.match(panels[0],/^data:image\/jpeg;base64,/);
  const manifest={scenes:[scene],editorial:{version:'sol-luna-v1',sha256:r.review.sha256,review:r.review,usage:r.usage}},bytes=await readFile(r.path);
  const cached=await reviewProduction({renderId:'test',invoke:async()=>({url:'https://fixture/video',manifest,project}),env,fetchImpl:async()=>new Response(bytes)});assert.equal(cached.model,'gpt-6-astra');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('image usage cost includes reference inputs and cannot treat missing usage as free',()=>{assert.equal(imageCost('gpt-image-2',{input_tokens_details:{text_tokens:205,image_tokens:4104},output_tokens:1372}).costUsd,.075017);assert.equal(imageCost('gpt-image-2',{}).costUsd,null);});
test('production H3 prompt writer uses Astra vision and its actual first frame through the shared adapter',async()=>{
 const {writeH3Prompt}=await import('../src/h3-prompts.js');
 let request;
 const prompt=await writeH3Prompt({referenceId:'owned-image',usedDuration:3,generatedDuration:5},env,{referenceUrl:'https://owned.test/frame.png',fetchImpl:async(url,init)=>{
  request=JSON.parse(init.body);assert.equal(url,'https://api.openai.com/v1/responses');assert.equal(request.model,'gpt-6-astra');assert.equal(request.input[1].content[1].image_url,'https://owned.test/frame.png');
  return response(request,{integrated_multimodal_description:'[Shot 1] Polished 3D character gently turns the shallow disc at chest height, maintaining hand contact and the exact original product shape throughout the continuous shot.'});
 }});assert.match(prompt,/overall_soundscape: N\/A/);assert.match(prompt,/Polished 3D/);
});
