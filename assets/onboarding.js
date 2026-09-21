import {giftCheckoutReturn} from './gift-checkout-model.js';
import { getAuthClient, getAuthProviders, apiRequest, requestAccess, requestGoogleAccess, accountDestination } from './auth-client.js';
const $ = selector => document.querySelector(selector);
const isPlans = document.body.dataset.onboarding === 'plans';
const params = new URLSearchParams(location.search);
const login = params.get('mode') === 'login';
const next = ['editor','planes','ads-sales-v1','creator-v1','regalos','gift-orders','gift-admin','gift-checkout'].includes(params.get('next')) ? params.get('next') : 'tool';
if(next==='editor')sessionStorage.setItem('creative-rush-return','editor');
if(next==='ads-sales-v1')sessionStorage.setItem('creative-rush-return','ads-sales-v1');
if(next==='creator-v1')sessionStorage.setItem('creative-rush-return','creator-v1');
if(next==='gift-checkout')sessionStorage.setItem('creative-rush-return','gift-checkout');
if(next==='gift-admin')sessionStorage.setItem('creative-rush-return','gift-admin');
if(next==='gift-orders')sessionStorage.setItem('creative-rush-return','gift-orders');
if(next==='regalos')sessionStorage.setItem('creative-rush-return','regalos');
let client, ready = false, routing = false, waiting = false, googleEnabled = false, googlePending = false;
function message(text, tone = 'neutral') { $('#on-message').textContent = text; $('#on-message').dataset.tone = tone; }
async function routeSession(session) {
  if (routing) return;
  if (!session) {
    if (isPlans) location.replace('/cuenta/?next=planes');
    return;
  }
  routing = true;
  try {
    if(!isPlans&&next==='editor'){sessionStorage.removeItem('creative-rush-return');location.replace('/editor/');return;}
    if(!isPlans&&next==='ads-sales-v1'){sessionStorage.removeItem('creative-rush-return');location.replace('/anuncios-lab/');return;}
    if(!isPlans&&next==='creator-v1'){sessionStorage.removeItem('creative-rush-return');location.replace('/crear/');return;}
    if(!isPlans&&next==='gift-checkout'){sessionStorage.removeItem('creative-rush-return');location.replace(giftCheckoutReturn(sessionStorage.getItem('gift-checkout-context')));return;}
    if(!isPlans&&next==='gift-admin'){sessionStorage.removeItem('creative-rush-return');location.replace('/regalos/admin/');return;}
    if(!isPlans&&next==='gift-orders'){sessionStorage.removeItem('creative-rush-return');location.replace('/regalos/pedido/');return;}
    if(!isPlans&&next==='regalos'){sessionStorage.removeItem('creative-rush-return');location.replace('/regalos/');return;}
    const account = await apiRequest('/api/account');
    if (!isPlans) { location.replace(accountDestination(account, next)); return; }
    $('#account-email').textContent = account.email;
    document.querySelectorAll('[data-plan]').forEach(button=>{button.disabled=false;button.textContent=button.dataset.label;});
    $('#seconds-balance').textContent=account.seconds?.enabled?`${account.seconds.available} s disponibles · ${account.seconds.reserved} s en producción`:'';
    $('#signout').hidden = false;
    $('#open-studio').hidden = !account.hasPack; $('#open-studio').href=accountDestination(account);
    message('');
  } catch (error) {
    if (error.code === 'UNAUTHORIZED') location.replace('/cuenta/?next=planes');
    else message('No pudimos comprobar tu cuenta. Recarga para intentarlo de nuevo. No se realizó ningún cobro.', 'error');
  } finally { routing = false; }
}

