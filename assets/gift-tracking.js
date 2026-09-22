// Only commercial metadata belongs in advertising events. Never pass the brief,
// photos, names, email, or private portal access token to this module.
const offers = {
  gift_60: { content_name: 'CreativeRush Regalos — 1 minuto', value: 299 },
  gift_120: { content_name: 'CreativeRush Regalos — 2 minutos', value: 499 },
};
export function giftEventData(plan) {
  return Object.hasOwn(offers,plan) ? { ...offers[plan], currency: 'MXN', content_category: 'regalos', content_ids: [plan], content_type: 'product', num_items: 1 } : null;
}
export function trackGiftCheckout(plan, url, win = window) {
  try {
    const target = new URL(url), data = giftEventData(plan);
    if (!data || !['buy.stripe.com','checkout.stripe.com'].includes(target.hostname) || target.protocol !== 'https:' || target.pathname.startsWith('/test_')) return;
    win.fbq?.('track', 'InitiateCheckout', data);
  } catch { /* Tracking must never prevent payment. */ }
}
export function trackGiftPurchase(data, sessionId, win = window) {
  if (!giftEventData(data.plan) || !data.ready || data.paymentStatus !== 'paid' || !/^cs_live_[a-zA-Z0-9_]+$/.test(sessionId) || !Number.isFinite(data.amountTotal) || data.amountTotal <= 0 || !/^[a-z]{3}$/i.test(data.currency || '')) return false;
  const key = `meta_purchase_${sessionId}`;
  try {
    if (win.localStorage.getItem(key)) return false;
  } catch { /* Browser event ID remains stable if storage is unavailable. */ }
  try {
    if (typeof win.fbq !== 'function') return false;
    win.fbq('track', 'Purchase', { ...giftEventData(data.plan), value: data.amountTotal / 100, currency: data.currency.toUpperCase() }, { eventID: sessionId });
    try { win.localStorage.setItem(key, '1'); } catch {}
    return true;
  } catch { return false; }
}
