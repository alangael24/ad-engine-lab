import {getAuthClient,apiRequest} from './auth-client.js';
import {giftRequest,giftQuestions,giftDraftStep,GIFT_OCCASIONS,GIFT_EMOTIONS} from './gift-model.js';
import {guestAvailable,saveGuest} from './gift-guest-client.js';
import {mountGiftMemoryGuide} from './gift-memory-guide.js';
import {giftBriefMissing} from './gift-brief.js';
import {saveGiftPhotos,loadGiftPhotos} from './gift-photo-draft.js';
const $=s=>document.querySelector(s),form=$('#gift-form'),panels=[...document.querySelectorAll('[data-panel]')];
const DRAFT='creativerush-gift-draft-v1',PENDING='creativerush-gift-submit-v1';
let step=0,session=null,busy=false,photos=[],guest=false;
const guestReady=guestAvailable().then(v=>guest=v);
const photosReady=loadGiftPhotos().then(saved=>{photos=saved.map(p=>({...p,id:null,url:URL.createObjectURL(p.file)}));paintPhotos();}).catch(()=>{});
const read=k=>{try{return JSON.parse(sessionStorage.getItem(k));}catch{return null;}};
const store=(k,v)=>sessionStorage.setItem(k,JSON.stringify(v));
const fields=()=>Object.fromEntries(new FormData(form));
function status(t,error=false){$('#gift-status').textContent=t;$('#gift-status').dataset.error=String(error);}
function saveDraft(){try{store(DRAFT,{fields:fields(),step,version:4});}catch{status('No pudimos guardar el borrador en este navegador. No cierres esta pestaña.',true);}}
const restored=read(DRAFT);if(restored?.fields?.names&&!restored.fields.additionalNames)restored.fields.additionalNames=restored.fields.names;if(restored?.fields)for(const [k,v]of Object.entries(restored.fields)){const input=form.elements.namedItem(k);if(input&&typeof v==='string')input.value=v;}
// Restore older drafts without carrying a retired visual style into new orders.
form.elements.namedItem('look').value='3d';
const purchasedPackage=new URLSearchParams(location.search).get('package');
if(['gift_60','gift_120'].includes(purchasedPackage))form.elements.namedItem('package').value=purchasedPackage;
$('#gift-duration').hidden=true;
function validatePanel(n){form.elements.memory2.setCustomValidity(fields().package==='gift_120'&&fields().memory2.trim()&&giftBriefMissing(fields()).includes('memory2')?'Cuéntanos un segundo momento distinto del primero.':'');for(const f of panels[n].querySelectorAll('input,textarea,select'))if(!f.checkValidity()){show(n);for(let parent=f.parentElement;parent&&parent!==panels[n];parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;f.reportValidity();return false;}return true;}
function paintQuestions(){const premium=fields().package==='gift_120';$('#gift-plan-guide').textContent=premium?'Para tus 2 minutos: cuéntanos dos momentos que quieras conectar y cómo quieres cerrar la película. Puedes añadir un tercer recuerdo en los detalles.':'Para tu minuto: cuéntanos un recuerdo concreto y qué quieres decirle al final. Un lugar, lo que pasó y por qué importa nos ayudan a hacerlo suyo.';form.elements.memory2.required=premium;$('#memory2-optional').hidden=premium;$(premium?'#premium-memory':'#optional-memory').append($('#second-memory'));const q=giftQuestions(fields());$('#memory1-question').textContent=q.memory;$('#memory2-question').textContent=premium?'¿Qué otro momento quieres conectar con ese recuerdo?':q.detail;$('#message-question').textContent=q.message;form.elements.memory1.placeholder=q.example;$('#memory-hint').textContent=q.hint;mountGiftMemoryGuide($('#memory1-guide'),{context:fields(),input:form.elements.memory1,question:$('#memory1-question'),hint:$('#memory-hint')});$('#memory2-guide').hidden=!premium;$('#memory2-hint').textContent='';if(premium)mountGiftMemoryGuide($('#memory2-guide'),{context:fields(),input:form.elements.memory2,question:$('#memory2-question'),hint:$('#memory2-hint'),second:true});}
for(const name of ['relationship','occasion'])form.elements.namedItem(name).addEventListener('change',paintQuestions);
paintQuestions();
const stepTitles=['¿A quién quieres sorprender?','Dale vida a sus protagonistas.'];
function show(n){step=n;document.body.dataset.giftStep=String(n);panels.forEach((p,i)=>p.hidden=i!==n);document.querySelectorAll('[data-step]').forEach(b=>b.setAttribute('aria-current',Number(b.dataset.step)===n?'step':'false'));$('#form-title').textContent=stepTitles[n];$('#gift-back').hidden=n===0;$('#gift-next').hidden=n===1;$('#gift-continue').hidden=n!==1;saveDraft();}
function go(n){if(busy)return;if(n>step)for(let i=0;i<n;i++)if(!validatePanel(i))return;show(n);const heading=$('#form-title');heading.tabIndex=-1;heading.focus({preventScroll:true});heading.closest('.workbench').scrollIntoView({block:'start',behavior:'instant'});}
for(const b of document.querySelectorAll('[data-step]'))b.onclick=()=>go(Number(b.dataset.step));
$('#gift-next').onclick=()=>go(step+1);$('#gift-back').onclick=()=>go(step-1);form.addEventListener('input',saveDraft);
function paintPhotos(){const list=$('#photo-list');list.replaceChildren();for(const p of photos){const row=document.createElement('div');row.className='photo-row';const img=document.createElement('img');img.src=p.url;img.alt='Foto de referencia seleccionada';const label=document.createElement('label');label.append('¿Quién aparece?');const input=document.createElement('input');input.required=true;input.maxLength=100;input.placeholder='Ana a la izquierda, Luis a la derecha';input.value=p.label;input.oninput=()=>{p.label=input.value;};label.append(input);const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.setAttribute('aria-label','Quitar '+p.file.name);remove.onclick=()=>{URL.revokeObjectURL(p.url);photos=photos.filter(x=>x!==p);paintPhotos();};row.append(img,label,remove);list.append(row);}}
$('#gift-photos').onchange=async e=>{const incoming=[...e.target.files];e.target.value='';await photosReady;if(photos.length+incoming.length>3){status('Puedes añadir hasta tres fotos de referencia.',true);return;}if(incoming.some(f=>!['image/jpeg','image/png','image/webp'].includes(f.type)||f.size>6291456)){status('Usa JPG, PNG o WebP de hasta 6 MB por foto.',true);return;}for(const file of incoming)photos.push({file,label:'',id:null,url:URL.createObjectURL(file)});paintPhotos();status('');};
async function refreshAuth(){await guestReady;if(guest){$('#account-link').hidden=true;$('#gift-photos').disabled=busy;$('#photo-auth').textContent='No necesitas crear una cuenta. Escribirás tu correo una sola vez al pagar en Stripe.';return null;}try{const auth=await getAuthClient();const {data,error}=await auth.auth.getSession();if(error)throw error;session=data.session;$('#gift-photos').disabled=busy||!session;$('#photo-auth').replaceChildren();if(!session){const a=document.createElement('a');a.href='/cuenta/?next=regalos';a.textContent='Inicia sesión para añadir tus fotos.';a.onclick=saveDraft;$('#photo-auth').append(a);}else{$('#account-link').href='/regalos/pedido/';$('#account-link').textContent='Mi cuenta';$('#account-link').href='/cuenta/?next=gift-orders';}return session;}catch(e){status('No pudimos conectar tu cuenta. Puedes escribir tu historia y volver a intentarlo.',true);return null;}}
async function uploadPhoto(p){const r=await fetch('/api/studio?upload=1&kind=image',{method:'POST',headers:{authorization:`Bearer ${session.access_token}`,'content-type':p.file.type,'x-file-name':encodeURIComponent(p.file.name)},body:p.file});const result=await r.json();if(!r.ok)throw Error(result.error||'No pudimos guardar esta foto. Inténtalo de nuevo.');p.id=result.asset.id;return p.id;}
function resume(id){const a=$('#resume-project');a.href='/regalos/pedido/?id='+encodeURIComponent(id);a.hidden=false;}
function setBusy(value){busy=value;for(const f of form.querySelectorAll('input,textarea,select,button'))f.disabled=value;$('#gift-photos').disabled=value||(!guest&&!session);for(const b of document.querySelectorAll('[data-step],[name=package]'))b.disabled=value;}
form.noValidate=true;
form.onsubmit=async e=>{e.preventDefault();if(busy)return;const requestedPackage=e.submitter?.dataset.giftPackage;if(['gift_60','gift_120'].includes(requestedPackage)){form.elements.namedItem('package').value=requestedPackage;}for(let i=0;i<panels.length;i++)if(!validatePanel(i))return;const submitted=fields();saveDraft();setBusy(true);let pending=read(PENDING);
 try{
  await guestReady;
  if(guest){await photosReady;await saveGiftPhotos(photos).catch(()=>{});giftRequest(submitted,photos.map(p=>({id:p.id||crypto.randomUUID(),label:p.label})));status('Guardando tu historia…');const draft=await saveGuest(submitted,photos,status);location.assign('/regalos/checkout/?draft='+draft.id);return;}
  if(!await refreshAuth()){location.assign('/cuenta/?next=regalos');return;}
  if(pending&&pending.userId!==session.user.id){sessionStorage.removeItem(PENDING);pending=null;}
  if(!pending){
   // Validate all text before uploading any file. Freeze the request before project creation.
   const input=submitted;
   giftRequest(input,photos.map(p=>({id:p.id||crypto.randomUUID(),label:p.label})));
   for(const p of photos){status(`Guardando foto ${photos.indexOf(p)+1} de ${photos.length}…`);if(!p.id)await uploadPhoto(p);}
   const data=giftRequest(input,photos.map(p=>({id:p.id,label:p.label})));pending={id:crypto.randomUUID(),chatId:crypto.randomUUID(),userId:session.user.id,data};store(PENDING,pending);
  }
  status('Guardando tu historia…');
  const saved=await apiRequest('/api/studio',{method:'POST',body:{action:'create_project',id:pending.id,data:pending.data}});const project=saved.value;resume(project.id);
  status('Tu historia está guardada. Enviando el pedido…');
  await apiRequest('/api/gift-orders',{method:'POST',body:{action:'submit',id:project.id}});
  sessionStorage.removeItem(PENDING);sessionStorage.removeItem(DRAFT);location.assign('/regalos/checkout/?id='+project.id);
 }catch(error){status(error.message||'No pudimos completar este paso. Tu borrador está guardado.',true);if(pending)resume(pending.id);}
 finally{setBusy(false);}
};
$('#account-link').addEventListener('click',saveDraft);show(giftDraftStep(restored));refreshAuth();

window.addEventListener('pageshow',e=>{if(e.persisted){setBusy(false);const draft=read(DRAFT);if(['gift_60','gift_120'].includes(draft?.fields?.package))form.elements.namedItem('package').value=draft.fields.package;paintQuestions();}});
