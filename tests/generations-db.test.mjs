import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { database,user,ready,call,reserve,balance } from './helpers/database.mjs';
let db;
before(async()=>{db=await database();});
after(async()=>{await db.close();});
beforeEach(async()=>{await db.exec('truncate generation_jobs,generation_references,generation_workers,credit_ledger,purchases,credit_balances,customer_accounts,auth.users cascade;');});

test('new SaaS purchases grant a balance once, without course access',async()=>{
  const u=await user(db); const beforeBalance=await balance(db,u);
  const result=await db.query('select * from apply_saas_purchase($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
    [`evt_retry`,`cs_${u.id}`,'plink_test',u.email,null,'esencial',99900,'mxn','paid',12,20,true]);
  assert.equal(result.rows[0].applied,false); assert.equal(await balance(db,u),beforeBalance);
  assert.equal((await db.query('select course_access from purchases')).rows[0].course_access,false);
});
test('offline worker never reserves a clip',async()=>{
  const u=await user(db); await assert.rejects(reserve(db,u),/WORKER_OFFLINE/); assert.equal(await balance(db,u),12);
});
test('idempotent parallel submissions only debit once and reject changed content',async()=>{
  const u=await user(db); await ready(db); const requestId=crypto.randomUUID();
  const [a,b]=await Promise.all([reserve(db,u,{requestId}),reserve(db,u,{requestId})]);
  assert.equal(a.id,b.id); assert.equal(await balance(db,u),11);
  await assert.rejects(reserve(db,u,{requestId,prompt:'Un prompt diferente'}),/IDEMPOTENCY_CONFLICT/);
  assert.equal(await balance(db,u),11);
});
test('15 seconds costs exactly three clips, and cannot overdraw',async()=>{
  const u=await user(db,3); await ready(db); const j=await reserve(db,u,{duration:15});
  assert.equal(j.credit_cost,3); assert.equal(await balance(db,u),0);
  await assert.rejects(reserve(db,u),/INSUFFICIENT_CREDITS/);
  assert.equal((await db.query('select count(*)::int n from generation_jobs')).rows[0].n,1);
});
test('reference ownership enforced even when UUID is known',async()=>{
  const a=await user(db), b=await user(db); await ready(db); const id=crypto.randomUUID();
  await db.query('insert into generation_references(id,user_id,storage_path,mime_type,size_bytes) values($1,$2,$3,$4,$5)',[id,a.id,`${a.id}/${id}.png`,'image/png',100]);
  await assert.rejects(reserve(db,b,{referenceId:id}),/REFERENCE_NOT_FOUND/);
  assert.equal((await reserve(db,a,{referenceId:id})).reference_id,id);
});
test('active job cap and cancel exactly-once refunds',async()=>{
  const u=await user(db); await ready(db); const first=await reserve(db,u); await reserve(db,u); await reserve(db,u);
  await assert.rejects(reserve(db,u),/TOO_MANY_ACTIVE_JOBS/);
  await call(db,'cancel_generation',[u.id,first.id]); await call(db,'cancel_generation',[u.id,first.id]);
  assert.equal(await balance(db,u),10); await reserve(db,u); assert.equal(await balance(db,u),9);
});
test('claim fencing prevents other workers or users completing/canceling work',async()=>{
  const u=await user(db),other=await user(db); await ready(db); const j=await reserve(db,u);
  const claimed=await call(db,'claim_generation',['gpu-a']);
  assert.equal(claimed.id,j.id); assert.equal((await call(db,'claim_generation',['gpu-a'])).id,j.id);
  assert.equal(await call(db,'claim_generation',['gpu-b']),null);
  await assert.rejects(call(db,'finish_generation',[j.id,'gpu-b',claimed.lease_token,true]),/LEASE_LOST/);
  await assert.rejects(call(db,'cancel_generation',[other.id,j.id]),/JOB_NOT_FOUND/);
  await assert.rejects(call(db,'cancel_generation',[u.id,j.id]),/JOB_ALREADY_STARTED/);
});
test('failed generation refunds once even under repeated callbacks',async()=>{
  const u=await user(db); await ready(db); await reserve(db,u); const j=await call(db,'claim_generation',['gpu']);
  await call(db,'finish_generation',[j.id,'gpu',j.lease_token,false]);
  await call(db,'finish_generation',[j.id,'gpu',j.lease_token,false]);
  assert.equal(await balance(db,u),12);
  assert.equal((await db.query("select count(*)::int n from credit_ledger where reason='generation_refunded'")).rows[0].n,1);
});
test('completed generation cannot later be refunded by a failure callback',async()=>{
  const u=await user(db); await ready(db); await reserve(db,u); const j=await call(db,'claim_generation',['gpu']);
  const result=await call(db,'finish_generation',[j.id,'gpu',j.lease_token,true]);
  assert.equal(result.result_path,`${u.id}/${j.id}.mp4`);
  assert.equal((await call(db,'finish_generation',[j.id,'gpu',j.lease_token,false])).status,'succeeded');
  assert.equal(await balance(db,u),11);
});
test('expired leases and stale queued jobs are refunded without resubmission',async()=>{
  const u=await user(db); await ready(db); await reserve(db,u); const j=await call(db,'claim_generation',['gpu']);
  await db.query("update generation_jobs set lease_expires_at=now()-interval '1 minute' where id=$1",[j.id]);
  await assert.rejects(call(db,'heartbeat_generation',[j.id,'gpu',j.lease_token,false,null]),/LEASE_LOST/);
  const queued=await reserve(db,u);
  await db.query("update generation_jobs set created_at=now()-interval '31 minutes' where id=$1",[queued.id]);
  assert.equal(await call(db,'sweep_generations'),2); assert.equal(await call(db,'sweep_generations'),0);
  assert.equal(await balance(db,u),12);
  assert.equal((await call(db,'finish_generation',[j.id,'gpu',j.lease_token,true])).status,'failed');
});
test('provider submission checkpoint is atomic and immutable',async()=>{
  const u=await user(db); await ready(db); await reserve(db,u); const j=await call(db,'claim_generation',['gpu']);
  await call(db,'heartbeat_generation',[j.id,'gpu',j.lease_token,true,null]);
  await assert.rejects(call(db,'heartbeat_generation',[j.id,'gpu',j.lease_token,true,null]),/SUBMISSION_ALREADY_STARTED/);
  const promptId=crypto.randomUUID(); await call(db,'heartbeat_generation',[j.id,'gpu',j.lease_token,false,promptId]);
  await assert.rejects(call(db,'heartbeat_generation',[j.id,'gpu',j.lease_token,false,crypto.randomUUID()]),/PROVIDER_CONFLICT/);
});
test('RLS hides another customer and browser cannot mutate balance or execute worker RPC',async()=>{
  const a=await user(db),b=await user(db); await ready(db); await reserve(db,a); await reserve(db,b);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[a.id]);
  await db.exec('set role authenticated');
  try {
    const rows=(await db.query('select user_id from generation_jobs')).rows;
    assert.deepEqual(rows.map(r=>r.user_id),[a.id]);
    await assert.rejects(db.query('update credit_balances set video_credits=999'),/permission denied/);
    await assert.rejects(call(db,'claim_generation',['attacker']),/permission denied/);
    await assert.rejects(db.query('select * from generation_references'),/permission denied/);
    await assert.rejects(db.query('select lease_token,worker_id from generation_jobs'),/permission denied/);
  } finally { await db.exec('reset role'); }
  const buckets=(await db.query('select public from storage.buckets')).rows;
  assert.ok(buckets.every(b=>b.public===false));
});

