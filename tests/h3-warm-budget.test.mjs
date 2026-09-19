import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {database,user,ready,reserve,call} from './helpers/database.mjs';
async function setup(){
 const db=await database();
 for(const file of ['20260915073916_managed_h3_pod_lifecycle.sql','20260915081955_managed_pod_failed_start_refunds.sql','20260915170257_managed_pod_boot_progress.sql','20260916221655_managed_h3_attempt_recovery.sql','20260919064717_production_cost_recovery.sql'])await db.exec(await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
 await db.exec('update h3_pod_control set enabled=true,total_limit_microusd=1000000,run_limit_microusd=330000');
 const u=await user(db);await ready(db);const job=await reserve(db,u,{duration:10});
 const state=await call(db,'h3_pod_work',['test','acquire']);
 const work=(action,data={})=>call(db,'h3_pod_work',['test',action,state.token,{...(action==='begin'?{imageDigest:'ghcr.io/alangael24/creativerush-h3-pod@sha256:'+'a'.repeat(64)}:{}),...data}]);
 const r=(await work('begin')).run;await work('attach',{podId:'abcdefgh'});await call(db,'h3_pod_ready',[r.id,r.worker_prefix]);
 await db.exec("update h3_pod_runs set created_at=now()-interval '22 minutes',needs_rotation=true");
 return {db,work,r,job};
}
test('warm reservation grows within existing total and admits the same clip without another pod',async()=>{
 const x=await setup();try{
 const s=await x.work('retain');assert.equal(s.retained,true);assert(s.run.reserved_microusd>330000);assert.equal(s.run.needs_rotation,false);
 assert.equal(s.run.deadline_at,x.r.deadline_at); // immutable admission horizon
 const j=await call(x.db,'claim_generation',[x.r.worker_prefix+'_a']);assert.equal(j.id,x.job.id);assert.equal(j.infra_runs,1);
 assert.equal((await x.db.query('select count(*)::int n from h3_pod_runs')).rows[0].n,1);
 assert.equal((await x.db.query('select total_limit_microusd from h3_pod_control')).rows[0].total_limit_microusd,1000000);
 }finally{await x.db.close();}
});
test('no top-up past global budget, per-job limit, deadline or disabled controller',async()=>{
 for(const sql of ["update h3_pod_control set total_limit_microusd=330000","update generation_jobs set infra_limit_microusd=infra_reserved_microusd","update h3_pod_runs set deadline_at=now()+interval '1 minute'","update h3_pod_control set enabled=false","update h3_pod_runs set boot_error='HOST_FAILED'"]){
  const x=await setup();try{await x.db.exec(sql);const s=await x.work('retain');assert.notEqual(s.retained,true);assert.equal(s.run.reserved_microusd,330000);}finally{await x.db.close();}
 }
});
test('no growth without queued work, and controller ownership is fenced',async()=>{
 const x=await setup();try{
 await x.db.exec("update generation_jobs set status='succeeded',result_path='test.mp4',finished_at=now()");assert.notEqual((await x.work('retain')).retained,true);
 await assert.rejects(call(x.db,'h3_pod_work',['other','retain',crypto.randomUUID()]),/LEASE_LOST/);
 await x.db.exec('set role authenticated');await assert.rejects(call(x.db,'h3_pod_work',['test','retain']),/permission denied/);
 }finally{await x.db.close();}
});
test('a later buffered clip keeps the warm pod beyond the old forty-minute cutoff',async()=>{
 const x=await setup();try{
 await x.db.exec("update generation_jobs set status='succeeded',result_path='test.mp4',finished_at=now(); update h3_pod_runs set created_at=now()-interval '41 minutes'");
 const u=await user(x.db);await ready(x.db);const next=await reserve(x.db,u);
 const s=await x.work('retain');assert.equal(s.retained,true);assert(s.run.reserved_microusd<=1000000);
 const j=await call(x.db,'claim_generation',[x.r.worker_prefix+'_a']);assert.equal(j.id,next.id);assert.equal(j.managed_run_id,x.r.id);
 assert.equal(j.infra_runs,1);
 }finally{await x.db.close();}
});
test('warm continuation preserves the order cap without charging an older order again',async()=>{
 const x=await setup();try{
  const uid=x.job.user_id,pid=crypto.randomUUID(),oid=crypto.randomUUID(),oldRun=crypto.randomUUID();
  await x.db.query("insert into studio_brands(id,user_id,data) values($1,$2,'{}');",[pid,uid]);
  await x.db.query("insert into studio_projects(id,user_id,brand_id,brand_snapshot,data) values($1,$2,$1,'{}','{}')",[pid,uid]);
  await x.db.query("insert into studio_productions(id,user_id,project_id,initial_revision,expected_revision,snapshot) values($1,$2,$3,1,1,'{}')",[oid,uid,pid]);
  await x.db.query("insert into studio_scene_versions(user_id,project_id,scene_id,version,request_id,request_payload,snapshot,job_id) values($1,$2,$3,1,$3,'{}','{}',$4)",[uid,pid,crypto.randomUUID(),x.job.id]);
  await x.db.query("insert into h3_pod_runs(id,name,phase,deadline_at,reserved_microusd,estimated_microusd,worker_prefix) values($1,$2,'closed',now(),1200000,1200000,'old')",[oldRun,'old-'+oldRun]);
  await x.db.query('insert into h3_pod_run_jobs(run_id,job_id) values($1,$2)',[oldRun,x.job.id]);
  await x.db.exec('update h3_pod_control set total_limit_microusd=3000000');
  assert.notEqual((await x.work('retain')).retained,true,'same order exceeds $1.50');
  await x.db.query("update studio_scene_versions set created_at=(select created_at-interval '1 day' from studio_productions where id=$1) where project_id=$2",[oid,pid]);
  assert.equal((await x.work('retain')).retained,true,'prior order must not consume the new order cap');
 }finally{await x.db.close();}
});
