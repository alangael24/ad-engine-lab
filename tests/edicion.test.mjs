import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Stripe from 'stripe';
import { database, user, call } from './helpers/database.mjs';
import { mockSupabase } from './helpers/supabase-http.mjs';
import * as edicion from '../functions/api/edicion.js';
import * as edicionWorker from '../functions/api/edicion-worker.js';
import * as webhook from '../functions/api/stripe/webhook.js';
import { EDICION_PLANS, referenceUrl } from '../assets/edicion-plans.js';
import { validateOrder, checkoutParams, reconcilePayments } from '../src/edicion.js';
import edicionWeb from '../workers/edicion-web.mjs';
import { getSupabaseAdmin } from '../src/backend.js';

const migration = new URL('../supabase/migrations/20261014030000_edicion_orders.sql', import.meta.url);
const revisions = new URL('../supabase/migrations/20261014040000_edicion_revisions.sql', import.meta.url);
const env = { SUPABASE_URL: 'http://supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'test-server-key', EDICION_ENABLED: 'true',
  STRIPE_SECRET_KEY: 'sk_test_only', STRIPE_WEBHOOK_SECRET: 'whsec_test_only', APP_URL: 'https://app.test',
  EDICION_WORKER_TOKEN: 'local-edicion-worker-secret-not-a-real-key-123' };
let db, stub, originalFetch, stripeCalls;

before(async () => {
  db = await database(); await db.exec(await readFile(migration, 'utf8')); await db.exec(await readFile(revisions, 'utf8'));
  stub = mockSupabase(db); originalFetch = globalThis.fetch; stripeCalls = [];
  // Stripe no se contacta en tests: se responde una sesión de Checkout falsa y se registra la petición.
  globalThis.fetch = async (input, options = {}) => {
    const request = input instanceof Request ? input : new Request(input, options);
    if (new URL(request.url).hostname === 'api.stripe.com') {
      const body = new URLSearchParams(await request.text());
      stripeCalls.push({ body, idempotency: request.headers.get('idempotency-key') });
      const id = `cs_test_${body.get('metadata[order_id]').slice(0, 8)}`;
      return new Response(JSON.stringify({ id, object: 'checkout.session', url: `https://checkout.stripe.test/${id}` }), { status: 200, headers: { 'content-type': 'application/json', 'request-id': 'req_test' } });
    }
    return stub.fetch(request);
  };
});
after(async () => { globalThis.fetch = originalFetch; await db.close(); });

const ctx = (resource, token, method = 'GET', body) => ({ env, params: {}, request: new Request(`https://app.test${resource}`, {
  method, headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}),
}) });
async function clip(u, name = 'mi-video.mp4') {
  const id = crypto.randomUUID();
  await call(db, 'studio_write', [u.id, 'register_asset', id, { kind: 'clip', name, bucket: 'studio-media', storage_path: `${u.id}/${id}.mp4`, mime_type: 'video/mp4', size_bytes: 1000, duration_seconds: 40 }, null]);
  return id;
}
const runWorker = body => edicionWorker.onRequestPost(ctx('/api/edicion-worker', env.EDICION_WORKER_TOKEN, 'POST', { workerId: 'editor-1', ...body }));
async function signedEvent(session, id = `evt_${crypto.randomUUID()}`) {
  const stripe = new Stripe('sk_test_only');
  const payload = JSON.stringify({ id, type: 'checkout.session.completed', data: { object: session } });
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: env.STRIPE_WEBHOOK_SECRET });
  return webhook.onRequestPost({ env, request: new Request('https://app.test/api/stripe/webhook', { method: 'POST', headers: { 'stripe-signature': signature }, body: payload }) });
}

