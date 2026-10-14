import { MAX_UPLOAD_BYTES, MAX_VIDEO_SECONDS, PART_BYTES, referenceUrl } from './edicion-plans.js';
import { inspectVideo } from './edicion-video.js';
import { newToken, rememberOrder, tokenFor, orderLink } from './edicion-pedidos.js';

// Página privada del pedido (/edicion/p/?o=<id>#t=<llave>): entregar material, seguir el avance, ver, descargar y pedir cambios.
const $ = sel => document.querySelector(sel);
const $$ = sel => [...document.querySelectorAll(sel)];
const params = new URLSearchParams(location.search);
const orderId = params.get('o');
const state = { token: null, order: null, versions: [], version: null, uploads: {}, busy: false, pollTimer: null, pollCount: 0 };
const QUICK = ['Subtítulos más grandes', 'Más dinámico', 'Menos texto en pantalla', 'Cambia el color de los textos', 'Quita una escena'];
const setStatus = (text, kind = '') => { const el = $('[data-status]'); el.textContent = text; el.dataset.kind = kind; };
const clock = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const mb = n => `${Math.round(n / 1048576)} MB`;

async function api(method, body, query = '') {
  const response = await fetch(`/api/edicion${method === 'GET' ? `?o=${orderId}${query}` : ''}`, {
    method, headers: { accept: 'application/json', 'x-edicion-token': state.token, ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify({ orderId, ...body }) } : {}) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(payload.error || 'No se pudo completar. Inténtalo de nuevo.'), { code: payload.code, status: response.status });
  return payload;
}

// ---------- Llave del pedido ----------
async function resolveToken() {
  const fromLink = new URLSearchParams(location.hash.slice(1)).get('t');
  if (fromLink && /^[A-Za-z0-9_-]{43}$/.test(fromLink)) state.token = fromLink;
  else state.token = tokenFor(orderId);
  const session = params.get('s');
  if (!state.token && session) {
    // Otro navegador al volver de Stripe: la sesión pagada emite una llave nueva para este dispositivo.
    state.token = newToken();
    await api('POST', { action: 'recover', sessionId: session });
  }
  if (!state.token) throw new Error('Abre el enlace privado de tu pedido (el que copiaste o el de tu correo de pago).');
  rememberOrder({ id: orderId, token: state.token, pending: false });
  history.replaceState(null, '', `/edicion/p/?o=${orderId}`); // la llave no se queda visible en la barra
}

// ---------- Estado y render ----------
async function refresh() {
  const { order, versions } = await api('GET');
  state.order = order; state.versions = versions;
  render();
  schedule();
}

function schedule() {
  clearTimeout(state.pollTimer);
  const o = state.order, uploading = Object.values(state.uploads).some(u => u.active);
  let wait = 0;
  if (o.status === 'awaiting_payment') wait = state.pollCount++ < 40 ? 2500 : 0;
  else if (['paid', 'processing'].includes(o.status) || ['queued', 'processing'].includes(o.revisionStatus)) wait = 15000;
  if (wait && !uploading) state.pollTimer = setTimeout(() => refresh().catch(() => schedule()), wait);
}

const TITLES = {
  awaiting_payment: 'Confirmando tu pago…',
  awaiting_material: '¡Pago recibido! Ahora tu material',
  paid: 'Recibimos tu material',
  processing: 'Estamos editando tu video',
  delivered: 'Tu video está listo',
  failed: 'Necesitamos revisar tu pedido',
  canceled: 'Pedido cancelado',
};

function render() {
  const o = state.order;
  $('[data-title]').textContent = TITLES[o.status] || 'Tu pedido';
  $('[data-lead]').textContent = {
    awaiting_payment: 'Esto tarda unos segundos. No cierres esta página.',
    awaiting_material: 'Sube el video que te gusta y el tuyo. Puedes hacerlo desde tu celular.',
    paid: 'Suele tardar entre 15 y 30 minutos. Puedes cerrar esta página: con tu enlace vuelves cuando quieras.',
    processing: 'Suele tardar entre 15 y 30 minutos. Puedes cerrar esta página: con tu enlace vuelves cuando quieras.',
    delivered: 'Míralo aquí, descárgalo o pide cambios.',
    failed: o.note || 'Algo salió mal al editar. Lo revisamos a mano y te avisamos. No tienes que volver a pagar.',
  }[o.status] || '';
  $('[data-material]').hidden = o.status !== 'awaiting_material';
  $('[data-track]').hidden = !['paid', 'processing'].includes(o.status);
  $('[data-result]').hidden = o.status !== 'delivered';
  $('[data-keep]').hidden = o.status === 'awaiting_payment';
  $$('[data-copy-link]').forEach(b => { b.hidden = o.status === 'awaiting_payment'; });
  if (o.status === 'awaiting_material') renderMaterial();
  if (['paid', 'processing'].includes(o.status)) renderTrack();
  if (o.status === 'delivered') renderResult();
}

