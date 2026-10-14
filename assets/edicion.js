import { EDICION_PLANS } from './edicion-plans.js';
import { newToken, rememberOrder, savedOrders, orderLink } from './edicion-pedidos.js';

// /edicion/: un solo botón. Se paga primero y el material se entrega después en la página privada del pedido.
const PLAN = EDICION_PLANS.pro;
const $ = sel => document.querySelector(sel);
const money = n => `$${n.toLocaleString('es-MX')} MXN`;
const setStatus = (text, kind = '') => { const el = $('[data-status]'); el.textContent = text; el.dataset.kind = kind; };
const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function renderPlan(enabled) {
  $('[data-plan-name]').textContent = `Edición ${PLAN.name}`;
  $('[data-plan-price]').textContent = money(PLAN.price);
  if (PLAN.regularPrice) { $('[data-plan-regular]').textContent = money(PLAN.regularPrice); $('[data-plan-regular]').hidden = false; }
  $('[data-plan-features]').innerHTML = PLAN.features.map(f => `<li>${escapeHtml(f)}</li>`).join('');
  const button = $('[data-start]');
  button.disabled = !enabled;
  button.textContent = enabled ? `Empezar · ${money(PLAN.price)}` : 'Muy pronto';
  $('[data-start-note]').textContent = enabled ? 'Pago seguro con Stripe. Después del pago subes tu material desde tu celular.' : 'Todavía no tomamos pedidos. Vuelve pronto.';
}

function renderOrders() {
  const orders = savedOrders();
  $('[data-orders]').hidden = orders.length === 0;
  $('[data-order-list]').innerHTML = orders.map(o => `<li><a href="${orderLink(o.id, o.token)}">Pedido del ${
    new Date(o.createdAt).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}</a><span aria-hidden="true">→</span></li>`).join('');
}

async function start() {
  const button = $('[data-start]');
  button.disabled = true; setStatus('Abriendo el pago seguro…');
  // La llave del pedido se crea aquí y nunca sale del enlace privado; el mismo id evita cobros duplicados al reintentar.
  const pending = savedOrders().find(o => o.pending);
  const order = pending || { id: crypto.randomUUID(), token: newToken(), createdAt: new Date().toISOString(), pending: true };
  rememberOrder(order);
  try {
    const response = await fetch('/api/edicion', { method: 'POST', headers: { 'content-type': 'application/json', 'x-edicion-token': order.token },
      body: JSON.stringify({ action: 'start', orderId: order.id, plan: PLAN.code }) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(payload.error || 'No pudimos abrir el pago.'), { code: payload.code });
    if (payload.checkoutUrl) { location.href = payload.checkoutUrl; return; }
    location.href = orderLink(order.id, order.token); // ya estaba pagado
  } catch (error) {
    if (error.code === 'IDEMPOTENCY_CONFLICT') rememberOrder({ ...order, pending: false, discarded: true });
    setStatus(error.message, 'error'); button.disabled = false;
  }
}

const pago = new URLSearchParams(location.search).get('pago');
if (pago === 'cancelado') { const b = $('[data-banner]'); b.textContent = 'El pago se canceló. Puedes intentarlo de nuevo cuando quieras.'; b.dataset.kind = 'warn'; b.hidden = false; }
renderPlan(false);
renderOrders();
$('[data-start]').addEventListener('click', start);
try {
  const config = await (await fetch('/api/edicion?config=1', { headers: { accept: 'application/json' } })).json();
  renderPlan(Boolean(config.enabled));
} catch { setStatus('No pudimos conectar. Recarga la página.', 'error'); }
