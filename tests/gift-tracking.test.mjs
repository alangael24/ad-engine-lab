import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {giftEventData,trackGiftCheckout,trackGiftPurchase} from '../assets/gift-tracking.js';
function browser() { const calls=[],saved=new Map(); return {calls,fbq:(...x)=>calls.push(x),localStorage:{getItem:k=>saved.get(k),setItem:(k,v)=>saved.set(k,v)}}; }
test('checkout sends only package metadata and excludes test payments',()=>{
 const w=browser();
 trackGiftCheckout('gift_60','https://buy.stripe.com/live-link',w);
 assert.equal(w.calls.length,1);assert.equal(w.calls[0][2].value,299);
 assert.deepEqual(Object.keys(w.calls[0][2]).sort(),['content_category','content_ids','content_name','content_type','currency','num_items','value']);
 trackGiftCheckout('gift_120','https://buy.stripe.com/test_link',w);
 trackGiftCheckout('constructor','https://buy.stripe.com/live-link',w);
 assert.equal(w.calls.length,1);assert.equal(giftEventData('gift_120').value,499);
});
test('purchase requires confirmed live payment, uses actual amount and deduplicates reloads',()=>{
 const w=browser(),d={ready:true,plan:'gift_120',paymentStatus:'paid',amountTotal:49900,currency:'mxn',story:'PRIVATE'};
 for(const x of [{...d,ready:false},{...d,paymentStatus:'unpaid'},{...d,amountTotal:NaN}]) assert.equal(trackGiftPurchase(x,'cs_live_example',w),false);
 assert.equal(trackGiftPurchase(d,'cs_test_example',w),false);
 assert.equal(trackGiftPurchase(d,'cs_live_example',w),true);
 assert.equal(trackGiftPurchase(d,'cs_live_example',w),false);
 assert.equal(w.calls.length,1);assert.equal(w.calls[0][2].value,499);assert.equal(w.calls[0][2].currency,'MXN');assert.equal(w.calls[0][2].story,undefined);assert.deepEqual(w.calls[0][3],{eventID:'cs_live_example'});
});
test('blocked analytics or browser storage never breaks checkout or confirmation',()=>{
 const w={localStorage:{getItem(){throw Error('blocked');}},fbq(){throw Error('blocked');}};
 assert.doesNotThrow(()=>trackGiftCheckout('gift_60','https://buy.stripe.com/live',w));
 assert.equal(trackGiftPurchase({ready:true,plan:'gift_60',paymentStatus:'paid',amountTotal:29900,currency:'mxn'},'cs_live_example',w),false);
});
test('tracking is installed on public funnel, never private order/admin pages',()=>{
 for(const p of ['regalos/index.html','regalos/checkout/index.html'])assert.match(readFileSync(p,'utf8'),/meta-pixel\.js/);
 for(const p of ['regalos/pedido/index.html','regalos/admin/index.html'])assert.doesNotMatch(readFileSync(p,'utf8'),/meta-pixel\.js/);
});
