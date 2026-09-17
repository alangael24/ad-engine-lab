// Text-only routing probe: no media, GPU, database writes or production calls.
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {callEditor} from '../src/studio-chat.js';
const script='¿Otra vez buscando el cargador debajo del escritorio?\nLuma mantiene tus cables justo donde los necesitas. Lo colocas en tu mesa, pasas el cable por su ranura y dejas de perseguirlo por el suelo.\nCuesta $24. Tienes 30 días para devolverlo.\nEntra a luma.example.com y elige el tuyo.';
const cases=[
 {name:'bare-script',message:script,expected:'provided_script',exact:script},
 {name:'explicit-script',message:'Usa esto tal cual:\n\n'+script,expected:'provided_script',exact:script},
 {name:'idea',message:'Quiero un anuncio directo para personas que pierden el cargador debajo del escritorio. Muestra el problema y cómo Luma lo resuelve. Termina con la oferta de la ficha. Hazlo en español.',expected:'generated_script'},
 {name:'rewrite',message:'Mejora este guion, hazlo más directo y reduce la extensión:\n'+script,expected:'generated_script'},
 {name:'mixed-ambiguous',message:'¿Otra vez sin cargador?\nLuma $24. Close-up del escritorio, aquí quizá una frase del beneficio.\nNo sé si estas líneas son instrucciones o la voz definitiva; ¿qué parte usarías tal cual?',expected:'clarify'},
 {name:'short-script',message:'¿Otra vez en el suelo?\nLuma mantiene el cargador en tu mesa.\nPídelo hoy por $24.',expected:'provided_script'}
];
if(!process.env.REFERENCE_FLASH_KEY)throw Error('REFERENCE_FLASH_KEY required');
const output=resolve(process.argv[2]||'outputs/script-intake-benchmark');await mkdir(output,{recursive:true});const runs=[];
for(const c of cases){
 const project={id:crypto.randomUUID(),revision:1,brand_snapshot:{name:'Luma',product:'Organizador de cables con ranuras para poner en la mesa',claims:'Precio $24. Devolución en 30 días.'},data:{productProfile:'ads-sales-v1',title:c.name,idea:c.message,scriptDraft:'',scenes:[],creative:{format:'auto',look:'3d'}}};
 const run={...c,providerCalls:0,models:[],startedAt:new Date().toISOString()};
 try{
  const result=await callEditor(project,[],[],c.message,{...process.env,PRODUCTION_ENABLED:'true'},async(url,init)=>{run.providerCalls++;run.models.push(JSON.parse(init.body).model);return fetch(url,init);});
  run.result=result;run.mode=result.usage?.inputMode||(result.edit.operation==='draft_script'?'generated_script':result.edit.operation);
  run.passed=run.mode===c.expected&&(c.expected!=='provided_script'||result.edit.value===(c.exact||c.message));
 }catch(e){run.passed=false;run.error=e.code||e.message;}
 run.finishedAt=new Date().toISOString();runs.push(run);await writeFile(join(output,'results.json'),JSON.stringify({purpose:'Script-vs-idea routing; fictional product; no media generated',runs},null,2));
 console.log(JSON.stringify({name:c.name,mode:run.mode,passed:run.passed,providerCalls:run.providerCalls,error:run.error}));
}
if(runs.some(r=>!r.passed))process.exitCode=1;
