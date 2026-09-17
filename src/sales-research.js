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
 angle:{type:'string',maxLength:2000,description:'Una razón específica para elegir el producto; no una fórmula genérica.'},
 insights:{type:'array',description:'Prefer concise relevant observations; multiple useful insights in the same category are allowed.',minItems:1,maxItems:32,items:{type:'object',additionalProperties:false,properties:{
  kind:{type:'string',enum:kinds},text:{type:'string',maxLength:2000},basis:{type:'string',enum:['source','creative_hypothesis']},sourceIds:{type:'array',maxItems:128,items:{type:'string'}}
 },required:['kind','text','basis','sourceIds']}}
},required:['angle','insights']};
export function salesPlanIssues(plan,research){
 const issues=[],add=(path,rule)=>issues.push({path,rule});
 if(!plan||typeof plan!=='object')return [{path:'salesPlan',rule:'object required'}];
 if(typeof plan.angle!=='string'||!plan.angle.trim()||plan.angle.length>2000)add('angle','nonempty string, maximum 2000 characters');
 if(!Array.isArray(plan.insights)||!plan.insights.length||plan.insights.length>32){add('insights','array of 1 to 32 insights');if(!Array.isArray(plan.insights))return issues;}
 const ids=new Set(research.sources.map(s=>s.id));
 for(const [i,x] of plan.insights.entries()){
  const path='insights['+i+']';
  if(!x||!kinds.includes(x.kind)){add(path+'.kind','use an allowed insight kind');continue;}
  if(typeof x.text!=='string'||!x.text.trim()||x.text.length>2000)add(path+'.text','nonempty string, maximum 2000 characters');
  if(!['source','creative_hypothesis'].includes(x.basis))add(path+'.basis','source or creative_hypothesis');
  if(!Array.isArray(x.sourceIds)||x.sourceIds.length>128)add(path+'.sourceIds','array of at most 128 source IDs');
  if(Array.isArray(x.sourceIds)&&x.sourceIds.some(id=>!ids.has(id)))add(path+'.sourceIds','every source ID must exist in the supplied sources');
  if(x.basis==='source'&&(!Array.isArray(x.sourceIds)||!x.sourceIds.length))add(path+'.sourceIds','a sourced insight needs at least one source');
  if(x.basis==='creative_hypothesis'&&['mechanism','difference','proof','offer'].includes(x.kind))add(path+'.basis','this kind requires source evidence, not a creative hypothesis');
 }
 return issues;
}
export function validateSalesPlan(plan,research){
 const issues=salesPlanIssues(plan,research);
 if(issues.length)throw Object.assign(Error('CHAT_INVALID'),{code:'CHAT_INVALID',validationReason:issues[0].path,validationIssues:issues});
 return {angle:plan.angle,insights:plan.insights.map(x=>({kind:x.kind,text:x.text,basis:x.basis,sourceIds:[...new Set(x.sourceIds)]}))};
}
