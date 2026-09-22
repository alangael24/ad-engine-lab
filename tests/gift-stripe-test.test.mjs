import test from 'node:test';
import assert from 'node:assert/strict';
import {testConfiguration,matchesTestEvent,testWebhook} from '../src/gift-stripe-test.js';
const now=Date.now(),c={secret:'whsec_test',checkoutId:'20c55cd4-28f2-485e-bcbf-aae20c80a3a6',paymentLinkId:'plink_test',plan:'gift_120',email:'regalos-prueba@example.com',expiresAt:now+3600000};
const event={livemode:false,type:'checkout.session.completed',data:{object:{livemode:false,id:'cs_test_example',client_reference_id:'gift_'+c.checkoutId,payment_link:c.paymentLinkId,payment_status:'paid',currency:'mxn',amount_total:49900,customer_details:{email:c.email}}}};
test('test webhook is disabled without narrow expiring configuration',async()=>{
 assert.equal(testConfiguration(''),null);assert.ok(testConfiguration(JSON.stringify(c),now));
 for(const patch of [{expiresAt:now},{expiresAt:now+86400001},{email:'someone@gmail.com'},{checkoutId:'any'},{plan:'minute_8'},{secret:''}])assert.equal(testConfiguration(JSON.stringify({...c,...patch}),now),null);
 assert.equal((await testWebhook({request:new Request('https://example.com'),env:{}})).status,404);
 assert.equal((await testWebhook({request:new Request('https://example.com',{method:'POST',body:'{}'}),env:{GIFT_STRIPE_TEST:JSON.stringify(c)}})).status,400);
});
test('only the exact paid fictitious checkout matches; live events and mismatches do not',()=>{
 assert.equal(matchesTestEvent(event,c),true);assert.equal(matchesTestEvent({...event,livemode:true},c),false);
 for(const patch of [{livemode:true},{id:'cs_live_x'},{client_reference_id:'gift_other'},{payment_link:'plink_other'},{amount_total:1},{currency:'usd'},{payment_status:'unpaid'},{customer_details:{email:'other@example.com'}}])assert.equal(matchesTestEvent({...event,data:{object:{...event.data.object,...patch}}},c),false);
});
