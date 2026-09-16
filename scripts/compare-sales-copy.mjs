// Text-only paired experiment. No images, narration, GPU or production jobs.
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {writeScriptChanges,LEGACY_SCRIPT_SYSTEM} from '../src/script-writer.js';
import {SALES_COPY_SYSTEM} from '../src/sales-copy.js';
import {SALES_PRODUCT} from '../assets/product-profiles.js';
import {SCRIPT_MODEL} from '../assets/model-routing.js';
const output=resolve(process.argv[2]||'outputs/sales-copy-comparison');
if(!process.env.REFERENCE_FLASH_KEY)throw Error('REFERENCE_FLASH_KEY required');
const cases=[
 {name:'CableNest (ficticio)',product:'Organizador adhesivo con cuatro ranuras para cables. Se fija al borde del escritorio.',benefits:'Mantiene hasta cuatro cables sujetos y accesibles.',claims:'Cuatro ranuras. Fijación adhesiva. Consultar medidas y superficies compatibles en la ficha.',avoid:'No afirmar que sirve para todas las superficies ni que nunca se despega.',idea:'Para quien trabaja desde casa y busca el cargador que se cae detrás del escritorio. Lleva a consultar medidas en la tienda. No hay oferta.'},
 {name:'LumaClip (ficticio)',product:'Lámpara de lectura recargable con pinza, brazo flexible y tres niveles de brillo.',benefits:'Permite dirigir la luz hacia las páginas y elegir entre tres niveles.',claims:'Precio 24 dólares. Carga USB-C. Cable incluido.',avoid:'No inventar autonomía, beneficios para la vista, garantía ni descuento.',idea:'Para quien lee de noche en la cama. Prioriza cómo dirigir la luz al libro. CTA: elige tu LumaClip en la tienda.'},
 {name:'FoldMat (ficticio)',product:'Alfombrilla plegable para cambiar al bebé fuera de casa, con superficie impermeable y bolsillo para pañales.',benefits:'Se pliega para transportarla y se limpia con un paño.',claims:'Precio 29 dólares. 30 días para devolverla. No hay descuento.',avoid:'No inventar protección contra bacterias, certificaciones ni testimonios.',idea:'Para padres que quieren llevar una superficie propia para el cambio de pañal al salir. Responde cómo se transporta y limpia. CTA: conoce FoldMat.'}
];
await mkdir(output,{recursive:true});const runs=[];
const request='Escribe un guion hablado en español de 90 a 110 palabras, natural y concreto, para el producto y público indicados. Entrega una sola versión.';
for(const [index,c] of cases.entries())for(const sales of [false,true]){
 const profile=sales?SALES_PRODUCT:'continuity-v1';const started=Date.now();const raw={operation:'draft_script',value:request};
 const record={case:index+1,name:c.name,profile,model:SCRIPT_MODEL,systemSha256:createHash('sha256').update(sales?SALES_COPY_SYSTEM:LEGACY_SCRIPT_SYSTEM).digest('hex'),request,status:'running'};
 try{
  record.calls=await writeScriptChanges(raw,{project:{id:`sales-paired-${index}`,brand_snapshot:{name:c.name,product:c.product,benefits:c.benefits,claims:c.claims,avoid:c.avoid},data:{title:c.name,idea:c.idea,scriptDraft:'',referenceNotes:'',creative:{format:'auto',look:'3d'},scenes:[],...(sales?{productProfile:SALES_PRODUCT}:{})}},history:[],message:request,env:process.env});
  record.text=raw.value;record.words=raw.value.trim().split(/\s+/u).length;record.status='completed';
 }catch(e){record.status='failed';record.error=e.code||e.message;}
 record.elapsedMs=Date.now()-started;runs.push(record);await writeFile(join(output,'results.json'),JSON.stringify({kind:'exploratory paired copy comparison; not conversion evidence',cases,runs},null,2));
 console.log(JSON.stringify({case:index+1,profile,status:record.status,words:record.words,error:record.error,elapsedMs:record.elapsedMs}));
 if(record.status==='failed')break;
}
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const rows=cases.map((c,i)=>{const pair=runs.filter(r=>r.case===i+1);if(i%2)pair.reverse();return `<section><h2>${escape(c.name)}</h2><p>${escape(c.idea)}</p><div class="pair">${pair.map((r,n)=>`<article><h3>Versión ${n?'B':'A'}</h3><p>${escape(r.text||r.error)}</p><footer>${r.words??0} palabras · ${(r.elapsedMs/1000).toFixed(1)} s</footer><details><summary>Ver versión del flujo</summary>${escape(r.profile)}</details></article>`).join('')}</div></section>`;}).join('');
await writeFile(join(output,'index.html'),`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Comparación de guiones</title><style>body{font:17px/1.65 system-ui;background:#f4f6f7;color:#203039;margin:0 auto;max-width:1100px;padding:32px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:20px}article{background:white;border:1px solid #dee5e8;border-radius:16px;padding:24px}article p{white-space:pre-wrap}section{margin:44px 0}footer,details{color:#667780;font-size:13px}summary{cursor:pointer}@media(max-width:700px){.pair{grid-template-columns:1fr}}</style><h1>Original vs. guion de venta</h1><p>Mismo modelo, productos ficticios y pedidos. Solo cambia el prompt de escritura. Compara claridad, especificidad, fidelidad a los hechos, naturalidad y siguiente paso. Esto no mide ventas.</p>${rows}</html>`);
console.log('Comparison saved: '+output);
