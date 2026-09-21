import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {database,call,ready,reserve} from './helpers/database.mjs';
import {mockSupabase} from './helpers/supabase-http.mjs';
import Stripe from 'stripe';
import {readFile} from 'node:fs/promises';
import {deliverySettled} from '../src/video-packages.js';
import {getSupabaseAdmin} from '../src/backend.js';
import {VIDEO_PACKAGES} from '../src/video-packages.js';
import * as checkout from '../functions/api/checkout.js';
import * as webhook from '../functions/api/stripe/webhook.js';
import * as account from '../functions/api/account.js';
let db,stub,originalFetch;
const env={SUPABASE_URL:'http://supabase.test',SUPABASE_SERVICE_ROLE_KEY:'test-only',STRIPE_WEBHOOK_SECRET:'whsec_test_seconds',APP_URL:'https://app.test'};
before(async()=>{db=await database({seconds:false});for(const file of ['20260915073916_managed_h3_pod_lifecycle.sql','20260915081955_managed_pod_failed_start_refunds.sql','20260915170257_managed_pod_boot_progress.sql','20260916221655_managed_h3_attempt_recovery.sql','20260917022634_video_seconds_packages.sql','20260921203307_gift_movie_packages.sql'])await db.exec(await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));stub=mockSupabase(db);originalFetch=globalThis.fetch;globalThis.fetch=stub.fetch;});
after(async()=>{globalThis.fetch=originalFetch;await db.close();});
async function buyer(plan='minute_1'){
 const u={id:crypto.randomUUID(),email:crypto.randomUUID()+'@example.test',email_confirmed_at:new Date().toISOString()};
 await db.query('insert into auth.users(id,email) values($1,$2)',[u.id,u.email]);stub.users.set(u.id,u);
 if(plan)await purchase(u,plan);return u;
}
async function purchase(u,plan,session='cs_'+crypto.randomUUID()){
 const p=VIDEO_PACKAGES[plan];return call(db,'apply_video_seconds_purchase',['evt_'+crypto.randomUUID(),session,p.paymentLinkId,u.email,null,plan,p.amount*100,'mxn','paid']);
}
async function fixture(u){
 const write=(action,id,data,expected=null)=>call(db,'studio_write',[u.id,action,id,JSON.stringify(data),expected]);
 const photo=crypto.randomUUID();await write('register_asset',photo,{kind:'image',name:'Product',bucket:'generation-references',storage_path:`${u.id}/${photo}.png`,mime_type:'image/png',size_bytes:100});
 const b=await write('save_brand',crypto.randomUUID(),{name:'Test',product:'Filter',appearance:'Chrome',claims:'Filters',avoid:'',productAssetId:photo});
 const p=await write('create_project',crypto.randomUUID(),{title:'Test',brandId:b.id,aspectRatio:'9:16',referenceUrl:'',referenceNotes:'',scriptDraft:'Conoce nuestro producto.',scenes:[],narrationAssetId:null});
 await db.query("insert into studio_production_workers(id) values('seconds-test') on conflict(id) do update set last_seen_at=now()");
 return {u,p,write,photo};
}
const start=(f,id=crypto.randomUUID())=>call(db,'studio_production_start',[f.u.id,id,f.p.id,f.p.revision,true]);
const work=(j,action,data={})=>call(db,'studio_production_work',['seconds-test',action,j.id,j.lease_token,JSON.stringify(data)]);
async function claim(initial){let j;do{j=await call(db,'studio_production_work',['seconds-test','claim']);if(j.id!==initial.id)await work(j,'fail',{code:'TEST_SKIP'});}while(j.id!==initial.id);return j;}
async function seconds(u){return (await db.query('select video_seconds from credit_balances where user_id=$1',[u.id])).rows[0].video_seconds;}
async function timing(j,duration){await work(j,'begin_step',{key:'timing'});return work(j,'finish_step',{key:'timing',result:[{id:crypto.randomUUID(),start:0,end:duration}]});}
async function deliver(j,duration,passed=true){
 const rid=crypto.randomUUID();
 await db.query("insert into studio_renders(id,user_id,project_id,project_revision,request_id,manifest,status,production_id,quality_status,result_path) values($1,$2,$3,$4,$5,$6,'succeeded',$7,$8,$9)",[rid,j.user_id,j.project_id,j.expected_revision,crypto.randomUUID(),JSON.stringify({scenes:[{start:0,end:duration}]}),j.id,passed?'passed':'pending',`${j.user_id}/${rid}.mp4`]);
 await work(j,'complete',{key:'completed',renderId:rid});return rid;
}
test('exact package entitlements; replayed webhook cannot credit twice or be redirected',async()=>{
 for(const p of Object.values(VIDEO_PACKAGES)){
  const u=await buyer(null),other=await buyer(null),session='cs_'+crypto.randomUUID();
  const object={id:session,payment_status:'paid',payment_link:p.paymentLinkId,currency:'mxn',amount_total:p.amount*100,customer_details:{email:u.email},client_reference_id:other.id};
  async function send(type){const payload=JSON.stringify({id:'evt_'+crypto.randomUUID(),type,data:{object}});const signature=new Stripe('unused').webhooks.generateTestHeaderString({payload,secret:env.STRIPE_WEBHOOK_SECRET});return webhook.onRequestPost({env,request:new Request('https://app.test/api/stripe/webhook',{method:'POST',headers:{'stripe-signature':signature},body:payload})});}
  assert.equal((await send('checkout.session.completed')).status,200);
  assert.equal((await (await send('checkout.session.async_payment_succeeded')).json()).applied,false);
  assert.equal(await seconds(u),p.videoSeconds);assert.equal(await seconds(other),0);
  assert.equal((await db.query('select count(*)::int n from credit_ledger where user_id=$1',[u.id])).rows[0].n,0);
 }
});
test('wrong currency, amount, unpaid or unsigned requests cannot grant seconds',async()=>{
 const u=await buyer(null),p=VIDEO_PACKAGES.minute_1;
 for(const overrides of [{amount_total:1},{currency:'usd'},{payment_status:'unpaid'},{payment_status:'no_payment_required'}]){
  const payload=JSON.stringify({id:'evt_'+crypto.randomUUID(),type:'checkout.session.completed',data:{object:{id:'cs_'+crypto.randomUUID(),payment_status:'paid',payment_link:p.paymentLinkId,currency:'mxn',amount_total:50000,customer_details:{email:u.email},...overrides}}});
  const signature=new Stripe('unused').webhooks.generateTestHeaderString({payload,secret:env.STRIPE_WEBHOOK_SECRET});
  await webhook.onRequestPost({env,request:new Request('https://app.test/api/stripe/webhook',{method:'POST',headers:{'stripe-signature':signature},body:payload})});
 }
 assert.equal(await seconds(u),0);
 assert.equal((await webhook.onRequestPost({env,request:new Request('https://app.test/api/stripe/webhook',{method:'POST',body:'{}'})})).status,400);
});
test('checkout only selects fixed MXN packages and locks the verified buyer email',async()=>{
 const u=await buyer(null);
 for(const p of Object.values(VIDEO_PACKAGES)){
  const response=await checkout.onRequestPost({env,request:new Request('https://app.test/api/checkout',{method:'POST',headers:{authorization:'Bearer '+u.id,'content-type':'application/json'},body:JSON.stringify({plan:p.code,amount:1,videoSeconds:9000,email:'other@example.test'})})});
  assert.equal(response.status,200);const body=await response.json();assert.equal(body.amount,p.amount);assert.equal(body.videoSeconds,p.videoSeconds);assert.equal(new URL(body.url).searchParams.get('locked_prefilled_email'),u.email);
 }
});
test('four 15-second deliveries consume a 60-second purchase, with no duplicate charge on replay',async()=>{
 const u=await buyer();
 for(let i=0;i<4;i++){
  const f=await fixture(u),initial=await start(f);assert.equal((await start(f,initial.id)).id,initial.id);
  const j=await claim(initial);await timing(j,15);await deliver(j,15);
  assert.equal(await seconds(u),60-(i+1)*15);
  await assert.rejects(work(j,'complete',{key:'completed',renderId:crypto.randomUUID()}),/LEASE_LOST/);
  assert.equal(await seconds(u),60-(i+1)*15);
 }
 await assert.rejects(start(await fixture(u)),/INSUFFICIENT_VIDEO_SECONDS/);
});
test('held seconds cannot be overspent by a concurrent project; voice timing releases unused capacity',async()=>{
 const u=await buyer(),f=await fixture(u),g=await fixture(u),j=await claim(await start(f));
 await assert.rejects(start(g),/INSUFFICIENT_VIDEO_SECONDS/);
 await timing(j,15);assert.equal(await seconds(u),45);
 await assert.rejects(start(g),/PRODUCTION_BUSY/);assert.equal(await seconds(u),45);
 await work(j,'fail',{code:'PRODUCTION_PROVIDER'});assert.equal(await seconds(u),60);
 const next=await start(g);assert.equal(await seconds(u),0);
 await db.query("update studio_productions set status='failed',error_code='PRODUCTION_TIMEOUT' where id=$1",[next.id]);assert.equal(await seconds(u),60);
});
test('overlong narration stops before images; failure/expiry and changed-project retries release once',async()=>{
 const u=await buyer(),f=await fixture(u),j=await claim(await start(f));
 await assert.rejects(timing(j,61),/VIDEO_DURATION_LIMIT/);
 await assert.rejects(work(j,'begin_step',{key:'image-0'}),/VIDEO_DURATION_LIMIT/);
 await f.write('save_project',f.p.id,{...f.p.data,title:'Changed'},f.p.revision);
 await work(j,'fail',{code:'STUDIO_CONFLICT'});assert.equal(await seconds(u),60);
 await assert.rejects(work(j,'fail',{code:'STUDIO_CONFLICT'}),/LEASE_LOST/);assert.equal(await seconds(u),60);
});
test('actual delivered duration settles; an unreviewed render cannot spend or deliver',async()=>{
 const u=await buyer(),f=await fixture(u),j=await claim(await start(f));await timing(j,40);
 await assert.rejects(deliver(j,35,false),/PRODUCTION_QUALITY_REQUIRED/);assert.equal(await seconds(u),20);
 await deliver(j,35);assert.equal(await seconds(u),25);
});
test('images and GPU retries for a funded production never debit or refund legacy credits',async()=>{
 const u=await buyer(),f=await fixture(u),j=await claim(await start(f));await timing(j,5);
 await work(j,'begin_step',{key:'image-0',stage:'images'});await work(j,'finish_step',{key:'image-0',result:{assetId:f.photo}});
 await ready(db);
 const scene={id:crypto.randomUUID(),text:f.p.data.scriptDraft,visual:'Product front',start:0,end:5,imageAssetId:f.photo,selectedVersionId:null};
 await work(j,'write',{key:'prepare',action:'save_project',data:{...f.p.data,scenes:[scene]}});
 const request={requestId:crypto.randomUUID(),sceneId:scene.id,prompt:'Product front camera moves gently',assetId:null};
 const v=await work(j,'write',{key:'clip-0',action:'version',data:request});
 const job=(await db.query('select * from generation_jobs where id=$1',[v.result.job_id])).rows[0];
 assert.equal(job.credit_cost,0);assert.equal(job.seconds_production_id,j.id);
 await call(db,'refund_generation',[job.id,'failed','TEST_GPU_FAIL']);
 const b=(await db.query('select video_credits,image_credits from credit_balances where user_id=$1',[u.id])).rows[0];assert.deepEqual(b,{video_credits:0,image_credits:0});
 await assert.rejects(reserve(db,u),/INSUFFICIENT_CREDITS/);
 await work(j,'fail',{code:'PRODUCTION_PROVIDER'});assert.equal(await seconds(u),60);
});
test('browser roles cannot mint seconds, resize holds, or read another customer ledger',async()=>{
 for(const role of ['anon','authenticated']){
  await db.exec('set role '+role);
  try{await assert.rejects(db.query('select * from video_seconds_reservations'),/permission denied/);await assert.rejects(db.query('select * from video_seconds_ledger'),/permission denied/);await assert.rejects(call(db,'adjust_video_seconds',[crypto.randomUUID(),1,'settle']),/permission denied/);await assert.rejects(call(db,'apply_video_seconds_purchase',['evt_x','cs_x','link','x@example.test',null,'minute_1',50000,'mxn','paid']),/permission denied/);}finally{await db.exec('reset role');}
 }
});
test('customer account reports available and held seconds independently of old clip credits',async()=>{
 const u=await buyer(),f=await fixture(u);await start(f);
 const response=await account.onRequestGet({env,request:new Request('https://app.test/api/account',{headers:{authorization:'Bearer '+u.id}})});const data=await response.json();
 assert.deepEqual(data.seconds,{available:0,reserved:60,enabled:true});assert.equal(data.balance.video_credits,0);
});

