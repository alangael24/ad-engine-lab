import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {giftBriefMissing} from '../assets/gift-brief.js';
const fields={briefVersion:'1',package:'gift_60',memory1:'El café de Puebla',message:'Gracias por estar a mi lado.'};
test('one minute needs one memory and a closing message; two needs a distinct second moment',()=>{
 assert.deepEqual(giftBriefMissing(fields),[]);
 assert.deepEqual(giftBriefMissing(fields,'gift_120'),['memory2']);
 assert.deepEqual(giftBriefMissing({...fields,memory2:'  EL café de Puebla  '},'gift_120'),['memory2']);
 assert.deepEqual(giftBriefMissing({...fields,memory2:'El reencuentro en el aeropuerto'},'gift_120'),[]);
 assert.deepEqual(giftBriefMissing({...fields,message:'  '}),['message']);
});
test('upgrading asks only for missing details and saves them with existing photos before opening payment',async()=>{
 const source=(await readFile(new URL('../assets/gift-guest-checkout.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'');
 const elements=new Map(),calls=[],saves=[],navigation=[],cachedPhotos=[{file:{name:'family.png'},label:'Ana y Luis'}];
 const el=k=>{if(!elements.has(k))elements.set(k,{value:k==='#choose-60'?'gift_60':k==='#choose-120'?'gift_120':'',hidden:false,disabled:true});return elements.get(k);};
 const context=vm.createContext({URL,URLSearchParams,giftBriefMissing,document:{querySelector:el},sessionStorage:{getItem:()=>null,setItem(){}},history:{replaceState(){}},window:{addEventListener(){}},location:{search:'?draft=draft1',assign:url=>navigation.push(url)},storedGuest:()=>({id:'draft1',token:'secret',fields,photos:[{id:'photo1'}]}),loadGiftPhotos:async()=>cachedPhotos,saveGuest:async(f,p)=>{saves.push({f,p});return {id:'draft2',token:'secret2',fields:f,photos:p};},rememberPortal(){},guestRequest:async(path,opts)=>{calls.push({path,opts});return path.includes('checkout=1')?{url:'https://buy.stripe.com/test',portal:'/regalos/pedido/#gift=test'}:{title:'Regalo para Ana'};}});
 vm.runInContext(source,context);await new Promise(r=>setImmediate(r));
 assert.equal(el('#checkout-story-details').hidden,true);
 el('#choose-120').onchange();assert.equal(el('#checkout-memory-wrap').hidden,false);assert.equal(el('#checkout-memory').required,true);assert.equal(el('#checkout-message-wrap').hidden,true);
 await el('#checkout-form').onsubmit({preventDefault(){}});assert.equal(calls.some(c=>c.path.includes('checkout=1')),false);assert.equal(saves.length,0);
 el('#checkout-memory').value='El café de Puebla';await el('#checkout-form').onsubmit({preventDefault(){}});assert.equal(saves.length,0);
 el('#checkout-memory').value='Nos reencontramos en el aeropuerto.';await el('#checkout-form').onsubmit({preventDefault(){}});
 assert.equal(saves[0].f.package,'gift_120');assert.equal(saves[0].f.memory2,'Nos reencontramos en el aeropuerto.');assert.equal(saves[0].p,cachedPhotos);
 assert.match(calls.at(-1).path,/draft=draft2&checkout=1/);assert.deepEqual(navigation,['https://buy.stripe.com/test']);
});
