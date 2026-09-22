import {apiRequest,getAuthClient} from './auth-client.js';
const $=s=>document.querySelector(s),params=new URLSearchParams(location.search),id=params.get('id');let page=0,busy=false;
const states={received:'Historia recibida',script_ready:'Guion por aprobar',approved:'Aprobado · por producir',producing:'En producción',ready:'Entregado',cancelled:'Cancelado'};
const date=value=>value?new Date(value).toLocaleString('es-MX'):'—';
const el=(tag,text,className)=>{const n=document.createElement(tag);n.textContent=text;if(className)n.className=className;return n;};
function fact(name,value){const box=el('div','');box.append(el('dt',name),el('dd',String(value??'—')));$('#facts').append(box);}
async function load(){if(busy)return;busy=true;$('#refresh').disabled=true;$('#notice').textContent='Cargando pedidos…';$('#authorized').hidden=true;$('#login').hidden=true;$('#switch-account').hidden=true;
 try{
  const q=new URLSearchParams(id?{id}:{page:String(page),status:$('#status-filter').value});const r=await apiRequest('/api/gift-admin?'+q);
  $('#authorized').hidden=false;$('#notice').textContent='';$('#list-view').hidden=Boolean(id);$('#detail-view').hidden=!id;
  if(!id){$('#orders').replaceChildren();$('#page-label').textContent=`Página ${page+1}`;$('#previous').disabled=page===0;$('#next').disabled=!r.hasMore;
   if(!r.orders.length)$('#orders').append(el('p','No hay pedidos con este estado.'));
   for(const o of r.orders){const a=el('a','','admin-card');a.href='/regalos/admin/?id='+o.id;a.append(el('h2',o.title),el('span',(o.needsPersonalization?'Pagado · pendiente de personalizar':states[o.status]),'admin-badge'),el('p',`${o.targetSeconds/60} min · ${o.targetSeconds===120?'Prioritaria · 1 hora':'Estándar · 24 h'} · ${date(o.createdAt)} · ${o.id.slice(0,8)}`));$('#orders').append(a);}return;
  }
  const o=r.order;$('#detail-title').textContent=o.title;$('#facts').replaceChildren();
  for(const [k,v]of [['Pedido',o.id],['Cliente',o.customerEmail||'Correo no disponible'],['Estado',(o.needsPersonalization?'Pagado · pendiente de personalizar':states[o.status])],['Duración',o.targetSeconds/60+' minuto(s)'],['Entrega',o.targetSeconds===120?'Prioritaria · 1 hora':'Estándar · 24 horas'],['Formato',o.brief.aspectRatio],['Estilo',o.brief.creative?.look==='clay'?'Plastilina':o.brief.creative?.look==='3d'?'Animación 3D':o.brief.creative?.look||'—'],['Recibido',date(o.createdAt)],['Último cambio',date(o.updatedAt)],['Guion aprobado',date(o.approvedAt)],['Entregado',date(o.deliveredAt)],['Duración reservada',o.reservedSeconds+' s'],['Duración entregada',o.deliveredSeconds==null?'—':o.deliveredSeconds+' s']])fact(k,v);
  $('#brief').textContent=o.brief.idea||'Sin instrucciones.';$('#script').textContent=o.script||'El guion todavía no está preparado.';$('#changes').textContent=o.customerNote||'Sin cambios solicitados.';$('#review').textContent=o.reviewNote||'Todavía no hay revisión de entrega.';$('#photo-notes').textContent=o.brief.referenceNotes||'';$('#photos').replaceChildren();
  if(!o.photos.length)$('#photos').append(el('p','Este pedido no incluye fotos. Los personajes tendrán una apariencia inventada.'));
  for(const p of o.photos){const f=el('figure',''),a=el('a',''),img=document.createElement('img');a.href=p.url;a.target='_blank';a.rel='noopener noreferrer';img.src=p.url;img.alt=p.name||'Referencia del cliente';img.loading='lazy';a.append(img);f.append(a,el('figcaption',p.name));$('#photos').append(f);}
  $('#download').hidden=o.status!=='ready';
  $('#whatsapp-delivery').hidden=!o.whatsapp;$('#whatsapp-open').hidden=true;$('#whatsapp-contact').textContent=o.whatsapp?`${o.whatsapp.phone} · Autorizado el ${date(o.whatsapp.consentedAt)}`:'';$('#send-whatsapp').hidden=!o.whatsapp||!['script_ready','ready'].includes(o.status);
 }catch(e){$('#notice').textContent=e.message||'No pudimos abrir los pedidos.';$('#login').hidden=e.code!=='UNAUTHORIZED';$('#switch-account').hidden=e.code!=='FORBIDDEN';}
 finally{busy=false;$('#refresh').disabled=false;}}
$('#switch-account').onclick=async()=>{try{const auth=await getAuthClient();const {error}=await auth.auth.signOut();if(error)throw error;location.assign('/cuenta/?next=gift-admin');}catch(e){$('#notice').textContent=e.message;}};
$('#refresh').onclick=load;$('#status-filter').onchange=()=>{page=0;load();};$('#previous').onclick=()=>{if(!busy&&page>0){page--;load();}};$('#next').onclick=()=>{if(!busy){page++;load();}};
$('#download').onclick=async e=>{e.preventDefault();try{const r=await apiRequest('/api/gift-admin?id='+encodeURIComponent(id)+'&download=1');location.assign(r.url);}catch(e){$('#notice').textContent=e.message;}};load();

$('#send-whatsapp').onclick=async()=>{const button=$('#send-whatsapp');button.disabled=true;try{const r=await apiRequest('/api/gift-admin?id='+encodeURIComponent(id)+'&whatsapp=1');const u=new URL(r.url);if(u.protocol!=='https:'||u.hostname!=='wa.me')throw Error('Enlace de WhatsApp no válido.');const a=$('#whatsapp-open');a.href=u.href;a.hidden=false;a.click();}catch(e){$('#notice').textContent=e.message;}finally{button.disabled=false;}};