function renderMaterial() {
  const o = state.order;
  const done = { reference: o.referenceUrl ? o.referenceUrl.replace(/^https:\/\/(www\.)?/, '') : o.referenceName, source: o.sourceName };
  for (const kind of ['reference', 'source']) {
    const u = state.uploads[kind], finished = Boolean(done[kind]) && !u?.active && !u?.editing;
    $(`[data-done="${kind}"]`).hidden = !finished;
    $(`[data-done-name="${kind}"]`).textContent = done[kind] || '';
    $(`[data-body="${kind}"]`).hidden = finished;
  }
  $('[data-submit]').disabled = state.busy || !(done.reference && done.source) || Object.values(state.uploads).some(u => u.active);
}

function renderTrack() {
  const step = state.order.status === 'paid' ? 'received' : 'editing';
  $$('[data-track-step]').forEach(li => {
    const order = ['received', 'editing', 'ready'], i = order.indexOf(li.dataset.trackStep), at = order.indexOf(step);
    li.dataset.state = i < at || (i === 0) ? 'done' : i === at ? 'now' : 'next';
  });
}

let shownVersion = null;
async function renderResult() {
  const o = state.order, versions = state.versions;
  const current = state.version && versions.some(v => v.version === state.version) ? state.version : versions.at(-1)?.version || 1;
  state.version = current;
  $('[data-versions]').innerHTML = versions.length > 1 ? versions.map(v => `<button type="button" data-version="${v.version}" aria-pressed="${v.version === current}">Versión ${v.version}</button>`).join('') : '';
  if (shownVersion !== current) {
    shownVersion = current;
    try {
      const [{ url: play }, { url: dl }] = await Promise.all([api('GET', null, `&video=1&version=${current}`), api('GET', null, `&video=1&download=1&version=${current}`)]);
      $('[data-player]').src = play; $('[data-download]').href = dl;
    } catch (error) { setStatus(error.message, 'error'); shownVersion = null; }
  }
  const applying = ['queued', 'processing'].includes(o.revisionStatus), left = Math.max(0, o.revisionsMax - o.revisionsUsed);
  $('[data-applying]').hidden = !applying;
  $('[data-changes]').hidden = applying || left === 0;
  $('[data-rounds]').textContent = `${left} ${left === 1 ? 'ronda de cambios' : 'rondas de cambios'}`;
  if (o.revisionStatus === 'failed') setStatus('No pudimos aplicar tu último cambio. No se descontó la ronda; intenta describirlo de otra forma.', 'error');
  $('[data-share]').hidden = !(navigator.canShare && navigator.canShare({ files: [new File([''], 'v.mp4', { type: 'video/mp4' })] }));
}

// ---------- Subida por partes (se reanuda) ----------
async function pick(kind, file) {
  setStatus('');
  const check = $(`[data-check="${kind}"]`);
  if (check) check.hidden = true;
  let info;
  try {
    if (file.size > MAX_UPLOAD_BYTES) throw new Error(`pesa ${mb(file.size)}; el máximo es ${mb(MAX_UPLOAD_BYTES)}`);
    info = await inspectVideo(file);
    if (info.duration > MAX_VIDEO_SECONDS) throw new Error(`dura ${clock(info.duration)}; el máximo es ${clock(MAX_VIDEO_SECONDS)}`);
  } catch (error) { setStatus(`Ese video no sirve: ${error.message}.`, 'error'); return; }
  if (kind === 'source' && check) {
    const notes = [];
    if (!info.hasAudio) notes.push('Tu video no tiene audio: lo editaremos sin voz ni subtítulos.');
    if (info.width > info.height) notes.push('Tu video es horizontal: lo pasaremos a vertical encuadrando lo importante.');
    check.textContent = notes.join(' '); check.hidden = notes.length === 0;
  }
  await upload(kind, file, info);
}

