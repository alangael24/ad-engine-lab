// Text-only smoke test: no purchase, image, voice, render or GPU job.
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {callEditor} from '../src/studio-chat.js';
import {applyEdit} from '../assets/chat-model.js';
import {projectData,brandData} from '../assets/studio-model.js';
import {parseStore} from '../src/store-import.js';
import {storeProductData} from '../assets/idea-intent.js';
if(!process.env.REFERENCE_FLASH_KEY)throw Error('REFERENCE_FLASH_KEY required');
const url='https://lumaclip.example.com/',html='<title>LumaClip</title><main><h1>Lee sin encender toda la habitación</h1><p>Lámpara de lectura con pinza y brazo flexible. Dirige la luz al libro y elige entre tres niveles de brillo.</p><p>Recargable por USB-C; cable incluido.</p><p>Precio: 24 dólares. Devoluciones durante 30 días. Sin descuento.</p></main>';
const project={id:crypto.randomUUID(),revision:1,brand_snapshot:brandData(storeProductData(parseStore(html,url,{sales:true}).products[0])),data:projectData({productProfile:'ads-sales-v1',title:'Prueba de tres guiones',brandId:null,scriptDraft:'',idea:'Un anuncio en español de 30 segundos para una lámpara de lectura.',referenceUrl:'',referenceNotes:'',aspectRatio:'9:16',scenes:[]})};
const message='Crea un anuncio de 30 segundos. Usa los dolores, beneficios y oferta de mi página. Quiero un hook fuerte, lenguaje conversacional, un problema concreto y un CTA directo. Evita introducciones largas y frases genéricas.';
const started=Date.now(),record={kind:'fictional-product text-only smoke',project,message,models:[]};
const output=resolve(process.argv[2]||'outputs/script-variants-smoke');await mkdir(output,{recursive:true});
try{
 record.result=await callEditor(project,[],[],message,process.env,async(url,init)=>{record.models.push(JSON.parse(init.body).model);return fetch(url,init);});
 record.saved=applyEdit(project,record.result.edit);
 if(record.saved.scriptVariants?.options.length!==3||record.saved.scriptDraft!=='')throw Error('Expected three unselected scripts');
 record.elapsedMs=Date.now()-started;record.status='passed';
}catch(e){record.status='failed';record.error=e.code||e.message;process.exitCode=1;}
await writeFile(output+'/result.json',JSON.stringify(record,null,2));
console.log(JSON.stringify({status:record.status,error:record.error,elapsedMs:record.elapsedMs,models:record.models,variants:record.saved?.scriptVariants?.options.map(o=>({title:o.title,words:o.script.split(/\s+/).length})),usage:record.result?.usage},null,2));
