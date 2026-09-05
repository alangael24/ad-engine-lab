import {prepareReference} from './reference-media.js';
const $=s=>document.querySelector(s),el=(tag,text)=>{const n=document.createElement(tag);n.textContent=text??'';return n;};
export function referencePanel({api,task,tell,getProject,isDirty,onApplied}){
 const root=$('#reference-inline'),input=$('#reference-file'),name=$('#reference-name'),status=$('#reference-status'),result=$('#reference-result'),action=$('#reference-action');
 let current=null,enabled=false,file=null,pending=null,poll=null,working=false,lastApplied=null,autoAdopt=null,attempts=0;
 const note=text=>{status.textContent=text;};
 const button=(text,fn)=>{action.hidden=false;action.textContent=text;action.onclick=()=>task(fn);};
 function resetAction(){action.hidden=true;action.onclick=null;}
 async function adopt(a){
  if(current!==getProject()?.id)return;
  if(isDirty()){note('Guarda tus cambios para usar esta referencia.');button('Usar referencia',()=>adopt(a));return;}
  const id=current,p=await api('/api/reference-analysis',{method:'POST',body:{action:'adopt',id:a.id,projectId:id,expected:getProject().revision,notes:a.result.suggestedDirection}});
  if(current!==id)return;lastApplied=a.id;autoAdopt=null;pending=null;note('Referencia añadida.');resetAction();await onApplied(p.project);
 }
 async function refresh(){
  const id=current,d=await api('/api/reference-analysis?project='+id);if(current!==id)return;
  enabled=d.enabled;const a=d.analyses[0];
  if(!a)return;
  root.hidden=false;name.textContent=file?.name||a.source.name;
  if(a.status==='running'){
   note('Analizando tu referencia…');clearTimeout(poll);
   if(attempts++<36)poll=setTimeout(()=>refresh().catch(()=>{note('No pude comprobar el resultado.');button('Reintentar',refresh);}),4000);
   else button('Comprobar resultado',refresh);
   return;
  }
  if(a.status==='succeeded'){resetAction();
   result.textContent=a.result.style;result.hidden=false;
   if(a.adoptedAt||lastApplied===a.id){note('Referencia añadida.');return;}
   note('Referencia lista.');
   if(autoAdopt===a.id){await adopt(a);return;}
   button('Usar referencia',()=>adopt(a));
  }else{note('No pude terminar el análisis.');button('Comprobar resultado',refresh);}
 }
 async function analyze(silent=false){
  if(!file||working||!current)return;
  const id=current;working=true;const send=$('#chat-send'),wasDisabled=send.disabled;send.disabled=true;resetAction();
  try{
   const d=await api('/api/reference-analysis?project='+id);if(current!==id)return;enabled=d.enabled;
   if(!enabled){note('El análisis no está disponible ahora.');button('Reintentar',()=>analyze(silent));return;}
   if(!pending){const media=await prepareReference(file,{silent,progress:()=>note('Preparando tu referencia…')});if(current!==id)return;pending={...media,requestId:crypto.randomUUID(),projectId:id};}
   autoAdopt=pending.requestId;note('Analizando tu referencia…');
   await api('/api/reference-analysis',{method:'POST',body:pending});if(current!==id)return;
   attempts=0;await refresh();
  }catch(e){
   if(current!==id)return;
   if(e.code==='REFERENCE_AUDIO_UNREADABLE'){note('No pude leer el audio de este video.');button('Usar solo las imágenes',()=>analyze(true));}
   else{note('No pude completar el análisis.');button('Reintentar',()=>analyze(silent));}
  }finally{working=false;if(current===id)send.disabled=wasDisabled;}
 }
 async function attach(selected){
  if(!selected)return;if(working){tell('Tu referencia todavía se está analizando.');return;}
  if(selected.size>200*1024*1024||!selected.type.startsWith('video/')){tell('Elige un video de hasta 200 MB.',true);return;}
  file=selected;pending=null;autoAdopt=null;resetAction();result.hidden=true;result.textContent='';name.textContent=file.name;root.hidden=false;await analyze();
 }
 input.onchange=()=>{const selected=input.files[0];input.value='';task(()=>attach(selected));};
 return {
  attach,
  pick(){if(!working)input.click();},
  async open(project){if(current===project.id)return;clearTimeout(poll);current=project.id;file=null;pending=null;autoAdopt=null;lastApplied=null;attempts=0;root.hidden=true;resetAction();result.hidden=true;try{await refresh();}catch{}},
  hasUnsaved:()=>false,
 };
}
