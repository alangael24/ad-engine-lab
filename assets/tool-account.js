import { getAuthClient, apiRequest, accountDestination } from './auth-client.js';
export { apiRequest } from './auth-client.js';
const $ = selector => document.querySelector(selector);
let supabase = null, session = null, revision = 0;
const listeners = new Set();
export const onAccountChange = callback => { listeners.add(callback); callback(session); };
export const setCredits = (video, images) => {
  $('#desktop-credit-copy').textContent = video == null ? 'Saldo no disponible' : `${video} clips · ${images} imágenes`;
  $('#mobile-credit-copy').textContent = video == null ? 'Saldo…' : `${video} clips · ${images} imgs`;
};
async function applySession(next) {
  const current = ++revision;
  if (!next) { location.replace('/cuenta/'); return; }
  try {
    if(sessionStorage.getItem('creative-rush-return')==='editor'){sessionStorage.removeItem('creative-rush-return');location.replace('/editor/');return;}
    const account = await apiRequest('/api/account');
    if (current !== revision) return;
    const destination = accountDestination(account);
    if (destination !== '/herramienta/') { location.replace(destination); return; }
    session = next;
    $('#auth-gate').hidden = true;
    $('#account-button').hidden = false;
    $('#account-button').textContent = account.email;
    setCredits(account.balance.video_credits, account.balance.image_credits);
    for (const callback of listeners) callback(next);
  } catch (error) {
    if (error.code === 'UNAUTHORIZED') { location.replace('/cuenta/'); return; }
    $('#auth-gate').hidden = false;
    $('#auth-message').textContent = 'No pudimos comprobar tu cuenta. Recarga esta página; no se descontó saldo.';
  }
}
async function boot() {
  try {
    supabase = await getAuthClient();
    const { data } = await supabase.auth.getSession();
    await applySession(data.session);
    supabase.auth.onAuthStateChange((_event, next) => { setTimeout(() => applySession(next), 0); });
  } catch (error) {
    if (error.code === 'AUTH_CALLBACK_ERROR') { location.replace('/cuenta/?auth_error=retry'); return; }
    $('#auth-gate').hidden = false;
    $('#auth-message').textContent = 'No pudimos conectar con tu cuenta. Puedes volver al registro e intentarlo otra vez.';
    $('#service-status').textContent = 'Backend sin conectar · generación desactivada';
  }
}
$('#account-button').addEventListener('click', async () => { if (supabase) { await supabase.auth.signOut(); location.replace('/cuenta/?mode=login'); } });
boot();
