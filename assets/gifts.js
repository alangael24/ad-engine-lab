import {getAuthClient,apiRequest} from './auth-client.js';
import {giftRequest,giftQuestions,giftDraftStep,GIFT_OCCASIONS,GIFT_EMOTIONS} from './gift-model.js';
const $=s=>document.querySelector(s),form=$('#gift-form'),panels=[...document.querySelectorAll('[data-panel]')];
const DRAFT='creativerush-gift-draft-v1',PENDING='creativerush-gift-submit-v1';
let step=0,session=null,busy=false,photos=[];
const read=k=>{try{return JSON.parse(sessionStorage.getItem(k));}catch{return null;}};
const store=(k,v)=>sessionStorage.setItem(k,JSON.stringify(v));
const fields=()=>Object.fromEntries(new FormData(form));
function status(t,error=false){$('#gift-status').textContent=t;$('#gift-status').dataset.error=String(error);}
function saveDraft(){try{store(DRAFT,{fields:fields(),step,version:3});}catch{status('No pudimos guardar el borrador en este navegador. No cierres esta pestaña.',true);}}
const restored=read(DRAFT);if(restored?.fields)for(const [k,v]of Object.entries(restored.fields)){const input=form.elements.namedItem(k);if(input&&typeof v==='string')input.value=v;}
const purchasedPackage=new URLSearchParams(location.search).get('package');
if(['gift_60','gift_120'].includes(purchasedPackage))form.elements.namedItem('package').value=purchasedPackage;
function paintPackage(){const code=form.elements.namedItem('package').value;$('#gift-duration').hidden=step!==3;$('#gift-duration').textContent=code==='gift_120'?'2 minutos · $499 MXN':'1 minuto · $299 MXN';for(const link of document.querySelectorAll('[data-gift-buy]'))link.hidden=link.dataset.giftBuy!==code;saveDraft();}
for(const input of document.querySelectorAll('[name=package]'))input.addEventListener('change',paintPackage);
for(const link of document.querySelectorAll('[data-gift-buy]'))link.addEventListener('click',e=>{if(busy){e.preventDefault();return;}form.elements.namedItem('package').value=link.dataset.giftBuy;paintPackage();});
paintPackage();
function validatePanel(n){for(const f of panels[n].querySelectorAll('input,textarea,select'))if(!f.checkValidity()){show(n);f.reportValidity();return false;}return true;}
function paintQuestions(){const q=giftQuestions(fields());$('#memory1-question').textContent=q.memory;$('#memory2-question').textContent=q.detail;$('#message-question').textContent=q.message;form.elements.memory1.placeholder=q.example;$('#memory-hint').textContent=q.hint;}
for(const name of ['relationship','occasion'])form.elements.namedItem(name).addEventListener('change',paintQuestions);
paintQuestions();
const stepTitles=['¿A quién quieres sorprender?','Los detalles que solo ustedes conocen.','Dale vida a sus protagonistas.','Elige su película.'];
function show(n){step=n;document.body.dataset.giftStep=String(n);panels.forEach((p,i)=>p.hidden=i!==n);document.querySelectorAll('[data-step]').forEach(b=>b.setAttribute('aria-current',Number(b.dataset.step)===n?'step':'false'));$('#form-title').textContent=stepTitles[n];$('#gift-back').hidden=n===0;$('#gift-next').hidden=n===3;$('#gift-submit').hidden=n!==3;$('#gift-purchase').hidden=n!==3;$('#gift-next').textContent=['Recordar juntos →','Elegir el estilo →','Elegir la duración →'][n]||'Continuar →';$('#gift-duration').hidden=n!==3;const f=fields();$('#gift-summary').textContent=`Para ${f.recipient||'esa persona especial'} · ${GIFT_OCCASIONS[f.occasion]||'Su historia'} · ${GIFT_EMOTIONS[f.emotion]||'Amor'} · ${f.look==='clay'?'Plastilina':'Animación 3D'}.`;saveDraft();}
function go(n){if(busy)return;if(n>step)for(let i=0;i<n;i++)if(!validatePanel(i))return;show(n);const heading=$('#form-title');heading.tabIndex=-1;heading.focus({preventScroll:true});heading.closest('.workbench').scrollIntoView({block:'start',behavior:'instant'});}
for(const b of document.querySelectorAll('[data-step]'))b.onclick=()=>go(Number(b.dataset.step));
$('#gift-next').onclick=()=>go(step+1);$('#gift-back').onclick=()=>go(step-1);form.addEventListener('input',saveDraft);
function paintPhotos(){const list=$('#photo-list');list.replaceChildren();for(const p of photos){const row=document.createElement('div');row.className='photo-row';const img=document.createElement('img');img.src=p.url;img.alt='Foto de referencia seleccionada';const label=document.createElement('label');label.append('¿Quién aparece?');const input=document.createElement('input');input.required=true;input.maxLength=100;input.placeholder='Ana a la izquierda, Luis a la derecha';input.value=p.label;input.oninput=()=>{p.label=input.value;};label.append(input);const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.setAttribute('aria-label','Quitar '+p.file.name);remove.onclick=()=>{URL.revokeObjectURL(p.url);photos=photos.filter(x=>x!==p);paintPhotos();};row.append(img,label,remove);list.append(row);}}
$('#gift-photos').onchange=e=>{const incoming=[...e.target.files];e.target.value='';if(photos.length+incoming.length>3){status('Puedes añadir hasta tres fotos de referencia.',true);return;}if(incoming.some(f=>!['image/jpeg','image/png','image/webp'].includes(f.type)||f.size>6291456)){status('Usa JPG, PNG o WebP de hasta 6 MB por foto.',true);return;}for(const file of incoming)photos.push({file,label:'',id:null,url:URL.createObjectURL(file)});paintPhotos();status('');};
async function refreshAuth(){try{const auth=await getAuthClient();const {data,error}=await auth.auth.getSession();if(error)throw error;session=data.session;for(const link of document.querySelectorAll('[data-gift-buy]')){const url=new URL(link.href);url.searchParams.delete('locked_prefilled_email');url.searchParams.delete('client_reference_id');if(session?.user?.email_confirmed_at){url.searchParams.set('locked_prefilled_email',session.user.email);url.searchParams.set('client_reference_id',session.user.id);}url.searchParams.set('locale','es');link.href=url.href;}$('#gift-photos').disabled=busy||!session;$('#photo-auth').replaceChildren();if(!session){const a=document.createElement('a');a.href='/cuenta/?next=regalos';a.textContent='Inicia sesión para añadir tus fotos.';a.onclick=saveDraft;$('#photo-auth').append(a);}else{$('#account-link').href='/regalos/pedido/';$('#account-link').textContent='Mis películas';}return session;}catch(e){status('No pudimos conectar tu cuenta. Puedes escribir tu historia y volver a intentarlo.',true);return null;}}
async function uploadPhoto(p){const r=await fetch('/api/studio?upload=1&kind=image',{method:'POST',headers:{authorization:`Bearer ${session.access_token}`,'content-type':p.file.type,'x-file-name':encodeURIComponent(p.file.name)},body:p.file});const result=await r.json();if(!r.ok)throw Error(result.error||'No pudimos guardar esta foto. Inténtalo de nuevo.');p.id=result.asset.id;return p.id;}
function resume(id){const a=$('#resume-project');a.href='/regalos/pedido/?id='+encodeURIComponent(id);a.hidden=false;}
function setBusy(value){busy=value;for(const f of form.querySelectorAll('input,textarea,select,button'))f.disabled=value;$('#gift-photos').disabled=value||!session;for(const b of document.querySelectorAll('[data-step],[name=package]'))b.disabled=value;}
form.noValidate=true;
form.onsubmit=async e=>{e.preventDefault();if(busy)return;for(let i=0;i<panels.length;i++)if(!validatePanel(i))return;const submitted=fields();saveDraft();setBusy(true);let pending=read(PENDING);
 try{
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
  sessionStorage.removeItem(PENDING);sessionStorage.removeItem(DRAFT);location.assign('/regalos/pedido/?id='+project.id);
 }catch(error){status(error.message||'No pudimos completar este paso. Tu borrador está guardado.',true);if(pending)resume(pending.id);}
 finally{setBusy(false);}
};
$('#account-link').addEventListener('click',saveDraft);show(giftDraftStep(restored));refreshAuth();
