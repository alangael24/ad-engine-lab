import {isSalesProduct} from '../assets/product-profiles.js';

export const PROVIDED_SCRIPT_SYSTEM=`ENTRADA DEL CLIENTE EN ANUNCIOS
Antes de pedir copy nuevo, distingue el texto narrable ya escrito de una idea o instrucciones para escribirlo. La longitud por sí sola no decide: un guion corto también puede estar completo y un brief largo puede ser solo una idea.
- Si el usuario pega una narración lista para decirse (apertura, desarrollo y cierre coherentes), o pide usar su guion sin cambios, usa accept_script. No vuelvas a redactarlo. No necesita decir «este es mi guion» si su intención es clara.
- Si solo describe lo que quiere, enumera notas/beneficios o pide escribir, mejorar, traducir o acortar, usa las operaciones de escritura existentes. Que incluya texto de ejemplo no significa que quiera conservarlo.
- Si mezcla narración con notas y no está claro qué palabras quiere decir, usa clarify con una sola pregunta breve. No adivines ni leas instrucciones visuales como voz.
accept_script solo guarda narración, no inicia medios. Se ofrece únicamente cuando todavía no hay escenas. Usa scriptSource=message para el texto de la petición actual, o idea para la entrada completa guardada al crear este proyecto (solo cuando la petición actual se refiere a ella). En value copia LITERALMENTE un bloque continuo de esa fuente. Conserva palabras, acentos, números, signos, saltos de línea e idioma; no corrijas, traduzcas, resumas ni añadas CTA. Puedes excluir una introducción exterior como «Este es mi guion:», pero no recortar el guion. No copies un guion del historial ni de la landing como si lo hubiera pegado el usuario.
Si el texto completo está en project.data.idea, no uses una versión resumida. No trates un guion recién pegado como aprobación del guion anterior. Primero guárdalo con accept_script; la producción se aprueba después.`;

export function withProvidedScript(request,project){
 if(!isSalesProduct(project.data)||(project.data.scenes||[]).length)return request;
 const schema=request.tools[0].function.parameters;
 schema.properties.operation.enum=[...schema.properties.operation.enum,'accept_script'];
 schema.properties.scriptSource={type:'string',enum:['message','idea'],description:'Solo accept_script: fuente original que contiene el guion literal.'};
 schema.properties.value.description+=' Para accept_script: copia literal y completa de la narración proporcionada, no una instrucción editorial.';
 request.messages[0].content+='\n'+PROVIDED_SCRIPT_SYSTEM;
 return request;
}

export function providedScript(raw,{project,message}){
 if(raw.operation!=='accept_script')return null;
 const fail=()=>{throw Object.assign(Error('CHAT_INVALID'),{code:'CHAT_INVALID'});};
 if(!isSalesProduct(project.data)||(project.data.scenes||[]).length||!['message','idea'].includes(raw.scriptSource))fail();
 const source=raw.scriptSource==='message'?message:project.data.idea;
 if(typeof source!=='string'||typeof raw.value!=='string'||!raw.value.trim()||raw.value.length>10000)fail();
 const value=raw.value.trim(),original=source.trim(),index=original.indexOf(value);
 // Only a short, explicit introductory label may be removed. A matching
 // substring alone is not enough: it could silently drop the hook or CTA.
 const prefix=original.slice(0,index).trim();
 if(index<0||original.slice(index)!==value||prefix&&!/^(?:(?:este es|aquí (?:está|tienes)|aqui (?:esta|tienes)) (?:mi|el) guion|(?:mi )?guion(?: completo| final)?|usa (?:este (?:guion|texto)|esto)(?: tal cual| sin cambios)?|(?:use (?:this|this script)(?: as is)?|(?:here(?:'s| is) )?(?:my |the )?(?:full |final )?script))\s*:$/iu.test(prefix))fail();
 // The model selects the source span; the saved text comes from the source,
 // never from a generated rewrite. Standard editor normalization only trims
 // whitespace outside the script, not within it.
 return {edit:{operation:'draft_script',value:original.slice(index),message:'Conservé tu guion tal como lo enviaste. Revísalo antes de producir el video.'},source:raw.scriptSource};
}
