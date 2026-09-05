import { getAuthenticatedUser, getSupabaseAdmin, json } from './backend.js';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const REFERENCE_BUCKET = 'generation-references';
export const RESULT_BUCKET = 'generation-results';
export const MAX_REFERENCE_BYTES = 6 * 1024 * 1024;
const MESSAGES = {
  UNAUTHORIZED: [401, 'Inicia sesión para continuar.'],
  INVALID_GENERATION: [400, 'Revisa el prompt y las opciones del video.'],
  INVALID_REFERENCE: [400, 'Usa una imagen PNG, JPG o WebP de hasta 6 MB.'],
  REFERENCE_NOT_FOUND: [404, 'La referencia no está disponible en tu cuenta.'],
  JOB_NOT_FOUND: [404, 'No encontramos ese video en tu cuenta.'],
  ACCOUNT_NOT_READY: [409, 'Tu cuenta todavía se está activando.'],
  INSUFFICIENT_CREDITS: [402, 'No tienes saldo suficiente para este video.'],
  TOO_MANY_ACTIVE_JOBS: [429, 'Ya tienes tres videos pendientes. Espera a que termine uno.'],
  UPLOAD_LIMIT: [429, 'Alcanzaste el límite diario de referencias.'],
  IDEMPOTENCY_CONFLICT: [409, 'Esta solicitud ya se usó con otras opciones.'],
  JOB_ALREADY_STARTED: [409, 'Este video ya comenzó; solo se puede cancelar mientras está en cola.'],
  WORKER_OFFLINE: [503, 'La generación no está disponible ahora. No se descontó saldo.'],
  LEASE_LOST: [409, 'Este trabajo ya no está asignado a este worker.'],
  SUBMISSION_ALREADY_STARTED: [409, 'El trabajo ya se envió al motor.'],
  RESULT_NOT_READY: [409, 'El archivo del video todavía no está guardado.'],
};
export class ApiError extends Error { constructor(code) { super(code); this.code = code; } }
export function apiError(error) {
  const code = Object.keys(MESSAGES).find(key => error?.code === key || error?.message === key);
  const [status, message] = MESSAGES[code] || [503, 'No pudimos completar la operación. Inténtalo de nuevo.'];
  if (!code) console.error('generation_api_failed', error?.code || error?.name || 'unknown');
  return json({ error: message, code: code || 'SERVICE_UNAVAILABLE' }, status);
}
export async function authContext(context) {
  const db = getSupabaseAdmin(context.env);
  const user = await getAuthenticatedUser(db, context.request);
  if (!user) throw new ApiError('UNAUTHORIZED');
  return { db, user };
}
export async function readJson(request, max = 12000) {
  if (!request.headers.get('content-type')?.includes('application/json')) throw new ApiError('INVALID_GENERATION');
  const bytes = await readBounded(request, max);
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new ApiError('INVALID_GENERATION'); }
}
export async function readBounded(request, max) {
  if (Number(request.headers.get('content-length')) > max) throw new ApiError('INVALID_GENERATION');
  if (!request.body) throw new ApiError('INVALID_GENERATION');
  const reader = request.body.getReader(); const chunks = []; let size = 0;
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    size += value.length;
    if (size > max) { await reader.cancel(); throw new ApiError('INVALID_GENERATION'); }
    chunks.push(value);
  }
  const result = new Uint8Array(size); let offset = 0;
  for (const part of chunks) { result.set(part, offset); offset += part.length; }
  return result;
}
export function validateGeneration(body) {
  if (!body || !UUID.test(body.requestId) || typeof body.prompt !== 'string'
    || body.prompt.trim().length < 8 || body.prompt.trim().length > 1600
    || ![5,10,15].includes(body.durationSeconds) || !['480p','720p'].includes(body.resolution)
    || !['9:16','16:9','1:1'].includes(body.aspectRatio)
    || (body.referenceId != null && !UUID.test(body.referenceId))) throw new ApiError('INVALID_GENERATION');
  return { p_request_id: body.requestId, p_prompt: body.prompt.trim(), p_duration: body.durationSeconds,
    p_resolution: body.resolution, p_ratio: body.aspectRatio, p_reference_id: body.referenceId || null };
}
export async function rpc(db, name, args = {}) {
  const { data, error } = await db.rpc(name, args);
  if (error) throw error;
  return data;
}
export function publicJob(j) {
  return { id: j.id, requestId: j.request_id, prompt: j.prompt, durationSeconds: j.duration_seconds,
    resolution: j.resolution, aspectRatio: j.aspect_ratio, creditCost: j.credit_cost, status: j.status,
    createdAt: j.created_at, startedAt: j.started_at, finishedAt: j.finished_at,
    refunded: Boolean(j.refunded_at), hasReference: Boolean(j.reference_id),
    error: j.status === 'failed' ? 'No se pudo generar el video. El saldo fue devuelto.' : null };
}
export async function ownJob(db, userId, id) {
  if (!UUID.test(id || '')) throw new ApiError('JOB_NOT_FOUND');
  const { data, error } = await db.from('generation_jobs').select('*').eq('id', id).eq('user_id', userId).maybeSingle();
  if (error) throw error; if (!data) throw new ApiError('JOB_NOT_FOUND'); return data;
}
export async function generationAvailability(db, env) {
  if (env.GENERATION_ENABLED !== 'true') return false;
  const { data, error } = await db.from('generation_workers').select('id')
    .gt('last_seen_at', new Date(Date.now() - 90000).toISOString()).limit(1);
  // Missing migration is an offline state, never pretend the provider is ready.
  return !error && data?.length > 0;
}
export function imageType(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return ['image/jpeg','jpg'];
  if ([137,80,78,71,13,10,26,10].every((v,i) => bytes[i] === v)) return ['image/png','png'];
  const d = new TextDecoder();
  if (d.decode(bytes.slice(0,4)) === 'RIFF' && d.decode(bytes.slice(8,12)) === 'WEBP') return ['image/webp','webp'];
  throw new ApiError('INVALID_REFERENCE');
}
