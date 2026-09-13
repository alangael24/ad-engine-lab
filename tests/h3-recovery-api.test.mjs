import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {database,user,ready,reserve,balance} from './helpers/database.mjs';
import {mockSupabase} from './helpers/supabase-http.mjs';
import {onRequestPost} from '../functions/api/worker.js';
import {createApi,processJob} from '../workers/h3-worker.mjs';
import {H3ServerlessAdapter} from '../workers/h3-serverless-adapter.mjs';
import {virtualClock} from './helpers/virtual-clock.mjs';
let db,stub,originalFetch;
const env={SUPABASE_URL:'http://supabase.test',SUPABASE_SERVICE_ROLE_KEY:'local-fake-service',GENERATION_ENABLED:'true',GENERATION_WORKER_TOKEN:'test-only-secret-01234567890123456789012'};
before(async()=>{db=await database();originalFetch=globalThis.fetch;});
after(async()=>{globalThis.fetch=originalFetch;await db.close();});
beforeEach(async()=>{await db.exec('truncate generation_jobs,generation_references,generation_workers,credit_ledger,purchases,credit_balances,customer_accounts,auth.users cascade;update generation_serverless_state set tripped_at=null,shutdown_verified_at=null;');stub=mockSupabase(db);globalThis.fetch=stub.fetch;});
const api=(fetchImpl)=>createApi({appUrl:'https://local.test',workerId:'cpu-a',token:env.GENERATION_WORKER_TOKEN,fetchImpl:fetchImpl||((url,opts)=>onRequestPost({env,request:new Request(url,opts)}))});
test('real worker + API + SQL + storage recovers an accepted job whose submit response was lost',async()=>{
  const u=await user(db);await ready(db);const reserved=await reserve(db,u),client=api();
  const {job}=await client('claim',{backend:'serverless'}),clock=virtualClock();let submits=0,signed;
  const provider=new H3ServerlessAdapter({endpointId:'exampleendpoint',apiKey:'local-fake',clock,fetchImpl:async(url,opts)=>{
    assert.ok(url.endsWith('/run'));submits++;signed=JSON.parse(opts.body).input.uploadUrl;throw Error('response lost');
  }});
  assert.equal((await processJob(job,client,provider,{clock})).reason,'AMBIGUOUS_SUBMISSION');
  assert.equal(await balance(db,u),11);
  await stub.fetch(signed,{method:'PUT',headers:{'content-type':'video/mp4'},body:new Blob(['simulated-video'])});
  const {job:resumed}=await client('claim',{backend:'serverless'});
  assert.equal(resumed.submissionStarted,true);assert.equal(resumed.providerPromptId,null);
  assert.equal((await processJob(resumed,client,provider,{clock})).recovered,true);
  assert.equal(submits,1);assert.equal(await balance(db,u),11);
  const finished=(await db.query('select status,result_path from generation_jobs where id=$1',[reserved.id])).rows[0];
  assert.equal(finished.status,'succeeded');assert.equal(finished.result_path,`${u.id}/${reserved.id}.mp4`);
});
test('paused API can reconcile existing work, but recoverOnly cannot dispatch queued work',async()=>{
  const u=await user(db);await ready(db);await reserve(db,u);const client=api();
  assert.equal((await client('claim',{backend:'serverless',recoverOnly:true})).job,null);
  const {job}=await client('claim',{backend:'serverless'});
  const paused=api((url,opts)=>onRequestPost({env:{...env,GENERATION_ENABLED:'false'},request:new Request(url,opts)}));
  assert.equal((await paused('claim',{backend:'serverless'})).job.id,job.id);
  await paused('fail',{jobId:job.id,leaseToken:job.leaseToken});await reserve(db,u);
  assert.equal((await paused('claim',{backend:'serverless'})).job,null);
});
test('confirmed missing storage differs from a storage outage, and progress persists via API',async()=>{
  const u=await user(db);await ready(db);await reserve(db,u);const client=api(),{job}=await client('claim',{backend:'serverless'});
  const identity={jobId:job.id,leaseToken:job.leaseToken};
  assert.equal((await client('recover',identity)).ready,false);
  globalThis.fetch=async(input,opts)=>{if(new URL(input instanceof Request?input.url:input).pathname.includes('/object/info/'))return Response.json({message:'Storage offline'}, {status:503});return stub.fetch(input,opts);};
  await assert.rejects(()=>client('recover',identity),/RESULT_NOT_READY/);
  await client('heartbeat',{...identity,submissionStarted:true,providerPromptId:'rp:exampleendpoint:test-u1'});
  await client('progress',{...identity,phase:'generating'});
  const j=(await db.query('select provider_phase,started_at,provider_submitted_at from generation_jobs where id=$1',[job.id])).rows[0];
  assert.equal(j.provider_phase,'generating');assert.ok(j.started_at);assert.ok(j.provider_submitted_at);assert.equal(await balance(db,u),11);
});
test('shutdown intent and verification are persisted through the authenticated worker API',async()=>{
  const u=await user(db);await ready(db);await reserve(db,u);const client=api(),{job}=await client('claim',{backend:'serverless'});
  const identity={jobId:job.id,leaseToken:job.leaseToken};
  await client('trip',identity);const resumed=(await client('claim',{backend:'serverless',recoverOnly:true})).job;
  assert.equal(resumed.providerShutdownRequired,true);assert.equal(resumed.providerPhase,'reconciling');
  await client('shutdown_verified',identity);await client('fail',identity);
  assert.equal(await balance(db,u),12);assert.equal((await client('claim',{backend:'serverless'})).job,null);
});
