// Pedidos guardados en este dispositivo (id + llave del enlace privado). Sin cuenta: si el navegador
// borra esto, el enlace del pedido (o volver desde Stripe) lo recupera.
const KEY = 'edicion-pedidos-v1';

export function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function read() {
  try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}

export function savedOrders() {
  return read().filter(o => o && /^[0-9a-f-]{36}$/.test(o.id) && /^[A-Za-z0-9_-]{43}$/.test(o.token) && !o.discarded)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export function rememberOrder(order) {
  const all = read().filter(o => o?.id !== order.id);
  all.push({ createdAt: new Date().toISOString(), ...order });
  try { localStorage.setItem(KEY, JSON.stringify(all.slice(-30))); } catch { /* modo privado: el enlace sigue sirviendo */ }
}

export const tokenFor = id => savedOrders().find(o => o.id === id)?.token || null;

// La llave va en el fragmento (#t=...): el navegador no la envía a ningún servidor ni queda en registros.
export const orderLink = (id, token, origin = location.origin) => `${origin}/edicion/p/?o=${id}#t=${token}`;