if (!isPlans) {
  if (params.get('auth_error') === 'retry') message('No se completó el acceso. Inténtalo de nuevo con Google o con tu correo.', 'error');
  $('#google-signin').addEventListener('click', async () => {
    if (!ready || !googleEnabled || googlePending) return;
    googlePending = true;
    $('#google-signin').disabled = true;
    $('#signup-submit').disabled = true;
    $('#google-label').textContent = 'Abriendo Google…';
    message('');
    try {
      await requestGoogleAccess();
    } catch (error) {
      googlePending = false;
      $('#google-signin').disabled = !googleEnabled;
      $('#signup-submit').disabled = waiting;
      $('#google-label').textContent = 'Continuar con Google';
      message(error.message, 'error');
    }
  });
  // Restore controls if the customer returns from Google's screen with Back.
  window.addEventListener('pageshow', event => {
    if (!event.persisted) return;
    googlePending = false;
    $('#google-signin').disabled = !ready || !googleEnabled;
    $('#signup-submit').disabled = !ready || waiting;
    $('#google-label').textContent = 'Continuar con Google';
  });
  if (login) {
    $('#account-title').textContent = 'Qué bueno verte de nuevo.';
    $('#account-intro').textContent = 'Entra a tu cuenta y continúa donde te quedaste.';
    $('#account-switch').replaceChildren(document.createTextNode('¿Primera vez aquí? '));
    const signup = document.createElement('a'); signup.href = next==='editor'?'/cuenta/?next=editor':'/cuenta/'; signup.textContent = 'Crea tu cuenta'; $('#account-switch').append(signup);
  }
  if(next==='editor'){
    $('#account-title').textContent='Tu editor empieza aquí.';$('#account-intro').textContent='Entra para guardar tus clips y editar por conversación.';
    document.querySelector('.on-steps').hidden=true;document.querySelector('.on-eyebrow').textContent='CREATIVERUSH EDITOR';document.querySelector('.on-bottom').textContent='Tus clips. Tu estilo. Tu video.';
    $('#account-switch a').href=login?'/cuenta/?next=editor':'/cuenta/?mode=login&next=editor';
  }
  if(next==='regalos'){
    $('#account-title').textContent='Su historia empieza aquí.';$('#account-intro').textContent='Entra para guardar sus recuerdos, añadir fotos y preparar la película.';
    document.querySelector('.on-steps').hidden=true;document.querySelector('.on-eyebrow').textContent='CREATIVERUSH REGALOS';document.querySelector('.on-bottom').textContent='Una historia que solo ustedes podrían protagonizar.';
    $('#account-switch a').href=login?'/cuenta/?next=regalos':'/cuenta/?mode=login&next=regalos';
  }
  if(next==='gift-admin'||next==='gift-orders'||next==='gift-checkout'){
    $('#account-title').textContent=next==='gift-admin'?'Administrar Regalos.':'Tus películas te esperan.';$('#account-intro').textContent=next==='gift-admin'?'Entra con la cuenta autorizada para consultar los pedidos.':'Entra para revisar tus guiones y descargar tus películas.';
    document.querySelector('.on-steps').hidden=true;document.querySelector('.on-eyebrow').textContent='CREATIVERUSH REGALOS';document.querySelector('.on-bottom').textContent='Tu cuenta. Tus películas.';
    $('#account-switch a').href=login?'/cuenta/?next='+next:'/cuenta/?mode=login&next='+next;
  }
  if(next==='gift-checkout'){$('#account-title').textContent='Tu regalo está a un paso.';$('#account-intro').textContent='Entra con tu correo para vincular la compra a tu película. Después volverás al resumen de tu regalo.';}
  if(next==='creator-v1'){
    $('#account-title').textContent='Tu próxima historia empieza aquí.';$('#account-intro').textContent='Crea contenido con IA a partir de una idea, un guion o una referencia.';
    document.querySelector('.on-steps').hidden=true;document.querySelector('.on-eyebrow').textContent='CREATIVERUSH CREADOR';document.querySelector('.on-bottom').textContent='Tu idea. Tu mundo. Tu video.';
    $('#account-switch a').href=login?'/cuenta/?next=creator-v1':'/cuenta/?mode=login&next=creator-v1';
  }
  if(next==='ads-sales-v1'){
    $('#account-title').textContent='Tu anuncio empieza aquí.';$('#account-intro').textContent='Entra al laboratorio para preparar el argumento y el guion de tu anuncio.';
    $('#account-switch a').href=login?'/cuenta/?next=ads-sales-v1':'/cuenta/?mode=login&next=ads-sales-v1';
  }
  $('#signup-form').addEventListener('submit', async event => {
    event.preventDefault(); if (!ready || waiting || googlePending) return;
    waiting = true; $('#signup-submit').disabled = true; $('#google-signin').disabled = true; message('Enviando tu enlace seguro…');
    try {
      await requestAccess($('#signup-email').value, !login);
      message(next==='gift-admin'||next==='gift-orders'||next==='gift-checkout'?'Revisa tu correo y abre el enlace en este navegador para consultar los pedidos.':next==='editor'?'Revisa tu correo y abre el enlace en este navegador para entrar al editor.':'Revisa tu correo y confirma el enlace en este navegador. Después verás tu plan; si ya tienes uno, entrarás a tu estudio.', 'success');
      $('#signup-submit').textContent = 'Enlace enviado';
      setTimeout(() => { waiting = false; $('#signup-submit').disabled = googlePending; $('#signup-submit').textContent = 'Enviar otro enlace'; }, 60000);
    } catch (error) {
      waiting = false; $('#signup-submit').disabled = false;
      message(error.message, 'error'); $('#signup-submit').textContent = login ? 'Enviarme mi acceso →' : 'Crear mi cuenta gratis →';
    } finally {
      $('#google-signin').disabled = !googleEnabled || googlePending;
    }
  });
} else {
  $('#signout').addEventListener('click', async () => { if (client) { await client.auth.signOut(); location.replace('/cuenta/'); } });
  document.querySelectorAll('[data-plan]').forEach(button=>button.addEventListener('click', async () => {
    if (waiting || !ready) return; waiting = true; document.querySelectorAll('[data-plan]').forEach(b=>b.disabled=true);
    button.textContent = 'Abriendo pago seguro…'; message('');
    try {
      const payment = await apiRequest('/api/checkout', { method: 'POST', body: { plan: button.dataset.plan } });
      const url = new URL(payment.url);
      if (url.origin !== 'https://buy.stripe.com') throw new Error('No pudimos abrir el pago seguro.');
      // Only a real checkout intent is counted, not signup or viewing plans.
      if (!['localhost','127.0.0.1','[::1]'].includes(location.hostname)) {
        try { window.fbq?.('track', 'InitiateCheckout', { content_name: payment.name, currency: payment.currency, value: payment.amount }); } catch { /* analytics must not block checkout */ }
      }
      location.assign(url.href);
    } catch (error) {
      if (error.code === 'UNAUTHORIZED') { location.replace('/cuenta/?next=planes'); return; }
      message(error.message, 'error'); waiting = false; document.querySelectorAll('[data-plan]').forEach(b=>{b.disabled=false;b.textContent=b.dataset.label;});
    }
  }));
}