async function upload(kind, file, info) {
  const u = state.uploads[kind] = { active: true, sent: 0 };
  const bar = $(`[data-progress="${kind}"]`), parts = Math.ceil(file.size / PART_BYTES);
  const show = () => { bar.hidden = false; const pct = Math.min(100, Math.floor(u.sent / file.size * 100)); bar.querySelector('i').style.width = `${pct}%`;
    bar.querySelector('small').textContent = navigator.onLine === false ? 'Sin señal: seguimos cuando vuelva…' : `Subiendo ${pct}%`; };
  renderMaterial(); show();
  let lock = null;
  try { lock = await navigator.wakeLock?.request('screen'); } catch { /* sin bloqueo de pantalla */ }
  try {
    const stored = new Map((await api('POST', { action: 'parts', kind })).parts.map(p => [p.index, p.size]));
    const expected = i => (i < parts - 1 ? PART_BYTES : file.size - PART_BYTES * (parts - 1));
    const todo = [];
    for (let i = 0; i < parts; i++) { if (stored.get(i) === expected(i)) u.sent += expected(i); else todo.push(i); }
    show();
    const worker = async () => {
      while (todo.length) {
        const i = todo.shift(), blob = file.slice(i * PART_BYTES, i * PART_BYTES + expected(i));
        for (let attempt = 0; ; attempt++) {
          try {
            if (navigator.onLine === false) await new Promise(r => addEventListener('online', r, { once: true }));
            const { url } = await api('POST', { action: 'part', kind, index: i, size: blob.size });
            const r = await fetch(url, { method: 'PUT', headers: { 'content-type': 'application/octet-stream', 'x-upsert': 'true' }, body: blob });
            if (!r.ok) throw new Error(`parte ${i}: ${r.status}`);
            break;
          } catch (error) {
            if (attempt >= 7) throw error;
            show(); await new Promise(r => setTimeout(r, Math.min(30000, 1000 * 2 ** attempt)));
          }
        }
        u.sent += blob.size; show();
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    const { order } = await api('POST', { action: 'material', kind, upload: { name: file.name, size: file.size, parts,
      durationSeconds: info.duration, width: info.width || undefined, height: info.height || undefined, hasAudio: info.hasAudio } });
    state.order = order;
  } catch (error) {
    setStatus(`No se pudo subir: ${error.message}. Vuelve a elegir el video y seguimos donde nos quedamos.`, 'error');
  } finally {
    u.active = false; u.editing = false; bar.hidden = true; lock?.release?.().catch(() => {});
    render(); schedule();
  }
}

async function saveLink() {
  const input = $('[data-ref-link]'), link = referenceUrl(input.value);
  if (!input.value.trim()) return;
  if (!link) { setStatus('Ese link no parece de TikTok, Instagram, YouTube, Facebook, X o Vimeo.', 'error'); return; }
  try { const { order } = await api('POST', { action: 'material', kind: 'reference', referenceUrl: link }); state.order = order; input.value = '';
    state.uploads.reference = { active: false }; setStatus(''); render(); }
  catch (error) { setStatus(error.message, 'error'); }
}

async function submitMaterial(event) {
  event.preventDefault();
  state.busy = true; renderMaterial(); setStatus('Enviando…');
  try {
    const { order } = await api('POST', { action: 'submit', instructions: $('[data-instructions]').value, names: $('[data-names]').value });
    state.order = order; setStatus(''); render(); schedule();
    window.fbq?.('trackCustom', 'EdicionMaterialEnviado');
  } catch (error) { setStatus(error.message, 'error'); }
  state.busy = false; if (state.order.status === 'awaiting_material') renderMaterial();
}

// ---------- Cambios ----------
async function sendChange(event) {
  event.preventDefault();
  const box = $('[data-change-text]'), request = box.value.trim(), button = $('[data-send-change]');
  if (request.length < 3) { setStatus('Cuéntanos qué quieres cambiar.', 'error'); box.focus(); return; }
  button.disabled = true;
  const form = $('[data-changes]');
  form.dataset.revisionId ||= crypto.randomUUID(); // mismo id en reintentos: sin rondas duplicadas
  try {
    const { order } = await api('POST', { action: 'revision', revisionId: form.dataset.revisionId, request });
    state.order = order; box.value = ''; delete form.dataset.revisionId; setStatus(''); render(); schedule();
  } catch (error) { setStatus(error.message, 'error'); }
  button.disabled = false;
}

function insertAtCursor(text) {
  const box = $('[data-change-text]'), at = box.selectionStart ?? box.value.length;
  box.value = box.value.slice(0, at) + text + box.value.slice(at); box.focus();
  box.selectionStart = box.selectionEnd = at + text.length;
}

function setupVoice() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition, button = $('[data-voice]');
  if (!Recognition) return;
  button.hidden = false;
  let rec = null;
  button.addEventListener('click', () => {
    if (rec) { rec.stop(); return; }
    rec = new Recognition(); rec.lang = 'es-MX'; rec.interimResults = false; rec.continuous = true;
    rec.onresult = e => { for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) insertAtCursor(`${e.results[i][0].transcript.trim()} `); };
    rec.onend = () => { rec = null; button.textContent = '🎙️ Dictar'; button.removeAttribute('aria-pressed'); };
    rec.onerror = () => setStatus('No pudimos usar el micrófono. Revisa el permiso o escribe tu cambio.', 'error');
    rec.start(); button.textContent = '⏹ Detener'; button.setAttribute('aria-pressed', 'true');
  });
}

