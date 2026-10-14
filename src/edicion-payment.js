import { rpc, UUID } from './generations.js';

// Webhook de Stripe → marca el pedido como pagado (idempotente; la firma ya fue verificada).
export function isEdicionSession(session) {
  return session?.metadata?.kind === 'edicion';
}

export async function applyEdicionPayment(db, event, session) {
  const orderId = session.metadata?.order_id;
  if (!UUID.test(orderId || '')) return { applied: false, reason: 'invalid_order' };
  const result = await rpc(db, 'edicion_payment', {
    p_event_id: event.id,
    p_session_id: session.id,
    p_order_id: orderId,
    p_amount_total: session.amount_total || 0,
    p_currency: String(session.currency || ''),
  });
  if (result?.duplicatePayment) console.error('edicion_duplicate_payment', orderId, session.id);
  return result;
}