test('validación: solo enlaces https de redes conocidas y precio del servidor', () => {
  assert.equal(referenceUrl('https://www.tiktok.com/@a/video/1'), 'https://www.tiktok.com/@a/video/1');
  assert.equal(referenceUrl('https://vm.tiktok.com/xyz/'), 'https://vm.tiktok.com/xyz/');
  for (const bad of ['http://tiktok.com/a', 'https://evil.com/tiktok.com', 'https://tiktok.com.evil.com/x', 'javascript:alert(1)', 'https://user:pw@youtube.com/x']) assert.equal(referenceUrl(bad), null);
  const body = { orderId: crypto.randomUUID(), plan: 'pro', sourceAssetId: crypto.randomUUID(), referenceUrl: 'https://youtu.be/abc', amountMxn: 1 };
  assert.equal(validateOrder(body).data.amountMxn, EDICION_PLANS.pro.price);
  for (const bad of [{ ...body, plan: 'gratis' }, { ...body, referenceUrl: 'https://evil.com/x' }, { ...body, referenceAssetId: crypto.randomUUID() },
    { ...body, referenceUrl: undefined }, { ...body, instructions: 'x'.repeat(1501) }, { ...body, orderId: 'no' }]) {
    assert.throws(() => validateOrder(bad), /EDICION_INVALID/);
  }
  const p = checkoutParams({ id: body.orderId }, EDICION_PLANS.pro, { id: 'u', email: 'a@b.c' }, 'https://app.test');
  assert.equal(p.line_items[0].price_data.unit_amount, 39900);
  assert.equal(p.metadata.kind, 'edicion');
});

