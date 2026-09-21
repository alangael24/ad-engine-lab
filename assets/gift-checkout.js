import {getAuthClient,apiRequest} from './auth-client.js';
const $=s=>document.querySelector(s),params=new URLSearchParams(location.search),id=params.get('id');
let plan=params.get('package')==='gift_60'?'gift_60':'gift_120',busy=false,covered=false,session=null,loaded=false,order=null;
const orderUrl=id?'/regalos/pedido/?id='+encodeURIComponent(id):'/regalos/';
function say(text,error=false){$('#checkout-status').textContent=text;$('#checkout-status').dataset.error=String(error);}
function paint(){$('#choose-60').checked=plan==='gift_60';$('#choose-120').checked=plan==='gift_120';const premium=plan==='gift_120';$('#popular').hidden=!premium;$('#package-title').textContent=premium?'Nuestra historia':'Un recuerdo especial';$('#package-description').textContent=premium?'Varios recuerdos, unidos en una sola película.':'Un momento inolvidable, convertido en su propia película.';$('#package-price').textContent=premium?'$499':'$299';$('#package-duration').textContent=premium?'2 minutos':'1 minuto';$('#package-delivery').textContent=premium?'Entrega en 1 hora*':'Entrega en 24 horas*';$('#checkout-pay').textContent=covered?'Continuar con mi película →':premium?'Crear nuestra historia · $499':'Crear mi regalo · $299';$('#view-order').href=orderUrl;}
async function refresh(){loaded=false;$('#checkout-options').disabled=Boolean(id);covered=false;say('');$('#checkout-pay').disabled=true;try{const auth=await getAuthClient();const {data,error}=await auth.auth.getSession();if(error)throw error;session=data.session;
 if(!session){$('#checkout-options').disabled=Boolean(id);say('Inicia sesión con el correo de tu pedido para continuar.');$('#checkout-login').hidden=false;return;}
 $('#checkout-email').value=session.user.email||'';
 if(id){const r=await apiRequest('/api/gift-orders?id='+encodeURIComponent(id));order=r.order;if(![60,120].includes(r.order.targetSeconds))throw Error('No pudimos identificar la duración de tu película.');plan=r.order.targetSeconds===120?'gift_120':'gift_60';covered=['approved','producing','ready','cancelled'].includes(r.order.status)||r.seconds.available>=r.order.targetSeconds;$('#story-title').textContent=r.order.title;$('#story-title').hidden=false;if(covered)say(r.order.status==='cancelled'?'Este pedido está cancelado. Puedes consultar su estado.':'Tu pedido puede continuar sin otra compra.');}
 paint();loaded=true;$('#checkout-options').disabled=Boolean(order&&!['received','script_ready'].includes(order.status));$('#checkout-pay').disabled=false;
 }catch(e){say(e instanceof SyntaxError?'No pudimos conectar con tu cuenta. Actualiza para volver a intentarlo.':e.message||'No pudimos cargar tu pedido. Actualiza para volver a intentarlo.',true);}}
$('#checkout-form').onsubmit=async e=>{e.preventDefault();if(busy||!loaded)return;if(covered){location.assign(orderUrl);return;}busy=true;$('#checkout-options').disabled=true;$('#checkout-pay').disabled=true;try{say('Abriendo el pago seguro…');const r=await apiRequest('/api/checkout',{method:'POST',body:{plan}});const url=new URL(r.url);if(url.protocol!=='https:'||!['buy.stripe.com','checkout.stripe.com'].includes(url.hostname))throw Error('No pudimos abrir el pago seguro. Inténtalo de nuevo.');location.assign(url.href);}catch(e){say(e.message||'No pudimos abrir Stripe. Tu historia sigue guardada.',true);busy=false;$('#checkout-options').disabled=false;$('#checkout-pay').disabled=false;}};
$('#checkout-login').onclick=()=>{sessionStorage.setItem('gift-checkout-context',JSON.stringify({id,plan}));};
paint();refresh();

window.addEventListener('pageshow',e=>{if(e.persisted){busy=false;refresh();}});

async function choose(value){if(busy||!['gift_60','gift_120'].includes(value)){paint();return;}if(value===plan)return;if(!id){plan=value;paint();return;}if(!loaded||!order||!['received','script_ready'].includes(order.status)){paint();return;}
 busy=true;$('#checkout-options').disabled=true;$('#checkout-pay').disabled=true;
 try{say('Actualizando la duración de tu película…');await apiRequest('/api/gift-orders',{method:'POST',body:{action:'package',id,expected:order.revision,seconds:value==='gift_120'?120:60}});await refresh();say('Duración actualizada. Prepararemos el guion para esta opción.');}
 catch(e){await refresh();say(e.message||'No pudimos cambiar el paquete. Tu elección anterior se conserva.',true);}
 finally{busy=false;paint();}}
$('#choose-60').onchange=()=>choose('gift_60');$('#choose-120').onchange=()=>choose('gift_120');