test('concurrent reference registrations enforce the daily quota under a balance lock',async()=>{
  const u=await user(db);
  for(let i=0;i<29;i++) {
    const id=crypto.randomUUID(); await call(db,'register_generation_reference',[id,u.id,`${u.id}/${id}.png`,'image/png',100]);
  }
  const register=()=>{const id=crypto.randomUUID();return call(db,'register_generation_reference',[id,u.id,`${u.id}/${id}.png`,'image/png',100]);};
  const attempts=await Promise.allSettled([register(),register()]);
  assert.equal(attempts.filter(x=>x.status==='fulfilled').length,1);
  assert.equal((await db.query('select count(*)::int n from generation_references')).rows[0].n,30);
});

test('security catalog: all SaaS tables use RLS and privileged functions are not callable by clients',async()=>{
  const tables=(await db.query("select relname,relrowsecurity from pg_class where relnamespace='public'::regnamespace and relname in ('generation_jobs','generation_workers','generation_references')")).rows;
  assert.equal(tables.length,3);assert.ok(tables.every(t=>t.relrowsecurity));
  const funcs=(await db.query(`select proname,has_function_privilege('anon',p.oid,'execute') a,
    has_function_privilege('authenticated',p.oid,'execute') b from pg_proc p
    where p.pronamespace='public'::regnamespace and proname in
    ('reserve_generation','claim_generation','finish_generation','heartbeat_generation','sweep_generations','refund_generation','register_generation_reference','apply_saas_purchase')`)).rows;
  assert.equal(funcs.length,8);assert.ok(funcs.every(f=>!f.a && !f.b));
});
