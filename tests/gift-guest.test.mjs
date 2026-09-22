import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {database,call} from './helpers/database.mjs';
import {mockSupabase} from './helpers/supabase-http.mjs';
import {guestGet,guestPost,randomToken,digest,fulfillGuest} from '../src/gift-guest.js';
import {getGiftOrder,postGiftOrder} from '../src/gift-orders.js';
import {getSupabaseAdmin} from '../src/backend.js';
import {VIDEO_PACKAGES} from '../src/video-packages.js';
import {getGiftAdmin} from '../src/gift-admin.js';
import {whatsappPhone} from '../assets/gift-whatsapp-model.js';
import {sendGiftMail} from '../src/gift-mail.js';
import Stripe from 'stripe';
import {onRequestPost as webhook} from '../functions/api/stripe/webhook.js';
let db,stub,original;
const env={SUPABASE_URL:'http://supabase.test',SUPABASE_SERVICE_ROLE_KEY:'test-only',GIFT_GUEST_ENABLED:'true',RESEND_API_KEY:'fake',GIFT_EMAIL_FROM:'Regalos <test@example.test>',GIFT_EMAIL_VERIFIED:'true'};
const fields={recipient:'Ana',names:'Ana y Luis',occasion:'anniversary',memory1:'Nos conocimos en un café.',look:'3d',tone:'warm',ratio:'9:16',package:'gift_60'};
const png=new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0]);
before(async()=>{db=await database();await db.exec(await readFile(new URL('../supabase/migrations/20260922002237_gift_guest_checkout.sql',import.meta.url),'utf8'));await db.exec(await readFile(new URL('../supabase/migrations/20260922015331_gift_whatsapp_delivery.sql',import.meta.url),'utf8'));await db.exec(await readFile(new URL('../supabase/migrations/20260922020036_gift_whatsapp_after_payment.sql',import.meta.url),'utf8'));stub=mockSupabase(db);original=globalThis.fetch;globalThis.fetch=stub.fetch;});
after(async()=>{globalThis.fetch=original;await db.close();});
const context=(path,{body,token,access,bytes,customEnv=env}={})=>({env:customEnv,request:new Request('https://app.test/api/gift-guest'+path,{method:body||bytes?'POST':'GET',headers:{'cf-connecting-ip':'192.0.2.1',...(token?{'x-gift-draft':token}:{}),...(access?{'x-gift-access':access}:{}),'content-type':bytes?'image/png':'application/json'},body:bytes|| (body?JSON.stringify(body):undefined)})});
async function draft(photo=false){const d={id:crypto.randomUUID(),token:randomToken(),fields,photos:photo?[{id:crypto.randomUUID(),label:'Ana',hash:await digest(png),mime:'image/png',size:png.length}]:[]};const r=await guestPost(context('?create=1',{body:d}));assert.equal(r.status,200,await r.text());return d;}
async function checkout(d,plan='gift_60'){const r=await guestPost(context(`?draft=${d.id}&checkout=1`,{body:{plan},token:d.token}));assert.equal(r.status,200);return r.json();}
const session=(c,plan='gift_60')=>({id:'cs_test_'+crypto.randomUUID(),client_reference_id:new URL(c.url).searchParams.get('client_reference_id'),customer_details:{email:crypto.randomUUID()+'@example.test'},payment_status:'paid',currency:'mxn',amount_total:VIDEO_PACKAGES[plan].amount*100});
const fulfill=(s,plan='gift_60')=>fulfillGuest(getSupabaseAdmin(env),{id:'evt_'+s.id},s,VIDEO_PACKAGES[plan],VIDEO_PACKAGES[plan].paymentLinkId);
test('feature stays closed until sender and provider are configured',async()=>{assert.equal((await (await guestGet(context('?config=1',{customEnv:{...env,RESEND_API_KEY:''}}))).json()).enabled,false);assert.equal((await guestPost(context('?create=1',{body:{},customEnv:{...env,GIFT_EMAIL_VERIFIED:'false'}}))).status,503);});
test('private draft uploads are bounded, hash locked, required before payment and inaccessible without secret',async()=>{
 const d=await draft(true);assert.equal((await guestGet(context('?draft='+d.id,{token:randomToken()}))).status,404);
 assert.equal((await guestPost(context(`?draft=${d.id}&checkout=1`,{body:{plan:'gift_60'},token:d.token}))).status,400);
 const path=`?draft=${d.id}&upload=${d.photos[0].id}`;
 assert.equal((await guestPost(context(path,{token:d.token,bytes:new Uint8Array([1,2,3])}))).status,400);
 assert.equal((await guestPost(context(path,{token:d.token,bytes:png}))).status,200);
 assert.equal((await guestPost(context(path,{token:d.token,bytes:png}))).status,200);
 const c=await checkout(d);assert.equal(new URL(c.url).searchParams.has('locked_prefilled_email'),false);
 const s=session(c),first=await fulfill(s);assert.equal(first.applied,true);assert.equal((await fulfill(s)).applied,false);
 const c2=await checkout(d);assert.equal(c2.paid,true);
 const assets=(await db.query('select * from studio_assets where storage_path like $1',[`gift-orders/${first.orderId}/%`])).rows;assert.equal(assets.length,1);
 const account=Array.from(stub.users.values()).find(u=>u.email===s.customer_details.email);assert.equal(account.email_confirmed_at,null);assert.equal(stub.invites.length,0);
 const access=new URL(c.portal,'https://app.test').hash.slice(6);
 const r=await getGiftOrder(context('?id='+first.orderId,{access}));assert.equal(r.status,200);assert.equal((await r.json()).canAdmin,false);
 assert.equal((await getGiftOrder(context('?id='+crypto.randomUUID(),{access}))).status,404);
 assert.equal((await getGiftOrder(context('',{access}))).status,404);
 const o=await call(db,'gift_order_operator',[first.orderId,'script',1,{script:'Te conocí tomando café.'}]);
 const approve={id:first.orderId,action:'approve',expected:o.revision};assert.equal((await postGiftOrder(context('',{access,body:approve}))).status,200);assert.equal((await postGiftOrder(context('',{access,body:approve}))).status,200);
 assert.equal((await postGiftOrder(context('',{access,body:{...approve,action:'package',seconds:120}}))).status,400);
 const counts=await db.query('select count(*)::int n from video_seconds_ledger where external_id=$1',['gift:'+first.orderId+':reserve']);assert.equal(counts.rows[0].n,1);
});
test('package snapshots, price validation, independent second purchases, and webhook retries',async()=>{
 const d=await draft(),c60=await checkout(d),c120=await checkout(d,'gift_120');
 assert.equal((await checkout(d)).url,c60.url);
 const wrong=session(c60);wrong.amount_total=1;await assert.rejects(fulfill(wrong),/GIFT_INVALID/);
 await assert.rejects(fulfill(session(c60),'gift_120'),/GIFT_INVALID/);
 const s=session(c120,'gift_120'),one=await fulfill(s,'gift_120');
 assert.equal((await db.query('select target_seconds from gift_orders where id=$1',[one.orderId])).rows[0].target_seconds,120);
 const twoSession={...s,id:'cs_test_'+crypto.randomUUID()},two=await fulfill(twoSession,'gift_120');assert.notEqual(one.orderId,two.orderId);assert.equal((await fulfill(twoSession,'gift_120')).applied,false);
 assert.equal((await db.query('select video_seconds from credit_balances where user_id=(select user_id from gift_orders where id=$1)',[one.orderId])).rows[0].video_seconds,240);
 const sql=await db.query('select count(*)::int n from gift_email_outbox where order_id=$1 and kind=$2',[two.orderId,'received']);assert.equal(sql.rows[0].n,1);
});
test('email outbox retries provider failures with stable idempotency keys; no actual emails',async()=>{
 const calls=[];const failed=await sendGiftMail(getSupabaseAdmin(env),env,{fetcher:async(_url,opts)=>{calls.push(opts);return new Response('{}',{status:503});}});assert.ok(failed.failed>0);
 await db.query("update gift_email_outbox set next_attempt_at=now() where status='pending'");
 const sent=await sendGiftMail(getSupabaseAdmin(env),env,{fetcher:async(_url,opts)=>{calls.push(opts);return Response.json({id:'mail_test'});}});assert.ok(sent.sent>0);
 const keys=calls.map(c=>c.headers['idempotency-key']);assert.equal(keys[0],keys[failed.failed]);
 assert.match(JSON.parse(calls[0].body).text,/#gift=[a-f0-9]{64}/);
 const again=await sendGiftMail(getSupabaseAdmin(env),env,{fetcher:async()=>{throw Error('Unexpected duplicate');}});assert.equal(again.sent,0);assert.equal(again.failed,0);
});
test('private tables and service functions are denied to anonymous and authenticated roles',async()=>{
 for(const role of ['anon','authenticated']){await db.exec('set role '+role);try{await assert.rejects(db.query('select * from gift_guest_checkouts'),/permission denied/);await assert.rejects(call(db,'gift_email_claim'),/permission denied/);}finally{await db.exec('reset role');}}
});
test('only a signed paid Stripe event can finalize the guest purchase',async()=>{
 const d=await draft(),c=await checkout(d),s=session(c);s.payment_link=VIDEO_PACKAGES.gift_60.paymentLinkId;
 const event={id:'evt_signed_'+crypto.randomUUID(),type:'checkout.session.completed',data:{object:s}},payload=JSON.stringify(event),secret='whsec_test_only';
 const request=signature=>({env:{...env,STRIPE_WEBHOOK_SECRET:secret},request:new Request('https://app.test/api/stripe/webhook',{method:'POST',headers:{'stripe-signature':signature},body:payload})});
 assert.equal((await webhook(request('invalid'))).status,400);
 const stripe=new Stripe('test_only'),signature=await stripe.webhooks.generateTestHeaderStringAsync({payload,secret});
 const accepted=await webhook(request(signature));assert.equal(accepted.status,200);assert.equal((await accepted.json()).applied,true);
 assert.equal((await (await webhook(request(signature))).json()).applied,false);
});

test('WhatsApp is optional after confirmed payment, owned, revocable and private',async()=>{
 assert.equal(whatsappPhone('garbage',false),null);assert.equal(whatsappPhone('55 1234 5678',true),'+525512345678');assert.equal(whatsappPhone('+1 (303) 555-1234',true),'+13035551234');assert.throws(()=>whatsappPhone('+52 1 5512345678',true));
 const d=await draft(),pre=await guestPost(context(`?draft=${d.id}&checkout=1`,{token:d.token,body:{plan:'gift_60',whatsappConsent:true,whatsappPhone:'bad'}}));assert.equal(pre.status,200);
 const c=await pre.json(),access=new URL(c.portal,'https://app.test').hash.slice(6),orderId=new URL(c.url).searchParams.get('client_reference_id').slice(5);
 const setPhone=(phone,consent=true,token=access,id=orderId)=>postGiftOrder(context('',{access:token,body:{action:'whatsapp',id,consent,phone}}));
 assert.equal((await setPhone('5512345678')).status,404); // Pending Stripe webhook: no paid order yet.
 assert.equal((await db.query('select whatsapp_phone from gift_guest_checkouts where id=$1',[orderId])).rows[0].whatsapp_phone,null);
 const s=session(c),paid=await fulfill(s);
 const get=await (await getGiftOrder(context('?id='+paid.orderId,{access}))).json();assert.equal(get.whatsapp.phone,'');
 assert.equal((await setPhone('bad')).status,400);assert.equal((await setPhone('5512345678',true,randomToken())).status,404);assert.equal((await setPhone('5512345678',true,access,crypto.randomUUID())).status,404);
 assert.equal((await setPhone('+52 55 1234 5678')).status,200);
 const after=await (await getGiftOrder(context('?id='+paid.orderId,{access}))).json();assert.equal(after.whatsapp.phone,'+525512345678');assert.equal(after.order.revision,get.order.revision);
 await checkout(d);assert.equal((await db.query('select whatsapp_phone from gift_guest_checkouts where order_id=$1',[paid.orderId])).rows[0].whatsapp_phone,'+525512345678');
 const buyer=Array.from(stub.users.values()).find(u=>u.email===s.customer_details.email);
 const adminCtx=()=>({env,request:new Request('https://app.test/api/gift-admin?id='+paid.orderId+'&whatsapp=1',{headers:{authorization:'Bearer '+buyer.id}})});
 assert.equal((await getGiftAdmin(adminCtx())).status,403);buyer.app_metadata={creativerush_gift_admin:true};assert.equal((await getGiftAdmin(adminCtx())).status,409);
 await call(db,'gift_order_operator',[paid.orderId,'script',1,{script:'Gracias por estar aquí.'}]);
 const r=await getGiftAdmin(adminCtx());assert.equal(r.status,200);const u=new URL((await r.json()).url);assert.equal(u.hostname,'wa.me');assert.equal(u.pathname,'/525512345678');assert.ok(u.searchParams.get('text').includes(c.portal));
 assert.equal((await setPhone('',false)).status,200);assert.equal((await getGiftAdmin(adminCtx())).status,409);
 assert.equal((await db.query('select whatsapp_consented_at from gift_guest_checkouts where order_id=$1',[paid.orderId])).rows[0].whatsapp_consented_at,null);
 for(const role of ['anon','authenticated']){await db.exec('set role '+role);try{await assert.rejects(call(db,'gift_order_whatsapp',[buyer.id,paid.orderId,'+525512345678']),/permission denied/);}finally{await db.exec('reset role');}}
});

test('new intake cannot open premium payment without its second memory and closing message',async()=>{
 const d={id:crypto.randomUUID(),token:randomToken(),fields:{...fields,briefVersion:'1',message:'Gracias por estar siempre.'},photos:[]};
 assert.equal((await guestPost(context('?create=1',{body:d}))).status,200);
 const denied=await guestPost(context(`?draft=${d.id}&checkout=1`,{token:d.token,body:{plan:'gift_120'}}));
 assert.equal(denied.status,400);assert.equal((await denied.json()).code,'GIFT_BRIEF_INCOMPLETE');
 assert.equal((await db.query('select count(*)::int n from gift_guest_checkouts where draft_id=$1',[d.id])).rows[0].n,0);
 await checkout(d,'gift_60');
 const full={...d,id:crypto.randomUUID(),token:randomToken(),fields:{...d.fields,memory2:'Nos reencontramos en el aeropuerto.'}};
 assert.equal((await guestPost(context('?create=1',{body:full}))).status,200);
 await checkout(full,'gift_120');
});

test('scoped Stripe test webhook creates one real-shaped order and suppresses test notifications',async()=>{
 const {testWebhook}=await import('../src/gift-stripe-test.js');
 const d=await draft(),c=await checkout(d),s=session(c);s.payment_link='plink_scopedtest';s.livemode=false;s.customer_details.email='regalos-prueba@example.com';
 const config={secret:'whsec_scopedtest',checkoutId:s.client_reference_id.slice(5),paymentLinkId:s.payment_link,plan:'gift_60',email:s.customer_details.email,expiresAt:Date.now()+3600000};
 const event={id:'evt_scoped_'+crypto.randomUUID(),type:'checkout.session.completed',livemode:false,data:{object:s}},payload=JSON.stringify(event);
 const signature=await new Stripe('unused').webhooks.generateTestHeaderStringAsync({payload,secret:config.secret});
 const request=()=>({env:{...env,GIFT_STRIPE_TEST:JSON.stringify(config)},request:new Request('https://app.test/api/stripe/gift-test-webhook',{method:'POST',headers:{'stripe-signature':signature},body:payload})});
 const first=await testWebhook(request());assert.equal(first.status,200);assert.equal((await first.json()).applied,true);
 const again=await testWebhook(request());assert.equal((await again.json()).applied,false);
 const outbox=(await db.query('select status,error_code from gift_email_outbox where order_id=$1',[config.checkoutId])).rows;
 assert.equal(outbox.length,1);assert.equal(outbox[0].error_code,'TEST_ORDER_NO_EMAIL');assert.equal(outbox[0].status,'failed');
});
