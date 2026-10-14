import { EDICION_PLANS, MAX_VIDEO_BYTES, MAX_VIDEO_SECONDS, ORDER_STATUS, referenceUrl } from './edicion-plans.js';
import { getAuthClient } from './auth-client.js';

// Un solo precio en la página; los otros planes siguen disponibles en el servidor.
const PLAN = EDICION_PLANS.pro;
const $ = sel => document.querySelector(sel);
const input = $('[data-input]');
const money = n => `$${n.toLocaleString('es-MX')} MXN`;
const state = { mode: 'email', session: null, source: null, reference: null, orderId: null, enabled: false, busy: false, client: null };
const setStatus = (text, kind = '') => { const el = $('[data-status]'); el.textContent = text; el.dataset.kind = kind; };

// El título guía los pasos: primero la referencia, luego tu video, luego enviar.
function step() {
  if (state.mode === 'email') return 0;
  if (!(state.reference?.id || state.reference?.link)) return 1;
  if (!state.source?.id) return 2;
  return 3;
}
const STEPS = [
  { title: '¿Qué video editamos hoy?', placeholder: 'Escribe tu correo para empezar…', hint: 'Te mandamos un link para entrar, sin contraseña' },
  { title: 'Sube el video que te gusta', placeholder: 'Pega aquí el link del video que te gusta…', hint: 'O adjúntalo con +' },
  { title: 'Ahora sube tu video', placeholder: 'Adjunta tu video con +', hint: 'MP4 de hasta 3 minutos' },
  { title: '¿Algo más? Si no, envíalo', placeholder: 'Opcional: qué cortar, qué resaltar, colores de tu marca…', hint: 'Listo para enviar' },
];

// El link de referencia se toma del texto; el resto son instrucciones.
function parseMessage() {
  const text = input.value;
  for (const token of text.split(/\s+/)) {
    const url = referenceUrl(token);
    if (url) return { link: url, instructions: text.replace(token, '').replace(/\s+/g, ' ').trim() };
  }
  return { link: null, instructions: text.trim() };
}

function render() {
  const email = state.mode === 'email', n = step(), current = STEPS[n];
  const hasRef = Boolean(state.reference?.id || state.reference?.link), hasVideo = Boolean(state.source?.id);
  $('[data-greeting]').textContent = current.title;
  $('[data-plus]').hidden = email; $('[data-price]').hidden = email || !state.enabled; $('[data-logout]').hidden = email;
  $('[data-input-label]').textContent = email ? 'Tu correo' : current.title;
  input.placeholder = current.placeholder;
  $('[data-price]').textContent = money(PLAN.price);
  const uploading = [state.reference, state.source].some(x => x?.state === 'loading');
  $('[data-hint]').textContent = uploading ? 'Subiendo…' : !email && !state.enabled ? 'Muy pronto: todavía no tomamos pedidos' : current.hint;
  $('[data-send]').disabled = state.busy || (email ? !/^\S+@\S+\.\S+$/.test(input.value.trim()) : !(state.enabled && hasVideo && hasRef));
  renderChips();
}

