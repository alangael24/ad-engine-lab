import {apiRequest as accountRequest} from './auth-client.js';
import {giftRequest,giftQuestions,giftDraftStep,GIFT_OCCASIONS,GIFT_EMOTIONS} from './gift-model.js';
import {saveGuest,privateAccess} from './gift-guest-client.js';
import {mountGiftMemoryGuide,giftDedicationGuide,giftMemoryOptions} from './gift-memory-guide.js';
import {giftBriefMissing} from './gift-brief.js';
import {saveGiftPhotos,loadGiftPhotos} from './gift-photo-draft.js';
const $=s=>document.querySelector(s),form=$('#gift-form'),panels=[...document.querySelectorAll('[data-panel]')];
const id=new URLSearchParams(location.search).get('id'),incoming=privateAccess();
const access=incoming||sessionStorage.getItem('gift-order-access');if(incoming)sessionStorage.setItem('gift-order-access',incoming);
const DRAFT='gift-personalization-'+id;
const portal=()=>'/regalos/pedido/'+(access?'#gift='+access:'?id='+id);
async function apiRequest(path,options={}){if(!access)return accountRequest(path,options);const r=await fetch(path,{method:options.method||'GET',headers:{'x-gift-access':access,...(options.body?{'content-type':'application/json'}:{})},body:options.body?JSON.stringify(options.body):undefined}),b=await r.json();if(!r.ok)throw Error(b.error||'No pudimos guardar tu historia.');return b;}
let order,ready=false;
let step=0,busy=false,photos=[];
const photosReady=loadGiftPhotos(id).then(saved=>{photos=saved.map(p=>({...p,id:null,url:URL.createObjectURL(p.file)}));paintPhotos();}).catch(()=>{});
const read=k=>{try{return JSON.parse(sessionStorage.getItem(k));}catch{return null;}};
const store=(k,v)=>sessionStorage.setItem(k,JSON.stringify(v));
const fields=()=>Object.fromEntries([...form.elements].filter(f=>f.name&&f.type!=='file'&&(!['radio','checkbox'].includes(f.type)||f.checked)).map(f=>[f.name,f.value]));
function status(t,error=false){$('#gift-status').textContent=t;$('#gift-status').dataset.error=String(error);}
function saveDraft(){try{store(DRAFT,{fields:fields(),step,version:4});}catch{status('No pudimos guardar el borrador en este navegador. No cierres esta pestaña.',true);}}
const restored=read(DRAFT);if(restored?.fields?.names&&!restored.fields.additionalNames)restored.fields.additionalNames=restored.fields.names;if(restored?.fields)for(const [k,v]of Object.entries(restored.fields)){const input=form.elements.namedItem(k);if(input&&typeof v==='string')input.value=v;}
// Restore older drafts without carrying a retired visual style into new orders.
form.elements.namedItem('look').value='3d';
$('#gift-duration').hidden=false;
function validatePanel(n){form.elements.memory2.setCustomValidity(fields().package==='gift_120'&&fields().memory2.trim()&&giftBriefMissing(fields()).includes('memory2')?'Cuéntanos un segundo momento distinto del primero.':'');for(const f of panels[n].querySelectorAll('input,textarea,select'))if(!f.checkValidity()){show(n);for(let parent=f.parentElement;parent&&parent!==panels[n];parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;f.reportValidity();return false;}return true;}
function paintQuestions(){const premium=fields().package==='gift_120';$('#gift-plan-guide').textContent=premium?'Para tus 2 minutos: cuéntanos dos momentos que quieras conectar y cómo quieres cerrar la película. Puedes añadir un tercer recuerdo en los detalles.':'Para tu minuto: cuéntanos un recuerdo concreto y qué quieres decirle al final. Un lugar, lo que pasó y por qué importa nos ayudan a hacerlo suyo.';form.elements.memory2.required=premium;$('#memory2-optional').hidden=premium;$(premium?'#premium-memory':'#optional-memory').append($('#second-memory'));const q=giftQuestions(fields());const opening=giftMemoryOptions(fields())[0];q.memory=opening.question;q.example='Ejemplo: '+opening.example;q.hint=opening.hint;const dedication=giftDedicationGuide(fields());q.message=dedication.question;form.elements.message.placeholder='Ejemplo: '+dedication.example;$('#memory1-question').textContent=q.memory;$('#memory2-question').textContent=premium?'¿Qué otro momento quieres conectar con ese recuerdo?':q.detail;$('#message-question').textContent=q.message;form.elements.memory1.placeholder=q.example;$('#memory-hint').textContent=q.hint;mountGiftMemoryGuide($('#memory1-guide'),{context:fields(),input:form.elements.memory1,question:$('#memory1-question'),hint:$('#memory-hint')});$('#memory2-guide').hidden=!premium;$('#memory2-hint').textContent='';if(premium)mountGiftMemoryGuide($('#memory2-guide'),{context:fields(),input:form.elements.memory2,question:$('#memory2-question'),hint:$('#memory2-hint'),second:true});}
for(const name of ['relationship','occasion'])form.elements.namedItem(name).addEventListener('change',paintQuestions);
paintQuestions();
const stepTitles=['¿A quién quieres sorprender?','Dale vida a sus protagonistas.'];
function show(n){step=n;document.body.dataset.giftStep=String(n);panels.forEach((p,i)=>p.hidden=i!==n);document.querySelectorAll('[data-step]').forEach(b=>b.setAttribute('aria-current',Number(b.dataset.step)===n?'step':'false'));$('#form-title').textContent=stepTitles[n];$('#gift-back').hidden=n===0;$('#gift-next').hidden=n===1;$('#gift-continue').hidden=n!==1;saveDraft();}
function go(n){if(busy)return;if(n>step)for(let i=0;i<n;i++)if(!validatePanel(i))return;show(n);const heading=$('#form-title');heading.tabIndex=-1;heading.focus({preventScroll:true});heading.closest('.workbench').scrollIntoView({block:'start',behavior:'instant'});}
for(const b of document.querySelectorAll('[data-step]'))b.onclick=()=>go(Number(b.dataset.step));
$('#gift-next').onclick=()=>go(step+1);$('#gift-back').onclick=()=>go(step-1);form.addEventListener('input',saveDraft);
function paintPhotos(){const list=$('#photo-list');list.replaceChildren();for(const p of photos){const row=document.createElement('div');row.className='photo-row';const img=document.createElement('img');img.src=p.url;img.alt='Foto de referencia seleccionada';const label=document.createElement('label');label.append('¿Quién aparece?');const input=document.createElement('input');input.required=true;input.maxLength=100;input.placeholder='Ana a la izquierda, Luis a la derecha';input.value=p.label;input.oninput=()=>{p.label=input.value;};label.append(input);const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.setAttribute('aria-label','Quitar '+p.file.name);remove.onclick=()=>{URL.revokeObjectURL(p.url);photos=photos.filter(x=>x!==p);paintPhotos();};row.append(img,label,remove);list.append(row);}}
$('#gift-photos').onchange=async e=>{const incoming=[...e.target.files];e.target.value='';await photosReady;if(photos.length+incoming.length>3){status('Puedes añadir hasta tres fotos de referencia.',true);return;}if(incoming.some(f=>!['image/jpeg','image/png','image/webp'].includes(f.type)||f.size>6291456)){status('Usa JPG, PNG o WebP de hasta 6 MB por foto.',true);return;}for(const file of incoming)photos.push({file,label:'',id:null,url:URL.createObjectURL(file)});paintPhotos();status('');};
function setBusy(value){busy=value;for(const f of form.querySelectorAll('input,textarea,select,button'))f.disabled=value;$('#gift-photos').disabled=value||!ready;for(const b of document.querySelectorAll('[data-step],[name=package]'))b.disabled=value;}
form.noValidate=true;
async function saveProgress(){await apiRequest('/api/gift-orders',{method:'POST',body:{action:'personalize_save',id,fields:fields()}});await saveGiftPhotos(photos,id);saveDraft();}
$('#gift-save').onclick=async()=>{if(busy||!ready)return;setBusy(true);try{await saveProgress();status('Respuestas guardadas. Puedes volver desde el enlace de tu pedido. Las fotos pendientes se conservan en este navegador.');}catch(e){status(e.message,true);}finally{setBusy(false);}};
form.onsubmit=async e=>{e.preventDefault();if(busy||!ready)return;for(let i=0;i<panels.length;i++)if(!validatePanel(i))return;
 const submitted=fields();if(giftBriefMissing(submitted).length){status('Completa los recuerdos y la dedicatoria de tu película.',true);go(0);return;}
 saveDraft();setBusy(true);
 try{await photosReady;await saveGiftPhotos(photos,id);giftRequest(submitted,photos.map(p=>({id:p.id||crypto.randomUUID(),label:p.label})));
  status('Guardando tu historia y sus fotos…');const draft=await saveGuest(submitted,photos,status);
  await apiRequest('/api/gift-orders',{method:'POST',body:{action:'personalize_submit',id,draftId:draft.id,draftToken:draft.token}});
  sessionStorage.removeItem(DRAFT);await saveGiftPhotos([],id);location.assign(portal());
 }catch(e){status(e.message||'No pudimos enviar tu historia. Tus respuestas se conservan.',true);}finally{setBusy(false);}
};
async function load(){
 try{if(!/^[a-f0-9-]{36}$/i.test(id||''))throw Error('Abre el enlace privado de tu pedido para personalizar tu película.');
  const r=await apiRequest('/api/gift-orders?id='+id);order=r.order;
  if(order.personalization?.state!=='pending'||order.status==='cancelled'){location.replace(portal());return;}
  const saved=restored?.fields||order.personalization.fields||{};
  for(const [key,value] of Object.entries(saved)){const f=form.elements.namedItem(key);if(f&&typeof value==='string')f.value=value;}
  form.elements.namedItem('look').value='3d';form.elements.namedItem('package').value=order.targetSeconds===120?'gift_120':'gift_60';
  $('#gift-duration').textContent='Pagado · '+order.targetSeconds/60+' minuto'+(order.targetSeconds===120?'s':'');
  $('#photo-auth').textContent='Tu película ya está pagada. Estas fotos se usarán únicamente como referencia para sus protagonistas.';
  $('#account-link').hidden=true;$('#personalization-loading').hidden=true;form.hidden=false;ready=true;$('#gift-photos').disabled=false;paintQuestions();show(giftDraftStep(restored));
 }catch(e){$('#personalization-loading').textContent=e.message||'No pudimos abrir tu pedido. Actualiza para intentarlo de nuevo.';}
}
load();
window.addEventListener('pageshow',e=>{if(e.persisted){setBusy(false);load();}});
