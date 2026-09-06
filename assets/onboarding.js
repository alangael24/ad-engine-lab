import { getAuthClient, getAuthProviders, apiRequest, requestAccess, requestGoogleAccess, accountDestination } from './auth-client.js';
const $ = selector => document.querySelector(selector);
const isPlans = document.body.dataset.onboarding === 'plans';
const params = new URLSearchParams(location.search);
const login = params.get('mode') === 'login';
const next = params.get('next') === 'editor' ? 'editor' : params.get('next') === 'planes' ? 'planes' : 'tool';
if(next==='editor')sessionStorage.setItem('creative-rush-return','editor');
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
    const account = await apiRequest('/api/account');
    if (!isPlans) { location.replace(accountDestination(account, next)); return; }
    $('#account-email').textContent = account.email;
    $('#choose-plan').disabled = false;
    $('#choose-plan').textContent = 'Elegir Launch →';
    $('#signout').hidden = false;
    $('#open-studio').hidden = accountDestination(account) !== '/herramienta/';
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
  $('#signup-form').addEventListener('submit', async event => {
    event.preventDefault(); if (!ready || waiting || googlePending) return;
    waiting = true; $('#signup-submit').disabled = true; $('#google-signin').disabled = true; message('Enviando tu enlace seguro…');
    try {
      await requestAccess($('#signup-email').value, !login);
      message(next==='editor'?'Revisa tu correo y abre el enlace en este navegador para entrar al editor.':'Revisa tu correo y confirma el enlace en este navegador. Después verás tu plan; si ya tienes uno, entrarás a tu estudio.', 'success');
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
  $('#choose-plan').addEventListener('click', async () => {
    if (waiting || !ready) return; waiting = true; $('#choose-plan').disabled = true;
    $('#choose-plan').textContent = 'Abriendo pago seguro…'; message('');
    try {
      const payment = await apiRequest('/api/checkout', { method: 'POST', body: { plan: 'launch' } });
      const url = new URL(payment.url);
      if (url.origin !== 'https://buy.stripe.com') throw new Error('No pudimos abrir el pago seguro.');
      // Only a real checkout intent is counted, not signup or viewing plans.
      if (!['localhost','127.0.0.1','[::1]'].includes(location.hostname)) {
        try { window.fbq?.('track', 'InitiateCheckout', { content_name: payment.name, currency: payment.currency, value: payment.amount }); } catch { /* analytics must not block checkout */ }
      }
      location.assign(url.href);
    } catch (error) {
      if (error.code === 'UNAUTHORIZED') { location.replace('/cuenta/?next=planes'); return; }
      message(error.message, 'error'); waiting = false; $('#choose-plan').disabled = false; $('#choose-plan').textContent = 'Elegir Launch →';
    }
  });
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
