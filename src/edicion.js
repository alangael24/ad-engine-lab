import Stripe from 'stripe';
import { json } from './backend.js';
import { authContext, readJson, rpc, ApiError, apiError, UUID } from './generations.js';
import { own, signed } from './studio.js';
import { applyEdicionPayment } from './edicion-payment.js';
import { getGuest, postGuest } from './edicion-guest.js';
import { EDICION_PLANS, MAX_INSTRUCTIONS, MAX_REVISION_REQUEST, referenceUrl } from '../assets/edicion-plans.js';

const ERRORS = {
  EDICION_DISABLED: [503, 'Los pedidos de edición abren muy pronto. No se realizó ningún cobro.'],
  EDICION_INVALID: [400, 'Revisa tu video, la referencia y las instrucciones.'],
  EDICION_NOT_FOUND: [404, 'No encontramos ese pedido en tu cuenta.'],
  EDICION_ALREADY_PAID: [409, 'Este pedido ya está pagado.'],
  EDICION_LIMIT: [429, 'Alcanzaste el límite de pedidos de hoy. Inténtalo mañana.'],
  EDICION_NOT_READY: [409, 'Tu video editado todavía no está listo.'],
  EDICION_REVISION_BUSY: [409, 'Ya estamos aplicando tus cambios. Espera a que termine esta versión.'],
  EDICION_REVISION_LIMIT: [429, 'Ya usaste todas las rondas de cambios de este video.'],
  EDICION_NOT_PAID: [402, 'Todavía estamos confirmando tu pago. Espera unos segundos.'],
  EDICION_MATERIAL_MISSING: [400, 'Falta tu video o el video que te gusta.'],
  EDICION_ALREADY_SUBMITTED: [409, 'Tu pedido ya está en edición; ya no se puede cambiar el material.'],
  EDICION_UPLOAD_INCOMPLETE: [409, 'Tu video no terminó de subirse. Vuelve a elegirlo para continuar.'],
  IDEMPOTENCY_CONFLICT: [409, 'Ese pedido ya existe. Recarga la página.'],
  STUDIO_ASSET_NOT_FOUND: [404, 'Ese archivo no pertenece a tu cuenta o no es un video MP4.'],
  STUDIO_NOT_FOUND: [404, 'No encontramos ese pedido en tu cuenta.'],
};

export function edicionError(error) {
  const code = Object.keys(ERRORS).find(c => c === error?.code || c === error?.message);
  return code ? json({ error: ERRORS[code][1], code }, ERRORS[code][0]) : apiError(error);
}

export function edicionEnabled(env) {
  return env.EDICION_ENABLED === 'true' && Boolean(env.STRIPE_SECRET_KEY);
}

export function stripeClient(env) {
  return new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: '2026-07-29.dahlia', httpClient: Stripe.createFetchHttpClient() });
}

// Valida el cuerpo del pedido; el precio sale del plan del servidor, nunca del cliente.
export function validateOrder(body) {
  const plan = EDICION_PLANS[body?.plan];
  const instructions = typeof body?.instructions === 'string' ? body.instructions.trim() : '';
  const refAsset = body?.referenceAssetId || null;
  const refUrl = body?.referenceUrl ? referenceUrl(body.referenceUrl) : null;
  if (!plan || !UUID.test(body?.orderId || '') || !UUID.test(body?.sourceAssetId || '')
    || (refAsset && !UUID.test(refAsset)) || (body?.referenceUrl && !refUrl)
    || Boolean(refAsset) === Boolean(refUrl) || instructions.length > MAX_INSTRUCTIONS) {
    throw new ApiError('EDICION_INVALID');
  }
  return {
    plan, orderId: body.orderId,
    data: { plan: plan.code, amountMxn: plan.price, sourceAssetId: body.sourceAssetId, referenceAssetId: refAsset, referenceUrl: refUrl, instructions },
  };
}

export function checkoutParams(order, plan, user, appUrl) {
  const back = `${appUrl}/edicion/?pedido=${order.id}`;
  return {
    mode: 'payment',
    locale: 'es-419',
    customer_email: user.email,
    client_reference_id: user.id,
    line_items: [{
      quantity: 1,
      price_data: { currency: 'mxn', unit_amount: plan.price * 100, product_data: { name: `Edición ${plan.name} · CreativeRush AI`, description: plan.summary } },
    }],
    metadata: { kind: 'edicion', order_id: order.id, plan: plan.code },
    payment_intent_data: { metadata: { kind: 'edicion', order_id: order.id } },
    success_url: `${back}&pago=ok`,
    cancel_url: `${back}&pago=cancelado`,
  };
}

