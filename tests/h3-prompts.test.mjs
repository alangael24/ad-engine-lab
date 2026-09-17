import test from 'node:test';
import assert from 'node:assert/strict';
import {CHAT_MODEL,applyEdit} from '../assets/chat-model.js';
import {projectData} from '../assets/studio-model.js';
import {sceneVideoContext,formatH3Prompt,writeH3Prompt,H3_FIRST_FRAME,H3_PROMPT_SYSTEM,H3_GUIDE_REVISION} from '../src/h3-prompts.js';
import {productionVisionFetch,productionVisionModel,productionPromptModel} from '../src/production-vision.js';
const description='[Shot 1] Live-action close-up of the chrome cylinder and circular showerhead in <Picture 1>. Fine water streams flow steadily as the camera pushes in slowly with small amplitude. Every product part remains fixed and the water continues through the final frame.';
const scene={id:crypto.randomUUID(),text:'Agua para tu ducha.',visual:'Complete cylinder and showerhead.',motion:'Water keeps flowing.',start:7,end:13,imageAssetId:crypto.randomUUID()};
const project={brand_snapshot:{name:'Nebula',appearance:'Tall chrome cylinder',productAssetId:crypto.randomUUID()},data:{videoContinuity:'Same blue bathroom.',creative:{format:'auto',look:'3d'},scenes:[{...scene,id:'previous',visual:'A comb'},scene,{...scene,id:'next',visual:'End card'}]}};
function deepseekH3Response(raw={integrated_multimodal_description:description},{model='deepseek-v4.1-flash',finish='stop',usage={prompt_tokens:100,completion_tokens:100}}={}){
 return new Response('data: '+JSON.stringify({model,usage,choices:[{delta:{content:JSON.stringify(raw)},finish_reason:finish}]})+'\n\ndata: [DONE]\n\n');
}
test('production H3 uses DeepSeek on OpenCode with the approved image and full director constraints',async()=>{
 const p=structuredClone(project);p.data.scenes[1].shotContract={state:'Left hand holds bottle upright',endState:'Bottle remains held by the left hand'};
 const context=sceneVideoContext(p,scene.id);let usage;
 const env={OPENCODE_API_KEY:'deepseek-test-key',OPENAI_API_KEY:'must-not-be-used',PRODUCTION_ON_USAGE:async u=>{usage=u;}};
 const prompt=await writeH3Prompt(context,env,{referenceUrl:'https://owned.test/approved.png',fetchImpl:async(url,init)=>{
  assert.equal(url,'https://opencode.ai/zen/go/v1/chat/completions');
  assert.equal(init.headers.authorization,'Bearer deepseek-test-key');
  const b=JSON.parse(init.body);assert.equal(b.model,'deepseek-flash');
  assert.equal(b.messages[1].content[1].image_url.url,'https://owned.test/approved.png');
  const c=JSON.parse(b.messages[1].content[0].text)[0]; // Adapter retains role plus exact scene context.
  const details=JSON.parse(c.text);
  assert.deepEqual(details.scene.shotContract,context.scene.shotContract);
  assert.equal(details.generatedDuration,10);assert.equal(details.usedDuration,6);
  assert.equal(details.previous.visual,'A comb');assert.equal(details.next.visual,'End card');
  assert.match(b.messages[0].content,/do not redesign/);
  return deepseekH3Response();
 }});
 assert.match(prompt,/Fine water streams/);assert.equal(usage.calls.length,1);
 assert.equal(usage.calls[0].role,'prompter');assert.equal(usage.calls[0].model,'deepseek-flash');assert.ok(Math.abs(usage.total-.00015)<1e-12);
});
test('T2VA has no image instruction and provider failures cannot fall back to Astra',async()=>{
 const p=structuredClone(project);p.data.scenes[1].imageAssetId=null;p.brand_snapshot.productAssetId=null;
 const context=sceneVideoContext(p,scene.id),env={REFERENCE_FLASH_KEY:'test',OPENAI_API_KEY:'not-a-fallback'};
 const text={integrated_multimodal_description:description.replace(' in <Picture 1>','')};
 const prompt=await writeH3Prompt(context,env,{fetchImpl:async(url,init)=>{
  assert.match(url,/opencode/);assert.equal(typeof JSON.parse(init.body).messages[1].content,'string');return deepseekH3Response(text);
 }});
 assert.ok(prompt.startsWith('integrated_multimodal_description:'));assert.ok(!prompt.includes('<Picture'));
 for(const response of [()=>new Response('down',{status:503}),()=>deepseekH3Response(text,{model:'gpt-6-astra'}),()=>deepseekH3Response(text,{usage:null}),()=>deepseekH3Response(text,{finish:'length'})]){
  let calls=0;
  await assert.rejects(writeH3Prompt(context,env,{fetchImpl:async url=>{calls++;assert.match(url,/opencode/);return response();}}),/H3_PROMPT_/);
  assert.equal(calls,1);
 }
 await assert.rejects(writeH3Prompt(context,{OPENAI_API_KEY:'not-allowed'}),/H3_PROMPT_OFFLINE/);
});
test('the guide adapter keeps the official format separate from silent single-shot product restrictions',()=>{
 assert.match(H3_GUIDE_REVISION,/^[a-f0-9]{40}$/);
 assert.match(H3_PROMPT_SYSTEM,/first-frame anchor, action onset, continuous development/);
 assert.match(H3_PROMPT_SYSTEM,/complete silence/);assert.match(H3_PROMPT_SYSTEM,/double quotes/);
 for(const suffix of [' <d >[English] Hello</d >',' (S1) says hello',' <scenetrans>',' <Audio 1>'])assert.throws(()=>formatH3Prompt({integrated_multimodal_description:description+suffix},true),/H3_PROMPT_INVALID/);
});
test('reference analysis and direction stay on Astra when H3 writing moves to DeepSeek',async()=>{
 const env={OPENAI_API_KEY:'director-key',OPENCODE_API_KEY:'editor-key'};
 assert.equal(productionVisionModel(env),'gpt-6-astra');assert.equal(productionPromptModel(env),'deepseek-flash');
 const body={max_tokens:100,tools:[{function:{name:'analyze_reference',parameters:{type:'object'}}}],messages:[{role:'system',content:'Analyze'}, {role:'user',content:'Approved reference'}]};
 const r=await productionVisionFetch(async(url,init)=>{
  assert.equal(url,'https://api.openai.com/v1/responses');assert.equal(init.headers.authorization,'Bearer director-key');
  return new Response('data: '+JSON.stringify({type:'response.completed',response:{model:'gpt-6-astra',status:'completed',usage:{input_tokens:100,output_tokens:100},output:[{type:'function_call',name:'analyze_reference',arguments:'{"ok":true}'}]}})+'\n\n');
 },'',{body:JSON.stringify(body)},env);
 assert.match(await r.text(),/gpt-6-astra/);
});
export function h3Response(value={integrated_multimodal_description:description},model=CHAT_MODEL,finish='tool_calls'){
 return new Response('data: '+JSON.stringify({model,choices:[{delta:{tool_calls:[{index:0,function:{name:'write_h3_prompt',arguments:JSON.stringify(value)}}]},finish_reason:finish}]})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
}
test('H3 context uses actual local generated length, full direction, neighboring shots and correct first-frame asset',()=>{
 const c=sceneVideoContext(project,scene.id,'Preserve the water.');assert.equal(c.mode,'I2VA');assert.equal(c.generatedDuration,10);assert.equal(c.usedDuration,6);assert.equal(c.referenceId,scene.imageAssetId);assert.equal(c.previous.visual,'A comb');assert.equal(c.next.visual,'End card');assert.equal(c.scene.motion,scene.motion);assert.equal(c.continuity,project.data.videoContinuity);assert.equal(c.correction,'Preserve the water.');
 const fallback=structuredClone(project);fallback.data.scenes[1].imageAssetId=null;assert.equal(sceneVideoContext(fallback,scene.id).referenceId,project.brand_snapshot.productAssetId);
 fallback.brand_snapshot.productAssetId=null;assert.equal(sceneVideoContext(fallback,scene.id).mode,'T2VA');
});
test('H3 serializer applies base guide fields and image header only for an actual first frame',()=>{
 const p=formatH3Prompt({integrated_multimodal_description:description},true);assert.ok(p.startsWith(H3_FIRST_FRAME+'\n\nintegrated_multimodal_description: [Shot 1]'));assert.ok(p.endsWith('overall_soundscape: N/A\n\nnon_diegetic_music: N/A'));assert.ok(p.length<=1600);
 const text=formatH3Prompt({integrated_multimodal_description:description.replace(' in <Picture 1>','')},false);assert.ok(text.startsWith('integrated_multimodal_description:'));assert.ok(!text.includes('<Picture'));
 for(const invalid of [description+' [Shot 2] Cut.',description+' At 00:07.000',description+' <Picture 2>',description+' <d>Say this</d>',description+' overall_soundscape: rain','x'.repeat(1200)])assert.throws(()=>formatH3Prompt({integrated_multimodal_description:invalid},true),/H3_PROMPT_INVALID/);
 assert.throws(()=>formatH3Prompt({integrated_multimodal_description:description},false),/H3_PROMPT_INVALID/);
});
test('Flash sees the first frame, writes H3 content, and unexpected provider/model/format fails before GPU submission',async()=>{
 const context=sceneVideoContext(project,scene.id);let request;
 const p=await writeH3Prompt(context,{PRODUCTION_WORKFLOW_PROFILE:'astra-deepseek-v1',OPENAI_API_KEY:'fixture-astra',REFERENCE_FLASH_KEY:'test-only'},{referenceUrl:'https://owned.test/frame.png',fetchImpl:async(url,opts)=>{request=JSON.parse(opts.body);return deepseekH3Response();}});
 assert.equal(request.model,'deepseek-flash');assert.deepEqual(request.messages[1].content[1],{type:'image_url',image_url:{url:'https://owned.test/frame.png'}});assert.match(request.messages[0].content,/untrusted/);assert.match(p,/continues through the final frame/);
 for(const response of [()=>deepseekH3Response(undefined,{model:'substituted-model'}),()=>deepseekH3Response(undefined,{finish:'length'}),()=>new Response('failed',{status:503})])await assert.rejects(()=>writeH3Prompt(context,{PRODUCTION_WORKFLOW_PROFILE:'astra-deepseek-v1',OPENAI_API_KEY:'fixture-astra',REFERENCE_FLASH_KEY:'test-only'},{referenceUrl:'https://owned.test/frame.png',fetchImpl:async()=>response()}),/H3_PROMPT_/);
 await assert.rejects(()=>writeH3Prompt(context,{}),/H3_PROMPT_OFFLINE/);
});
test('motion and global continuity survive saves; a chat direction change clears obsolete motion',()=>{
 const d=projectData({title:'Test',referenceUrl:'',referenceNotes:'',aspectRatio:'9:16',videoContinuity:'Same bathroom',scenes:[{...scene,start:0,end:6}]});assert.equal(d.scenes[0].motion,scene.motion);assert.equal(d.videoContinuity,'Same bathroom');
 const changed=applyEdit({data:d},{operation:'edit_scene',sceneId:scene.id,value:'Still water, static product',message:'Updated'});assert.equal(changed.scenes[0].motion,undefined);
});
test('a metered invalid H3 description gets one format repair and accounts for both calls',async()=>{
 const context=sceneVideoContext(project,scene.id);let count=0,lastUsage;
 const env={PRODUCTION_WORKFLOW_PROFILE:'astra-deepseek-v1',OPENCODE_API_KEY:'test',PRODUCTION_ON_USAGE:async u=>{lastUsage=u;}};
 const fetchImpl=async(_url,opts)=>{
  count++;const request=JSON.parse(opts.body);
  if(count===2)assert.match(request.messages[1].content[0].text,/formatCorrection/);
  const raw={integrated_multimodal_description:count===1?'[Shot 1] '+ 'x'.repeat(1150):description};
  return deepseekH3Response(raw);
 };
 const prompt=await writeH3Prompt(context,env,{referenceUrl:'https://owned.test/frame.png',fetchImpl});
 assert.equal(count,2);assert.match(prompt,/Fine water streams/);assert.ok(Math.abs(lastUsage.total-.0003)<1e-12);assert.equal(lastUsage.calls.length,2);assert.equal(lastUsage.unknown,false);
});