test('paid packages can exceed the former five-delivery pilot limit',async()=>{
 const u=await buyer('minute_8');
 for(let i=0;i<8;i++){const j=await claim(await start(await fixture(u)));await timing(j,15);await deliver(j,15);}
 assert.equal(await seconds(u),360);
});
test('service role applies paid entitlements; paid access preserves the global switch and spending caps',async()=>{
 const {productionAccess}=await import('../src/studio-production.js');
 const u=await buyer(null);await db.exec('set role service_role');
 try{await purchase(u,'minute_1');}finally{await db.exec('reset role');}
 const admin=getSupabaseAdmin(env),rollout={PRODUCTION_ENABLED:'true',PRODUCTION_ALLOWED_USERS:'pilot-only'};
 assert.equal(await productionAccess(admin,rollout,u.id),true);
 assert.equal(await productionAccess(admin,{...rollout,PRODUCTION_ENABLED:'false'},u.id),false);
 const outsider=await buyer(null);assert.equal(await productionAccess(admin,rollout,outsider.id),false);
 const j=await claim(await start(await fixture(u)));
 await db.query('update production_spend_policy set allowed_user_ids=$1',[[]]);
 try{
  await call(db,'reserve_production_spend',['seconds-test',j.id,j.lease_token,'plan','planning',1]);
  await call(db,'account_production_spend',['seconds-test',j.id,j.lease_token,'plan','reserve',12000]);
  await db.query('update production_spend_policy set total_limit=1');
  await assert.rejects(call(db,'reserve_production_spend',['seconds-test',j.id,j.lease_token,'image','image',1]),/PRODUCTION_BUDGET_EXCEEDED/);
 }finally{await db.query('update production_spend_policy set allowed_user_ids=null,total_limit=10000000000');await work(j,'fail',{code:'TEST_END'});}
});
test('a reviewed render stays gated until its seconds transaction is settled',async()=>{
 const u=await buyer(),j=await claim(await start(await fixture(u))),admin=getSupabaseAdmin(env);
 const rid=crypto.randomUUID();
 assert.equal(await deliverySettled(admin,{id:rid,production_id:j.id}),false);
 const delivered=await deliver(j,15);
 assert.equal(await deliverySettled(admin,{id:delivered,production_id:j.id}),true);
 assert.equal(await deliverySettled(admin,{id:rid,production_id:j.id}),false);
});
test('only scoped edits retaining paid script and source clips can reuse their duration entitlement',async()=>{
 const u=await buyer(),f=await fixture(u),j=await claim(await start(f)),scene={id:crypto.randomUUID(),text:f.p.data.scriptDraft,selectedVersionId:crypto.randomUUID(),start:0,end:15};
 const rid=await deliver(j,15);
 await db.query('update studio_renders set manifest=$1 where id=$2',[JSON.stringify({scenes:[{...scene,versionId:scene.selectedVersionId}]}),rid]);
 const edit={...f.p.data,scenes:[scene],editing:{scoped:true,baseRenderId:rid}};
 // Isolate the balance wrapper from the editor renderer's own validation.
 await db.query('update studio_projects set data=$1 where id=$2',[JSON.stringify(edit),f.p.id]);
 const same=await start(f);
 assert.equal((await db.query('select included_seconds from video_seconds_reservations where production_id=$1',[same.id])).rows[0].included_seconds,15);
 await db.query("update studio_productions set status='failed' where id=$1",[same.id]);
 await db.query('update studio_projects set data=$1 where id=$2',[JSON.stringify({...edit,scriptDraft:'A completely different ad'}),f.p.id]);
 const different=await start(f);
 assert.equal((await db.query('select included_seconds from video_seconds_reservations where production_id=$1',[different.id])).rows[0].included_seconds,0);
 await db.query("update studio_productions set status='failed' where id=$1",[different.id]);
});

