import {prepareReference} from './reference-media.js';
const $=s=>document.querySelector(s),el=(tag,text)=>{const n=document.createElement(tag);n.textContent=text??'';return n;};
export function referencePanel({api,task,tell,getProject,isDirty,onApplied}){
  let current=null,rows=[],enabled=false,pending=null,poll=null,reviewDirty=false,previewUrl=null;
  const status=text=>{$('#reference-status').textContent=text;};
  async function refresh(projectId=current){
    const d=await api(`/api/reference-analysis?project=${projectId}`);if(current!==projectId)return;
    rows=d.analyses;enabled=d.enabled;$('#reference-analyze').disabled=!enabled;
    if(!reviewDirty)paint();clearTimeout(poll);if(rows.some(r=>r.status==='running'))poll=setTimeout(()=>refresh().catch(()=>{}),5000);
  }
  function paint(){
    const box=$('#reference-result');box.replaceChildren();
    if(!rows.length){status(enabled?'Elige un video. Se revisan sus imágenes y lo que dice.':'Análisis temporalmente no disponible. Puedes escribir la dirección de referencia al crear el anuncio.');return;}
    const latest=rows[0],labels={running:'Analizando. Puedes volver después; la solicitud quedó guardada.',succeeded:'Análisis listo para revisar.',invalid:'La respuesta no respetó la secuencia del video. No se incorporó al anuncio.',uncertain:'El proveedor no confirmó el resultado. No se reenvió automáticamente.'};status(labels[latest.status]);
    const a=rows.find(r=>r.status==='succeeded');if(!a)return;
    if(a!==latest)box.append(el('p','Último análisis terminado: '+a.source.name));
    const r=a.result;box.append(el('h3','Lo que entendió de la referencia'));
    for(const [label,text] of [['Oferta',r.topic],['Hook',r.hook],['Estilo',r.style],['Personajes',r.characters.join(' · ')],['Cierre de la referencia',r.cta]])box.append(el('p',label+': '+text));
    const sequence=el('details');sequence.append(el('summary','Ver secuencia observada'));const list=el('ol');for(const b of r.beats)list.append(el('li',`${b.observedFrom.toFixed(2)}–${b.observedTo.toFixed(2)} s · ${b.visual}`));sequence.append(el('p','Momentos muestreados de la referencia; no son tiempos de montaje de tu anuncio.'),list);box.append(sequence);
    const evidence=el('details');evidence.append(el('summary','Transcripción y puntos por revisar'),el('p',a.transcript?.text||'Sin narración inteligible disponible.'),el('p','Afirmaciones de la referencia, sin verificar: '+(r.sourceClaims.join(' · ')||'Ninguna identificada')),el('p',r.uncertainties.join(' · ')||'Comprueba los detalles frente al video.'));box.append(evidence);
    const label=el('label','Dirección visual que quieres usar'),notes=el('textarea');notes.id='reference-direction';notes.maxLength=1200;notes.rows=5;notes.value=r.suggestedDirection;notes.addEventListener('input',()=>{reviewDirty=true;});label.append(notes);box.append(label);
    const check=el('label','Revisé el estilo y la secuencia frente al video.');check.className='check';const checkbox=el('input');checkbox.type='checkbox';checkbox.id='reference-reviewed';check.prepend(checkbox);box.append(check);
    const use=el('button','Usar dirección revisada');use.type='button';use.className='primary';use.disabled=true;checkbox.onchange=()=>{use.disabled=!checkbox.checked;reviewDirty=true;};
    use.onclick=()=>task(async()=>{if(current!==getProject()?.id||!checkbox.checked)return;if(isDirty()){tell('Guarda las escenas antes de aplicar la referencia.',true);return;}const p=await api('/api/reference-analysis',{method:'POST',body:{action:'adopt',id:a.id,projectId:current,expected:getProject().revision,notes:notes.value}});reviewDirty=false;await onApplied(p.project);tell('Dirección guardada. El guion, las escenas y sus versiones se conservaron.');});box.append(use);
    if(a.adoptedAt)box.append(el('p','Esta referencia ya se utilizó en el anuncio. Puedes revisar y guardar otra dirección.'));
  }
  function preview(file){if(previewUrl)URL.revokeObjectURL(previewUrl);const video=$('#reference-preview');video.removeAttribute('src');video.hidden=!file;previewUrl=file?URL.createObjectURL(file):null;if(previewUrl)video.src=previewUrl;else video.load();}
  $('#reference-file').onchange=()=>{pending=null;preview($('#reference-file').files[0]);};$('#reference-silent').onchange=()=>{pending=null;};
  $('#reference-analyze').onclick=()=>task(async()=>{
    const projectId=current,file=$('#reference-file').files[0];if(!file){tell('Elige un video de referencia.',true);return;}
    if(reviewDirty&&!confirm('Hay una dirección revisada sin aplicar. ¿Analizar otra referencia?'))return;
    clearTimeout(poll);reviewDirty=false;
    if(!pending||pending.projectId!==projectId){const media=await prepareReference(file,{silent:$('#reference-silent').checked,progress:status});pending={...media,requestId:crypto.randomUUID(),projectId};}
    status('Transcribiendo y analizando la referencia… Mantén esta pestaña abierta.');
    try{const d=await api('/api/reference-analysis',{method:'POST',body:pending});if(d.analysis.status==='succeeded')pending=null;}
    finally{await refresh(projectId);}
  });
  $('#reference-new-attempt').onclick=()=>task(async()=>{if(!confirm('Se enviará una solicitud nueva al proveedor. Úsala solo si la anterior no terminó. ¿Continuar?'))return;pending=null;tell('Puedes pulsar «Analizar referencia» para iniciar otra solicitud.');});
  $('#reference-refresh').onclick=()=>task(()=>refresh());
  return {async open(project){clearTimeout(poll);if(current===project.id)return;current=project.id;pending=null;reviewDirty=false;rows=[];$('#reference-file').value='';preview(null);$('#reference-silent').checked=false;$('#reference-result').replaceChildren();status('Cargando referencias…');try{await refresh();}catch{status('No pudimos cargar el análisis de referencias.');$('#reference-analyze').disabled=true;}},hasUnsaved:()=>reviewDirty};
}
