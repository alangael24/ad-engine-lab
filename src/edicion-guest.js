import { getSupabaseAdmin, json } from './backend.js';
import { ApiError, rpc, UUID } from './generations.js';
import { signed } from './studio.js';
import { applyEdicionPayment } from './edicion-payment.js';
import { EDICION_PLANS, MAX_INSTRUCTIONS, MAX_NAMES, MAX_PARTS, MAX_REVISION_REQUEST, MAX_UPLOAD_BYTES, MAX_VIDEO_SECONDS,
  PART_BYTES, referenceUrl } from '../assets/edicion-plans.js';

// Pedido sin cuenta: se paga primero y todo lo demás pasa en /edicion/p/?o=<pedido>#t=<llave>.
// La llave (32 bytes en base64url) solo vive en el navegador y en el enlace; la base guarda su sha256.
export const MATERIAL_BUCKET = 'edicion-material';
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const KINDS = new Set(['source', 'reference']);
export const partPath = (orderId, kind, index) => `${orderId}/${kind}/${String(index).padStart(3, '0')}`;
export const resultOwner = o => o.user_id || 'invitados';

export async function tokenHash(token) {
  if (!TOKEN.test(token || '')) throw new ApiError('EDICION_NOT_FOUND');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function guestCheckoutParams(order, plan, appUrl) {
  return {
    mode: 'payment',
    locale: 'es-419',
    line_items: [{
      quantity: 1,
      price_data: { currency: 'mxn', unit_amount: plan.price * 100, product_data: { name: `Edición ${plan.name} · CreativeRush AI`, description: plan.summary } },
    }],
    metadata: { kind: 'edicion', order_id: order.id, plan: plan.code },
    payment_intent_data: { metadata: { kind: 'edicion', order_id: order.id } },
    // Stripe reemplaza {CHECKOUT_SESSION_ID}; sirve para recuperar el enlace si el navegador perdió la llave.
    success_url: `${appUrl}/edicion/p/?o=${order.id}&s={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl}/edicion/?pago=cancelado`,
  };
}

export function publicGuestOrder(o) {
  return { id: o.id, plan: o.plan, amountMxn: o.amount_mxn, status: o.status, referenceUrl: o.reference_url,
    referenceName: o.reference_upload?.name ?? null, sourceName: o.source_upload?.name ?? null,
    instructions: o.instructions, names: o.names ?? '', note: o.result_note, createdAt: o.created_at, paidAt: o.paid_at,
    materialAt: o.material_at ?? null, version: o.result_version ?? 1, revisionsUsed: o.revisions_used ?? 0,
    revisionsMax: EDICION_PLANS[o.plan]?.revisions ?? 0, revisionStatus: o.revision_status ?? null };
}

// Valida lo que el navegador dice haber subido contra lo que realmente hay en el bucket.
export function validateUpload(upload, stored) {
  const name = String(upload?.name || '').replace(/[^\p{L}\p{N} ._()-]/gu, '').slice(0, 120) || 'video';
  const size = Number(upload?.size), parts = Number(upload?.parts), duration = Number(upload?.durationSeconds);
  if (!Number.isInteger(size) || size < 1 || size > MAX_UPLOAD_BYTES || parts !== Math.ceil(size / PART_BYTES) || parts > MAX_PARTS
    || !(duration > 0) || duration > MAX_VIDEO_SECONDS) throw new ApiError('EDICION_INVALID');
  for (let i = 0; i < parts; i++) {
    const want = i < parts - 1 ? PART_BYTES : size - PART_BYTES * (parts - 1);
    if (stored.get(i) !== want) throw new ApiError('EDICION_UPLOAD_INCOMPLETE');
  }
  return { name, size, parts, durationSeconds: Math.round(duration * 100) / 100,
    width: Number.isInteger(upload.width) ? upload.width : null, height: Number.isInteger(upload.height) ? upload.height : null,
    hasAudio: typeof upload.hasAudio === 'boolean' ? upload.hasAudio : null };
}

async function storedParts(db, orderId, kind) {
  const { data, error } = await db.storage.from(MATERIAL_BUCKET).list(`${orderId}/${kind}`, { limit: 1000 });
  if (error) throw error;
  const parts = new Map();
  for (const f of data || []) if (/^\d{3}$/.test(f.name)) parts.set(Number(f.name), Number(f.metadata?.size ?? f.metadata?.contentLength ?? -1));
  return parts;
}

async function row(db, orderId, hash) {
  if (!UUID.test(orderId || '')) throw new ApiError('EDICION_NOT_FOUND');
  const { data, error } = await db.from('edicion_orders').select('*').eq('id', orderId).eq('access_hash', hash).maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiError('EDICION_NOT_FOUND');
  return data;
}

export async function getGuest(context, url, { enabled, reconcile }) {
  const db = getSupabaseAdmin(context.env);
  const hash = await tokenHash(context.request.headers.get('x-edicion-token'));
  let o = await row(db, url.searchParams.get('o'), hash);
  if (enabled && await reconcile(db, [o])) o = await row(db, o.id, hash);
  const versions = o.status === 'delivered' ? await rpc(db, 'edicion_guest', { p_action: 'versions', p_id: o.id, p_hash: hash, p_data: {} }) : [];
  if (url.searchParams.has('video')) {
    const want = Number(url.searchParams.get('version') || o.result_version || 1);
    const v = versions.find(x => x.version === want);
    if (!v) throw new ApiError('EDICION_NOT_READY');
    return json({ url: await signed(db, 'studio-media', v.path, url.searchParams.has('download')) });
  }
  return json({ order: publicGuestOrder(o), versions: versions.map(v => ({ version: v.version, request: v.request })) });
}

export async function postGuest(context, body, { enabled, stripeClient, reconcile }) {
  const db = getSupabaseAdmin(context.env);
  const hash = await tokenHash(context.request.headers.get('x-edicion-token') || body.token);
  const call = (action, data = {}) => rpc(db, 'edicion_guest', { p_action: action, p_id: body.orderId, p_hash: hash, p_data: data });
  if (!UUID.test(body.orderId || '')) throw new ApiError('EDICION_INVALID');

  if (body.action === 'start') {
    if (!enabled) throw new ApiError('EDICION_DISABLED');
    const plan = EDICION_PLANS[body.plan];
    if (!plan) throw new ApiError('EDICION_INVALID');
    const order = await call('create', { plan: plan.code, amountMxn: plan.price });
    if (order.status !== 'awaiting_payment') return json({ order }, 200);
    const appUrl = String(context.env.APP_URL || 'https://creativerushai.com').replace(/\/$/, '');
    const session = await stripeClient(context.env).checkout.sessions.create(
      guestCheckoutParams(order, plan, appUrl), { idempotencyKey: `edicion-${order.id}` });
    await call('attach_session', { checkoutSessionId: session.id });
    return json({ checkoutUrl: session.url }, 201);
  }
  if (body.action === 'recover') {
    // Otro navegador o la llave se perdió: la sesión de Stripe pagada prueba que es quien compró.
    if (typeof body.sessionId !== 'string' || !/^cs_[A-Za-z0-9_]{8,200}$/.test(body.sessionId)) throw new ApiError('EDICION_NOT_FOUND');
    const session = await stripeClient(context.env).checkout.sessions.retrieve(body.sessionId).catch(error => {
      if (error?.statusCode === 404 || error?.type === 'StripeInvalidRequestError') throw new ApiError('EDICION_NOT_FOUND');
      throw error;
    });
    if (session.payment_status !== 'paid' || session.metadata?.kind !== 'edicion' || session.metadata?.order_id !== body.orderId) {
      throw new ApiError('EDICION_NOT_FOUND');
    }
    await applyEdicionPayment(db, { id: `reconcile:${session.id}` }, session);
    return json({ order: await call('recover', { sessionId: session.id }) });
  }

  const o = await row(db, body.orderId, hash);
  if (body.action === 'part' || body.action === 'parts' || body.action === 'material') {
    if (!['awaiting_payment', 'awaiting_material'].includes(o.status)) throw new ApiError('EDICION_ALREADY_SUBMITTED');
    if (!KINDS.has(body.kind)) throw new ApiError('EDICION_INVALID');
  }
  if (body.action === 'part') {
    const index = Number(body.index), size = Number(body.size);
    if (!Number.isInteger(index) || index < 0 || index >= MAX_PARTS || !Number.isInteger(size) || size < 1 || size > PART_BYTES) {
      throw new ApiError('EDICION_INVALID');
    }
    const r = await db.storage.from(MATERIAL_BUCKET).createSignedUploadUrl(partPath(o.id, body.kind, index), { upsert: true });
    if (r.error) throw r.error;
    return json({ url: r.data.signedUrl });
  }
  if (body.action === 'parts') {
    const parts = await storedParts(db, o.id, body.kind);
    return json({ parts: [...parts].map(([index, size]) => ({ index, size })) });
  }
  if (body.action === 'material') {
    if (body.kind === 'reference' && body.referenceUrl !== undefined) {
      const link = referenceUrl(body.referenceUrl);
      if (!link) throw new ApiError('EDICION_INVALID');
      return json({ order: await call('material', { kind: 'reference', referenceUrl: link }) });
    }
    const upload = validateUpload(body.upload, await storedParts(db, o.id, body.kind));
    return json({ order: await call('material', { kind: body.kind, upload }) });
  }
  if (body.action === 'submit') {
    const instructions = typeof body.instructions === 'string' ? body.instructions.trim() : '';
    const names = typeof body.names === 'string' ? body.names.trim() : '';
    if (instructions.length > MAX_INSTRUCTIONS || names.length > MAX_NAMES) throw new ApiError('EDICION_INVALID');
    if (enabled && o.status === 'awaiting_payment') await reconcile(db, [o]);
    return json({ order: await call('submit', { instructions, names }) }, 202);
  }
  if (body.action === 'revision') {
    const request = typeof body.request === 'string' ? body.request.trim() : '';
    if (!UUID.test(body.revisionId || '') || request.length < 3 || request.length > MAX_REVISION_REQUEST) throw new ApiError('EDICION_INVALID');
    return json({ order: await call('revision', { revisionId: body.revisionId, request }) }, 202);
  }
  throw new ApiError('EDICION_INVALID');
}

