import {creatorRequest} from './creator-model.js';
import {FORMATS,LOOKS,creativeLabel} from './creative-formats.js';
const $=s=>document.querySelector(s);
export function creatorComposer({task,tell,create,home,startChat,attachReference,uploadCharacter}){
 const input=$('#idea-input'),status=$('#idea-status');let mode='idea',file=null,uploaded=null,requestId=null,fingerprint=null,currentProject=null,creative={format:'auto',look:'auto'};
 const note=t=>{status.textContent=t;status.hidden=!t;};
 function step(name){document.querySelectorAll('[data-step]').forEach(n=>n.hidden=n.dataset.step!==name);document.querySelectorAll('[data-workflow]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.workflow===name)));}
 function refresh(){
  $('#idea-submit').setAttribute('aria-label',mode==='script'?'Guardar mi guion':'Desarrollar mi idea');
  input.placeholder=mode==='script'?'Pega aquí las palabras que quieres que se narren…':'Ej. Un astronauta pierde las llaves de su nave en la Luna. Una historia divertida con un final inesperado…';
  document.querySelectorAll('[data-input-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.inputMode===mode)));
  $('#creator-mode-note').textContent=mode==='script'?'Conservamos tu guion. Lo revisarás antes de crear el video.':'Primero verás un guion. Tú decides cuándo producirlo.';
  $('#idea-style').textContent=creativeLabel(creative);
 }
 for(const b of document.querySelectorAll('[data-input-mode]'))b.onclick=()=>{mode=b.dataset.inputMode;refresh();input.focus();};
 for(const b of document.querySelectorAll('[data-idea]'))b.onclick=()=>{mode='idea';input.value=b.dataset.idea;$('#creator-kind').value=b.dataset.kind;refresh();input.focus();};
 function attachment(){const root=$('#idea-attachment');root.replaceChildren();root.hidden=!file;if(!file)return;const text=document.createElement('span');text.textContent=(file.type.startsWith('image/')?'Personaje: ':'Referencia: ')+file.name;const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.setAttribute('aria-label','Quitar archivo');remove.onclick=()=>{file=null;uploaded=null;$('#idea-file').value='';attachment();};root.append(text,remove);}
 function select(f){if(!f)return;const image=['image/png','image/jpeg','image/webp'].includes(f.type),video=f.type.startsWith('video/');if((!image&&!video)||f.size>(image?6291456:200*1024*1024)){tell('Usa una imagen JPG, PNG o WebP de hasta 6 MB o un video de hasta 200 MB.',true);return;}file=f;uploaded=null;attachment();}
 $('#idea-attach').onclick=()=>$('#idea-file').click();$('#idea-file').onchange=()=>select($('#idea-file').files[0]);
 for(const [kind,options] of [['format',FORMATS],['look',LOOKS]])for(const [id,v] of Object.entries(options)){const b=document.createElement('button');b.type='button';b.textContent=v.name;b.onclick=()=>{creative[kind]=id;for(const n of $(`#${kind}-options`).children)n.setAttribute('aria-pressed',String(n===b));refresh();};b.setAttribute('aria-pressed',String(id==='auto'));$(`#${kind}-options`).append(b);}
 $('#idea-style').onclick=()=>$('#style-picker').showModal();$('#style-done').onclick=()=>$('#style-picker').close();document.querySelectorAll('[data-close-dialog]').forEach(b=>b.onclick=()=>b.closest('dialog').close());
 const form=$('#idea-form');form.addEventListener('dragover',e=>{if(e.dataTransfer.types.includes('Files'))e.preventDefault();});form.addEventListener('drop',e=>{if(e.dataTransfer.files.length){e.preventDefault();select(e.dataTransfer.files[0]);}});
 form.onsubmit=e=>{e.preventDefault();task(async()=>{
  const text=input.value.trim();if(!text){input.focus();note('Escribe la idea o pega tu guion para empezar.');return;}
  const options={mode,kind:$('#creator-kind').value,targetDuration:Number($('#creator-duration').value),aspectRatio:$('#creator-ratio').value,creative,referenceUrl:$('#creator-reference').value.trim()};
  // Validate before uploading; preserve the same project request across a lost reply.
  creatorRequest(text,options);if(options.referenceUrl){const u=new URL(options.referenceUrl);if(!['https:','http:'].includes(u.protocol)||u.username||u.password)throw Error('Usa un enlace http o https de referencia.');}
  const key=JSON.stringify([text,options,file?.name,file?.size,file?.lastModified]);if(key!==fingerprint){fingerprint=key;requestId=crypto.randomUUID();}
  $('#idea-submit').disabled=true;note('Guardando tu idea…');
  try{
   if(file?.type.startsWith('image/')&&!uploaded)uploaded=await uploadCharacter(file);
   const data=creatorRequest(text,{...options,characterAssetIds:uploaded?[uploaded.id]:[]});
   await create(requestId,data);
   const reference=file?.type.startsWith('video/')?file:null;
   input.value='';file=null;uploaded=null;requestId=null;fingerprint=null;attachment();note('');
   if(reference)await attachReference(reference);
   else if(mode==='idea')await startChat(`Desarrolla la idea completa guardada en el proyecto como un video ${options.kind}, de unos ${options.targetDuration} segundos. Propón el guion para que lo revise antes de producir.`);
   else tell('Guion guardado. Revísalo y pulsa «Aprobar guion y crear video» cuando esté listo.');
  }finally{$('#idea-submit').disabled=false;}
 });};
 document.querySelectorAll('[data-workflow]').forEach(b=>b.onclick=()=>step(b.dataset.workflow));
 return {refresh,open(){home();refresh();input.focus();},hasDraft:()=>Boolean(file||input.value.trim()),project(p){$('#project-idea').textContent=p.data.idea||p.data.title;$('#project-direction').textContent='';if(currentProject!==p.id){currentProject=p.id;step('idea');}},step};
}
