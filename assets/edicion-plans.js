// Planes de edición por referencia. Precios en pesos mexicanos, IVA incluido.
// El servidor cobra exactamente lo que define este archivo; la página solo lo muestra.
export const EDICION_PLANS = Object.freeze({
  basico: Object.freeze({
    code: 'basico', name: 'Básico', price: 299, delivery: '24 h', revisions: 2,
    summary: 'Cortes, subtítulos animados y color al estilo de tu referencia.',
    features: Object.freeze(['Cortes de silencios y ritmo', 'Subtítulos animados como la referencia', 'Corrección de color', '2 rondas de cambios']),
  }),
  pro: Object.freeze({
    code: 'pro', name: 'Pro', price: 399, delivery: '24 h', highlight: true, regularPrice: 599, revisions: 3,
    summary: 'Todo lo del Básico más motion graphics, efectos y sonido de la referencia.',
    features: Object.freeze(['Todo lo del plan Básico', 'Motion graphics y efectos de la referencia', 'Zooms, transiciones y efectos de sonido', '3 rondas de cambios']),
  }),
  premium: Object.freeze({
    code: 'premium', name: 'Premium', price: 1490, delivery: '48 h', revisions: 5,
    summary: 'Edición desde cero tipo motion graphics completo, con objetos 3D generados.',
    features: Object.freeze(['Todo lo del plan Pro', 'Escenas y objetos 3D generados para tu video', 'Motion graphics de punta a punta', '5 rondas de cambios']),
  }),
});

export const MAX_INSTRUCTIONS = 1500;
export const MAX_REVISION_REQUEST = 1000;
export const MAX_VIDEO_BYTES = 52428800; // subida antigua en un solo archivo (cuentas con sesión)
export const MAX_VIDEO_SECONDS = 180;
// Subida por partes desde la página privada del pedido: se reanuda si se corta la señal.
export const PART_BYTES = 8388608;
export const MAX_UPLOAD_BYTES = 629145600; // 600 MB
export const MAX_PARTS = Math.ceil(MAX_UPLOAD_BYTES / PART_BYTES);
export const MAX_NAMES = 300;

const REFERENCE_HOSTS = ['tiktok.com', 'instagram.com', 'youtube.com', 'youtu.be', 'facebook.com', 'fb.watch', 'x.com', 'twitter.com', 'vimeo.com'];

// Devuelve la URL normalizada si es un enlace https a una red social conocida; si no, null.
export function referenceUrl(value) {
  let url;
  try { url = new URL(String(value || '').trim()); } catch { return null; }
  const host = url.hostname.toLowerCase().replace(/^www\.|^m\.|^vm\./, '');
  if (url.protocol !== 'https:' || url.username || url.password || url.href.length > 500) return null;
  return REFERENCE_HOSTS.some(h => host === h || host.endsWith(`.${h}`)) ? url.href : null;
}

export const ORDER_STATUS = Object.freeze({
  awaiting_payment: 'Pendiente de pago',
  awaiting_material: 'Esperando tu material',
  paid: 'En cola',
  processing: 'Editando',
  delivered: 'Entregado',
  failed: 'Necesita revisión',
  canceled: 'Cancelado',
});
