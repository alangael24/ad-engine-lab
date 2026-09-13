import {test} from 'node:test';
import assert from 'node:assert/strict';
import {processJob,claimReadyJob,workerInstanceId} from '../workers/h3-worker.mjs';
import {H3ServerlessAdapter} from '../workers/h3-serverless-adapter.mjs';
import {H3_LIMITS} from '../src/h3-lifecycle.js';
import {virtualClock} from './helpers/virtual-clock.mjs';
const minute=60_000,endpointId='exampleendpoint',providerId=`rp:${endpointId}:test-u1`;
function harness(){
  const clock=virtualClock(),began=clock.now();
  const job={id:crypto.randomUUID(),leaseToken:crypto.randomUUID(),prompt:'The dog settles into its soft bed',durationSeconds:5,resolution:'480p',aspectRatio:'9:16',providerClaimedAt:new Date(began).toISOString(),providerDeadlineAt:new Date(began+H3_LIMITS.providerTtlMs+H3_LIMITS.reconciliationMs).toISOString()};
  const calls=[],requests=[];
  const state={file:false,status:'running',refunds:0,submits:0,cancels:0,provider:'IN_QUEUE',maxWorkers:1};
  const output={jobId:job.id,uploaded:true,bytes:100,sha256:'a'.repeat(64)};
  const h={clock,began,job,state,calls,requests,output};
  h.api=async(action,body={})=>{
    calls.push({action,body,at:clock.now()});
    if(action==='heartbeat'){
      if(body.submissionStarted){assert.ok(!job.submissionStarted);job.submissionStarted=true;job.providerSubmittedAt=new Date(clock.now()).toISOString();}
      if(body.providerPromptId)job.providerPromptId=body.providerPromptId;
    }
    if(action==='progress'){
      job.providerPhase=body.phase;
      if(body.phase==='generating')job.providerStartedAt??=new Date(clock.now()).toISOString();
    }
    if(action==='trip'){job.providerShutdownRequired=true;job.providerPhase='reconciling';}
    if(action==='recover'){
      if(state.file)state.status='succeeded';
      return {ready:state.file};
    }
    if(action==='complete'){assert.ok(state.file,'storage must contain the clip');state.status='succeeded';}
    if(action==='fail'){if(state.status==='running'){state.status='failed';state.refunds++;}}
    return action==='upload'?{uploadUrl:'https://test.supabase.co/storage/v1/object/upload/sign/generation-results/test.mp4?token=test'}:{};
  };
  h.fetch=async(url,options)=>{
    requests.push(url);
    if(url.startsWith('https://api.runpod.io/')){
      if(options?.method==='PATCH'){assert.deepEqual(JSON.parse(options.body),{workers:{min:0,max:0}});state.maxWorkers=0;}
      return Response.json(url.endsWith('/workers')?{summary:{total:0},workers:[]}:{workers:{min:0,max:state.maxWorkers}});
    }
    if(url.endsWith('/health'))return Response.json({jobs:{inQueue:0,inProgress:0}});
    if(url.endsWith('/run')){state.submits++;return Response.json({id:'test-u1'});}
    if(url.includes('/cancel/')){state.cancels++;state.provider='CANCELLED';return Response.json({status:'CANCELLED'});}
    if(url.includes('/status/'))return Response.json({status:state.provider,...(state.provider==='COMPLETED'?{output}:{} )});
    throw Error('Unexpected simulated request '+url);
  };
  h.adapter=()=>new H3ServerlessAdapter({endpointId,apiKey:'fake-local-only',controlApiKey:'fake-local-control',clock,fetchImpl:(...args)=>h.fetch(...args)});
  h.run=(api=h.api)=>processJob({...job},api,h.adapter(),{clock});
  h.elapsed=()=>clock.now()-began;
  return h;
}
test('35-minute cold start, then 12-minute execution, completes with one paid submission',async()=>{
  const h=harness(),fetch=h.fetch;
  h.fetch=async(url,opts)=>{
    if(url.includes('/status/')){
      h.state.provider=h.elapsed()<35*minute?'IN_QUEUE':h.elapsed()<47*minute?'IN_PROGRESS':'COMPLETED';
      if(h.state.provider==='COMPLETED')h.state.file=true;
    }
    return fetch(url,opts);
  };
  assert.equal((await h.run()).status,'succeeded');
  assert.equal(h.state.submits,1);assert.equal(h.state.cancels,0);assert.equal(h.state.refunds,0);
  assert.equal(Date.parse(h.job.providerStartedAt)-h.began,35*minute);
  assert.ok(h.calls.filter(x=>x.action==='heartbeat').length>100);
  assert.equal(h.clock.timerCount,0);
});
test('a short disconnection retries status, never generation',async()=>{
  const h=harness(),fetch=h.fetch;
  h.fetch=async(url,opts)=>{
    if(url.includes('/status/')){
      if(h.elapsed()<minute)throw Error('connection lost');
      h.state.provider='COMPLETED';h.state.file=true;
    }
    return fetch(url,opts);
  };
  assert.equal((await h.run()).status,'succeeded');assert.equal(h.state.submits,1);assert.equal(h.state.cancels,0);
});
test('long disconnection defers; a restarted worker resumes the same provider ID and clocks',async()=>{
  const h=harness(),fetch=h.fetch;
  h.fetch=async(url,opts)=>{if(url.includes('/status/'))throw Error('provider offline');return fetch(url,opts);};
  assert.equal((await h.run()).status,'deferred');
  const submitted=h.job.providerSubmittedAt,deadline=h.job.providerDeadlineAt;
  assert.equal(h.job.providerPromptId,providerId);assert.equal(h.state.cancels,0);assert.equal(h.state.refunds,0);
  h.fetch=async(url,opts)=>{if(url.includes('/status/')){h.state.provider='COMPLETED';h.state.file=true;}return fetch(url,opts);};
  assert.equal((await h.run()).status,'succeeded');assert.equal(h.state.submits,1);
  assert.equal(h.job.providerSubmittedAt,submitted);assert.equal(h.job.providerDeadlineAt,deadline);
});
test('lost submit acknowledgement recovers private output without a second POST /run',async()=>{
  const h=harness(),fetch=h.fetch;
  h.fetch=async(url,opts)=>{const response=await fetch(url,opts);if(url.endsWith('/run'))throw Error('accepted, response lost');return response;};
  assert.equal((await h.run()).reason,'AMBIGUOUS_SUBMISSION');assert.equal(h.state.refunds,0);assert.equal(h.job.providerPromptId,undefined);
  await h.clock.sleep(36*minute);h.state.file=true;
  assert.equal((await h.run()).recovered,true);assert.equal(h.state.submits,1);assert.equal(h.state.refunds,0);
});
test('unknown acknowledgement without output waits until absolute TTL plus grace, then refunds once',async()=>{
  const h=harness(),fetch=h.fetch;
  h.fetch=async(url,opts)=>{const r=await fetch(url,opts);if(url.endsWith('/run'))throw Error('ack lost');return r;};
  assert.equal((await h.run()).status,'deferred');
  await h.clock.sleep(71*minute);assert.equal((await h.run()).status,'deferred');assert.equal(h.state.refunds,0);
  await h.clock.sleep(minute);assert.equal((await h.run()).status,'failed');
  assert.equal(h.state.submits,1);assert.equal(h.state.refunds,1);
});
test('lost immutable provider checkpoint acknowledgement is retried, not the generation',async()=>{
  const h=harness(),api=h.api,fetch=h.fetch;let checkpoints=0;
  h.fetch=async(url,opts)=>{if(url.includes('/status/')){h.state.provider='COMPLETED';h.state.file=true;}return fetch(url,opts);};
  assert.equal((await h.run(async(action,body)=>{const r=await api(action,body);if(body.providerPromptId&&++checkpoints===1)throw Error('checkpoint ack lost');return r;})).status,'succeeded');
  assert.equal(checkpoints,2);assert.equal(h.state.submits,1);assert.equal(h.state.cancels,0);
});
test('storage output survives a lost completion response',async()=>{
  const h=harness(),api=h.api,fetch=h.fetch;
  h.fetch=async(url,opts)=>{if(url.includes('/status/')){h.state.provider='COMPLETED';h.state.file=true;}return fetch(url,opts);};
  assert.equal((await h.run(async(action,body)=>{const r=await api(action,body);if(action==='complete')throw Error('completion ack lost');return r;})).recovered,true);
  assert.equal(h.state.status,'succeeded');assert.equal(h.state.refunds,0);assert.equal(h.state.cancels,0);
});
test('expired provider result is recovered from private storage',async()=>{
  const h=harness();Object.assign(h.job,{submissionStarted:true,providerPromptId:providerId});h.state.file=true;
  h.fetch=async()=>{throw Error('must recover storage before provider status');};
  assert.equal((await h.run()).recovered,true);assert.equal(h.state.submits,0);
});
test('storage outage is deferred, never interpreted as proof that output is missing',async()=>{
  const h=harness();Object.assign(h.job,{submissionStarted:true,providerPromptId:providerId});
  assert.equal((await h.run(async(action,body)=>{if(action==='recover')throw Error('storage offline');return h.api(action,body);})).status,'deferred');
  assert.equal(h.state.cancels,0);assert.equal(h.state.refunds,0);assert.equal(h.state.submits,0);
});
test('startup and execution have separate bounded deadlines',async()=>{
  for(const phase of ['IN_QUEUE','IN_PROGRESS']){
    const h=harness();h.state.provider=phase;
    const result=await h.run();
    assert.equal(result.status,'failed');assert.equal(h.state.cancels,1);assert.equal(h.state.refunds,1);
    assert.equal(h.elapsed(),phase==='IN_QUEUE'?H3_LIMITS.preparationMs:H3_LIMITS.executionMs);
  }
});
test('restart cannot reset a nearly exhausted startup deadline',async()=>{
  const h=harness();Object.assign(h.job,{submissionStarted:true,providerPromptId:providerId,providerSubmittedAt:new Date(h.began).toISOString()});
  await h.clock.sleep(44*minute);
  assert.equal((await h.run()).reason,'H3_SERVERLESS_PREPARATION_TIMEOUT');
  assert.equal(h.elapsed(),45*minute);assert.equal(h.state.submits,0);
});
test('cancel acknowledgement alone is insufficient; cleanup remains pending until terminal status',async()=>{
  const h=harness(),fetch=h.fetch;
  h.fetch=async(url,opts)=>url.includes('/cancel/')?Response.json({status:'CANCELLED'}):fetch(url,opts);
  assert.equal((await h.run()).reason,'CANCELLATION_UNCONFIRMED');assert.equal(h.state.refunds,0);
  assert.equal(h.job.providerPhase,'reconciling');
  h.fetch=fetch;assert.equal((await h.run()).status,'failed');assert.equal(h.state.refunds,1);assert.equal(h.state.submits,1);
});
test('an old worker never cancels a job after it loses its lease',async()=>{
  const h=harness(),api=h.api;
  assert.equal((await h.run(async(action,body)=>{if(action==='heartbeat'&&body.providerPromptId)throw Object.assign(Error('LEASE_LOST'),{code:'LEASE_LOST'});return api(action,body);})).reason,'LEASE_LOST');
  assert.equal(h.state.submits,1);assert.equal(h.state.cancels,0);assert.equal(h.state.refunds,0);
});
test('recovery bypasses unhealthy GPU readiness; new dispatch still requires readiness',async()=>{
  const calls=[],adapter={directUpload:true,ready:async()=>{calls.push('ready');throw Error('unhealthy');}};
  const job={id:'already-paid'};
  assert.deepEqual(await claimReadyJob(async(action,body)=>{assert.equal(body.recoverOnly,true);return {job};},adapter),{job});
  assert.deepEqual(calls,[]);
  await assert.rejects(()=>claimReadyJob(async()=>({job:null}),adapter),/unhealthy/);
});
test('failed startup latches shutdown, scales only to zero, and verifies workers before refund',async()=>{
  const h=harness();
  assert.equal((await h.run()).reason,'H3_SERVERLESS_PREPARATION_TIMEOUT');
  assert.equal(h.state.maxWorkers,0);assert.equal(h.job.providerShutdownRequired,true);
  const events=h.calls.map(x=>x.action);
  assert.ok(events.indexOf('trip')<events.indexOf('shutdown_verified'));
  assert.ok(events.indexOf('shutdown_verified')<events.indexOf('fail'));
  assert.equal(h.state.refunds,1);
});
test('shutdown PATCH response lost: reads back max=0 and worker count before confirming',async()=>{
  const h=harness(),fetch=h.fetch;let patches=0;
  h.fetch=async(url,opts)=>{const r=await fetch(url,opts);if(opts?.method==='PATCH'){patches++;throw Error('ack lost');}return r;};
  assert.equal(await h.adapter().shutdownAndVerify(),true);assert.equal(patches,1);assert.equal(h.state.maxWorkers,0);
});
test('max=0 alone does not mean a GPU is off; live or missing worker evidence keeps cleanup pending',async()=>{
  for(const workers of [{summary:{total:1},workers:[{status:'INITIALIZING'}]},{}]){
    const h=harness(),fetch=h.fetch;
    h.fetch=async(url,opts)=>url.endsWith('/workers')?Response.json(workers):fetch(url,opts);
    assert.equal((await h.run()).reason,'SHUTDOWN_UNCONFIRMED');
    assert.equal(h.state.refunds,0);assert.equal(h.job.providerShutdownRequired,true);assert.equal(h.state.maxWorkers,0);
    h.fetch=fetch;
    assert.equal((await h.run()).status,'failed');assert.equal(h.state.submits,1);assert.equal(h.state.refunds,1);
  }
});
test('failed inference cancellation still attempts control-plane shutdown and preserves pending reconciliation',async()=>{
  const h=harness(),fetch=h.fetch;
  h.fetch=async(url,opts)=>{if(url.includes('/cancel/'))throw Error('inference api offline');return fetch(url,opts);};
  assert.equal((await h.run()).reason,'CANCELLATION_UNCONFIRMED');assert.equal(h.state.maxWorkers,0);assert.equal(h.state.refunds,0);
});
test('shutdown without control credentials cannot report success or make network requests',async()=>{
  let requests=0;
  const a=new H3ServerlessAdapter({endpointId,apiKey:'local-fake',fetchImpl:async()=>{requests++;throw Error('unexpected');}});
  await assert.rejects(()=>a.shutdownAndVerify(),/CREDENTIAL_REQUIRED/);assert.equal(requests,0);
});
test('a concurrently checkpointed submission is deferred instead of refunding another execution',async()=>{
  const h=harness(),api=h.api;
  const result=await h.run(async(action,body)=>{
    if(body.submissionStarted)throw Object.assign(Error('SUBMISSION_ALREADY_STARTED'),{code:'SUBMISSION_ALREADY_STARTED'});
    return api(action,body);
  });
  assert.equal(result.status,'deferred');assert.equal(h.state.submits,0);assert.equal(h.state.refunds,0);assert.equal(h.state.cancels,0);
});
test('overlapping CPU deployments use different valid worker identities',()=>{
  const base='a'.repeat(80),a=workerInstanceId(base),b=workerInstanceId(base);
  assert.notEqual(a,b);assert.match(a,/^[a-zA-Z0-9_-]{1,80}$/);
  assert.throws(()=>workerInstanceId(undefined));assert.throws(()=>workerInstanceId('invalid/id'));
});