function renderChips() {
  const chip = (kind, label, item) => item ? `<li class="ed-chip" data-state="${item.state}"><b>${label}</b><small>${escapeHtml(item.error || item.name)}</small>
    <button type="button" data-remove="${kind}" aria-label="Quitar ${label.toLowerCase()}">×</button></li>` : '';
  $('[data-chips]').innerHTML = chip('reference', 'Referencia', state.reference) + chip('source', 'Tu video', state.source);
}
const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(resource, { method = 'GET', body, headers = {} } = {}) {
  const { data } = await state.client.auth.getSession();
  if (!data.session) throw new Error('Escribe tu correo para continuar.');
  const raw = body instanceof Blob;
  const response = await fetch(resource, { method, body: raw ? body : body && JSON.stringify(body),
    headers: { accept: 'application/json', authorization: `Bearer ${data.session.access_token}`, ...(body && !raw ? { 'content-type': 'application/json' } : {}), ...headers } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(payload.error || 'No se pudo completar la solicitud.'), { code: payload.code });
  return payload;
}

// Duración leída del encabezado MP4 (caja mvhd). No depende del reproductor del navegador,
// que no carga videos mientras la pestaña está en segundo plano.
async function videoDuration(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  for (let i = 4; i < bytes.length - 32; i++) {
    if (bytes[i] !== 0x6d || bytes[i + 1] !== 0x76 || bytes[i + 2] !== 0x68 || bytes[i + 3] !== 0x64) continue; // 'mvhd'
    const view = new DataView(bytes.buffer, i + 4), v1 = view.getUint8(0) === 1;
    const scale = view.getUint32(v1 ? 20 : 12), units = v1 ? Number(view.getBigUint64(24)) : view.getUint32(16);
    if (scale > 0 && units > 0) return units / scale;
  }
  throw new Error('no se pudo leer; usa MP4');
}

// El primer video es el tuyo; si ya hay uno, el siguiente es la referencia.
async function attach(file) {
  const kind = !state.reference ? 'reference' : !state.source ? 'source' : 'reference';
  const item = state[kind] = { name: file.name, state: 'loading' };
  render();
  try {
    if (file.type !== 'video/mp4') throw new Error('tiene que ser MP4');
    if (file.size > MAX_VIDEO_BYTES) throw new Error('pesa más de 50 MB');
    const duration = await videoDuration(file);
    if (!(duration > 0) || duration > MAX_VIDEO_SECONDS) throw new Error('máximo 3 minutos');
    const { asset } = await api('/api/studio?upload=1&kind=clip', { method: 'POST', body: file,
      headers: { 'content-type': 'video/mp4', 'x-file-name': encodeURIComponent(file.name), 'x-duration': String(Math.round(duration * 100) / 100) } });
    if (state[kind] === item) Object.assign(item, { id: asset.id, state: 'done' });
  } catch (error) {
    if (state[kind] === item) Object.assign(item, { state: 'error', error: `${file.name}: ${error.message}` });
  }
  render();
}

async function submit(event) {
  event.preventDefault();
  if ($('[data-send]').disabled) return;
  state.busy = true; render();
  if (state.mode === 'email') {
    const email = input.value.trim().toLowerCase();
    setStatus('Enviando…');
    try {
      const { error } = await state.client.auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo: `${location.origin}/edicion/` } });
      if (error) throw error;
      setStatus(`Te mandamos un link a ${email}. Ábrelo para continuar.`, 'ok'); input.value = '';
    } catch (error) {
      setStatus(error.status === 429 ? 'Espera un minuto e inténtalo otra vez.' : 'No pudimos enviar el link. Revisa tu correo.', 'error');
    }
    state.busy = false; render(); return;
  }
  setStatus('Abriendo el pago seguro…');
  state.orderId ||= crypto.randomUUID(); // mismo id en reintentos: sin pedidos ni cobros duplicados
  const { instructions } = parseMessage();
  const body = { orderId: state.orderId, plan: PLAN.code, sourceAssetId: state.source.id, instructions };
  if (state.reference.id) body.referenceAssetId = state.reference.id; else body.referenceUrl = state.reference.link;
  try {
    const { checkoutUrl } = await api('/api/edicion', { method: 'POST', body });
    location.href = checkoutUrl;
  } catch (error) {
    setStatus(error.message, 'error');
    if (error.code === 'EDICION_INVALID' || error.code === 'STUDIO_ASSET_NOT_FOUND') state.orderId = null;
    state.busy = false; render();
  }
}

let pollTimer;
async function loadOrders() {
  const { orders, enabled } = await api('/api/edicion');
  state.enabled = enabled; render();
  $('[data-orders]').hidden = orders.length === 0;
  // La lista se refresca sola; si el cliente está escribiendo un cambio, se conserva la caja abierta y su texto.
  const open = document.querySelector('[data-revise-form]:not([hidden])');
  const keep = open && { id: open.dataset.reviseForm, text: open.querySelector('textarea').value, revisionId: open.dataset.revisionId,
    focused: document.activeElement === open.querySelector('textarea') };
  $('[data-order-list]').innerHTML = orders.map(orderItem).join('');
  const again = keep && document.querySelector(`[data-revise-form="${keep.id}"]`);
  if (again) {
    again.hidden = false; again.querySelector('textarea').value = keep.text;
    if (keep.revisionId) again.dataset.revisionId = keep.revisionId;
    if (keep.focused) again.querySelector('textarea').focus();
  }
  clearTimeout(pollTimer);
  const pending = o => o.status === 'paid' || o.status === 'processing' || o.revisionStatus === 'queued' || o.revisionStatus === 'processing';
  if (orders.some(pending)) pollTimer = setTimeout(() => loadOrders().catch(() => {}), 20000);
}

// Cada video entregado tiene "Descargar" y, si le quedan rondas, "Pedir cambios" con una caja propia.
function orderItem(o) {
  const date = `${new Date(o.createdAt).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })} · ${money(o.amountMxn)}`;
  const version = o.version > 1 ? ` · versión ${o.version}` : '';
  if (o.status !== 'delivered') return `<li><div class="ed-row-main"><span>${date}</span><span class="ed-pill" data-status="${o.status}">${ORDER_STATUS[o.status] || o.status}</span></div></li>`;
  const applying = o.revisionStatus === 'queued' || o.revisionStatus === 'processing';
  const left = Math.max(0, o.revisionsMax - o.revisionsUsed);
  const failed = o.revisionStatus === 'failed' ? '<small class="ed-note" data-kind="error">No pudimos aplicar tu último cambio. No se descontó la ronda.</small>' : '';
  const action = applying ? '<span class="ed-pill" data-status="processing">Aplicando cambios…</span>'
    : left > 0 ? `<button type="button" class="ed-ghost" data-revise="${o.id}">Pedir cambios</button>` : '';
  return `<li data-order="${o.id}">
    <div class="ed-row-main"><span>${date}${version}</span><span class="ed-row-actions">${action}<button type="button" data-download="${o.id}">Descargar</button></span></div>
    ${failed}
    <form class="ed-revise" data-revise-form="${o.id}" hidden>
      <textarea maxlength="1000" rows="2" placeholder="¿Qué cambiamos? Ej.: subtítulos más grandes, quita la pausa del inicio, cambia el color a blanco…"></textarea>
      <div class="ed-revise-bar"><small>${left} ${left === 1 ? 'ronda disponible' : 'rondas disponibles'}</small><button type="submit">Enviar cambios</button></div>
    </form>
  </li>`;
}

