import test from 'node:test';
import assert from 'node:assert/strict';
import {database,user,call} from './helpers/database.mjs';
import {checkGpuIdle} from '../workers/gpu-idle-worker.mjs';
import {onRequestPost} from '../functions/api/studio-production-worker.js';
import {mockSupabase} from './helpers/supabase-http.mjs';
async function fixture(db,projectId){
 const u=await user(db),project=projectId||crypto.randomUUID(),job=crypto.randomUUID(),lease=crypto.randomUUID();
 if(!projectId){
  const brand=await call(db,'studio_write',[u.id,'save_brand',crypto.randomUUID(),JSON.stringify({name:'Test',product:'Shoes'})]);
  await call(db,'studio_write',[u.id,'create_project',project,JSON.stringify({brandId:brand.id,title:'Test',aspectRatio:'9:16',scenes:[]})]);
 }
 await db.query("insert into studio_production_workers(id) values('budget-worker') on conflict(id) do nothing");
 await db.query("insert into studio_productions(id,user_id,project_id,initial_revision,expected_revision,snapshot,status,worker_id,lease_token,lease_expires_at) values($1,$2,$3,1,1,'{}','running','budget-worker',$4,now()+interval '5 minutes')",[job,u.id,project,lease]);
 return {job,lease,project};
}
const reserve=(db,f,key='image-0',kind='image')=>call(db,'reserve_production_spend',['budget-worker',f.job,f.lease,key,kind,1]);
test('budget ceiling serializes requests, survives new attempts, and never refunds unknown provider cost',async()=>{
 const db=await database();try{
  const f=await fixture(db);
  await db.exec('update production_spend_policy set project_limit=300000,total_limit=300000');
  const results=await Promise.allSettled([reserve(db,f),reserve(db,f,'image-1')]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
  assert.match(results.find(x=>x.status==='rejected').reason.message,/PRODUCTION_BUDGET_EXCEEDED/);
  assert.equal((await reserve(db,f)).estimated_microusd,300000);
  await call(db,'studio_production_work',['budget-worker','fail',f.job,f.lease,JSON.stringify({code:'PRODUCTION_PROVIDER'})]);
  const retry=await fixture(db,f.project);
  await assert.rejects(reserve(db,retry),/PRODUCTION_BUDGET_EXCEEDED/);
  const another=await fixture(db);await assert.rejects(reserve(db,another),/PRODUCTION_BUDGET_EXCEEDED/);
 }finally{await db.close();}
});
test('zero policy blocks route before starting the provider step; browser cannot edit budget',async()=>{
 const db=await database(),network=globalThis.fetch;
 try{
  const f=await fixture(db);await db.exec('update production_spend_policy set project_limit=0,total_limit=0');
  const stub=mockSupabase(db);globalThis.fetch=stub.fetch;
  const env={SUPABASE_URL:'http://supabase.test',SUPABASE_SERVICE_ROLE_KEY:'service',PRODUCTION_WORKER_TOKEN:'a'.repeat(40)};
  const r=await onRequestPost({env,request:new Request('https://app.test/api/studio-production-worker',{method:'POST',headers:{authorization:'Bearer '+env.PRODUCTION_WORKER_TOKEN,'content-type':'application/json'},body:JSON.stringify({action:'begin_step',workerId:'budget-worker',jobId:f.job,leaseToken:f.lease,data:{key:'image-0',stage:'images'}})})});
  assert.equal((await r.json()).code,'PRODUCTION_BUDGET_DISABLED');
  assert.deepEqual((await db.query('select steps from studio_productions where id=$1',[f.job])).rows[0].steps,{});
  await db.exec('set role authenticated');await assert.rejects(db.exec('update production_spend_policy set total_limit=999'),/permission denied/);
 }finally{globalThis.fetch=network;await db.close();}
});
test('idle shutdown waits for complete productions then prevents late claims',async()=>{
 const db=await database();try{
  const f=await fixture(db);await db.exec("update gpu_idle_control set idle_since=now()-interval '1 hour'");
  assert.equal((await call(db,'gpu_idle_check',[300])).stop,false);
  await db.exec("update studio_productions set status='failed'");
  assert.equal((await call(db,'gpu_idle_check',[300])).stop,false);
  await db.exec("update gpu_idle_control set idle_since=now()-interval '1 hour'");
  assert.equal((await call(db,'gpu_idle_check',[300])).stop,true);
  assert.equal(await call(db,'claim_generation',['late-worker']),null);
 }finally{await db.close();}
});
const env={GPU_IDLE_ACTION:'stop',GPU_MANAGED_EXCLUSIVE:'true',GPU_IDLE_ENABLED:'true',GPU_MANAGED_POD_ID:'allowed-pod',RUNPOD_API_KEY:'fixture',PRODUCTION_WORKER_TOKEN:'a'.repeat(40),CREATIVE_RUSH_URL:'https://app.test'};
test('GPU is never started, rented or stopped without an affirmative idle decision',async()=>{
 for(const reason of ['disabled','absent','busy','stop']){
  const calls=[];
  const fetchImpl=async(url,options)=>{calls.push([url,options.method]);if(url.endsWith('/gpu-idle'))return Response.json({stop:reason==='stop',reason:'busy'});if(url.endsWith('/stop'))return new Response(null,{status:200});return reason==='absent'?new Response(null,{status:404}):Response.json({id:'allowed-pod',desiredStatus:'RUNNING'});};
  await checkGpuIdle({...env,GPU_IDLE_ENABLED:reason==='disabled'?'false':'true'},{fetchImpl});
  assert.equal(calls.filter(([url])=>url.endsWith('/stop')).length,reason==='stop'?1:0);
  assert.ok(calls.every(([url,method])=>method==='GET'||url.endsWith('/gpu-idle')||url.endsWith('/stop')));
 }
 await assert.rejects(checkGpuIdle(env,{fetchImpl:async()=>new Response(null,{status:500})}),/GPU_STATUS_UNAVAILABLE/);
});
