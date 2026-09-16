import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {database,user,ready,reserve,call} from './helpers/database.mjs';
import {eligibleProfiles,DEFAULT_H3_PROFILE,managedStopReason,infrastructureFailure} from '../src/h3-pod-policy.js';
async function setup(){
 const db=await database();
 for(const file of ['20260915073916_managed_h3_pod_lifecycle.sql','20260915081955_managed_pod_failed_start_refunds.sql','20260915170257_managed_pod_boot_progress.sql','20260916221655_managed_h3_attempt_recovery.sql'])await db.exec(await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
 await db.exec('update h3_pod_control set enabled=true,total_limit_microusd=10000000');
 const u=await user(db);await ready(db);const job=await reserve(db,u);
 const state=await call(db,'h3_pod_work',['test','acquire']);
 const work=(action,data={})=>call(db,'h3_pod_work',['test',action,state.token,{...(action==='begin'?{imageDigest:'ghcr.io/alangael24/creativerush-h3-pod@sha256:'+'a'.repeat(64)}:{}),...data}]);
 const start=async()=>{const s=await work('begin');await work('attach',{podId:'pod'+s.run.id.replaceAll('-','').slice(0,20)});await call(db,'h3_pod_ready',[s.run.id,s.run.worker_prefix]);return s.run;};
 const row=()=>db.query('select * from generation_jobs where id=$1',[job.id]).then(x=>x.rows[0]);
 const credits=()=>db.query('select video_credits from credit_balances where user_id=$1',[u.id]).then(x=>x.rows[0].video_credits);
 return {db,u,job,work,start,row,credits};
}
test('host failure preserves stable clip, seed, deadline and credits; old attempt is fenced',async()=>{
 const x=await setup();try{
 const balance=await x.credits(),run=await x.start();
 const j=await call(x.db,'claim_generation',[run.worker_prefix+'_a']);assert.ok(j.managed_attempt_id);
 await call(x.db,'h3_attempt_progress',[j.id,j.worker_id,j.lease_token,'reconciling','host_failed']);
 await x.work('drain',{reason:'host_failed'});
 assert.equal((await x.db.query('select enabled from h3_pod_control')).rows[0].enabled,true);
 assert.equal(await x.credits(),balance);
 await x.work('close');const pending=await x.row();assert.equal(pending.status,'queued');assert.equal(await x.credits(),balance);
 const second=await x.start();const j2=await call(x.db,'claim_generation',[second.worker_prefix+'_a']);
 assert.equal(j2.id,j.id);assert.equal(j2.managed_seed,j.managed_seed);assert.equal(j2.managed_deadline_at,j.managed_deadline_at);
 assert.notEqual(j2.managed_attempt_id,j.managed_attempt_id);
 await assert.rejects(call(x.db,'finish_generation',[j.id,j.worker_id,j.lease_token,true]),/LEASE_LOST/);
 assert.equal(await x.credits(),balance);
 }finally{await x.db.close();}
});
test('uploaded result recovered after host loss, completed jobs never regenerated',async()=>{
 const x=await setup();try{
 const balance=await x.credits(),r=await x.start(),j=await call(x.db,'claim_generation',[r.worker_prefix+'_a']);
 await x.work('drain',{reason:'worker_exited'});await x.work('close',{recoveredAttemptIds:[j.managed_attempt_id]});
 const row=await x.row();assert.equal(row.status,'succeeded');assert.ok(row.result_path.endsWith(j.managed_attempt_id+'.mp4'));assert.equal(await x.credits(),balance);
 await x.db.exec("update generation_jobs set created_at=now()-interval '3 hours',lease_expires_at=now()-interval '1 hour'");await call(x.db,'sweep_generations',[]);
 assert.equal((await x.row()).status,'succeeded');assert.equal(await x.credits(),balance);
 }finally{await x.db.close();}
});
test('failed bootstrap only exhausts its own cohort, third attempt refunds once',async()=>{
 const x=await setup();try{
 const charged=await x.credits();let other;
 for(let n=0;n<3;n++){
  const r=await x.start();
  if(n===0){const u2=await user(x.db);other=await reserve(x.db,u2);}
  await x.work('drain',{reason:'startup_failed'});await x.work('close');
  if(n<2)assert.equal(await x.credits(),charged);
 }
 assert.equal((await x.row()).status,'failed');assert.equal(await x.credits(),charged+x.job.credit_cost);
 assert.equal((await x.db.query('select status from generation_jobs where id=$1',[other.id])).rows[0].status,'queued');
 await call(x.db,'sweep_generations',[]);assert.equal(await x.credits(),charged+x.job.credit_cost);
 }finally{await x.db.close();}
});
test('expired worker lease adopts same attempt rather than refunds or duplicates',async()=>{
 const x=await setup();try{
 const r=await x.start(),j=await call(x.db,'claim_generation',[r.worker_prefix+'_a']);
 await call(x.db,'heartbeat_generation',[j.id,j.worker_id,j.lease_token,true,'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa']);
 await x.db.exec("update generation_jobs set lease_expires_at=now()-interval '1 second'");await call(x.db,'sweep_generations',[]);
 const j2=await call(x.db,'claim_generation',[r.worker_prefix+'_b']);assert.equal(j2.managed_attempt_id,j.managed_attempt_id);assert.equal(j2.submission_started,true);assert.ok(j2.provider_prompt_id);assert.notEqual(j2.lease_token,j.lease_token);
 }finally{await x.db.close();}
});
test('OOM suspends its profile, never authorizes a smaller GPU retry',async()=>{
 const x=await setup();try{
 await x.start();await x.work('drain',{reason:'gpu_oom'});await x.work('close');
 assert.equal((await x.row()).status,'failed');
 const p=(await x.db.query("select * from h3_execution_profiles where id='h3-5090'")).rows[0];assert.ok(p.suspended_at);
 await assert.rejects(x.work('begin',{profileId:'h3-4090'}),/PROFILE_NOT_APPROVED/);
 await assert.rejects(x.db.exec("update h3_execution_profiles set enabled=true where id='h3-4090'"),/check constraint/);
 }finally{await x.db.close();}
});
test('claim reserves enough time and cost including upload, not just three minutes',async()=>{
 const x=await setup();try{
 const r=await x.start();await x.db.exec("update h3_pod_runs set deadline_at=now()+interval '3 minutes 10 seconds'");
 assert.equal((await call(x.db,'claim_generation',[r.worker_prefix+'_a']))?.id,undefined);
 assert.equal((await x.db.query('select needs_rotation from h3_pod_runs')).rows[0].needs_rotation,true);
 }finally{await x.db.close();}
});
test('private attempts and profiles cannot be operated by customers',async()=>{
 const x=await setup();try{
 await x.db.exec('set role authenticated');
 await assert.rejects(x.db.query('select * from h3_generation_attempts'),/permission denied/);
 await assert.rejects(x.db.query('update h3_execution_profiles set enabled=true'),/permission denied/);
 }finally{await x.db.exec('reset role');await x.db.close();}
});
test('4090 remains opt in, and genuine startup progress is bounded by hard budget',()=>{
 assert.deepEqual(eligibleProfiles([{...DEFAULT_H3_PROFILE,id:'h3-4090',enabled:true}]),[]);
 assert.equal(infrastructureFailure('H3_OOM').retry,false);assert.equal(infrastructureFailure('MODEL_SIZE_MISMATCH').scope,'profile');
 const r={profile_id:'h3-5090',phase:'preparing',created_at:new Date(0).toISOString(),boot_updated_at:new Date(900000).toISOString(),deadline_at:new Date(2400000).toISOString(),reserved_microusd:500000};
 const pod={gpu:{id:DEFAULT_H3_PROFILE.gpu,count:1},cloud:'COMMUNITY',cost:.69,status:'RUNNING'};
 assert.equal(managedStopReason(r,pod,{enabled:true},1000000),null);
 assert.equal(managedStopReason(r,pod,{enabled:true},1600000),'startup_failed');
 assert.equal(managedStopReason(r,pod,{enabled:true},2400000),'budget_deadline');
});
test('a second customer is untouched by the first failed boot',async()=>{
 const x=await setup();try{
 await x.start();const u2=await user(x.db),other=await reserve(x.db,u2);
 await x.work('drain',{reason:'startup_failed'});await x.work('close');
 const row=(await x.db.query('select status,infra_runs,managed_run_id from generation_jobs where id=$1',[other.id])).rows[0];
 assert.deepEqual(row,{status:'queued',infra_runs:0,managed_run_id:null});
 assert.equal((await x.row()).infra_runs,1);
 }finally{await x.db.close();}
});
test('deadline cannot reset on restart; unallocated jobs expire without renting',async()=>{
 const x=await setup();try{
 const charged=await x.credits();await x.db.exec("update generation_jobs set managed_deadline_at=now()-interval '1 second'");
 await x.work('heartbeat');await call(x.db,'sweep_generations',[]);assert.equal((await x.row()).status,'failed');
 assert.equal(await x.credits(),charged+x.job.credit_cost);
 await assert.rejects(x.start(),/POD_NOT_ADMITTED/);
 }finally{await x.db.close();}
});
test('repeated bootstrap heartbeat is not progress; increasing completed bytes is',async()=>{
 const x=await setup();try{
 const s=await x.work('begin');await x.work('attach',{podId:'abcdefgh'});
 await call(x.db,'h3_pod_boot_progress',[s.run.id,s.run.worker_prefix,'models']);
 await x.db.exec("update h3_pod_runs set boot_updated_at=now()-interval '5 minutes'");
 const old=(await x.db.query('select boot_updated_at from h3_pod_runs')).rows[0].boot_updated_at;
 await call(x.db,'h3_pod_boot_progress',[s.run.id,s.run.worker_prefix,'models']);
 assert.deepEqual((await x.db.query('select boot_updated_at from h3_pod_runs')).rows[0].boot_updated_at,old);
 await call(x.db,'h3_pod_download_progress',[s.run.id,s.run.worker_prefix,1000]);
 assert.ok((await x.db.query('select boot_updated_at from h3_pod_runs')).rows[0].boot_updated_at>old);
 }finally{await x.db.close();}
});
test('one GPU continues into later clips without rotation after the initial buffer',async()=>{
 const x=await setup();try{
 const run=await x.start(),j=await call(x.db,'claim_generation',[run.worker_prefix+'_a']);
 await call(x.db,'finish_generation',[j.id,j.worker_id,j.lease_token,true]);
 const later=await reserve(x.db,x.u);
 const next=await call(x.db,'claim_generation',[run.worker_prefix+'_a']);assert.equal(next.id,later.id);assert.equal(next.managed_run_id,run.id);
 assert.equal((await x.db.query('select needs_rotation from h3_pod_runs')).rows[0].needs_rotation,false);
 }finally{await x.db.close();}
});
test('GPU wait yields production ownership with preserved checkpoints and deadline',async()=>{
 const x=await setup();try{
 const project=crypto.randomUUID(),production=crypto.randomUUID();
 await x.db.query("insert into studio_brands(id,user_id,data) values($1,$2,'{}')",[project,x.u.id]);
 await x.db.query("insert into studio_projects(id,user_id,brand_id,brand_snapshot,data) values($1,$2,$1,'{}','{}')",[project,x.u.id]);
 await x.db.query("insert into studio_productions(id,user_id,project_id,initial_revision,expected_revision,snapshot,steps) values($1,$2,$3,1,1,'{}','{\"plan\":{\"status\":\"done\",\"result\":{\"approved\":true}}}')",[production,x.u.id,project]);
 const j=await call(x.db,'studio_production_work',['coordinator','claim']);
 const yielded=await call(x.db,'studio_production_work',['coordinator','yield_gpu',j.id,j.lease_token]);assert.equal(yielded.status,'queued');assert.equal(yielded.lease_token,null);
 assert.equal(await call(x.db,'studio_production_work',['next','claim']),null);
 await x.db.exec("update studio_productions set next_attempt_at=now()-interval '1 second'");
 const resumed=await call(x.db,'studio_production_work',['next','claim']);assert.equal(resumed.id,j.id);assert.deepEqual(resumed.steps,j.steps);assert.equal(resumed.delivery_deadline_at,j.delivery_deadline_at);
 await assert.rejects(call(x.db,'studio_production_work',['coordinator','heartbeat',j.id,j.lease_token]),/LEASE_LOST/);
 }finally{await x.db.close();}
});
test('multiple scene retries share an order-wide rental limit and count one rental once',async()=>{
 const x=await setup();try{
 const project=crypto.randomUUID(),production=crypto.randomUUID();
 await x.db.query("insert into studio_brands(id,user_id,data) values($1,$2,'{}')",[project,x.u.id]);
 await x.db.query("insert into studio_projects(id,user_id,brand_id,brand_snapshot,data) values($1,$2,$1,'{}','{}')",[project,x.u.id]);
 await x.db.query("insert into studio_productions(id,user_id,project_id,initial_revision,expected_revision,snapshot,created_at) values($1,$2,$3,1,1,'{}',now()-interval '1 minute')",[production,x.u.id,project]);
 const jobs=[x.job,await reserve(x.db,x.u),await reserve(x.db,x.u)];
 for(const [i,j] of jobs.entries())await x.db.query("insert into studio_scene_versions(user_id,project_id,scene_id,version,request_id,request_payload,snapshot,job_id) values($1,$2,$3,1,$4,'{}','{}',$5)",[x.u.id,project,crypto.randomUUID(),crypto.randomUUID(),j.id]);
 const r=await x.start();
 assert.equal(await call(x.db,'h3_order_can_rent',[x.job.id,500000,r.id]),true);
 assert.equal((await x.db.query('select count(distinct run_id)::int n from h3_pod_run_jobs')).rows[0].n,1);
 await x.work('drain',{reason:'startup_failed'});await x.work('close');
 for(let i=0;i<2;i++){await x.start();await x.work('drain',{reason:'startup_failed'});await x.work('close');}
 assert.equal(await call(x.db,'h3_order_can_rent',[x.job.id,500000]),false);
 assert.equal((await x.db.query('select count(*)::int n from h3_pod_runs')).rows[0].n,3);
 }finally{await x.db.close();}
});
