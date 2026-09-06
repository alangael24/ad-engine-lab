import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Stripe from 'stripe';
import { database, user } from './helpers/database.mjs';
import { mockSupabase } from './helpers/supabase-http.mjs';
import * as account from '../functions/api/account.js';
import * as checkout from '../functions/api/checkout.js';
import * as generations from '../functions/api/generations/index.js';
import * as webhook from '../functions/api/stripe/webhook.js';
import { accountDestination, accessOptions, googleOAuthOptions, authorizeGoogle, readAuthProviders, authCallbackMessage } from '../assets/auth-client.js';
let db, stub, originalFetch;
const env = { SUPABASE_URL:'http://supabase.test', SUPABASE_SERVICE_ROLE_KEY:'test-server-key', GENERATION_ENABLED:'false', STRIPE_WEBHOOK_SECRET:'whsec_only_a_test', APP_URL:'https://app.test' };
before(async()=>{db=await database();stub=mockSupabase(db);originalFetch=globalThis.fetch;globalThis.fetch=stub.fetch;});
after(async()=>{globalThis.fetch=originalFetch;await db.close();});
const ctx=(endpoint,token,body)=>({env,request:new Request('https://app.test'+endpoint,{method:body?'POST':'GET',headers:{authorization:'Bearer '+token,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})})});
async function freeUser(token,confirmed=true){
  const u={id:crypto.randomUUID(),email:token+'@example.test',email_confirmed_at:confirmed?new Date().toISOString():null};
  await db.query('insert into auth.users(id,email) values($1,$2)',[u.id,u.email]);stub.users.set(token,u);return u;
}
test('new verified account can exist before buying: zero balance, no errors or free credit grant',async()=>{
  const u=await freeUser('new-account');
  const response=await account.onRequestGet(ctx('/api/account','new-account'));assert.equal(response.status,200);
  const data=await response.json();assert.equal(data.hasPack,false);assert.deepEqual(data.balance,{video_credits:0,image_credits:0});
  assert.equal(accountDestination(data),'/planes/');
  const history=await generations.onRequestGet(ctx('/api/generations','new-account'));assert.equal(history.status,200);
  assert.equal((await history.json()).available,false);
  // The existing auth trigger creates an empty balance; signup must not credit it.
  assert.deepEqual((await db.query('select video_credits,image_credits from credit_balances where user_id=$1',[u.id])).rows[0],{video_credits:0,image_credits:0});
  assert.equal((await db.query('select count(*)::int as n from credit_ledger where user_id=$1',[u.id])).rows[0].n,0);
});
test('anonymous and unconfirmed users cannot start checkout',async()=>{
  assert.equal((await account.onRequestGet(ctx('/api/account','bad'))).status,401);
  assert.equal((await checkout.onRequestPost(ctx('/api/checkout','bad',{plan:'launch'}))).status,401);
  await freeUser('unconfirmed',false);
  assert.equal((await checkout.onRequestPost(ctx('/api/checkout','unconfirmed',{plan:'launch'}))).status,403);
});
test('checkout locks the verified email and rejects invented plans; ignores client amounts and identities',async()=>{
  const u=await freeUser('checkout-user');
  const response=await checkout.onRequestPost(ctx('/api/checkout','checkout-user',{plan:'launch',email:'other@example.test',amount:1,userId:'other',redirect:'https://evil.test'}));
  assert.equal(response.status,200);const data=await response.json();const url=new URL(data.url);
  assert.equal(url.origin,'https://buy.stripe.com');assert.equal(url.pathname,'/3cI7sL7JdelBaWs8hqbwk02');
  assert.equal(url.searchParams.get('locked_prefilled_email'),u.email);assert.equal(url.searchParams.get('client_reference_id'),u.id);
  assert.equal(data.amount,999);assert.equal(data.currency,'MXN');assert.equal(url.searchParams.has('amount'),false);
  assert.equal((await checkout.onRequestPost(ctx('/api/checkout','checkout-user',{plan:'business'}))).status,400);
});
test('registered account receives its pack only after signed payment; reference ID cannot divert it',async()=>{
  const u=await freeUser('paid-after-signup');const other=await freeUser('not-the-buyer');
  const payload=JSON.stringify({id:'evt_signup_paid',type:'checkout.session.completed',data:{object:{id:'cs_signup_paid',payment_status:'paid',payment_link:'plink_1U8z8uEudyi7fxH7OsFRKvC9',amount_total:99900,currency:'mxn',customer_details:{email:u.email},client_reference_id:other.id}}});
  const stripe=new Stripe('unused');const signature=stripe.webhooks.generateTestHeaderString({payload,secret:env.STRIPE_WEBHOOK_SECRET});
  const request=()=>({env,request:new Request('https://app.test/api/stripe/webhook',{method:'POST',headers:{'stripe-signature':signature},body:payload})});
  assert.equal((await webhook.onRequestPost(request())).status,200);
  assert.equal((await (await webhook.onRequestPost(request())).json()).applied,false);
  const data=await (await account.onRequestGet(ctx('/api/account','paid-after-signup'))).json();
  assert.equal(data.hasPack,true);assert.equal(data.balance.video_credits,12);assert.equal(accountDestination(data),'/herramienta/');
  const bystander=await (await account.onRequestGet(ctx('/api/account','not-the-buyer'))).json();assert.equal(bystander.balance.video_credits,0);
});
test('existing buyer with exhausted balance still enters studio and can explicitly view packs',async()=>{
  const u=await user(db,0,0);stub.users.set('old-buyer',u);
  const data=await (await account.onRequestGet(ctx('/api/account','old-buyer'))).json();
  assert.equal(accountDestination(data),'/herramienta/');assert.equal(accountDestination(data,'planes'),'/planes/');
  assert.equal(accountDestination(data,'https://evil.test'),'/herramienta/');
});
test('signup creates auth users, login does not, and both reuse the existing callback',()=>{
  assert.deepEqual(accessOptions(' User@Brand.COM ',true,'https://app.test'),{email:'user@brand.com',options:{shouldCreateUser:true,emailRedirectTo:'https://app.test/herramienta/'}});
  assert.equal(accessOptions('a@b.com',false,'https://app.test').options.shouldCreateUser,false);
});
test('Google uses PKCE client callback and does not request Gmail, Drive or offline access',async()=>{
  const options=googleOAuthOptions('https://app.test');
  assert.deepEqual(options,{provider:'google',options:{redirectTo:'https://app.test/herramienta/',queryParams:{prompt:'select_account'}}});
  let received;
  await authorizeGoogle({auth:{signInWithOAuth:async args=>{received=args;return {data:{url:'https://auth.test/authorize'},error:null};}}},'https://app.test');
  assert.deepEqual(received,options);
  await assert.rejects(authorizeGoogle({auth:{signInWithOAuth:async()=>({error:{message:'internal-error'}})}},'https://app.test'),/No pudimos abrir Google/);
});
test('disabled Google fails closed and provider discovery only uses publishable key',async()=>{
  const config={supabaseUrl:'https://auth.test',supabasePublishableKey:'public-test-key'};
  for(const [value,enabled] of [[true,true],[false,false],['true',false],[undefined,false]]){
    const result=await readAuthProviders(config,async(url,options)=>{
      assert.equal(url,'https://auth.test/auth/v1/settings');
      assert.deepEqual(options.headers,{apikey:'public-test-key'});
      return Response.json({external:{google:value}});
    });
    assert.deepEqual(result,{google:enabled});
  }
  await assert.rejects(readAuthProviders(config,async()=>new Response('',{status:503})),/comprobar/);
});
test('OAuth cancellation and expired email links show safe messages, never raw provider HTML',()=>{
  assert.match(authCallbackMessage('https://app.test/herramienta/#error=access_denied&error_description=%3Cscript%3E'),/No se completó/);
  assert.match(authCallbackMessage('https://app.test/herramienta/?error=access_denied'),/No se completó/);
  assert.match(authCallbackMessage('https://app.test/herramienta/#error=access_denied&error_code=otp_expired'),/expiró/);
  assert.equal(authCallbackMessage('https://app.test/herramienta/?code=valid-pkce-code'),null);
});
test('landing CTAs no longer bypass signup to Stripe; plan is prepaid, not an invented subscription',async()=>{
  const landing=await readFile(new URL('../ecom-index.html',import.meta.url),'utf8');
  assert.equal(/href="https:\/\/buy\.stripe\.com/.test(landing),false);
  assert.match(landing,/class="cr-generate" href="\/cuenta\/"/);
  const plans=await readFile(new URL('../planes/index.html',import.meta.url),'utf8');assert.match(plans,/Sin suscripción/);assert.match(plans,/\$999/);assert.match(plans,/aún no está activada/);
});
