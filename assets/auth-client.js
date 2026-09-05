// Shared browser auth. Account creation never grants production credits.
let clientPromise, publicConfig, providersPromise;
export function getAuthClient() {
  if (!clientPromise) clientPromise = (async () => {
    const callbackMessage = authCallbackMessage(location.href);
    if (callbackMessage) {
      const clean = new URL(location.href);
      for (const key of ['error', 'error_code', 'error_description', 'code']) clean.searchParams.delete(key);
      clean.hash = '';
      history.replaceState(null, '', clean.pathname + clean.search);
      throw Object.assign(new Error(callbackMessage), { code: 'AUTH_CALLBACK_ERROR' });
    }
    const response = await fetch('/api/public-config', { headers: { accept: 'application/json' } });
    const config = await response.json();
    if (!response.ok || !config.enabled) throw new Error('No pudimos conectar el registro. Inténtalo de nuevo más tarde.');
    publicConfig = config;
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.4/+esm');
    const client = createClient(config.supabaseUrl, config.supabasePublishableKey, {
      auth: { detectSessionInUrl: true, persistSession: true, flowType: 'pkce' },
    });
    const fragment = new URLSearchParams(location.hash.slice(1));
    if (fragment.get('access_token') && fragment.get('refresh_token')) {
      const { error } = await client.auth.setSession({ access_token: fragment.get('access_token'), refresh_token: fragment.get('refresh_token') });
      history.replaceState(null, '', location.pathname + location.search);
      if (error) throw error;
    }
    const { error } = await client.auth.getSession();
    if (error) throw error;
    return client;
  })().catch(error => { clientPromise = null; throw error; });
  return clientPromise;
}

// Only Google/basic identity. No Gmail/Drive scopes or offline provider access.
export function googleOAuthOptions(origin) {
  return { provider: 'google', options: {
    redirectTo: new URL('/herramienta/', origin).href,
    queryParams: { prompt: 'select_account' },
  } };
}

export function authCallbackMessage(href) {
  const url = new URL(href);
  const hash = new URLSearchParams(url.hash.slice(1));
  const error = hash.get('error') || url.searchParams.get('error');
  const code = hash.get('error_code') || url.searchParams.get('error_code');
  if (!error && !code) return null;
  if (code === 'otp_expired') return 'El enlace expiró o ya fue utilizado. Solicita uno nuevo.';
  if (error === 'access_denied') return 'No se completó el acceso. Vuelve a intentarlo con Google o con tu correo.';
  return 'No pudimos completar el acceso. Vuelve a intentarlo con Google o con tu correo.';
}

export async function readAuthProviders(config, request = fetch) {
  const response = await request(`${config.supabaseUrl}/auth/v1/settings`, {
    headers: { apikey: config.supabasePublishableKey }, signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error('No pudimos comprobar el acceso con Google.');
  const settings = await response.json();
  return { google: settings.external?.google === true };
}

export async function getAuthProviders() {
  await getAuthClient();
  if (!providersPromise) providersPromise = readAuthProviders(publicConfig).catch(error => { providersPromise = null; throw error; });
  return providersPromise;
}

export async function authorizeGoogle(client, origin) {
  const { data, error } = await client.auth.signInWithOAuth(googleOAuthOptions(origin));
  if (error || !data?.url) throw new Error('No pudimos abrir Google. Inténtalo de nuevo o utiliza tu correo.');
}

export async function requestGoogleAccess() {
  const client = await getAuthClient();
  if (!(await getAuthProviders()).google) throw new Error('Google aún no está habilitado. Puedes continuar con tu correo.');
  await authorizeGoogle(client, location.origin);
}

export async function apiRequest(resource, { body, method = 'GET', raw = false } = {}) {
  const client = await getAuthClient();
  const { data, error } = await client.auth.getSession();
  if (error || !data.session) throw Object.assign(new Error('Inicia sesión para continuar.'), { code: 'UNAUTHORIZED' });
  const headers = { accept: 'application/json', authorization: `Bearer ${data.session.access_token}` };
  if (body != null) headers['content-type'] = raw ? body.type : 'application/json';
  const response = await fetch(resource, { method, headers, ...(body != null ? { body: raw ? body : JSON.stringify(body) } : {}) });
  const payload = await response.json();
  if (!response.ok) throw Object.assign(new Error(payload.error || 'No se pudo completar la solicitud.'), { code: payload.code || (response.status === 401 ? 'UNAUTHORIZED' : 'REQUEST_FAILED') });
  return payload;
}

export function accessOptions(email, createAccount, origin) {
  return { email: email.trim().toLowerCase(), options: {
    shouldCreateUser: createAccount, emailRedirectTo: `${origin}/herramienta/`,
  } };
}
export async function requestAccess(email, createAccount) {
  const client = await getAuthClient();
  const { error } = await client.auth.signInWithOtp(accessOptions(email, createAccount, location.origin));
  if (error) {
    if (error.status === 429 || /rate|over_email_send/i.test(error.code || '')) throw new Error('Espera un minuto antes de solicitar otro enlace.');
    if (/email_address_not_authorized|smtp/i.test(error.code || '')) throw new Error('El envío de correos todavía no está disponible para esta dirección. No se realizó ningún cobro.');
    throw new Error('No pudimos enviar el enlace. Revisa el correo o inténtalo de nuevo más tarde.');
  }
}

export function accountDestination(account, next = 'tool') {
  if (next === 'planes') return '/planes/';
  return account.hasPack || account.balance.video_credits > 0 || account.balance.image_credits > 0 ? '/herramienta/' : '/planes/';
}
