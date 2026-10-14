import { verifyWorker } from './worker.js';
import { getSupabaseAdmin, json } from '../../src/backend.js';
import { readJson, rpc, UUID, ApiError } from '../../src/generations.js';
import { own, signed } from '../../src/studio.js';
import { edicionError } from '../../src/edicion.js';

// Worker de edición: toma pedidos pagados (kind "order") o rondas de cambios (kind "revision"),
// recibe URLs firmadas y entrega el MP4. Ambos usan lease con heartbeat.
const KINDS = {
  order: { table: 'edicion_orders', rpc: 'edicion_work', path: o => `${o.user_id}/edicion/${o.id}.mp4`,
    project: o => projectPath(o.user_id, o.id, 1) },
  revision: { table: 'edicion_revisions', rpc: 'edicion_revision_work', path: r => `${r.user_id}/edicion/${r.order_id}_v${r.version}.mp4`,
    project: r => projectPath(r.user_id, r.order_id, r.version) },
};
// Proyecto de cada versión (receta, script, imágenes) para aplicar cambios en cualquier servidor.
const PROJECT_BUCKET = 'edicion-proyectos';
const projectPath = (userId, orderId, version) => `${userId}/${orderId}/proyecto_v${version}.tar.gz`;

async function materials(db, order) {
  const source = await own(db, 'studio_assets', order.user_id, order.source_asset_id);
  const reference = order.reference_asset_id ? await own(db, 'studio_assets', order.user_id, order.reference_asset_id) : null;
  return {
    source: { name: source.name, durationSeconds: source.duration_seconds, url: await signed(db, source.bucket, source.storage_path) },
    reference: reference
      ? { name: reference.name, durationSeconds: reference.duration_seconds, url: await signed(db, reference.bucket, reference.storage_path) }
      : { link: order.reference_url },
  };
}

export async function onRequestPost(context) {
  try {
    await verifyWorker(context.request, context.env.EDICION_WORKER_TOKEN);
    const db = getSupabaseAdmin(context.env), b = await readJson(context.request, 20000);
    if (!/^[\w-]{1,80}$/.test(b.workerId || '')) throw new ApiError('UNAUTHORIZED');
    const kind = KINDS[b.kind || 'order'];
    if (!kind) throw new ApiError('EDICION_INVALID');
    const args = { p_worker: b.workerId, p_action: b.action, p_id: b.jobId || null, p_lease: b.leaseToken || null, p_result: b.result || null };
    if (b.action === 'claim') {
      if (context.env.EDICION_ENABLED !== 'true') return json({ job: null });
      const claimed = await rpc(db, kind.rpc, args);
      if (!claimed) return json({ job: null });
      if (kind === KINDS.order) {
        return json({ job: { id: claimed.id, leaseToken: claimed.lease_token, plan: claimed.plan, instructions: claimed.instructions,
          attempt: claimed.attempts, ...(await materials(db, claimed)) } });
      }
      const order = await own(db, 'edicion_orders', claimed.user_id, claimed.order_id);
      const previous = projectPath(order.user_id, order.id, claimed.previousVersion);
      const info = await db.storage.from(PROJECT_BUCKET).info(previous);
      const project = !info.error && info.data ? { url: await signed(db, PROJECT_BUCKET, previous) } : null;
      return json({ job: { id: claimed.id, orderId: claimed.order_id, leaseToken: claimed.lease_token, plan: claimed.plan,
        version: claimed.version, previousVersion: claimed.previousVersion, request: claimed.request, instructions: order.instructions,
        attempt: claimed.attempts, project, ...(await materials(db, order)) } });
    }
    if (!UUID.test(b.jobId || '') || !UUID.test(b.leaseToken || '')) throw new ApiError('LEASE_LOST');
    if (b.action === 'heartbeat') return json(await rpc(db, kind.rpc, args));
    const q = await db.from(kind.table).select('*').eq('id', b.jobId).eq('worker_id', b.workerId).eq('lease_token', b.leaseToken).maybeSingle();
    if (q.error) throw q.error;
    const row = q.data;
    if (!row) throw new ApiError('LEASE_LOST');
    if (b.action === 'finish' && ['delivered', 'failed'].includes(row.status)) return json({ status: row.status });
    if (row.status !== 'processing' || Date.parse(row.lease_expires_at) <= Date.now()) throw new ApiError('LEASE_LOST');
    const path = kind.path(row);
    if (b.action === 'upload_project') {
      // Sube (o reemplaza) el proyecto de esta versión; el worker lo hace después de entregar.
      const r = await db.storage.from(PROJECT_BUCKET).createSignedUploadUrl(kind.project(row), { upsert: true });
      if (r.error) throw r.error;
      return json({ url: r.data.signedUrl });
    }
    if (b.action === 'upload') {
      const r = await db.storage.from('studio-media').createSignedUploadUrl(path);
      if (r.error) throw r.error;
      return json({ url: r.data.signedUrl });
    }
    if (b.action === 'finish') {
      if (b.result?.status === 'delivered') {
        const r = await db.storage.from('studio-media').info(path);
        const size = r.data?.size ?? r.data?.metadata?.size, mime = r.data?.contentType ?? r.data?.metadata?.mimetype;
        if (r.error || !size || size > 52428800 || mime !== 'video/mp4') throw new ApiError('RESULT_NOT_READY');
      }
      return json(await rpc(db, kind.rpc, { ...args, p_result: { status: b.result?.status, note: b.result?.note || '', resultPath: path } }));
    }
    throw new ApiError('EDICION_INVALID');
  } catch (error) { return edicionError(error); }
}
export function onRequest() { return new Response(null, { status: 405 }); }
