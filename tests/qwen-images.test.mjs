import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {qwenImage} from '../workers/qwen-image-provider.mjs';
import {tickQwenPod} from '../workers/qwen-pod-controller.mjs';
const id='11111111-1111-4111-8111-111111111111';
async function dbFixture(){
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table studio_productions(id uuid primary key,status text,stage text,updated_at timestamptz default now());
 create table production_spend_reservations(job_id uuid,step_key text,kind text,estimated_microusd bigint,measured_microusd bigint);
 insert into studio_productions(id,status,stage) values('${id}','running','images');
 insert into production_spend_reservations values('${id}','image-0','image',300000,null);`);
 await db.exec(await readFile(new URL('../supabase/migrations/20260921000100_qwen_image_batches.sql',import.meta.url),'utf8'));
 const call=async(a,d={})=>(await db.query('select qwen_image_work($1,$2) as v',[a,d])).rows[0].v;
 return {db,call};
}
test('queue disabled by default, idempotent, single GPU claim and final cost allocation',async()=>{
 const {db,call}=await dbFixture();try{
  const request={productionId:id,key:'image-0',fingerprint:'a'.repeat(64),request:{prompt:'same',references:[],size:'1024x1536'}};
  await assert.rejects(call('enqueue',request),/QWEN_DISABLED/);
  await db.exec('update qwen_image_control set enabled=true,commercial_authorized=true');
  const q=await call('enqueue',request);assert.equal((await call('enqueue',request)).id,q.id);
  await assert.rejects(call('enqueue',{...request,fingerprint:'b'.repeat(64)}),/IDEMPOTENCY_CONFLICT/);
  const c=await call('acquire',{owner:'controller'}),auth={owner:'controller',token:c.token};
  assert.equal((await call('acquire',{owner:'other'})).busy,true);
  const s=await call('begin',{...auth,image:'digest',hourlyUsd:.69}),runId=s.run.id;
  assert.equal(s.budgetUsd,.3);
  await call('progress',{runId,ready:true});
  const first=await call('claim',{runId}),second=await call('claim',{runId});
  assert.equal(first.id,second.id);assert.equal(first.claim_token,second.claim_token);
  await call('finish',{runId,id:q.id,claimToken:first.claim_token,receipt:{sha256:'x'}});
  assert.equal(await call('claim',{runId}),null);
  await call('drain',{...auth,reason:'idle'});
  await assert.rejects(call('claim',{runId}),/QWEN_RUN_CLOSED/);
  const closed=await call('close',auth);assert.equal(closed.run.phase,'closed');
  const row=(await db.query('select * from qwen_image_jobs')).rows[0];assert.ok(Number(row.allocated_compute_usd)>=Number(row.active_usd));
  assert.equal((await call('close',auth)).run.compute_usd,closed.run.compute_usd);
  await call('release',auth);
  await db.exec('set role anon');await assert.rejects(db.query('select * from qwen_image_jobs'),/permission denied/);
 }finally{await db.close();}
});
test('failed startup retains its billed session against original queued job',async()=>{
 const {db,call}=await dbFixture();try{
  await db.exec('update qwen_image_control set enabled=true,commercial_authorized=true');
  await call('enqueue',{productionId:id,key:'image-0',fingerprint:'a'.repeat(64),request:{}});
  const c=await call('acquire',{owner:'a'}),auth={owner:'a',token:c.token};
  await call('begin',{...auth,image:'digest',hourlyUsd:.69});
  await call('drain',{...auth,reason:'startup_failed'});await call('close',auth);
  const q=(await db.query('select * from qwen_image_jobs')).rows[0];assert.equal(q.status,'uncertain');assert.ok(Number(q.allocated_compute_usd)>0);
 }finally{await db.close();}
});
test('provider reuses uploaded image after registration failed, no new generation',async()=>{
 let registrations=0,enqueues=0;
 const invoke=async(action)=>{
  if(action==='qwen_enqueue'){enqueues++;return {id,asset_id:id,status:'succeeded',run_id:id,active_usd:.01};}
  if(action==='register'){if(++registrations===1)throw Error('storage unavailable');return {result:{id}};}
  throw Error(action);
 };invoke.costStep='image-0';
 const args={prompt:'a',size:'1024x1536',references:[],invoke};
 await assert.rejects(qwenImage(args),/storage unavailable/);
 assert.equal((await qwenImage(args)).assetId,id);assert.equal(enqueues,2);assert.equal(registrations,2);
});
test('uncertain result is not automatically regenerated or replaced with OpenAI',async()=>{
 const invoke=async()=>({status:'uncertain',error:'QWEN_RUN_ENDED'});invoke.costStep='image-0';
 await assert.rejects(qwenImage({invoke}),/QWEN_RUN_ENDED/);
});
const env={QWEN_POD_CONTROLLER:'true',QWEN_POD_IMAGE:'ghcr.io/alangael24/creativerush-qwen-pod@sha256:'+'a'.repeat(64),CREATIVE_RUSH_URL:'https://example.test',RUNPOD_CONTROL_API_KEY:'secret',PRODUCTION_WORKER_TOKEN:'secret',GENERATION_WORKER_TOKEN:'secret'};
test('controller persists create intent and never retries ambiguous POST',async()=>{
 const operations=[];const fetchImpl=async(url,options)=>{
  const body=options.body&&JSON.parse(options.body);operations.push(body?.action||new URL(url).pathname);
  if(url.includes('/api/qwen'))return Response.json(body.action==='acquire'?{enabled:true,pending:1,token:id,run:null}:body.action==='begin'?{run:{id,name:'owned',image_digest:env.QWEN_POD_IMAGE,deadline_at:new Date(Date.now()+3600000).toISOString()}}:{});
  if(url.includes('/catalog/'))return Response.json({price:{community:.69},availability:'HIGH'});
  throw Error('response lost');
 };
 assert.equal((await tickQwenPod(env,{fetchImpl})).status,'creation_unconfirmed');
 assert.deepEqual(operations,['acquire','/v2/catalog/gpus/NVIDIA%20GeForce%20RTX%205090','begin','/v2/pods','release']);
});
test('controller verifies ownership and deletion, idle held while images reviewed',async()=>{
 let holding=true,deleted=false;const actions=[];const run={id,pod_id:'p',name:'owned',phase:'running',created_at:new Date(Date.now()-300000).toISOString(),ready_at:new Date().toISOString(),heartbeat_at:new Date().toISOString(),last_job_at:new Date(Date.now()-200000).toISOString(),deadline_at:new Date(Date.now()+3600000).toISOString(),hourly_usd:.69};
 const fetchImpl=async(url,options)=>{
  const body=options.body&&JSON.parse(options.body);
  if(url.includes('/api/qwen')){actions.push(body.action);return Response.json(body.action==='acquire'?{enabled:true,pending:0,running:false,holding,budgetUsd:1,run,token:id}:{});}
  if(body?.action==='terminate'){deleted=true;return Response.json({});}
  return deleted?new Response('',{status:404}):Response.json({id:'p',name:'owned',gpu:{id:'NVIDIA GeForce RTX 5090',count:1},cloud:'COMMUNITY',cost:.69});
 };
 assert.equal((await tickQwenPod(env,{fetchImpl})).status,'running');assert.equal(deleted,false);
 holding=false;assert.equal((await tickQwenPod(env,{fetchImpl})).status,'deleted');assert.ok(actions.includes('close'));
});

test('cold enqueue reserves startup allowance; warm and existing jobs do not',async()=>{
 const {qwenProductionAction}=await import('../src/qwen-images.js');
 for(const mode of ['cold','warm','existing','disabled']){
  const calls=[];
  const rows={qwen_image_jobs:mode==='existing'?{id}:null,qwen_image_control:{enabled:mode!=='disabled',commercial_authorized:true,current_run:mode==='warm'?id:null},qwen_image_runs:{phase:'running',ready_at:'now'},production_spend_reservations:{estimated_microusd:150000}};
  const db={from(table){const chain={select(){return chain},eq(){return chain},single:async()=>({data:rows[table]}),maybeSingle:async()=>({data:rows[table]})};return chain},async rpc(name,args){calls.push({name,args});return {data:{id}}}};
  const action=qwenProductionAction(db,{id,worker_id:'test',lease_token:id},'qwen_enqueue',{key:'image-0',request:{prompt:'product',size:'1024x1536',references:[]}});
  if(mode==='disabled'){await assert.rejects(action,/QWEN_DISABLED/);assert.equal(calls.length,0);continue}
  await action;
  const reserve=calls.filter(c=>c.name==='account_production_spend');assert.equal(reserve.length,mode==='cold'?1:0);
  if(reserve.length)assert.equal(reserve[0].args.p_amount,400000);
 }
});
