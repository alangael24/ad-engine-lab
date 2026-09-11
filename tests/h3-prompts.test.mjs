import test from 'node:test';
import assert from 'node:assert/strict';
import {CHAT_MODEL,applyEdit} from '../assets/chat-model.js';
import {projectData} from '../assets/studio-model.js';
import {sceneVideoContext,formatH3Prompt,writeH3Prompt,H3_FIRST_FRAME} from '../src/h3-prompts.js';
const description='[Shot 1] Live-action close-up of the chrome cylinder and circular showerhead in <Picture 1>. Fine water streams flow steadily as the camera pushes in slowly with small amplitude. Every product part remains fixed and the water continues through the final frame.';
const scene={id:crypto.randomUUID(),text:'Agua para tu ducha.',visual:'Complete cylinder and showerhead.',motion:'Water keeps flowing.',start:7,end:13,imageAssetId:crypto.randomUUID()};
const project={brand_snapshot:{name:'Nebula',appearance:'Tall chrome cylinder',productAssetId:crypto.randomUUID()},data:{videoContinuity:'Same blue bathroom.',creative:{format:'auto',look:'3d'},scenes:[{...scene,id:'previous',visual:'A comb'},scene,{...scene,id:'next',visual:'End card'}]}};
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
 const p=await writeH3Prompt(context,{PRODUCTION_WORKFLOW_PROFILE:'sol-luna-v1',REFERENCE_FLASH_KEY:'test-only'},{referenceUrl:'https://owned.test/frame.png',fetchImpl:async(url,opts)=>{request=JSON.parse(opts.body);return h3Response();}});
 assert.equal(request.model,CHAT_MODEL);assert.deepEqual(request.input[1].content[1],{type:'input_image',image_url:'https://owned.test/frame.png'});assert.match(request.input[0].content,/untrusted/);assert.match(p,/continues through the final frame/);
 for(const response of [()=>h3Response(undefined,'substituted-model'),()=>h3Response(undefined,CHAT_MODEL,'length'),()=>new Response('failed',{status:503})])await assert.rejects(()=>writeH3Prompt(context,{PRODUCTION_WORKFLOW_PROFILE:'sol-luna-v1',REFERENCE_FLASH_KEY:'test-only'},{referenceUrl:'https://owned.test/frame.png',fetchImpl:async()=>response()}),/H3_PROMPT_/);
 await assert.rejects(()=>writeH3Prompt(context,{}),/H3_PROMPT_OFFLINE/);
});
test('motion and global continuity survive saves; a chat direction change clears obsolete motion',()=>{
 const d=projectData({title:'Test',referenceUrl:'',referenceNotes:'',aspectRatio:'9:16',videoContinuity:'Same bathroom',scenes:[{...scene,start:0,end:6}]});assert.equal(d.scenes[0].motion,scene.motion);assert.equal(d.videoContinuity,'Same bathroom');
 const changed=applyEdit({data:d},{operation:'edit_scene',sceneId:scene.id,value:'Still water, static product',message:'Updated'});assert.equal(changed.scenes[0].motion,undefined);
});
