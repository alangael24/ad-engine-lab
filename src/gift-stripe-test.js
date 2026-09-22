import Stripe from 'stripe';
import {json,getSupabaseAdmin,getPaymentLinkId} from './backend.js';
import {readBounded,UUID} from './generations.js';
import {fulfillGuest} from './gift-guest.js';
import {VIDEO_PACKAGES} from './video-packages.js';

// Operator-only configuration: a test link alone can NEVER grant a gift.
// Enable briefly for one pre-created fictitious checkout; remove after verification.
export function testConfiguration(raw,now=Date.now()){
 try{
  const c=JSON.parse(raw||'null');
  if(!c||!c.secret?.startsWith('whsec_')||!UUID.test(c.checkoutId||'')||!/^plink_[a-zA-Z0-9]+$/.test(c.paymentLinkId||'')||!['gift_60','gift_120'].includes(c.plan)||!/^[-a-z0-9]+@example\.com$/.test(c.email||'')||!Number.isFinite(c.expiresAt)||c.expiresAt<=now||c.expiresAt>now+86400000)return null;
  return c;
 }catch{return null;}
}
export function matchesTestEvent(event,c){
 const s=event?.data?.object,p=VIDEO_PACKAGES[c.plan];
 return event?.livemode===false&&event.type==='checkout.session.completed'&&s?.livemode===false&&s.id?.startsWith('cs_test_')&&s.client_reference_id==='gift_'+c.checkoutId&&getPaymentLinkId(s.payment_link)===c.paymentLinkId&&s.payment_status==='paid'&&s.currency==='mxn'&&s.amount_total===p.amount*100&&(s.customer_details?.email||s.customer_email)===c.email;
}
export async function testWebhook({request,env}){
 const c=testConfiguration(env.GIFT_STRIPE_TEST);
 if(!c)return json({error:'Not found'},404);
 let event;
 try{
  const payload=new TextDecoder().decode(await readBounded(request,262144));
  const stripe=new Stripe('unused',{httpClient:Stripe.createFetchHttpClient()});
  event=await stripe.webhooks.constructEventAsync(payload,request.headers.get('stripe-signature')||'',c.secret,undefined,Stripe.createSubtleCryptoProvider());
 }catch{return json({error:'Invalid Stripe signature'},400);}
 if(!matchesTestEvent(event,c))return json({received:true,ignored:true});
 try{
  const db=getSupabaseAdmin(env),s=event.data.object;
  const current=await db.from('gift_guest_checkouts').select('checkout_session_id,order_id').eq('id',c.checkoutId).maybeSingle();
  if(current.error)throw current.error;
  if(!current.data||current.data.checkout_session_id&&current.data.checkout_session_id!==s.id)return json({received:true,ignored:true});
  const result=await fulfillGuest(db,event,s,VIDEO_PACKAGES[c.plan],c.paymentLinkId);
  // Fictitious recipient: do not send notifications or start any production.
  const stopped=await db.from('gift_email_outbox').update({status:'failed',error_code:'TEST_ORDER_NO_EMAIL'}).eq('order_id',c.checkoutId).eq('status','pending');
  if(stopped.error)throw stopped.error;
  return json({received:true,test:true,applied:Boolean(result?.applied),orderId:result?.orderId});
 }catch(e){console.error('gift_test_webhook_failed',e.code||e.message);return json({error:'Test fulfillment failed'},500);}
}