test('two-minute creator gift reserves, settles and replays exactly 120 seconds; ads stay capped',async()=>{
 const u=await buyer('gift_120');
 await db.query("insert into studio_production_workers(id) values('seconds-test') on conflict(id) do update set last_seen_at=now()");
 const data={productProfile:'creator-v1',creatorBrief:{kind:'story',targetDuration:120},title:'Regalo',brandId:null,idea:'Una historia familiar',aspectRatio:'16:9',scriptDraft:'Nuestra historia empieza aquí.',scenes:[],narrationAssetId:null};
 const p=await call(db,'studio_write',[u.id,'create_project',crypto.randomUUID(),JSON.stringify(data),null]);
 const f={u,p};const initial=await start(f);assert.equal(await seconds(u),0);
 assert.equal((await start(f,initial.id)).id,initial.id);assert.equal(await seconds(u),0);
 const j=await claim(initial);await assert.rejects(timing(j,121),/VIDEO_DURATION_LIMIT/);
 await work(j,'finish_step',{key:'timing',result:[{id:crypto.randomUUID(),start:0,end:120}]});await deliver(j,120);assert.equal(await seconds(u),0);
 await assert.rejects(start({u,p},crypto.randomUUID()),/INSUFFICIENT_VIDEO_SECONDS|STUDIO_CONFLICT/);
 const adBuyer=await buyer('gift_120'),ad=await fixture(adBuyer),adJob=await claim(await start(ad));
 await assert.rejects(timing(adJob,61),/VIDEO_DURATION_LIMIT/);await work(adJob,'fail',{code:'PRODUCTION_PROVIDER'});assert.equal(await seconds(adBuyer),120);
});
test('failed two-minute gifts refund once; a one-minute balance cannot fund a two-minute delivery',async()=>{
 for(const plan of ['gift_60','gift_120']){
  const u=await buyer(plan),p=await call(db,'studio_write',[u.id,'create_project',crypto.randomUUID(),JSON.stringify({productProfile:'creator-v1',creatorBrief:{kind:'story',targetDuration:120},title:'Regalo',brandId:null,idea:'Familia',aspectRatio:'16:9',scriptDraft:'Una historia.',scenes:[],narrationAssetId:null}),null]);
  const j=await claim(await start({u,p}));
  if(plan==='gift_60')await assert.rejects(timing(j,120),/INSUFFICIENT_VIDEO_SECONDS/);else await timing(j,120);
  await work(j,'fail',{code:'PRODUCTION_PROVIDER'});assert.equal(await seconds(u),VIDEO_PACKAGES[plan].videoSeconds);
  await assert.rejects(work(j,'fail',{code:'PRODUCTION_PROVIDER'}),/LEASE_LOST/);assert.equal(await seconds(u),VIDEO_PACKAGES[plan].videoSeconds);
 }
});
