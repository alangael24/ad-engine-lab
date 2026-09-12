import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import Stripe from 'stripe';
import {database,user,balance} from './helpers/database.mjs';
import {mockSupabase} from './helpers/supabase-http.mjs';
import * as jobs from '../functions/api/generations/index.js';
import * as item from '../functions/api/generations/[id].js';
import * as refs from '../functions/api/references.js';
import * as worker from '../functions/api/worker.js';
import * as webhook from '../functions/api/stripe/webhook.js';
let db,stub,originalFetch;
const env={SUPABASE_URL:'http://supabase.test',SUPABASE_SERVICE_ROLE_KEY:'test-server-key',GENERATION_ENABLED:'true',
  GENERATION_WORKER_TOKEN:'local-test-worker-secret-not-a-real-key-12345',STRIPE_WEBHOOK_SECRET:'whsec_test_only',APP_URL:'https://app.test'};
before(async()=>{db=await database();stub=mockSupabase(db);originalFetch=globalThis.fetch;globalThis.fetch=stub.fetch;});
after(async()=>{globalThis.fetch=originalFetch;await db.close();});
const context=(resource,token,method='GET',body,params={})=>({env,params,request:new Request(`https://app.test${resource}`,{
  method,headers:{authorization:`Bearer ${token}`,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),
})});
const runWorker=body=>worker.onRequestPost(context('/api/worker',env.GENERATION_WORKER_TOKEN,'POST',{workerId:'test-gpu',...body}));
test('real API flow: auth, private reference, enqueue, worker, upload, download and ownership',async()=>{
  const a=await user(db),b=await user(db);stub.users.set('alice',a);stub.users.set('bob',b);
  assert.equal((await jobs.onRequestGet(context('/api/generations','invalid'))).status,401);
  assert.equal((await runWorker({action:'claim'})).status,200);
  const uploadContext={env,request:new Request('https://app.test/api/references',{method:'POST',headers:{authorization:'Bearer alice','content-type':'image/png'},body:new Uint8Array([137,80,78,71,13,10,26,10,1,2,3])})};
  const referenceResponse=await refs.onRequestPost(uploadContext);assert.equal(referenceResponse.status,201);
  const referenceId=(await referenceResponse.json()).referenceId;
  const body={requestId:crypto.randomUUID(),prompt:'Un video de producto para mi tienda',durationSeconds:5,resolution:'720p',aspectRatio:'9:16',referenceId};
  const response=await jobs.onRequestPost(context('/api/generations','alice','POST',body)); assert.equal(response.status,202);
  const {job}=await response.json();assert.equal(await balance(db,a),11);
  assert.equal((await jobs.onRequestPost(context('/api/generations','alice','POST',body))).status,202);assert.equal(await balance(db,a),11);
  assert.equal((await item.onRequestGet(context('/api/generations/'+job.id,'bob','GET',null,{id:job.id}))).status,404);
  const claimed=(await (await runWorker({action:'claim'})).json()).job;assert.equal(claimed.id,job.id);assert.ok(claimed.referenceUrl);
  const identity={jobId:job.id,leaseToken:claimed.leaseToken};
  const queueId='rp:exampleendpoint:'+crypto.randomUUID()+'-u1';
  assert.equal((await runWorker({action:'heartbeat',...identity,submissionStarted:true,providerPromptId:queueId})).status,200);
  assert.equal((await runWorker({action:'heartbeat',...identity,providerPromptId:queueId})).status,200);
  assert.equal((await runWorker({action:'heartbeat',...identity,providerPromptId:'https://untrusted.test/id'})).status,400);
  assert.equal((await db.query('select provider_prompt_id from generation_jobs where id=$1',[job.id])).rows[0].provider_prompt_id,queueId);
  assert.equal((await runWorker({action:'complete',...identity})).status,409,'cannot complete a missing video');
  const upload=(await (await runWorker({action:'upload',...identity})).json()).uploadUrl;
  await stub.fetch(upload,{method:'PUT',headers:{'content-type':'video/mp4'},body:new Blob(['test-video'])});
  const finished=await runWorker({action:'complete',...identity}); assert.equal(finished.status,200,await finished.clone().text());
  const downloaded=await item.onRequestGet(context('/api/generations/'+job.id,'alice','GET',null,{id:job.id}));
  const payload=await downloaded.json();assert.equal(payload.job.status,'succeeded');assert.ok(payload.resultUrl.includes('token='));
  const history=await (await jobs.onRequestGet(context('/api/generations','alice'))).json();assert.equal(history.jobs.length,1);assert.equal(history.balance.video_credits,11);
  assert.ok(!JSON.stringify(history).includes(claimed.leaseToken));
});
test('disabled provider and unsigned callbacks cannot mutate balances',async()=>{
  const a=await user(db);stub.users.set('disabled-user',a);
  const ctx=context('/api/generations','disabled-user','POST',{requestId:crypto.randomUUID(),prompt:'Otro video para la tienda',durationSeconds:5,resolution:'720p',aspectRatio:'9:16'});
  ctx.env={...env,GENERATION_ENABLED:'false'};
  assert.equal((await jobs.onRequestPost(ctx)).status,503);assert.equal(await balance(db,a),12);
  assert.equal((await worker.onRequestPost(context('/api/worker','bad','POST',{action:'claim',workerId:'attacker'}))).status,401);
});
test('signed Stripe test event provisions SaaS, redirects to tool and cannot credit twice',async()=>{
  const stripe=new Stripe('test-unused');
  const event={id:'evt_test_saas',type:'checkout.session.completed',data:{object:{id:'cs_test_saas_purchase',payment_status:'paid',
    payment_link:'plink_1U8z8uEudyi7fxH7OsFRKvC9',amount_total:99900,currency:'mxn',customer_details:{email:'new-buyer@example.test'}}}};
  const payload=JSON.stringify(event);
  const signature=stripe.webhooks.generateTestHeaderString({payload,secret:env.STRIPE_WEBHOOK_SECRET});
  const ctx=()=>({env,request:new Request('https://app.test/api/stripe/webhook',{method:'POST',headers:{'stripe-signature':signature},body:payload})});
  const invalid={env,request:new Request('https://app.test/api/stripe/webhook',{method:'POST',body:payload})};
  assert.equal((await webhook.onRequestPost(invalid)).status,400);
  const first=await webhook.onRequestPost(ctx());assert.equal(first.status,200,await first.clone().text());assert.equal((await first.json()).applied,true);
  const second=await webhook.onRequestPost(ctx());assert.equal((await second.json()).applied,false);
  assert.equal(stub.invites.at(-1).redirectTo,'https://app.test/herramienta/');
  const purchase=(await db.query("select course_access,video_credits from purchases where checkout_session_id='cs_test_saas_purchase'")).rows[0];
  assert.equal(purchase.course_access,false);assert.equal(purchase.video_credits,12);
});
