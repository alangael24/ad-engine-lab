import {apiRequest} from './auth-client.js';
const $=s=>document.querySelector(s),id=new URLSearchParams(location.search).get('id');let order,busy=false,timer,needsPayment=true;
const states={received:'Recibimos tu historia. Prepararemos el guion para que lo revises aquí.',script_ready:'Tu guion está listo. Revísalo antes de aprobar la producción.',approved:'Guion aprobado. Tu película está pendiente de producción.',producing:'Estamos creando tu película.',ready:'Tu película está lista para descargar.',cancelled:'Este pedido fue cancelado. Los segundos reservados se liberaron.'};
function say(t){$('#order-status').textContent=t;}
async function refresh(){clearTimeout(timer);try{
 const r=await apiRequest('/api/gift-orders'+(id?'?id='+encodeURIComponent(id):''));
 $('#admin-link').hidden=!r.canAdmin;
 if(!id){say(r.orders.length?'Abre una película para ver su avance.':'Todavía no has enviado una historia.');const list=$('#order-list');list.replaceChildren();for(const o of r.orders){const a=document.createElement('a');a.className='order-list-item';a.href='/regalos/pedido/?id='+o.id;a.textContent=`${o.title} — ${states[o.status]}`;list.append(a);}return;}
 order=r.order;$('#order-title').textContent=order.title;$('#order-details').hidden=false;say(states[order.status]);$('#order-reference').textContent='Pedido '+order.id.slice(0,8);$('#order-progress').textContent=`Película de ${order.targetSeconds/60} minuto${order.targetSeconds>60?'s':''}`;
 $('#order-script').hidden=!order.script;$('#order-script').textContent=order.script;$('#order-review').hidden=order.status!=='script_ready';
 $('#order-balance').textContent=order.status==='script_ready'?`Tienes ${r.seconds.available} segundos disponibles. Al aprobar se reservan ${order.targetSeconds}.`:'';
 needsPayment=['received','script_ready'].includes(order.status)&&r.seconds.available<order.targetSeconds;
 $('#order-buy').hidden=!needsPayment;$('#order-buy').textContent=order.targetSeconds===120?'Comprar película de 2 minutos · $499 MXN':'Comprar película de 1 minuto · $299 MXN';
 // The server selects a payment link with the verified account identity; never trust query params as payment proof.
 $('#order-buy').onclick=async e=>{e.preventDefault();await task(async()=>{const r=await apiRequest('/api/checkout',{method:'POST',body:{plan:order.targetSeconds===120?'gift_120':'gift_60'}});location.assign(r.url);});};
 $('#order-approve').disabled=needsPayment;$('#order-download').hidden=order.status!=='ready';
 $('#order-download').onclick=async e=>{e.preventDefault();await task(async()=>{const d=await apiRequest('/api/gift-orders?id='+id+'&download=1');location.assign(d.url);});};
 if(!['ready','cancelled'].includes(order.status))timer=setTimeout(()=>{if(!busy)refresh();},30000);
 }catch(e){say(e.message||'No pudimos conectar. Puedes actualizar para intentarlo de nuevo.');if(e.code==='UNAUTHORIZED'){const a=document.createElement('a');a.href='/cuenta/?mode=login&next=gift-orders';a.textContent='Iniciar sesión';$('#order-list').replaceChildren(a);}}}
async function task(fn){if(busy)return;busy=true;for(const b of document.querySelectorAll('button'))b.disabled=true;try{await fn();await refresh();}catch(e){say(e.message);}finally{busy=false;$('#order-refresh').disabled=false;$('#order-changes').disabled=false;$('#order-approve').disabled=needsPayment||order?.status!=='script_ready';}}
$('#order-approve').onclick=()=>task(()=>apiRequest('/api/gift-orders',{method:'POST',body:{action:'approve',id,expected:order.revision}}));
$('#order-changes').onclick=()=>task(async()=>{const note=$('#order-note').value.trim();if(!note)throw Error('Escribe el cambio que quieres pedir.');await apiRequest('/api/gift-orders',{method:'POST',body:{action:'changes',id,expected:order.revision,note}});$('#order-note').value='';});
$('#order-refresh').onclick=()=>{if(!busy)refresh();};refresh();