test('flujo completo: pedido → Stripe Checkout → webhook → cola → worker → descarga', async () => {
  const a = await user(db), b = await user(db); stub.users.set('alice', a); stub.users.set('bob', b);
  const source = await clip(a), reference = await clip(a, 'referencia.mp4'), foreign = await clip(b);
  const orderId = crypto.randomUUID();
  const body = { orderId, plan: 'pro', sourceAssetId: source, referenceAssetId: reference, instructions: 'Subtítulos como la referencia' };

  assert.equal((await edicion.onRequestPost(ctx('/api/edicion', 'nadie', 'POST', body))).status, 401);
  assert.equal((await edicion.onRequestPost(ctx('/api/edicion', 'bob', 'POST', { ...body, orderId: crypto.randomUUID() }))).status, 404);
  assert.equal((await edicion.onRequestPost(ctx('/api/edicion', 'alice', 'POST', { ...body, orderId: crypto.randomUUID(), sourceAssetId: foreign }))).status, 404);

  const created = await edicion.onRequestPost(ctx('/api/edicion', 'alice', 'POST', body));
  assert.equal(created.status, 201);
  const { order, checkoutUrl } = await created.json();
  assert.equal(order.status, 'awaiting_payment'); assert.equal(order.amountMxn, 399);
  assert.match(checkoutUrl, /^https:\/\/checkout\.stripe\.test\//);
  const call0 = stripeCalls.at(-1);
  assert.equal(call0.body.get('line_items[0][price_data][unit_amount]'), '39900');
  assert.equal(call0.body.get('line_items[0][price_data][currency]'), 'mxn');
  assert.equal(call0.body.get('metadata[kind]'), 'edicion');
  assert.equal(call0.idempotency, `edicion-${orderId}`);
  // Reintento del mismo pedido: misma llave de idempotencia, sin pedidos duplicados.
  assert.equal((await edicion.onRequestPost(ctx('/api/edicion', 'alice', 'POST', body))).status, 201);
  assert.equal((await db.query('select count(*)::int n from edicion_orders where user_id=$1', [a.id])).rows[0].n, 1);

  // Sin pago, el worker no recibe nada.
  assert.equal((await (await runWorker({ action: 'claim' })).json()).job, null);

  const sessionId = (await db.query('select checkout_session_id from edicion_orders where id=$1', [orderId])).rows[0].checkout_session_id;
  const session = { id: sessionId, object: 'checkout.session', payment_status: 'paid', amount_total: 39900, currency: 'mxn', metadata: { kind: 'edicion', order_id: orderId } };
  // Monto alterado: no se encola.
  assert.equal((await signedEvent({ ...session, amount_total: 100 })).status, 500);
  const paid = await signedEvent(session, 'evt_paid_1');
  assert.deepEqual(await paid.json(), { received: true, applied: true });
  assert.deepEqual(await (await signedEvent(session, 'evt_paid_1')).json(), { received: true, applied: false });
  assert.equal((await edicion.onRequestPost(ctx('/api/edicion', 'alice', 'POST', body))).status, 409);

  const list = await (await edicion.onRequestGet(ctx('/api/edicion', 'alice'))).json();
  assert.equal(list.orders[0].status, 'paid'); assert.equal(list.enabled, true);
  assert.equal((await (await edicion.onRequestGet(ctx('/api/edicion', 'bob'))).json()).orders.length, 0);
  assert.equal((await edicion.onRequestGet(ctx(`/api/edicion?order=${orderId}`, 'bob'))).status, 404);

  const { job } = await (await runWorker({ action: 'claim' })).json();
  assert.equal(job.id, orderId); assert.equal(job.plan, 'pro'); assert.match(job.source.url, /token=test-private/); assert.match(job.reference.url, /token=test-private/);
  assert.equal((await runWorker({ action: 'heartbeat', jobId: job.id, leaseToken: crypto.randomUUID() })).status, 409);
  assert.deepEqual(await (await runWorker({ action: 'heartbeat', jobId: job.id, leaseToken: job.leaseToken })).json(), { ok: true });
  // No se puede entregar sin subir el archivo.
  assert.equal((await runWorker({ action: 'finish', jobId: job.id, leaseToken: job.leaseToken, result: { status: 'delivered' } })).status, 409);
  const upload = await (await runWorker({ action: 'upload', jobId: job.id, leaseToken: job.leaseToken })).json();
  assert.match(upload.url, new RegExp(`${a.id}/edicion/${orderId}\\.mp4`));
  stub.media.set(`studio-media/${a.id}/edicion/${orderId}.mp4`, { size: 2048, contentType: 'video/mp4' });
  assert.equal((await edicion.onRequestGet(ctx(`/api/edicion?order=${orderId}&download=1`, 'alice'))).status, 409);
  const done = await runWorker({ action: 'finish', jobId: job.id, leaseToken: job.leaseToken, result: { status: 'delivered', note: 'Listo' } });
  assert.equal((await done.json()).status, 'delivered');
  assert.equal((await (await runWorker({ action: 'finish', jobId: job.id, leaseToken: job.leaseToken, result: { status: 'delivered' } })).json()).status, 'delivered');
  const dl = await (await edicion.onRequestGet(ctx(`/api/edicion?order=${orderId}&download=1`, 'alice'))).json();
  assert.match(dl.url, /edicion/);
});

test('pedidos: idempotencia por dueño, referencia por enlace y apagado sin cobrar', async () => {
  const a = await user(db), b = await user(db);
  const source = await clip(a), id = crypto.randomUUID();
  const data = { plan: 'basico', amountMxn: 299, sourceAssetId: source, referenceUrl: 'https://www.tiktok.com/@x/video/1', instructions: '' };
  const first = await call(db, 'edicion_write', [a.id, 'create', id, data]);
  assert.deepEqual(await call(db, 'edicion_write', [a.id, 'create', id, data]), first);
  await assert.rejects(() => call(db, 'edicion_write', [b.id, 'create', id, data]), /IDEMPOTENCY_CONFLICT/);
  await assert.rejects(() => call(db, 'edicion_write', [a.id, 'create', crypto.randomUUID(), { ...data, referenceAssetId: source }]), /EDICION_INVALID|STUDIO_ASSET_NOT_FOUND/);
  await assert.rejects(() => call(db, 'edicion_write', [a.id, 'create', crypto.randomUUID(), { ...data, referenceUrl: null }]), /EDICION_INVALID/);
  await assert.rejects(() => call(db, 'edicion_payment', ['evt_x', 'cs_x', id, 29900, 'usd']), /EDICION_PAYMENT_MISMATCH/);
  stub.users.set('alice-off', a);
  const off = await edicion.onRequestPost({ ...ctx('/api/edicion', 'alice-off', 'POST', { orderId: crypto.randomUUID(), plan: 'pro', sourceAssetId: source, referenceUrl: 'https://youtu.be/x' }), env: { ...env, EDICION_ENABLED: 'false' } });
  assert.equal(off.status, 503); assert.equal((await off.json()).code, 'EDICION_DISABLED');
});

test('worker: lease vencido reintenta y tras 3 intentos queda para revisión', async () => {
  const a = await user(db), source = await clip(a), id = crypto.randomUUID();
  await call(db, 'edicion_write', [a.id, 'create', id, { plan: 'basico', amountMxn: 299, sourceAssetId: source, referenceUrl: 'https://youtu.be/x' }]);
  await call(db, 'edicion_write', [a.id, 'attach_session', id, { checkoutSessionId: 'cs_test_retry' }]);
  await call(db, 'edicion_payment', ['evt_retry', 'cs_test_retry', id, 29900, 'mxn']);
  for (let i = 1; i <= 3; i++) {
    const j = await call(db, 'edicion_work', ['w', 'claim']);
    assert.equal(j.id, id); assert.equal(j.attempts, i);
    await assert.rejects(() => call(db, 'edicion_work', ['otro', 'finish', j.id, j.lease_token, { status: 'failed' }]), /LEASE_LOST/);
    await assert.rejects(() => call(db, 'edicion_work', ['w', 'finish', j.id, j.lease_token, { status: 'delivered', resultPath: 'otra/ruta.mp4' }]), /EDICION_INVALID/);
    await db.query("update edicion_orders set lease_expires_at=now()-interval '1 second' where id=$1", [id]);
  }
  assert.equal(await call(db, 'edicion_work', ['w', 'claim']), null);
  const row = (await db.query('select status,result_note from edicion_orders where id=$1', [id])).rows[0];
  assert.equal(row.status, 'failed'); assert.match(row.result_note, /manualmente/);
});

// --- Rondas de cambios ---
async function deliveredOrder(u, plan = 'basico') {
  const source = await clip(u), id = crypto.randomUUID();
  await call(db, 'edicion_write', [u.id, 'create', id, { plan, amountMxn: EDICION_PLANS[plan].price, sourceAssetId: source, referenceUrl: 'https://youtu.be/x' }]);
  await call(db, 'edicion_write', [u.id, 'attach_session', id, { checkoutSessionId: `cs_test_${id.slice(0, 8)}` }]);
  await call(db, 'edicion_payment', [`evt_${id}`, `cs_test_${id.slice(0, 8)}`, id, EDICION_PLANS[plan].price * 100, 'mxn']);
  const j = await call(db, 'edicion_work', ['w', 'claim']);
  await call(db, 'edicion_work', ['w', 'finish', j.id, j.lease_token, { status: 'delivered', resultPath: `${u.id}/edicion/${id}.mp4` }]);
  return id;
}

test('rondas de cambios: límites por plan, una a la vez, versión nueva y devolución si falla', async () => {
  for (const plan of Object.keys(EDICION_PLANS)) assert.equal((await db.query('select public.edicion_revision_max($1) n', [plan])).rows[0].n, EDICION_PLANS[plan].revisions, plan);
  const a = await user(db), b = await user(db), id = await deliveredOrder(a, 'basico');
  const rev = () => crypto.randomUUID();
  await assert.rejects(() => call(db, 'edicion_revision_write', [b.id, rev(), id, 'cambia el color']), /EDICION_NOT_FOUND/);
  await assert.rejects(() => call(db, 'edicion_revision_write', [a.id, rev(), id, 'x']), /EDICION_INVALID/);
  const r1 = rev(), first = await call(db, 'edicion_revision_write', [a.id, r1, id, 'subtítulos abajo']);
  assert.deepEqual([first.revisionsUsed, first.revisionsMax, first.revisionStatus], [1, 2, 'queued']);
  assert.deepEqual(await call(db, 'edicion_revision_write', [a.id, r1, id, 'subtítulos abajo']), first, 'reintento idempotente');
  await assert.rejects(() => call(db, 'edicion_revision_write', [a.id, rev(), id, 'otro cambio']), /EDICION_REVISION_BUSY/);

  const j = await call(db, 'edicion_revision_work', ['w', 'claim']);
  assert.equal(j.version, 2); assert.equal(j.previousVersion, 1);
  await assert.rejects(() => call(db, 'edicion_revision_work', ['w', 'finish', j.id, j.lease_token, { status: 'delivered', resultPath: `${a.id}/edicion/${id}.mp4` }]), /EDICION_INVALID/, 'no puede pisar la versión 1');
  await call(db, 'edicion_revision_work', ['w', 'finish', j.id, j.lease_token, { status: 'delivered', resultPath: `${a.id}/edicion/${id}_v2.mp4` }]);
  let o = (await db.query('select result_path, result_version, revision_status, revisions_used from edicion_orders where id=$1', [id])).rows[0];
  assert.deepEqual([o.result_path, o.result_version, o.revision_status, o.revisions_used], [`${a.id}/edicion/${id}_v2.mp4`, 2, 'delivered', 1]);

  // Un cambio fallido no consume la ronda.
  await call(db, 'edicion_revision_write', [a.id, rev(), id, 'más rápido']);
  const j2 = await call(db, 'edicion_revision_work', ['w', 'claim']);
  await call(db, 'edicion_revision_work', ['w', 'finish', j2.id, j2.lease_token, { status: 'failed', note: 'no se pudo' }]);
  o = (await db.query('select revisions_used, revision_status, result_version from edicion_orders where id=$1', [id])).rows[0];
  assert.deepEqual([o.revisions_used, o.revision_status, o.result_version], [1, 'failed', 2]);

  // Lease vencido dos veces: también se devuelve la ronda.
  await call(db, 'edicion_revision_write', [a.id, rev(), id, 'quita silencios']);
  for (let i = 0; i < 2; i++) { await call(db, 'edicion_revision_work', ['w', 'claim']); await db.query("update edicion_revisions set lease_expires_at=now()-interval '1 second' where status='processing'"); }
  assert.equal(await call(db, 'edicion_revision_work', ['w', 'claim']), null);
  o = (await db.query('select revisions_used, revision_status from edicion_orders where id=$1', [id])).rows[0];
  assert.deepEqual([o.revisions_used, o.revision_status], [1, 'failed']);

  // Se agota el plan básico (2 rondas).
  await call(db, 'edicion_revision_write', [a.id, rev(), id, 'último cambio']);
  const j3 = await call(db, 'edicion_revision_work', ['w', 'claim']);
  await call(db, 'edicion_revision_work', ['w', 'finish', j3.id, j3.lease_token, { status: 'delivered', resultPath: `${a.id}/edicion/${id}_v${j3.version}.mp4` }]);
  await assert.rejects(() => call(db, 'edicion_revision_write', [a.id, rev(), id, 'uno más']), /EDICION_REVISION_LIMIT/);
});

test('API de cambios: el cliente pide, el worker aplica y la descarga da la versión nueva', async () => {
  const a = await user(db); stub.users.set('alice-rev', a);
  const id = await deliveredOrder(a, 'pro'), revisionId = crypto.randomUUID();
  const bad = await edicion.onRequestPost(ctx('/api/edicion', 'alice-rev', 'POST', { action: 'revision', orderId: id, revisionId, request: 'x' }));
  assert.equal(bad.status, 400);
  const res = await edicion.onRequestPost(ctx('/api/edicion', 'alice-rev', 'POST', { action: 'revision', orderId: id, revisionId, request: 'Pon los subtítulos abajo' }));
  assert.equal(res.status, 202);
  const listed = (await (await edicion.onRequestGet(ctx('/api/edicion', 'alice-rev'))).json()).orders.find(o => o.id === id);
  assert.deepEqual([listed.revisionStatus, listed.revisionsUsed, listed.revisionsMax, listed.version], ['queued', 1, 3, 1]);

  stub.media.set(`edicion-proyectos/${a.id}/${id}/proyecto_v1.tar.gz`, { size: 900, contentType: 'application/gzip' });
  const { job } = await (await runWorker({ action: 'claim', kind: 'revision' })).json();
  assert.equal(job.orderId, id); assert.match(job.project.url, /proyecto_v1\.tar\.gz/); assert.equal(job.version, 2); assert.equal(job.request, 'Pon los subtítulos abajo'); assert.match(job.source.url, /token=test-private/);
  const up = await (await runWorker({ kind: 'revision', action: 'upload', jobId: job.id, leaseToken: job.leaseToken })).json();
  assert.match(up.url, new RegExp(`${id}_v2\\.mp4`));
  const proj = await (await runWorker({ kind: 'revision', action: 'upload_project', jobId: job.id, leaseToken: job.leaseToken })).json();
  assert.match(proj.url, new RegExp(`edicion-proyectos/${a.id}/${id}/proyecto_v2\\.tar\\.gz`));
  stub.media.set(`studio-media/${a.id}/edicion/${id}_v2.mp4`, { size: 4096, contentType: 'video/mp4' });
  assert.equal((await (await runWorker({ kind: 'revision', action: 'finish', jobId: job.id, leaseToken: job.leaseToken, result: { status: 'delivered' } })).json()).status, 'delivered');
  const dl = await (await edicion.onRequestGet(ctx(`/api/edicion?order=${id}&download=1`, 'alice-rev'))).json();
  assert.match(dl.url, new RegExp(`${id}_v2\\.mp4`));
});

test('pago sin webhook: al consultar, se confirma con Stripe solo si la sesión está pagada y es de ese pedido', async () => {
  const a = await user(db); stub.users.set('carol', a);
  const mk = async () => {
    const r = await edicion.onRequestPost(ctx('/api/edicion', 'carol', 'POST', { orderId: crypto.randomUUID(), plan: 'basico', sourceAssetId: await clip(a), referenceUrl: 'https://youtu.be/abc' }));
    return (await r.json()).order;
  };
  const paid = await mk(), unpaid = await mk(), other = await mk(), cheap = await mk();
  const rows = async () => (await db.query('select * from edicion_orders where user_id=$1 order by created_at desc', [a.id])).rows.map(r => ({ ...r, created_at: new Date(r.created_at).toISOString() }));
  const sessions = {};
  for (const r of await rows()) {
    const o = { id: r.checkout_session_id, payment_status: 'paid', amount_total: 29900, currency: 'mxn', metadata: { kind: 'edicion', order_id: r.id } };
    if (r.id === unpaid.id) o.payment_status = 'unpaid';
    if (r.id === other.id) o.metadata.order_id = paid.id; // sesión de otro pedido: se ignora
    if (r.id === cheap.id) o.amount_total = 100; // monto alterado: la base lo rechaza
    sessions[r.checkout_session_id] = o;
  }
  const retrieved = [];
  const stripe = { checkout: { sessions: { retrieve: async id => { retrieved.push(id); return sessions[id]; } } } };
  const admin = getSupabaseAdmin(env);
  assert.equal(await reconcilePayments(admin, env, await rows(), stripe), true);
  const status = Object.fromEntries((await rows()).map(r => [r.id, r.status]));
  assert.equal(status[paid.id], 'paid');
  assert.equal(status[unpaid.id], 'awaiting_payment');
  assert.equal(status[other.id], 'awaiting_payment');
  assert.equal(status[cheap.id], 'awaiting_payment');
  // Repetir no cambia nada ni vuelve a consultar el pedido ya pagado.
  const paidSession = (await rows()).find(r => r.id === paid.id).checkout_session_id;
  retrieved.length = 0;
  assert.equal(await reconcilePayments(admin, env, await rows(), stripe), false);
  assert.equal(retrieved.length, 3); assert.ok(!retrieved.includes(paidSession));
  assert.equal((await rows()).filter(r => r.status === 'paid').length, 1);
});

test('Worker de /edicion/: solo atiende su página, sus assets y sus APIs', async () => {
  const served = [];
  const workerEnv = { ...env, ASSETS: { fetch: async req => { served.push(new URL(req.url).pathname); return new Response('ok', { headers: { 'content-type': 'text/html' } }); } } };
  const go = (path, init) => edicionWeb.fetch(new Request('https://creativerushai.com' + path, init), workerEnv, { waitUntil() {} });
  assert.equal((await go('/edicion')).status, 308);
  const page = await go('/edicion/?pedido=1');
  assert.equal(page.status, 200); assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await go('/assets/edicion.js')).status, 200);
  assert.deepEqual(served, ['/edicion/', '/assets/edicion.js']);
  assert.equal((await go('/assets/edicion-secreto.js')).status, 404);
  assert.equal((await go('/edicionx')).status, 404);
  assert.equal((await go('/edicion/', { method: 'POST' })).status, 405);
  assert.equal((await go('/api/edicion')).status, 401, 'la API exige sesión');
  assert.equal((await go('/api/edicion', { method: 'DELETE' })).status, 405);
  assert.equal((await go('/api/edicion-worker', { method: 'POST', body: '{}' })).status, 401, 'el worker exige su token');
});
