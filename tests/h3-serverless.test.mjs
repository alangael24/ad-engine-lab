import {test} from 'node:test';
import assert from 'node:assert/strict';
import {H3ServerlessAdapter} from '../workers/h3-serverless-adapter.mjs';
import {processJob} from '../workers/h3-worker.mjs';
import {runJob,storageUrl} from '../workers/serverless/run-job.mjs';
import {PROVIDER_ID} from '../functions/api/worker.js';
const endpointId='exampleendpoint',job={id:crypto.randomUUID(),leaseToken:crypto.randomUUID(),prompt:'The shower water falls into a pool',durationSeconds:5,resolution:'480p',aspectRatio:'9:16'};
const origin='https://example.supabase.co',uploadUrl=origin+'/storage/v1/object/upload/sign/generation-results/test.mp4?token=test';
const result={jobId:job.id,uploaded:true,bytes:100,sha256:'a'.repeat(64)};
const make=fetchImpl=>new H3ServerlessAdapter({endpointId,apiKey:'test-only',fetchImpl});
test('scale-to-zero health does not submit paid work',async()=>{
 const urls=[];const a=make(async(url,opts)=>{urls.push(url);assert.equal(opts.method,undefined);return Response.json({workers:{idle:0,running:0}});});
 await a.ready();assert.deepEqual(urls,[`https://api.runpod.ai/v2/${endpointId}/health`]);
});
test('serverless stores provider ID and uploads directly without CPU video transfer',async()=>{
 const calls=[];let submitted=0;
 const a=make(async(url,opts)=>{
  if(url.endsWith('/run')){submitted++;const body=JSON.parse(opts.body);assert.equal(body.input.job.id,job.id);assert.equal(body.input.uploadUrl,uploadUrl);assert.equal(body.policy.executionTimeout,1200000);return Response.json({id:'abc-u1'});}
  assert.ok(url.endsWith('/status/abc-u1'));return Response.json({status:'COMPLETED',output:result,executionTime:1234,delayTime:200});
 });
 const api=async(action,body)=>{calls.push({action,body});return action==='upload'?{uploadUrl}:{};};
 await processJob(job,api,a,{fetchImpl:async()=>{throw Error('CPU must not download/upload video');}});
 assert.equal(submitted,1);assert.ok(calls.some(x=>x.body.providerPromptId===`rp:${endpointId}:abc-u1`));
 assert.equal(calls.at(-1).action,'complete');assert.ok(calls.findIndex(x=>x.action==='upload')<calls.findIndex(x=>x.body.submissionStarted));
});
test('restarted bridge resumes known Runpod job without another run',async()=>{
 const a=make(async url=>{assert.ok(url.includes('/status/'));return Response.json({status:'COMPLETED',output:result});});
 let complete=0;await processJob({...job,submissionStarted:true,providerPromptId:`rp:${endpointId}:abc-u1`},async action=>{if(action==='complete')complete++;return{};},a);
 assert.equal(complete,1);
});
test('lost submit response is not retried or completed',async()=>{
 let submitted=0;const actions=[];const a=make(async()=>{submitted++;throw Error('network interrupted');});
 await processJob(job,async action=>{actions.push(action);return {uploadUrl};},a);
 assert.equal(submitted,1);assert.equal(actions.at(-1),'fail');assert.ok(!actions.includes('complete'));
});
test('timed out or wrong-job output is cancelled and never completed',async()=>{
 for(const status of [{status:'TIMED_OUT'},{status:'COMPLETED',output:{...result,jobId:crypto.randomUUID()}}]){
  const urls=[],actions=[];const a=make(async url=>{urls.push(url);return Response.json(status);});
  await processJob({...job,providerPromptId:`rp:${endpointId}:abc-u1`},async action=>{actions.push(action);return{};},a);
  assert.ok(urls.some(url=>url.includes('/cancel/')));assert.equal(actions.at(-1),'fail');assert.ok(!actions.includes('complete'));
 }
});
test('provider ID supports queue IDs but rejects URLs and cross-endpoint recovery',()=>{
 assert.ok(PROVIDER_ID.test(`rp:${endpointId}:abc-u1`));assert.ok(PROVIDER_ID.test(crypto.randomUUID()));
 for(const value of ['https://evil.test/steal','rp:exampleendpoint:../../secret','rp:x:abc','abc'])assert.equal(PROVIDER_ID.test(value),false);
 assert.throws(()=>make(()=>{}).jobId('rp:otherendpoint:abc-u1'));
});
test('GPU accepts only signed URLs from configured storage',()=>{
 assert.equal(storageUrl(uploadUrl,origin,true),uploadUrl);
 for(const value of ['http://169.254.169.254/latest','https://other.supabase.co/storage/v1/object/sign/a','https://example.supabase.co/rest/v1/users',origin+'/storage/v1/object/upload/sign/../../secrets'])assert.throws(()=>storageUrl(value,origin));
});
test('upload retry reuses rendered bytes, and arbitrary workflows are not executed',async()=>{
 let rendered=0,uploaded=0;const adapter={build:async x=>{assert.equal(x.prompt,job.prompt);return{};},findSubmission:async()=>null,submit:async()=>{rendered++;return 'local-prompt';},wait:async()=>new Blob(['1234ftyp1234'])};
 const out=await runJob({job,uploadUrl,workflow:{evil:true}},{adapter,env:{H3_STORAGE_ORIGIN:origin},fetchImpl:async()=>{if(++uploaded===1)throw Error('network');return new Response();}});
 assert.equal(rendered,1);assert.equal(uploaded,2);assert.equal(out.uploaded,true);assert.equal(out.bytes,12);
 await assert.rejects(()=>runJob({job},{adapter,env:{}}),/UPLOAD_REQUIRED/);
});
