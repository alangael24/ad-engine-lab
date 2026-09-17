import {isSalesProduct} from './product-profiles.js';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const invalid=()=>{throw Object.assign(Error('CHAT_INVALID'),{code:'CHAT_INVALID'});};
const text=(v,max)=>typeof v==='string'&&v.trim()&&v.length<=max?v.trim():invalid();
export function normalizeScriptVariants(input){
 if(!input||!uuid.test(input.id||'')||!Array.isArray(input.options)||input.options.length!==3)invalid();
 const options=input.options.map(o=>({title:text(o.title,500),angle:text(o.angle,2000),script:text(o.script,10000)}));
 const key=s=>s.toLocaleLowerCase().replace(/[\p{P}\p{S}\s]+/gu,'');
 for(const field of ['script'])if(new Set(options.map(o=>key(o[field]))).size!==3)invalid();
 return {id:input.id,options};
}
export function selectScriptVariant(project,index,setId=project.data.scriptVariants?.id){
 if(!isSalesProduct(project.data))invalid();
 const set=project.data.scriptVariants;
 if(!set||set.id!==setId)throw Object.assign(Error('CHAT_VARIANTS_STALE'),{code:'CHAT_VARIANTS_STALE'});
 if(!Number.isInteger(index)||index<1||index>3||project.data.scenes?.length)invalid();
 const option=normalizeScriptVariants(set).options[index-1];
 return {operation:'draft_script',value:option.script,message:`Elegiste la variante ${index}: ${option.title}. Puedes ajustarla o aprobarla para producir el video.`};
}
