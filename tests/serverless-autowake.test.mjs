import {test} from 'node:test';
import assert from 'node:assert/strict';
import {H3ServerlessAdapter} from '../workers/h3-serverless-adapter.mjs';
import {shutdownIdleEndpoint,processJob} from '../workers/h3-worker.mjs';
import {database,user,ready,reserve,call} from './helpers/database.mjs';
function provider({max=0,pool='ADA_32_PRO',lostAck=false}={}){
 const requests=[];const state={id:'exampleendpoint',gpu:{count:1,pools:[pool]},workers:{min:0,max}};
 const adapter=new H3ServerlessAdapter({endpointId:state.id,apiKey:'fake-inference',controlApiKey:'fake-control',autoWake:true,fetchImpl:async(url,opts)=>{
  requests.push({url,method:opts.method,body:opts.body&&JSON.parse(opts.body)});
  if(opts.method==='PATCH'){Object.assign(state.workers,JSON.parse(opts.body).workers);if(lostAck)throw Error('ack lost');}
  return Response.json(url.endsWith('/workers')?{summary:{total:0},workers:[]}:url.endsWith('/health')?{jobs:{inQueue:0,inProgress:0}}:state);
 }});return {state,adapter,requests};
}
test('off -> on-demand single 5090 -> verified off -> on-demand again',async()=>{
 const {adapter,state,requests}=provider({lostAck:true});let leases=0;
 await adapter.ensureActive(()=>{leases++;});assert.equal(state.workers.max,1);
 await adapter.ensureActive();assert.equal(requests.filter(x=>x.method==='PATCH').length,1);
 assert.equal(await adapter.shutdownAndVerify(),true);assert.equal(state.workers.max,0);
 await adapter.ensureActive();assert.equal(state.workers.max,1);assert.ok(leases>=5);
 assert.deepEqual(requests.filter(x=>x.method==='PATCH').map(x=>x.body),[{workers:{min:0,max:1}},{workers:{min:0,max:0}},{workers:{min:0,max:1}}]);
});
test('wake cannot switch GPUs, enable multiple workers, or proceed after lease loss',async()=>{
 for(const options of [{pool:'OTHER_GPU'},{max:2}]){
  const p=provider(options);await assert.rejects(p.adapter.ensureActive(),/ACTIVATION_CONFIG/);assert.ok(p.requests.every(x=>x.method!=='PATCH'));
 }
 const p=provider();await assert.rejects(p.adapter.ensureActive(()=>{throw Error('LEASE_LOST');}),/LEASE_LOST/);assert.equal(p.requests.length,0);
});
test('activation failure occurs before submission checkpoint and never dispatches inference',async()=>{
 const events=[];const job={id:crypto.randomUUID(),leaseToken:crypto.randomUUID()};
 const adapter={directUpload:true,build:async()=>({}),ensureActive:async()=>{throw Error('H3_ACTIVATION_CONFIG');}};
 const result=await processJob(job,async(action,body)=>{events.push({action,body});return{};},adapter);
 assert.equal(result.status,'failed');assert.ok(!events.some(x=>x.body?.submissionStarted));
});
test('idle cleanup retains lock on unconfirmed shutdown; releases only after verification',async()=>{
 const actions=[];let off=false;
 const api=async(action)=>{actions.push(action);return {stop:true,token:'fake-lease'};};
 const adapter={shutdownAndVerify:async guard=>{await guard();return off;}};
 assert.equal((await shutdownIdleEndpoint(api,adapter)).status,'pending');assert.ok(!actions.includes('idle_complete'));
 off=true;assert.equal((await shutdownIdleEndpoint(api,adapter)).status,'off');assert.equal(actions.at(-1),'idle_complete');
});
test('SQL serializes shutdown with incoming jobs and recovers crashed cleanup owners',async()=>{
 const db=await database();try{
  const idle=(w,a='claim',token=null)=>call(db,'serverless_idle_work',[w,a,token]);
  const a=await idle('cpu-a');assert.ok(a.stop);assert.ok(a.token);
  const u=await user(db);await ready(db);await reserve(db,u);
  assert.equal(await call(db,'claim_serverless_generation',['cpu-b',true]),null);
  assert.equal((await idle('cpu-b')).stop,false);
  await db.exec("update generation_serverless_state set idle_lease_until=now()-interval '1 minute'");
  assert.equal(await call(db,'claim_serverless_generation',['cpu-b',true]),null,'expired cleanup is still fenced');
  const b=await idle('cpu-b');assert.ok(b.stop);assert.notEqual(a.token,b.token);
  await assert.rejects(idle('cpu-a','complete',a.token),/LEASE_LOST/);
  await idle('cpu-b','complete',b.token);
  const job=await call(db,'claim_serverless_generation',['cpu-b',true]);assert.ok(job.id);
  assert.equal((await idle('cpu-a')).reason,'work_pending');
  await call(db,'finish_generation',[job.id,job.worker_id,job.lease_token,true]);
  await db.exec("update generation_serverless_state set idle_verified_at=now()-interval '2 minutes'");
  const c=await idle('cpu-c');assert.ok(c.stop);await idle('cpu-c','complete',c.token);
  await db.exec('set role authenticated');await assert.rejects(idle('browser'),/permission denied/);
 }finally{await db.close();}
});
