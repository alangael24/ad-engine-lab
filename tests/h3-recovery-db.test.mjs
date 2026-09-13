import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {database,user,ready,reserve,call,balance} from './helpers/database.mjs';
import {H3_LIMITS} from '../src/h3-lifecycle.js';
let db;
before(async()=>{db=await database();});
after(async()=>{await db.close();});
beforeEach(async()=>{await db.exec('truncate generation_jobs,generation_references,generation_workers,credit_ledger,purchases,credit_balances,customer_accounts,auth.users cascade;update generation_serverless_state set tripped_at=null,shutdown_verified_at=null;');});
const claim=(worker='cpu-a',allow=true)=>call(db,'claim_serverless_generation',[worker,allow]);
const beat=j=>call(db,'heartbeat_generation',[j.id,j.worker_id,j.lease_token,true,'rp:exampleendpoint:test-u1']);
const progress=(j,phase)=>call(db,'generation_provider_progress',[j.id,j.worker_id,j.lease_token,phase]);
const finish=(j,success)=>call(db,'finish_generation',[j.id,j.worker_id,j.lease_token,success]);
const get=id=>db.query('select to_jsonb(j) value from generation_jobs j where id=$1',[id]).then(x=>x.rows[0].value);
async function setup(n=1){const u=await user(db);await ready(db);const jobs=[];for(let i=0;i<n;i++)jobs.push(await reserve(db,u));return {u,jobs};}
test('queued scenes survive a 35-minute cold start, expire only at the bounded pending deadline',async()=>{
  const {u,jobs:[first,second]}=await setup(2);const j=await claim();
  await db.query("update generation_jobs set created_at=now()-interval '35 minutes' where id=$1",[second.id]);
  assert.equal(await call(db,'sweep_generations'),0);assert.equal((await get(second.id)).status,'queued');
  await finish(j,true);assert.equal((await claim()).id,second.id);
  const third=await reserve(db,u);
  await db.query("update generation_jobs set created_at=now()-($1::double precision*interval '1 millisecond') where id=$2",[H3_LIMITS.pendingMs+1000,third.id]);
  assert.equal(await call(db,'sweep_generations'),1);assert.equal(await call(db,'sweep_generations'),0);
  assert.equal((await get(first.id)).status,'succeeded');assert.equal(await balance(db,u),10);
});
test('claim reserves one global serverless lane and separates preparation from execution',async()=>{
  await setup(2);const j=await claim();
  assert.equal(j.provider_phase,'preparing');assert.equal(j.started_at,null);
  assert.equal(Date.parse(j.provider_deadline_at)-Date.parse(j.provider_claimed_at),H3_LIMITS.providerTtlMs+H3_LIMITS.reconciliationMs);
  assert.equal(await claim('cpu-b'),null);
  const same=await claim();assert.equal(same.id,j.id);assert.equal(same.lease_token,j.lease_token);
  await beat(j);await progress(j,'generating');const started=await get(j.id);
  assert.ok(started.started_at);await progress(j,'generating');assert.equal((await get(j.id)).started_at,started.started_at);
});
test('expired CPU lease is adopted with original ID/deadline; previous owner is fenced',async()=>{
  const {u}=await setup();const j=await claim();await beat(j);
  const saved=await get(j.id);
  await db.query("update generation_jobs set lease_expires_at=now()-interval '1 minute' where id=$1",[j.id]);
  assert.equal(await call(db,'sweep_generations'),0);assert.equal(await balance(db,u),11);
  const adopted=await claim('cpu-b');assert.equal(adopted.id,j.id);assert.notEqual(adopted.lease_token,j.lease_token);
  for(const key of ['provider_prompt_id','provider_submitted_at','provider_claimed_at','provider_deadline_at'])assert.equal(adopted[key],saved[key]);
  await assert.rejects(finish(j,true),/LEASE_LOST/);await assert.rejects(progress(j,'reconciling'),/LEASE_LOST/);
  await finish(adopted,true);assert.equal(await balance(db,u),11);
});
test('paused admission still recovers an existing job and never claims another',async()=>{
  await setup(2);assert.equal(await claim('cpu-a',false),null);
  const j=await claim();assert.equal((await claim('cpu-a',false)).id,j.id);
  await finish(j,true);assert.equal(await claim('cpu-a',false),null);
});
test('absolute expiry schedules reconciliation before refund; cleanup intent survives restart',async()=>{
  const {u}=await setup();const j=await claim();await beat(j);
  await db.query("update generation_jobs set provider_deadline_at=now()-interval '1 minute',lease_expires_at=now()-interval '1 minute' where id=$1",[j.id]);
  assert.equal(await call(db,'sweep_generations'),0);assert.equal((await get(j.id)).provider_phase,'reconciling');
  assert.equal(await balance(db,u),11);
  const adopted=await claim('cpu-b');await progress(adopted,'generating');
  assert.equal((await get(j.id)).provider_phase,'reconciling');
  await finish(adopted,false);await finish(adopted,false);assert.equal(await balance(db,u),12);
});
test('failure in scene two preserves the first clip and allows the third scene to run',async()=>{
  const {u}=await setup(3);const first=await claim();await finish(first,true);const saved=await get(first.id);
  const second=await claim();await finish(second,false);await finish(second,false);
  const third=await claim();assert.notEqual(third.id,first.id);assert.notEqual(third.id,second.id);await finish(third,true);
  assert.equal((await get(first.id)).result_path,saved.result_path);assert.equal((await get(first.id)).status,'succeeded');
  assert.equal(await balance(db,u),10);assert.equal(await claim(),null);
});
test('provider progress cannot be forged by a browser or change a known provider ID',async()=>{
  await setup();const j=await claim();await assert.rejects(progress(j,'generating'),/INVALID_GENERATION/);
  await beat(j);await assert.rejects(call(db,'heartbeat_generation',[j.id,j.worker_id,j.lease_token,false,'rp:exampleendpoint:other-u1']),/PROVIDER_CONFLICT/);
  const {rows}=await db.query("select proname,has_function_privilege('anon',oid,'execute') a,has_function_privilege('authenticated',oid,'execute') b,has_function_privilege('service_role',oid,'execute') s from pg_proc where proname in ('claim_serverless_generation','generation_provider_progress')");
  assert.equal(rows.length,2);assert.ok(rows.every(x=>!x.a&&!x.b&&x.s));
  for(const column of ['provider_backend','provider_phase','provider_deadline_at']){
    const r=await db.query("select has_column_privilege('authenticated','public.generation_jobs',$1,'SELECT') allowed",[column]);
    assert.equal(r.rows[0].allowed,false);
  }
});
test('startup circuit breaker survives cleanup and blocks later GPU dispatch until operator reset',async()=>{
  await setup(2);const j=await claim();
  await assert.rejects(call(db,'generation_serverless_shutdown',[j.id,j.worker_id,j.lease_token,true]),/INVALID_GENERATION/);
  await call(db,'generation_serverless_shutdown',[j.id,j.worker_id,j.lease_token,false]);
  const tripped=await get(j.id);assert.equal(tripped.provider_shutdown_required,true);assert.equal(tripped.provider_phase,'reconciling');
  await db.query("update generation_jobs set lease_expires_at=now()-interval '1 minute' where id=$1",[j.id]);
  const recovered=await claim('cpu-b');assert.equal(recovered.provider_shutdown_required,true);
  await call(db,'generation_serverless_shutdown',[recovered.id,recovered.worker_id,recovered.lease_token,true]);await finish(recovered,false);
  assert.equal(await claim('cpu-b'),null,'remaining scene must not launch another failed GPU');
  const state=(await db.query('select * from generation_serverless_state')).rows[0];assert.ok(state.tripped_at);assert.ok(state.shutdown_verified_at);
  const permission=(await db.query("select has_table_privilege('authenticated','generation_serverless_state','UPDATE') allowed,has_function_privilege('authenticated','generation_serverless_shutdown(uuid,text,uuid,boolean)','EXECUTE') rpc")).rows[0];
  assert.equal(permission.allowed,false);assert.equal(permission.rpc,false);
});
