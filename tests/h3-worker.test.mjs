import {test} from 'node:test';
import assert from 'node:assert/strict';
import {H3Adapter,findVideo} from '../workers/h3-adapter.mjs';
import {processJob} from '../workers/h3-worker.mjs';
test('H3 helper uses existing turbo8 settings, unchanged prompt and optional image',async()=>{
  let form;
  const h3=new H3Adapter('http://localhost:8188',{fetchImpl:async(url,options)=>{
    assert.equal(url,'http://localhost:8188/h3-simple/build');form=options.body;return Response.json({workflow:{prompt:{node:{}}}});
  }});
  await h3.build({prompt:'Mi producto gira en la mesa',durationSeconds:5,resolution:'720p',aspectRatio:'9:16'});
  assert.equal(form.get('preset'),'turbo8');assert.equal(form.get('resolution'),'720');assert.equal(form.get('aspect'),'portrait');assert.equal(form.get('duration'),'5');assert.equal(form.get('prompt'),'Mi producto gira en la mesa');assert.equal(form.has('image'),false);
});
test('worker processes supplied clip and never invokes GPU again during a recovered submission',async()=>{
  let submitted=0;const calls=[];
  const adapter={build:async()=>({}),submit:async()=>{submitted++;return crypto.randomUUID();},findSubmission:async()=>crypto.randomUUID(),wait:async()=>new Blob(['mp4'],{type:'video/mp4'})};
  const api=async(action)=>{calls.push(action);return action==='upload'?{uploadUrl:'http://storage.test/result'}:{status:'succeeded'};};
  await processJob({id:crypto.randomUUID(),leaseToken:crypto.randomUUID(),submissionStarted:true},api,adapter,{fetchImpl:async()=>new Response('{}')});
  assert.equal(submitted,0);assert.ok(calls.includes('complete'));assert.ok(!calls.includes('fail'));
});
test('ambiguous submission is refunded rather than blindly rerun',async()=>{
  const calls=[];const api=async action=>{calls.push(action);return{};};
  await processJob({id:crypto.randomUUID(),leaseToken:crypto.randomUUID(),submissionStarted:true},api,{findSubmission:async()=>null});
  assert.ok(calls.includes('fail'));assert.ok(!calls.includes('complete'));
});
test('ComfyUI result discovery only accepts MP4 video outputs',()=>{
  assert.equal(findVideo({images:[{filename:'x.png'}]}),null);
  assert.equal(findVideo({node:{gifs:[{filename:'render.mp4'}]}}).filename,'render.mp4');
});