async function sendRevision(form) {
  const orderId = form.dataset.reviseForm, request = form.querySelector('textarea').value.trim(), button = form.querySelector('button');
  if (request.length < 3) { setStatus('Escribe qué quieres cambiar.', 'error'); return; }
  button.disabled = true;
  form.dataset.revisionId ||= crypto.randomUUID(); // mismo id en reintentos: sin rondas duplicadas
  try {
    await api('/api/edicion', { method: 'POST', body: { action: 'revision', orderId, revisionId: form.dataset.revisionId, request } });
    setStatus('Listo, ya estamos aplicando tus cambios. Te avisamos cuando esté la nueva versión.', 'ok');
    form.hidden = true; form.querySelector('textarea').value = '';
    await loadOrders();
  } catch (error) { setStatus(error.message, 'error'); button.disabled = false; }
}

async function showSession(session) {
  state.session = session; state.mode = session ? 'order' : 'email';
  if (!session) $('[data-orders]').hidden = true;
  render();
  if (session) { try { await loadOrders(); } catch (error) { setStatus(error.message, 'error'); } }
}

function showReturnBanner() {
  const pago = new URLSearchParams(location.search).get('pago'), banner = $('[data-banner]');
  const text = { ok: '¡Listo! Recibimos tu pago. Te avisamos por correo cuando tu video esté editado.', cancelado: 'El pago se canceló. Puedes intentarlo de nuevo cuando quieras.' }[pago];
  if (text) { banner.textContent = text; banner.dataset.kind = pago === 'ok' ? 'ok' : 'warn'; banner.hidden = false; }
}

// --- Eventos ---
const box = $('[data-composer]');
box.addEventListener('submit', submit);
// Un link completo se convierte en el chip de referencia y la caja queda libre para el siguiente paso.
// Mientras se escribe, el último token puede estar incompleto: solo se toma al pegar, tras un espacio, al salir o con Enter.
function captureLink(force) {
  if (state.mode !== 'order' || state.reference) return;
  const text = input.value, tokens = text.split(/\s+/), complete = force || /\s$/.test(text);
  const candidates = complete ? tokens : tokens.slice(0, -1);
  const token = candidates.find(t => referenceUrl(t));
  if (!token) return;
  const link = referenceUrl(token);
  state.reference = { link, name: link.replace(/^https:\/\/(www\.)?/, ''), state: 'done' };
  input.value = text.replace(token, '').replace(/\s+/g, ' ').trim();
}
function resize() { input.style.height = 'auto'; input.style.height = `${input.scrollHeight}px`; }
input.addEventListener('input', e => { captureLink(e.inputType === 'insertFromPaste'); resize(); render(); });
input.addEventListener('blur', () => { captureLink(true); resize(); render(); });
input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); captureLink(true); resize(); render(); box.requestSubmit(); } });
$('[data-file]').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) attach(f); });
box.addEventListener('dragover', e => { if (state.mode === 'order') { e.preventDefault(); box.classList.add('is-over'); } });
box.addEventListener('dragleave', () => box.classList.remove('is-over'));
box.addEventListener('drop', e => { if (state.mode !== 'order') return; e.preventDefault(); box.classList.remove('is-over'); [...e.dataTransfer.files].slice(0, 2).forEach(attach); });
document.addEventListener('click', async e => {
  const remove = e.target.closest('[data-remove]')?.dataset.remove;
  if (remove) { state[remove] = null; render(); return; }
  const revise = e.target.closest('[data-revise]')?.dataset.revise;
  if (revise) { const form = document.querySelector(`[data-revise-form="${revise}"]`); form.hidden = !form.hidden; if (!form.hidden) form.querySelector('textarea').focus(); return; }
  const id = e.target.closest('[data-download]')?.dataset.download;
  if (!id) return;
  try { const { url } = await api(`/api/edicion?order=${id}&download=1`); location.href = url; } catch (error) { setStatus(error.message, 'error'); }
});
$('[data-logout]').addEventListener('click', () => state.client.auth.signOut());
document.addEventListener('submit', e => { const form = e.target.closest('[data-revise-form]'); if (form) { e.preventDefault(); sendRevision(form); } });

showReturnBanner();
render();
try {
  state.client = await getAuthClient();
  const { data } = await state.client.auth.getSession();
  await showSession(data.session);
  state.client.auth.onAuthStateChange((_event, session) => setTimeout(() => showSession(session), 0));
} catch (error) {
  setStatus(error.message || 'No pudimos conectar. Inténtalo más tarde.', 'error');
}
input.focus();
