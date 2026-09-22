import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {whatsappPhone} from '../assets/gift-whatsapp-model.js';
const source=(await readFile(new URL('../assets/gift-order-page.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'');
async function page(paid){
 const elements=new Map(),calls=[];
 const el=k=>{if(!elements.has(k))elements.set(k,{hidden:true,value:'',textContent:'',checked:false,disabled:false,removeAttribute(){}});return elements.get(k);};
 const ctx=vm.createContext({URLSearchParams,whatsappPhone,privateAccess:()=>null,accountRequest:async(path,opts)=>{calls.push({path,opts});if(opts?.body)return {whatsapp:{phone:opts.body.phone}};return {order:{id:'order',title:'Prueba',status:'script_ready',script:'Nuestra historia',revision:2,targetSeconds:60},seconds:{available:paid?60:0},whatsapp:paid?{phone:'',consentedAt:null}:null};},sessionStorage:{getItem:()=>null},document:{querySelector:el,querySelectorAll:()=>[]},location:{search:'?id=order'},setTimeout(){return 1;},clearTimeout(){}});
 vm.runInContext(source,ctx);await new Promise(r=>setImmediate(r));return {el,calls};
}
test('WhatsApp appears only for confirmed paid orders and does not block approval',async()=>{
 const unpaid=await page(false);assert.equal(unpaid.el('#order-whatsapp').hidden,true);
 const paid=await page(true);assert.equal(paid.el('#order-whatsapp').hidden,false);assert.equal(paid.el('#order-approve').disabled,false);
 paid.el('#whatsapp-consent').checked=true;paid.el('#whatsapp-consent').onchange();paid.el('#whatsapp-number').value='5512345678';
 await paid.el('#whatsapp-form').onsubmit({preventDefault(){}});
 const body=paid.calls.at(-1).opts.body;assert.equal(body.action,'whatsapp');assert.equal(body.phone,'+525512345678');assert.equal(paid.el('#order-approve').disabled,false);assert.match(paid.el('#whatsapp-status').textContent,/Listo/);
});
