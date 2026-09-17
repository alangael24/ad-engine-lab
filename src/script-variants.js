import {isSalesProduct} from '../assets/product-profiles.js';
import {normalizeScriptVariants} from '../assets/script-variants.js';
import {SALES_COPY_SYSTEM} from './sales-copy.js';
import {salesResearch,SALES_PLAN_SCHEMA,validateSalesPlan} from './sales-research.js';
import {SCRIPT_MODEL} from '../assets/model-routing.js';
import {openCodeHeaders} from './model-provider.js';
import {readEvents} from '../assets/chat-stream.js';
const fail=code=>{throw Object.assign(Error(code),{code});};
export const VARIANTS_SYSTEM=`TRES VARIANTES PARA ELEGIR
Para una idea o pedido de un guion nuevo, entrega EXACTAMENTE tres guiones completos, no tres hooks ni un solo guion con sinónimos. Cada variante desarrolla un ángulo de venta distinto y una apertura distinta: elige los tres enfoques más relevantes para esta landing, producto y petición. Pueden ser problema/frustración, objeción/contraste o deseo/demostración, sin imponer esa fórmula si no encaja.
Conserva en las tres el idioma, duración, tono, producto, hechos, oferta y restricciones solicitados. Cada una debe tener hook, desarrollo, mecanismo o razón para elegir y CTA. Cumple las reglas de copy y fuentes en CADA variante. No inventes evidencia para diferenciar los ángulos.
En esta llamada usa write_script UNA sola vez con {variants:[{title,salesPlan,value},...]} en lugar de salesPlan/value en la raíz. title es una etiqueta breve del enfoque; salesPlan explica ese ángulo y cita fuentes; value solo contiene la narración completa sin encabezados. No elijas una ganadora ni juntes los tres guiones para narrarlos. El cliente elegirá después.`;
export function wantsScriptVariants(change,raw,project){return isSalesProduct(project.data)&&change.operation==='draft_script'&&raw.scriptMode!=='revision';}
export function withScriptVariants(request,project){
 if(!isSalesProduct(project.data)||(project.data.scenes||[]).length)return request;
 const schema=request.tools[0].function.parameters;
 schema.properties.operation.enum.push('select_script');
 schema.properties.scriptMode={type:'string',enum:['variants','revision'],description:'draft_script: variants para una idea, un guion nuevo o alternativas; revision solo para modificar el guion ya elegido, conservando su enfoque.'};
 request.messages[0].content+='\nEn Anuncios, draft_script genera tres guiones completos con ángulos y hooks diferentes por defecto (scriptMode=variants). No anuncies una sola propuesta. Si el usuario solo pide corregir/acortar/traducir el guion ya elegido, usa scriptMode=revision. Si pide otro guion, nuevas ideas o variantes, usa variants. Cuando hay project.data.scriptVariants, muéstralos para elegir; select_script con position 1, 2 o 3 guarda exactamente la variante elegida sin reescribirla ni iniciar medios. Una petición ambigua como «hazlo» sin elección requiere clarify; no elijas por el cliente. No conviertas la elección de variante en produce. Un guion pegado completo conserva la ruta accept_script.';
 return request;
}
export async function writeScriptVariants(change,{project,history,message,env,request}){
 if(project.data.scenes?.length)fail('CHAT_SCRIPT_EXISTS');
 const research=salesResearch(project,message);
 const response=await request('https://opencode.ai/zen/go/v1/chat/completions',{method:'POST',headers:openCodeHeaders({authorization:`Bearer ${env.OPENCODE_API_KEY||env.REFERENCE_FLASH_KEY}`,'content-type':'application/json','x-opencode-session':'creativerush-script-'+project.id}),signal:AbortSignal.timeout(120000),body:JSON.stringify({model:SCRIPT_MODEL,reasoning_effort:'low',stream:true,stream_options:{include_usage:true},max_tokens:8000,tool_choice:'auto',tools:[{type:'function',function:{name:'write_script',parameters:{type:'object',additionalProperties:false,properties:{variants:{type:'array',minItems:3,maxItems:3,items:{type:'object',additionalProperties:false,properties:{title:{type:'string',maxLength:90},salesPlan:SALES_PLAN_SCHEMA,value:{type:'string',maxLength:10000}},required:['title','salesPlan','value']}}},required:['variants']}}}],messages:[{role:'system',content:SALES_COPY_SYSTEM+'\n'+VARIANTS_SYSTEM},{role:'user',content:JSON.stringify({request:message,editorialInstruction:change.value,salesResearch:research,brand:{...project.brand_snapshot,salesSource:undefined},data:project.data,history:history.slice(-8).map(r=>({request:r.request_payload?.message,result:r.result?.message}))})}]})});
 if(!response.ok)fail('CHAT_PROVIDER');
 let model,finish,usage,args='',name='';const indices=new Set();
 await readEvents(response,d=>{if(d.error)fail('CHAT_PROVIDER');model=d.model||model;usage=d.usage||usage;for(const c of d.choices||[]){finish=c.finish_reason||finish;for(const t of c.delta?.tool_calls||[]){indices.add(t.index);name+=t.function?.name||'';args+=t.function?.arguments||'';}}},2500000);
 if(model!==SCRIPT_MODEL||finish!=='tool_calls'||name!=='write_script'||indices.size!==1)fail('CHAT_INVALID');
 let result;try{result=JSON.parse(args);}catch{fail('CHAT_INVALID');}
 if(!Array.isArray(result.variants)||result.variants.length!==3)fail('CHAT_INVALID');
 const plans=result.variants.map(v=>validateSalesPlan(v.salesPlan,research));
 const variants=normalizeScriptVariants({id:crypto.randomUUID(),options:result.variants.map((v,i)=>({title:v.title,angle:plans[i].angle,script:v.value}))});
 Object.assign(change,{operation:'propose_scripts',variants,message:'Aquí tienes tres guiones con enfoques diferentes. Elige uno para continuar.'});delete change.value;
 return {model:SCRIPT_MODEL,usage:usage||null,productProfile:'ads-sales-v1',scriptVariants:variants,salesPlans:plans,researchVersion:research.version,landingIncluded:research.landingIncluded,sourceUrl:research.sourceUrl};
}