// Confirma pagos consultando la sesión en Stripe (no depende del webhook del sitio principal).
// Es idempotente: edicion_payment solo cambia pedidos que siguen en awaiting_payment.
export async function reconcilePayments(db, env, orders, stripe = stripeClient(env)) {
  const pending = orders.filter(o => o.status === 'awaiting_payment' && o.checkout_session_id
    && Date.now() - Date.parse(o.created_at) < 3 * 864e5).slice(0, 5);
  let changed = false;
  for (const o of pending) {
    try {
      const session = await stripe.checkout.sessions.retrieve(o.checkout_session_id);
      if (session.payment_status !== 'paid' || session.metadata?.kind !== 'edicion' || session.metadata?.order_id !== o.id) continue;
      const r = await applyEdicionPayment(db, { id: `reconcile:${session.id}` }, session);
      changed ||= Boolean(r?.applied);
    } catch (error) { console.error('edicion_reconcile_failed', o.id, error?.message); }
  }
  return changed;
}

// Pedidos sin cuenta (página privada) y configuración pública; el resto exige sesión.
const GUEST_ACTIONS = new Set(['start', 'recover', 'part', 'parts', 'material', 'submit', 'revision']);
const guestOptions = env => ({ enabled: edicionEnabled(env), stripeClient, reconcile: (db, rows) => reconcilePayments(db, env, rows) });

export async function getEdicion(context) {
  try {
    const url = new URL(context.request.url);
    if (url.searchParams.has('config')) return json({ enabled: edicionEnabled(context.env), plans: EDICION_PLANS });
    if (url.searchParams.has('o')) return await getGuest(context, url, guestOptions(context.env));
    const { db, user } = await authContext(context);
    const reconcile = async rows => edicionEnabled(context.env) && await reconcilePayments(db, context.env, rows);
    if (url.searchParams.has('order')) {
      let o = await own(db, 'edicion_orders', user.id, url.searchParams.get('order'));
      if (await reconcile([o])) o = await own(db, 'edicion_orders', user.id, o.id);
      if (url.searchParams.has('download')) {
        if (o.status !== 'delivered' || !o.result_path) throw new ApiError('EDICION_NOT_READY');
        return json({ url: await signed(db, 'studio-media', o.result_path, true) });
      }
      return json({ order: publicOrder(o) });
    }
    const list = async () => {
      const { data, error } = await db.from('edicion_orders').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(30);
      if (error) throw error;
      return data;
    };
    let rows = await list();
    if (await reconcile(rows)) rows = await list();
    return json({ orders: rows.map(publicOrder), enabled: edicionEnabled(context.env), plans: EDICION_PLANS });
  } catch (error) { return edicionError(error); }
}

export function publicOrder(o) {
  return { id: o.id, plan: o.plan, amountMxn: o.amount_mxn, status: o.status, referenceUrl: o.reference_url,
    instructions: o.instructions, note: o.result_note, createdAt: o.created_at, paidAt: o.paid_at,
    version: o.result_version ?? 1, revisionsUsed: o.revisions_used ?? 0, revisionsMax: EDICION_PLANS[o.plan]?.revisions ?? 0,
    revisionStatus: o.revision_status ?? null };
}

export async function postEdicion(context) {
  try {
    const body = await readJson(context.request, 8000);
    // Un pedido ya pagado puede terminar de entregar su material aunque se pausen las ventas.
    if (body?.token || context.request.headers.get('x-edicion-token')) {
      if (!GUEST_ACTIONS.has(body?.action)) throw new ApiError('EDICION_INVALID');
      return await postGuest(context, body, guestOptions(context.env));
    }
    if (!edicionEnabled(context.env)) throw new ApiError('EDICION_DISABLED');
    const { db, user } = await authContext(context);
    if (body?.action === 'revision') return json({ order: await requestRevision(db, user, body) }, 202);
    const { plan, orderId, data } = validateOrder(body);
    const order = await rpc(db, 'edicion_write', { p_user: user.id, p_action: 'create', p_id: orderId, p_data: data });
    if (order.status !== 'awaiting_payment') throw new ApiError('EDICION_ALREADY_PAID');
    const appUrl = String(context.env.APP_URL || 'https://creativerushai.com').replace(/\/$/, '');
    // La misma llave de idempotencia devuelve la misma sesión si el cliente reintenta.
    const session = await stripeClient(context.env).checkout.sessions.create(
      checkoutParams(order, plan, user, appUrl), { idempotencyKey: `edicion-${order.id}` });
    const updated = await rpc(db, 'edicion_write', { p_user: user.id, p_action: 'attach_session', p_id: order.id, p_data: { checkoutSessionId: session.id } });
    return json({ order: updated, checkoutUrl: session.url }, 201);
  } catch (error) { return edicionError(error); }
}

// Ronda de cambios sobre un video entregado. Haiku la aplica sobre la receta del video.
export function validateRevision(body) {
  const request = typeof body?.request === 'string' ? body.request.trim() : '';
  if (!UUID.test(body?.revisionId || '') || !UUID.test(body?.orderId || '') || request.length < 3 || request.length > MAX_REVISION_REQUEST) {
    throw new ApiError('EDICION_INVALID');
  }
  return { revisionId: body.revisionId, orderId: body.orderId, request };
}

async function requestRevision(db, user, body) {
  const { revisionId, orderId, request } = validateRevision(body);
  return rpc(db, 'edicion_revision_write', { p_user: user.id, p_id: revisionId, p_order: orderId, p_request: request });
}
