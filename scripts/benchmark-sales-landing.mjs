// Text-only smoke benchmark, with optional previous writer for comparison.
// Fictional LP fixtures isolate information extraction from web availability.
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseStore} from '../src/store-import.js';
import {storeProductData} from '../assets/idea-intent.js';
import {brandData} from '../assets/studio-model.js';
import {writeScriptChanges} from '../src/script-writer.js';
const cases=[
 {name:'LumaClip',short:'Lámpara de lectura con pinza.',page:'<h1>Tu siguiente capítulo no necesita iluminar todo el dormitorio</h1><p>Una lámpara de techo ilumina la habitación entera. LumaClip dirige la luz al libro con su brazo flexible y tres niveles de brillo.</p><h2>¿Tendré que comprar pilas?</h2><p>No. Es recargable por USB-C y el cable está incluido.</p><h2>Oferta</h2><p>24 dólares. Devolución en 30 días.</p>',request:'Guion en español de 90 a 110 palabras. Vende a alguien que lee en la cama. No hay descuento. Tono directo y agresivo, sin insultos.'},
 {name:'FoldMat',short:'Alfombrilla plegable para cambiar pañales.',page:'<h1>Salir con tu bebé no debería significar improvisar dónde cambiarlo</h1><p>Lleva una superficie propia para cambiar el pañal fuera de casa. FoldMat se pliega y tiene un bolsillo para pañales.</p><h2>¿Y si se ensucia?</h2><p>Su superficie impermeable se limpia con un paño.</p><h2>Precio</h2><p>29 dólares. 30 días para devolverla.</p>',request:'Guion de 90 a 110 palabras en español, frontal, para padres que salen con su bebé. No afirmar que protege contra bacterias.'},
 {name:'BookFlow',short:'Software para reservar citas.',page:'<h1>Deja de perseguir a tus clientes por WhatsApp para encontrar una hora</h1><p>Con BookFlow compartes un enlace con tus horarios disponibles. Tu cliente elige una hora y recibe confirmación por email.</p><h2>Sin comisiones por reserva</h2><p>Cuesta 12 dólares al mes. Puedes cancelar cuando quieras.</p><h2>Prueba antes de pagar</h2><p>7 días gratis, sin tarjeta.</p>',request:'Guion agresivo y conversacional en español de 90 a 110 palabras, para profesionales que coordinan citas por mensajes. No hay testimonios ni datos de ahorro de tiempo.'}
];
if(!process.env.REFERENCE_FLASH_KEY)throw Error('REFERENCE_FLASH_KEY required');
const output=resolve(process.argv[2]||'outputs/sales-landing-benchmark');await mkdir(output,{recursive:true});
const baseline=process.env.SALES_BASELINE_WRITER?await import(pathToFileURL(resolve(process.env.SALES_BASELINE_WRITER))):null,runs=[];
for(const c of cases)for(const mode of baseline?['before','landing-v2']:['landing-v2']){
 const url=`https://${c.name.toLowerCase()}.example.com/products/main`;
 const html='<title>'+c.name+'</title><script type="application/ld+json">'+JSON.stringify({'@type':'Product',name:c.name,description:c.short,url})+'</script><main>'+c.page+'</main>';
 const brand=brandData(storeProductData(parseStore(html,url,{sales:mode==='landing-v2'}).products[0]));
 const project={id:crypto.randomUUID(),brand_snapshot:brand,data:{productProfile:'ads-sales-v1',title:c.name,idea:c.request,scriptDraft:'',scenes:[],creative:{format:'auto',look:'3d'}}};
 const raw={operation:'draft_script',value:c.request},started=Date.now(),run={name:c.name,mode,request:c.request};
 try{run.calls=await(mode==='before'?baseline.writeScriptChanges:writeScriptChanges)(raw,{project,history:[],message:c.request,env:process.env});run.script=raw.value;run.words=raw.value.trim().split(/\s+/).length;run.status='completed';}catch(e){run.status='failed';run.error=e.code||e.message;}
 run.elapsedMs=Date.now()-started;runs.push(run);await writeFile(join(output,'results.json'),JSON.stringify({kind:'Fictional LP smoke benchmark, no conversion measurement',cases,runs},null,2));console.log(JSON.stringify({name:c.name,mode,status:run.status,words:run.words,error:run.error}));
}
const esc=s=>String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
await writeFile(join(output,'index.html'),`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Guiones desde la landing</title><style>body{font:17px/1.7 system-ui;max-width:1150px;margin:40px auto;padding:20px;background:#f5f7f6;color:#243b32}.pair{display:grid;grid-template-columns:1fr 1fr;gap:22px}article{background:white;border:1px solid #dde5df;border-radius:15px;padding:25px}article p{white-space:pre-wrap}summary{cursor:pointer}@media(max-width:700px){.pair{grid-template-columns:1fr}}</style><h1>De la landing al argumento de venta</h1><p>Tres productos ficticios. Mismo modelo y pedido: antes solo recibía la descripción corta; ahora recibe la landing y elige un argumento. Esta prueba no mide conversiones.</p>${cases.map(c=>`<section><h2>${esc(c.name)}</h2><div class="pair">${runs.filter(r=>r.name===c.name).map(r=>`<article><h3>${r.mode==='before'?'Antes':'Landing + copy directo'}</h3><p>${esc(r.script||r.error)}</p><small>${r.words||0} palabras</small>${r.calls?.[0]?.salesPlan?`<details><summary>Argumento e insights</summary><pre style="white-space:pre-wrap">${esc(JSON.stringify(r.calls[0].salesPlan,null,2))}</pre></details>`:''}</article>`).join('')}</div></section>`).join('')}</html>`);
if(runs.some(r=>r.status!=='completed'))process.exitCode=1;
