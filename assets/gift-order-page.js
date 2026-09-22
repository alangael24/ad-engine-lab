import {apiRequest as accountRequest} from './auth-client.js';
import {whatsappPhone} from './gift-whatsapp-model.js';
import {privateAccess} from './gift-guest-client.js';
const incoming=privateAccess();let access=incoming||sessionStorage.getItem('gift-order-access');
if(incoming)sessionStorage.setItem('gift-order-access',incoming);
// An explicit account order URL always uses account authentication.
if(new URLSearchParams(location.search).has('id'))access=null;
async function apiRequest(path,options={}){if(!access)return accountRequest(path,options);const r=await fetch(path,{method:options.method||'GET',headers:{'x-gift-access':access,...(options.body?{'content-type':'application/json'}:{})},body:options.body?JSON.stringify(options.body):undefined}),b=await r.json();if(!r.ok)throw Error(b.error||'No pudimos abrir tu pedido.');return b;}

const $=s=>document.querySelector(s);let id=new URLSearchParams(location.search).get('id');let whatsappLoaded=false,whatsappBusy=false;let order,busy=false,timer,needsPayment=true;
const states={received:'Recibimos tu historia. Prepararemos el guion para que lo revises aquí.',script_ready:'Tu guion está listo. Revísalo antes de aprobar la producción.',approved:'Guion aprobado. Tu película está pendiente de producción.',producing:'Estamos creando tu película.',ready:'Tu película está lista para descargar.',cancelled:'Este pedido fue cancelado. Los segundos reservados se liberaron.'};
function say(t){$('#order-status').textContent=t;}
async function refresh(){clearTimeout(timer);try{
 if(access&&!id){const response=await fetch('/api/gift-guest?order=1',{headers:{'x-gift-access':access}}),info=await response.json();if(!response.ok)throw Error(info.error);if(!info.orderId){say('Esperamos la confirmación de Stripe. No necesitas volver a pagar.');timer=setTimeout(refresh,5000);return;}id=info.orderId;}
 const r=await apiRequest('/api/gift-orders'+(id?'?id='+encodeURIComponent(id):''));
 $('#admin-link').hidden=!r.canAdmin;
 if(!id){say(r.orders.length?'Abre una película para ver su avance.':'Todavía no has enviado una historia.');const list=$('#order-list');list.replaceChildren();for(const o of r.orders){const a=document.createElement('a');a.className='order-list-item';a.href='/regalos/pedido/?id='+o.id;a.textContent=`${o.title} — ${o.personalization?.state==='pending'?'Pagado · pendiente de personalizar':states[o.status]}`;list.append(a);}return;}
 order=r.order;const pending=order.personalization?.state==='pending';$('#order-personalize').hidden=!pending||order.status==='cancelled';$('#order-personalize').href='/regalos/personalizar/?id='+order.id+(access?'#gift='+access:'');$('#order-whatsapp').hidden=!r.whatsapp;if(r.whatsapp&&!whatsappLoaded){$('#whatsapp-consent').checked=Boolean(r.whatsapp.phone);$('#whatsapp-number').value=r.whatsapp.phone||'';paintWhatsApp();whatsappLoaded=true;}$('#order-title').textContent=order.title;$('#order-details').hidden=false;say(pending&&order.status!=='cancelled'?'Tu pago está confirmado. Ahora cuéntanos su historia y añade sus fotos.':states[order.status]);$('#order-reference').textContent='Pedido '+order.id.slice(0,8);$('#order-progress').textContent=`Película de ${order.targetSeconds/60} minuto${order.targetSeconds>60?'s':''}`;
 $('#order-script').hidden=!order.script;$('#order-script').textContent=order.script;$('#order-review').hidden=order.status!=='script_ready';
 $('#order-balance').textContent=!access&&order.status==='script_ready'?`Tienes ${r.seconds.available} segundos disponibles. Al aprobar se reservan ${order.targetSeconds}.`:'';
 needsPayment=['received','script_ready'].includes(order.status)&&r.seconds.available<order.targetSeconds;
 $('#order-buy').hidden=!needsPayment;$('#order-buy').textContent=order.targetSeconds===120?'Comprar película de 2 minutos · $499 MXN':'Comprar película de 1 minuto · $299 MXN';
 $('#order-buy').href='/regalos/checkout/?id='+encodeURIComponent(order.id);
 $('#order-buy').removeAttribute('target');
 $('#order-approve').disabled=needsPayment;$('#order-download').hidden=order.status!=='ready';
 $('#order-download').onclick=async e=>{e.preventDefault();await task(async()=>{const d=await apiRequest('/api/gift-orders?id='+id+'&download=1');location.assign(d.url);});};
 if(!['ready','cancelled'].includes(order.status))timer=setTimeout(()=>{if(!busy)refresh();},30000);
 }catch(e){say(e.message||'No pudimos conectar. Puedes actualizar para intentarlo de nuevo.');if(e.code==='UNAUTHORIZED'){const a=document.createElement('a');a.href='/cuenta/?mode=login&next=gift-orders';a.textContent='Iniciar sesión';$('#order-list').replaceChildren(a);}}}
async function task(fn){if(busy)return;busy=true;for(const b of document.querySelectorAll('button'))b.disabled=true;try{await fn();await refresh();}catch(e){say(e.message);}finally{busy=false;$('#whatsapp-save').disabled=whatsappBusy;$('#order-refresh').disabled=false;$('#order-changes').disabled=false;$('#order-approve').disabled=needsPayment||order?.status!=='script_ready';}}
$('#order-approve').onclick=()=>task(()=>apiRequest('/api/gift-orders',{method:'POST',body:{action:'approve',id,expected:order.revision}}));
$('#order-changes').onclick=()=>task(async()=>{const note=$('#order-note').value.trim();if(!note)throw Error('Escribe el cambio que quieres pedir.');await apiRequest('/api/gift-orders',{method:'POST',body:{action:'changes',id,expected:order.revision,note}});$('#order-note').value='';});
function paintWhatsApp(){$('#whatsapp-number-wrap').hidden=!$('#whatsapp-consent').checked;$('#whatsapp-number').required=$('#whatsapp-consent').checked;}
$('#whatsapp-consent').onchange=()=>{paintWhatsApp();$('#whatsapp-status').textContent='';};
$('#whatsapp-form').onsubmit=async e=>{e.preventDefault();if(whatsappBusy||!id||busy)return;whatsappBusy=true;$('#whatsapp-save').disabled=true;try{const consent=$('#whatsapp-consent').checked,phone=whatsappPhone($('#whatsapp-number').value,consent);await apiRequest('/api/gift-orders',{method:'POST',body:{action:'whatsapp',id,consent,phone}});$('#whatsapp-status').textContent=consent?'Listo. También recibirás los enlaces del guion y la película en '+phone+'.':'Guardado. Recibirás los enlaces únicamente por correo.';}catch(e){$('#whatsapp-status').textContent=e.message;}finally{whatsappBusy=false;$('#whatsapp-save').disabled=false;}};
$('#order-refresh').onclick=()=>{if(!busy)refresh();};refresh();