async function boot() {
  try {
    client = await getAuthClient(); ready = true;
    const { data } = await client.auth.getSession();
    await routeSession(data.session);
    if (!isPlans) {
      $('#signup-submit').disabled = false;
      $('#signup-submit').textContent = login ? 'Enviarme mi acceso →' : 'Crear mi cuenta gratis →';
      // A disabled/misconfigured provider must not send customers to an error page.
      getAuthProviders().then(providers => {
        googleEnabled = providers.google;
        $('#google-signin').disabled = !googleEnabled || googlePending;
        $('#google-status').hidden = googleEnabled;
        $('#google-status').textContent = googleEnabled ? '' : 'Google aún no está disponible. Puedes continuar con tu correo.';
      }).catch(() => {
        $('#google-status').hidden = false;
        $('#google-status').textContent = 'No pudimos comprobar Google. Puedes continuar con tu correo.';
      });
    }
    client.auth.onAuthStateChange((_event, session) => setTimeout(() => routeSession(session), 0));
  } catch (error) {
    if (error.code === 'AUTH_CALLBACK_ERROR') { location.replace('/cuenta/?auth_error=retry'); return; }
    message('No pudimos conectar con el registro. Recarga la página para intentarlo de nuevo; no se ha realizado ningún cobro.', 'error');
    if (isPlans) $('#account-email').textContent = 'Cuenta pendiente de verificar';
  }
}
boot();