// ---------- Eventos ----------
for (const kind of ['reference', 'source']) {
  $(`[data-file="${kind}"]`).addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) pick(kind, f); });
  $(`[data-change="${kind}"]`).addEventListener('click', () => { state.uploads[kind] = { active: false, editing: true }; renderMaterial(); });
}
$('[data-ref-link]').addEventListener('paste', () => setTimeout(saveLink, 0));
$('[data-ref-link]').addEventListener('change', saveLink);
$('[data-ref-link]').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); saveLink(); } });
$('[data-material]').addEventListener('submit', submitMaterial);
$('[data-changes]').addEventListener('submit', sendChange);
$('[data-quick]').innerHTML = QUICK.map(q => `<button type="button" data-quick-item>${q}</button>`).join('');
$('[data-quick]').addEventListener('click', e => { const b = e.target.closest('[data-quick-item]'); if (b) insertAtCursor(`${$('[data-change-text]').value && !/\s$/.test($('[data-change-text]').value) ? '. ' : ''}${b.textContent}`); });
const player = $('[data-player]');
player.addEventListener('timeupdate', () => { $('[data-mark]').textContent = `📍 Marcar ${clock(player.currentTime)}`; });
$('[data-mark]').addEventListener('click', () => { player.pause(); insertAtCursor(`[${clock(player.currentTime)}] `); });
$('[data-versions]').addEventListener('click', e => { const b = e.target.closest('[data-version]'); if (b) { state.version = Number(b.dataset.version); renderResult(); } });
$('[data-share]').addEventListener('click', async () => {
  try {
    setStatus('Preparando tu video…');
    const blob = await (await fetch(player.src)).blob();
    await navigator.share({ files: [new File([blob], 'video-editado.mp4', { type: 'video/mp4' })] }); setStatus('');
  } catch (error) { if (error.name !== 'AbortError') setStatus('No se pudo compartir; usa Descargar.', 'error'); else setStatus(''); }
});
$$('[data-copy-link]').forEach(b => b.addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(orderLink(orderId, state.token)); setStatus('Enlace copiado. Guárdalo: con él vuelves a tu pedido.', 'ok'); }
  catch { prompt('Copia tu enlace privado:', orderLink(orderId, state.token)); }
}));
addEventListener('beforeunload', e => { if (Object.values(state.uploads).some(u => u.active)) e.preventDefault(); });
addEventListener('visibilitychange', () => { if (!document.hidden && state.order) refresh().catch(() => {}); });
// Pegar otro enlace privado estando en esta página solo cambia el #: se recarga para leer la llave nueva.
addEventListener('hashchange', () => { if (/[#&]t=/.test(location.hash)) location.reload(); });
setupVoice();

try {
  if (!/^[0-9a-f-]{36}$/.test(orderId || '')) throw new Error('Este enlace no es válido.');
  await resolveToken();
  await refresh();
  if (params.get('s')) window.fbq?.('track', 'Purchase', { currency: 'MXN', value: state.order.amountMxn });
} catch (error) {
  $('[data-title]').textContent = 'No encontramos tu pedido';
  $('[data-lead]').textContent = error.status === 404 ? 'Abre el enlace privado de tu pedido (el que copiaste) desde el navegador donde pagaste.' : error.message;
}
