// Shared limits and deterministic frame identity. Model output never supplies edit times.
export const ANALYSIS_VERSION = 'flash-reference-v1';
export const FLASH_MODEL = 'deepseek-v4-flash-vision-exp';
export function referenceError(code='REFERENCE_INVALID'){throw Object.assign(new Error(code),{code});}
export function sampleFrames(duration){
  if(typeof duration!=='number'||!Number.isFinite(duration)||duration<2||duration>120)referenceError();
  const count=Math.min(24,Math.max(8,Math.ceil(duration/3)));
  return Array.from({length:count},(_,i)=>({id:`F${String(i+1).padStart(2,'0')}`,time:Math.round((.2+i*(duration-.4)/(count-1))*1000)/1000}));
}
const str=(s,max=900)=>{if(typeof s!=='string'||!s.trim()||s.length>max)referenceError('REFERENCE_OUTPUT_INVALID');return s.trim();};
export function parseModelJson(raw){
  if(typeof raw!=='string'||raw.length>24000)referenceError('REFERENCE_OUTPUT_INVALID');
  let s=raw.trim();
  if(s.startsWith('```'))s=s.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim();
  // Tolerate one introductory line, not multiple objects or trailing instructions.
  const first=s.indexOf('{');if(first>0&&first<240)s=s.slice(first);
  try{return JSON.parse(s);}catch{referenceError('REFERENCE_OUTPUT_INVALID');}
}
export function validateAnalysis(raw,frames){
  const a=typeof raw==='string'?parseModelJson(raw):raw;
  if(!a||!Array.isArray(a.beats)||!a.beats.length||a.beats.length>frames.length)referenceError('REFERENCE_OUTPUT_INVALID');
  let cursor=0;
  const beats=a.beats.map((b,i)=>{
    if(!Array.isArray(b.frameIds)||!b.frameIds.length)referenceError('REFERENCE_OUTPUT_INVALID');
    const start=cursor;
    for(const id of b.frameIds){if(id!==frames[cursor]?.id)referenceError('REFERENCE_OUTPUT_INVALID');cursor++;}
    return {id:`B${i+1}`,frameIds:[...b.frameIds],observedFrom:frames[start].time,observedTo:frames[cursor-1].time,visual:str(b.visual,700)};
  });
  if(cursor!==frames.length)referenceError('REFERENCE_OUTPUT_INVALID');
  const list=(v,max=8)=>{if(!Array.isArray(v)||v.length>max)referenceError('REFERENCE_OUTPUT_INVALID');return v.map(s=>str(s,500));};
  return {version:ANALYSIS_VERSION,topic:str(a.topic,700),hook:str(a.hook,700),style:str(a.style,1000),characters:list(a.characters),beats,cta:str(a.cta,700),sourceClaims:list(a.sourceClaims),uncertainties:list(a.uncertainties),reviewRequired:true};
}
export function referenceDirection(a){
  // Only reviewed visual direction enters production prompts; source claims and CTA do not.
  return `Estilo de la referencia: ${a.style}\nCrear un personaje propio y mantenerlo entre escenas.\nAdaptar a la identidad y afirmaciones respaldadas de nuestra marca; no copiar promesas ni personas de la referencia.`.slice(0,1200);
}
