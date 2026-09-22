import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=(await readFile(new URL('../assets/gift-pay-first-checkout.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'');
async function page({query='',paid=false,payUrl='https://buy.stripe.com/test_link',enabled=true}={}){
 const els=new Map(),calls=[],navigation=[],stored=new Map();const el=k=>{if(!els.has(k))els.set(k,{textContent:'',hidden:false,disabled:true});return els.get(k);};
 vm.runInNewContext(source,{crypto,URL,URLSearchParams,document:{querySelector:el},sessionStorage:{getItem:k=>stored.get(k),setItem:(k,v)=>stored.set(k,v),removeItem:k=>stored.delete(k)},history:{replaceState(){}},location:{search:query,assign:u=>navigation.push(u)},window:{addEventListener(){}},guestAvailable:async()=>enabled,rememberPortal(){},trackGiftCheckout(){},guestRequest:async(path,opts)=>{calls.push({path,opts});return path.includes('checkout=1')?{paid,url:payUrl,portal:'/regalos/pedido/#gift=test'}:{};}});
 await new Promise(r=>setImmediate(r));return {el,calls,navigation,submit:()=>el('#checkout-form').onsubmit({preventDefault(){}})};
}
test('purchase-first collects only plan, no story/email/photos/login, and preserves chosen price',async()=>{for(const plan of ['gift_60','gift_120']){const p=await page({query:'?package='+plan});assert.equal(p.el('#checkout-account').hidden,true);assert.equal(p.el('#checkout-pay').disabled,false);await p.submit();assert.deepEqual({...p.calls[0].opts.body.fields},{flow:'pay_first',package:plan});assert.equal(p.calls[0].opts.body.photos.length,0);assert.equal(p.calls[1].opts.body.plan,plan);assert.deepEqual(p.navigation,['https://buy.stripe.com/test_link']);}});
test('switching packages updates the payment and double clicks cannot duplicate submissions',async()=>{const p=await page();p.el('#choose-60').onchange();assert.equal(p.el('#package-price').textContent,'$299');await Promise.all([p.submit(),p.submit()]);assert.equal(p.calls.length,2);assert.equal(p.calls[1].opts.body.plan,'gift_60');});
test('already-paid checkout resumes the existing order and unavailable checkout fails closed',async()=>{const p=await page({paid:true});await p.submit();assert.deepEqual(p.navigation,['/regalos/pedido/#gift=test']);const q=await page({enabled:false});await q.submit();assert.equal(q.calls.length,0);});
test('invalid payment destination remains on checkout with retry enabled',async()=>{const p=await page({payUrl:'https://evil.test'});await p.submit();assert.equal(p.navigation.length,0);assert.equal(p.el('#checkout-pay').disabled,false);});
