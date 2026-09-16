import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {database,user,ready,reserve,call,balance} from './helpers/database.mjs';
import {mockSupabase} from './helpers/supabase-http.mjs';
import {onRequestPost as workerRoute} from '../functions/api/worker.js';
import {onRequestPost as podRoute} from '../functions/api/gpu-pod.js';
import {createApi,processJob} from '../workers/h3-worker.mjs';
const env={SUPABASE_URL:'http://supabase.test',SUPABASE_SERVICE_ROLE_KEY:'test-only',H3_BACKEND:'pod',GENERATION_ENABLED:'true',GENERATION_WORKER_TOKEN:'generation-test-only-01234567890123456789',PRODUCTION_WORKER_TOKEN:'production-test-only-01234567890123456789'};
async function fixture(){
 const db=await database();for(const file of ['20260915073916_managed_h3_pod_lifecycle.sql','20260915081955_managed_pod_failed_start_refunds.sql','20260915170257_managed_pod_boot_progress.sql','20260916221655_managed_h3_attempt_recovery.sql'])await db.exec(await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
 await db.exec('update h3_pod_control set enabled=true,total_limit_microusd=5000000');
 const u=await user(db);await ready(db);const reserved=await reserve(db,u);
 const state=await call(db,'h3_pod_work',['controller','acquire']);
 const work=(action,data={})=>call(db,'h3_pod_work',['controller',action,state.token,{...(action==='begin'?{imageDigest:'ghcr.io/alangael24/creativerush-h3-pod@sha256:'+'a'.repeat(64)}:{}),...data}]);
 const run=(await work('begin')).run;await work('attach',{podId:'abcdefgh'});await call(db,'h3_pod_ready',[run.id,run.worker_prefix]);
 const stub=mockSupabase(db),original=globalThis.fetch;globalThis.fetch=stub.fetch;
 const api=createApi({appUrl:'https://app.test',token:env.GENERATION_WORKER_TOKEN,workerId:run.worker_prefix+'_cpu',fetchImpl:(url,opts)=>workerRoute({env,request:new Request(url,opts)})});
 const close=()=>podRoute({env,request:new Request('https://app.test/api/gpu-pod',{method:'POST',headers:{authorization:'Bearer '+env.PRODUCTION_WORKER_TOKEN,'content-type':'application/json'},body:JSON.stringify({owner:'controller',action:'close',token:state.token})})});
 return {db,u,reserved,api,work,run,stub,close,cleanup:async()=>{globalThis.fetch=original;await db.close();}};
}
test('managed worker, API, PostgreSQL and Storage persist an attempt-specific result after lost upload ACK',async()=>{
 const x=await fixture();try{
 const {job}=await x.api('claim',{backend:'comfy'});assert.ok(job.managedAttemptId);assert.ok(Number.isSafeInteger(job.noiseSeed));
 let renders=0,puts=0;const adapter={build:async()=>({}),submit:async()=>crypto.randomUUID(),wait:async()=>{renders++;return new Blob(['video'],{type:'video/mp4'});}};
 const outcome=await processJob(job,x.api,adapter,{clock:{now:()=>Date.now(),sleep:async()=>{},setInterval:()=>1,clearInterval:()=>{}},fetchImpl:async(url,opts)=>{puts++;await x.stub.fetch(url,opts);throw Error('lost upload response');}});
 assert.equal(outcome.status,'succeeded');assert.equal(renders,1);assert.equal(puts,1);assert.equal(await balance(x.db,x.u),11);
 const j=(await x.db.query('select * from generation_jobs where id=$1',[job.id])).rows[0];assert.equal(j.result_path,`${x.u.id}/${job.id}/${job.managedAttemptId}.mp4`);
 }finally{await x.cleanup();}
});
test('controller closure waits through Storage outage and then recovers the existing clip without a refund',async()=>{
 const x=await fixture();try{
 const {job}=await x.api('claim',{backend:'comfy'}),identity={jobId:job.id,leaseToken:job.leaseToken};
 const {uploadUrl}=await x.api('upload',identity);await x.stub.fetch(uploadUrl,{method:'PUT',headers:{'content-type':'video/mp4'},body:new Blob(['video'])});
 await x.work('drain',{reason:'host_failed'});
 globalThis.fetch=(input,options)=>new URL(input instanceof Request?input.url:input).pathname.includes('/object/info/')?Promise.resolve(Response.json({statusCode:503,message:'Storage unavailable'},{status:503})):x.stub.fetch(input,options);
 assert.notEqual((await x.close()).status,200);
 assert.equal((await x.db.query('select phase from h3_pod_runs')).rows[0].phase,'draining');assert.equal(await balance(x.db,x.u),11);
 globalThis.fetch=x.stub.fetch;
 assert.equal((await x.close()).status,200);
 assert.equal((await x.db.query('select status from generation_jobs')).rows[0].status,'succeeded');assert.equal(await balance(x.db,x.u),11);
 }finally{await x.cleanup();}
});
