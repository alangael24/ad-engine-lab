import {guestAvailable,guestRequest,rememberPortal} from './gift-guest-client.js';
import {trackGiftCheckout} from './gift-tracking.js';
const $=s=>document.querySelector(s),params=new URLSearchParams(location.search),KEY='gift-purchase-first-v1';
let plan=params.get('package')==='gift_60'?'gift_60':'gift_120',busy=false,enabled=false;
function paint(){const premium=plan==='gift_120';$('#choose-60').checked=!premium;$('#choose-120').checked=premium;$('#popular').hidden=!premium;$('#package-title').textContent=premium?'Nuestra historia':'Un recuerdo especial';$('#package-description').textContent=premium?'Varios recuerdos, unidos en una sola película.':'Un momento inolvidable, convertido en su propia película.';$('#package-price').textContent=premium?'$499':'$299';$('#package-duration').textContent=premium?'2 minutos':'1 minuto';$('#package-delivery').textContent=premium?'Entrega en 1 hora*':'Entrega en 24 horas*';$('#checkout-pay').textContent=premium?'Crear nuestra historia · $499':'Crear mi regalo · $299';}
$('#checkout-account').hidden=true;$('#checkout-guest-info').hidden=false;$('#checkout-story-details').hidden=true;$('#view-order').href='/regalos/';$('#view-order').textContent='← Volver a los paquetes';
function choose(value){if(busy)return;plan=value;paint();history.replaceState(null,'','?package='+plan);}
$('#choose-60').onchange=()=>choose('gift_60');$('#choose-120').onchange=()=>choose('gift_120');
async function load(){enabled=await guestAvailable();$('#checkout-pay').disabled=!enabled;$('#checkout-status').textContent=enabled?'Después de pagar podrás añadir su historia y sus fotos.':'El pago no está disponible en este momento. Actualiza para volver a intentarlo.';}
$('#checkout-form').onsubmit=async e=>{e.preventDefault();if(busy||!enabled)return;busy=true;$('#checkout-pay').disabled=true;$('#checkout-options').disabled=true;
 try{
  let d;try{d=JSON.parse(sessionStorage.getItem(KEY));}catch{}
  if(!d||d.plan!==plan){d={id:crypto.randomUUID(),token:Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join(''),plan};sessionStorage.setItem(KEY,JSON.stringify(d));}
  $('#checkout-status').textContent='Abriendo el pago seguro…';
  await guestRequest('/api/gift-guest?create=1',{method:'POST',body:{id:d.id,token:d.token,fields:{flow:'pay_first',package:plan},photos:[]}});
  const r=await guestRequest('/api/gift-guest?draft='+d.id+'&checkout=1',{method:'POST',token:d.token,body:{plan}});rememberPortal(r.portal);
  if(r.paid){sessionStorage.removeItem(KEY);location.assign(r.portal);return;}
  const url=new URL(r.url);if(url.protocol!=='https:'||url.hostname!=='buy.stripe.com')throw Error('No pudimos abrir el pago seguro.');
  trackGiftCheckout(plan,url.href);location.assign(url.href);
 }catch(e){$('#checkout-status').textContent=e.message||'No pudimos abrir Stripe. Inténtalo de nuevo.';busy=false;$('#checkout-pay').disabled=false;$('#checkout-options').disabled=false;}
};
paint();load();window.addEventListener('pageshow',e=>{if(e.persisted){busy=false;$('#checkout-options').disabled=false;load();}});
