// A compact, addressable source pack. These are the client's statements, not
// independently verified research. Never use the style reference as fact input.
export function salesResearch(project,message){
 const brand=project.brand_snapshot||{},sources=[];
 for(const key of ['product','benefits','claims','avoid','sourceText'])if(brand[key]?.trim())sources.push({id:'brand:'+key,text:brand[key]});
 const landing=brand.salesSource;
 if(landing?.text){
  const blocks=landing.text.split(/\n+/).map(x=>x.trim()).filter(Boolean);
  let i=0;for(const block of blocks)for(let offset=0;offset<block.length;offset+=1000)sources.push({id:'lp:'+ ++i,text:block.slice(offset,offset+1000)});
 }
 if(project.data.idea)sources.push({id:'idea',text:project.data.idea});
 if(message)sources.push({id:'request',text:message});
 return {version:'lp-sales-v2',sourceUrl:landing?.url||brand.sourceUrl||'',landingIncluded:Boolean(landing?.text),truncated:landing?.truncated===true,sources};
}
const kinds=['audience','pain','desire','mechanism','difference','objection','proof','offer'];
export const SALES_PLAN_SCHEMA={type:'object',additionalProperties:false,properties:{
 angle:{type:'string',maxLength:300,description:'Una razón específica para elegir el producto; no una fórmula genérica.'},
 insights:{type:'array',minItems:1,maxItems:8,items:{type:'object',additionalProperties:false,properties:{
  kind:{type:'string',enum:kinds},text:{type:'string',maxLength:300},basis:{type:'string',enum:['source','creative_hypothesis']},sourceIds:{type:'array',maxItems:5,items:{type:'string'}}
 },required:['kind','text','basis','sourceIds']}}
},required:['angle','insights']};
export function validateSalesPlan(plan,research){
 const invalid=()=>{throw Object.assign(Error('CHAT_INVALID'),{code:'CHAT_INVALID'});};
 if(!plan||typeof plan.angle!=='string'||!plan.angle.trim()||plan.angle.length>300||!Array.isArray(plan.insights)||!plan.insights.length||plan.insights.length>8)invalid();
 const ids=new Set(research.sources.map(s=>s.id)),seen=new Set();
 const insights=plan.insights.map(x=>{
  if(!x||!kinds.includes(x.kind)||seen.has(x.kind)||typeof x.text!=='string'||!x.text.trim()||x.text.length>300||!['source','creative_hypothesis'].includes(x.basis)||!Array.isArray(x.sourceIds)||x.sourceIds.length>5||x.sourceIds.some(id=>!ids.has(id)))invalid();
  if(x.basis==='source'&&!x.sourceIds.length)invalid();
  if(x.basis==='creative_hypothesis'&&['mechanism','difference','proof','offer'].includes(x.kind))invalid();
  seen.add(x.kind);return {kind:x.kind,text:x.text,basis:x.basis,sourceIds:[...new Set(x.sourceIds)]};
 });
 return {angle:plan.angle,insights};
}
