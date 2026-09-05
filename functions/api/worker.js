import { getSupabaseAdmin, json, getBearerToken } from '../../src/backend.js';
import { ApiError, apiError, readJson, rpc, UUID, REFERENCE_BUCKET, RESULT_BUCKET } from '../../src/generations.js';

export async function verifyWorker(request, secret) {
  const token = getBearerToken(request);
  if (!secret || secret.length < 32 || !token || token.length > 512) throw new ApiError('UNAUTHORIZED');
  const encoder = new TextEncoder();
  const [a,b] = await Promise.all([secret,token].map(s => crypto.subtle.digest('SHA-256', encoder.encode(s))));
  const left = new Uint8Array(a), right = new Uint8Array(b); let mismatch = 0;
  for (let i = 0; i < left.length; i++) mismatch |= left[i] ^ right[i];
  if (mismatch) throw new ApiError('UNAUTHORIZED');
}
async function assignedJob(db, body) {
  if (!UUID.test(body.jobId || '') || !UUID.test(body.leaseToken || '')) throw new ApiError('LEASE_LOST');
  const { data, error } = await db.from('generation_jobs').select('*').eq('id', body.jobId)
    .eq('worker_id', body.workerId).eq('lease_token', body.leaseToken).maybeSingle();
  if (error) throw error; if (!data) throw new ApiError('LEASE_LOST');
  return data;
}
export async function onRequestPost(context) {
  try {
    await verifyWorker(context.request, context.env.GENERATION_WORKER_TOKEN);
    const db = getSupabaseAdmin(context.env);
    const body = await readJson(context.request);
    if (body.action === 'sweep') return json({ expired: await rpc(db, 'sweep_generations') });
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(body.workerId || '')) throw new ApiError('UNAUTHORIZED');
    if (body.action === 'claim') {
      await rpc(db, 'sweep_generations');
      if (context.env.GENERATION_ENABLED !== 'true') return json({ job: null, paused: true });
      const job = await rpc(db, 'claim_generation', { p_worker_id: body.workerId });
      if (!job?.id) return json({ job: null });
      let referenceUrl = null;
      if (job.reference_id) {
        const ref = await db.from('generation_references').select('storage_path').eq('id', job.reference_id).eq('user_id', job.user_id).single();
        if (ref.error) throw ref.error;
        const signed = await db.storage.from(REFERENCE_BUCKET).createSignedUrl(ref.data.storage_path, 900);
        if (signed.error) throw signed.error;
        referenceUrl = signed.data.signedUrl;
      }
      return json({ job: { id: job.id, leaseToken: job.lease_token, prompt: job.prompt,
        durationSeconds: job.duration_seconds, resolution: job.resolution, aspectRatio: job.aspect_ratio,
        preset: job.preset, referenceUrl, submissionStarted: job.submission_started, providerPromptId: job.provider_prompt_id } });
    }
    const job = await assignedJob(db, body);
    const args = { p_job_id: job.id, p_worker_id: body.workerId, p_lease_token: body.leaseToken };
    if (body.action === 'heartbeat') {
      if (body.providerPromptId != null && !UUID.test(body.providerPromptId)) throw new ApiError('INVALID_GENERATION');
      await rpc(db, 'heartbeat_generation', { ...args, p_submission_started: body.submissionStarted === true,
        p_provider_prompt_id: body.providerPromptId || null });
      return json({ ok: true });
    }
    if (body.action === 'fail') {
      const result = await rpc(db, 'finish_generation', { ...args, p_success: false });
      return json({ status: result.status });
    }
    if (body.action === 'complete' && job.status === 'succeeded') return json({ status: job.status });
    if (job.status !== 'running' || Date.parse(job.lease_expires_at) <= Date.now()) throw new ApiError('LEASE_LOST');
    const resultPath = `${job.user_id}/${job.id}.mp4`;
    if (body.action === 'upload') {
      const { data, error } = await db.storage.from(RESULT_BUCKET).createSignedUploadUrl(resultPath);
      if (error) throw error;
      return json({ uploadUrl: data.signedUrl });
    }
    if (body.action === 'complete') {
      const { data, error } = await db.storage.from(RESULT_BUCKET).info(resultPath);
      const size = data?.size ?? data?.metadata?.size;
      const mime = data?.contentType ?? data?.metadata?.mimetype;
      if (error || !size || size > 52428800 || mime !== 'video/mp4') throw new ApiError('RESULT_NOT_READY');
      const result = await rpc(db, 'finish_generation', { ...args, p_success: true });
      return json({ status: result.status });
    }
    throw new ApiError('INVALID_GENERATION');
  } catch (error) { return apiError(error); }
}
export function onRequest() { return json({ error: 'Método no permitido.' }, 405); }
