import {test} from 'node:test';
import assert from 'node:assert/strict';
import {H3Adapter,findVideo} from '../workers/h3-adapter.mjs';
import {processJob} from '../workers/h3-worker.mjs';
test('H3 builds verified turbo8 graph directly without a helper',async()=>{
  const h3=new H3Adapter('http://localhost:8188',{fetchImpl:async()=>{throw Error('unexpected network call');}});
  const {prompt:g}=await h3.build({prompt:'Mi producto gira en la mesa',durationSeconds:5,resolution:'720p',aspectRatio:'9:16'});
  assert.equal(g['104'].inputs.prompt,'Mi producto gira en la mesa');
  assert.deepEqual([g['104'].inputs.width,g['104'].inputs.height,g['104'].inputs.length],[736,1312,120]);
  assert.equal(g['9'].inputs.steps,8);assert.equal(g['17'].inputs.sampler_name,'euler');
  assert.equal(g['119'].inputs.lora_name,'minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors');
  assert.equal(g['23'],undefined);assert.equal(g['91'].inputs.audio,undefined);
});
test('H3 uploads reference and wires first frame; graphs do not leak across jobs',async()=>{
  let upload;
  const h3=new H3Adapter('http://localhost:8188',{fetchImpl:async(url,options)=>{
    if(url==='https://storage.test/reference')return new Response(new Uint8Array([137,80,78,71]),{headers:{'content-type':'image/png'}});
    assert.equal(url,'http://localhost:8188/upload/image');upload=options.body;
    return Response.json({name:'frame.png',subfolder:'test'});
  }});
  const job={prompt:'Animate the product gently',durationSeconds:10,resolution:'480p',aspectRatio:'16:9'};
  const {prompt:g}=await h3.build({...job,referenceUrl:'https://storage.test/reference'});
  assert.equal(upload.get('overwrite'),'false');assert.deepEqual(g['104'].inputs.first_frame,['200',0]);
  assert.equal(g['200'].inputs.image,'test/frame.png');assert.equal(g['104'].inputs.width,832);
  assert.equal((await h3.build(job)).prompt['200'],undefined);
  await assert.rejects(()=>h3.build({...job,durationSeconds:100}));
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
