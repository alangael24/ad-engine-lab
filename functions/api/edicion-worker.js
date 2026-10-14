import { verifyWorker } from './worker.js';
import { getSupabaseAdmin, json } from '../../src/backend.js';
import { readJson, rpc, UUID, ApiError } from '../../src/generations.js';
import { own, signed } from '../../src/studio.js';
import { edicionError } from '../../src/edicion.js';
import { MATERIAL_BUCKET, partPath, resultOwner } from '../../src/edicion-guest.js';

// Worker de edición: toma pedidos pagados (kind "order") o rondas de cambios (kind "revision"),
// recibe URLs firmadas y entrega el MP4. Ambos usan lease con heartbeat.
const KINDS = {
  order: { table: 'edicion_orders', rpc: 'edicion_work', path: o => `${resultOwner(o)}/edicion/${o.id}.mp4`,
    project: o => projectPath(resultOwner(o), o.id, 1) },
  revision: { table: 'edicion_revisions', rpc: 'edicion_revision_work', path: r => `${resultOwner(r)}/edicion/${r.order_id}_v${r.version}.mp4`,
    project: r => projectPath(resultOwner(r), r.order_id, r.version) },
};
// Proyecto de cada versión (receta, script, imágenes) para aplicar cambios en cualquier servidor.
const PROJECT_BUCKET = 'edicion-proyectos';
const projectPath = (userId, orderId, version) => `${userId}/${orderId}/proyecto_v${version}.tar.gz`;

// Material subido por partes desde la página privada: una URL firmada por parte, en una sola petición.
async function uploaded(db, order, kind) {
  const up = order[`${kind}_upload`];
  const paths = Array.from({ length: up.parts }, (_, i) => partPath(order.id, kind, i));
  const { data, error } = await db.storage.from(MATERIAL_BUCKET).createSignedUrls(paths, 3600);
  if (error) throw error;
  if (data.length !== paths.length || data.some(d => d.error || !d.signedUrl)) throw new ApiError('RESULT_NOT_READY');
  return { name: up.name, durationSeconds: up.durationSeconds, size: up.size, parts: data.map(d => d.signedUrl) };
}

async function materials(db, order) {
  if (order.source_upload) {
    return { source: await uploaded(db, order, 'source'),
      reference: order.reference_upload ? await uploaded(db, order, 'reference') : { link: order.reference_url },
      names: order.names || '' };
  }
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
      const q = await db.from('edicion_orders').select('*').eq('id', claimed.order_id).maybeSingle();
      if (q.error) throw q.error;
      const order = q.data;
      if (!order) throw new ApiError('EDICION_NOT_FOUND');
      const previous = projectPath(resultOwner(order), order.id, claimed.previousVersion);
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
