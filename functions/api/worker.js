import { getSupabaseAdmin, json, getBearerToken } from '../../src/backend.js';
import { ApiError, apiError, readJson, rpc, UUID, REFERENCE_BUCKET, RESULT_BUCKET } from '../../src/generations.js';
import {H3_LIMITS} from '../../src/h3-lifecycle.js';
export const PROVIDER_ID = /^(?:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}|rp:[a-zA-Z0-9]{8,40}:[a-zA-Z0-9_-]{1,100})$/i;

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
    if (['idle_claim','idle_heartbeat','idle_complete'].includes(body.action)) {
      return json(await rpc(db,'serverless_idle_work',{p_worker:body.workerId,p_action:body.action.slice(5),p_token:body.idleToken||null}));
    }
    if (body.action === 'claim') {
      await rpc(db, 'sweep_generations');
      const serverless=body.backend==='serverless';
      if(context.env.H3_BACKEND==='pod'&&serverless)return json({job:null,paused:true});
      const enabled=context.env.GENERATION_ENABLED==='true';
      if (!enabled && !serverless) return json({ job: null, paused: true });
      const job = await rpc(db, serverless?'claim_serverless_generation':'claim_generation',
        {p_worker_id:body.workerId,...(serverless?{p_allow_new:enabled&&body.recoverOnly!==true}:{})});
      if (!job?.id) return json({ job: null });
      let referenceUrl = null;
      if (job.reference_id&&!job.submission_started) {
        const ref = await db.from('generation_references').select('storage_path').eq('id', job.reference_id).eq('user_id', job.user_id).single();
        if (ref.error) throw ref.error;
        const signed = await db.storage.from(REFERENCE_BUCKET).createSignedUrl(ref.data.storage_path, H3_LIMITS.referenceUrlSeconds);
        if (signed.error) throw signed.error;
        referenceUrl = signed.data.signedUrl;
      }
      return json({ job: { id: job.id, leaseToken: job.lease_token, prompt: job.prompt,
        durationSeconds: job.duration_seconds, resolution: job.resolution, aspectRatio: job.aspect_ratio,
        managedAttemptId:job.managed_attempt_id,noiseSeed:job.managed_seed,preset: job.preset, referenceUrl, submissionStarted: job.submission_started, providerPromptId: job.provider_prompt_id,
        providerPhase:job.provider_phase,providerShutdownRequired:job.provider_shutdown_required,providerClaimedAt:job.provider_claimed_at,
        providerSubmittedAt:job.provider_submitted_at,providerStartedAt:job.started_at,providerDeadlineAt:job.provider_deadline_at } });
    }
    const job = await assignedJob(db, body);
    const args = { p_job_id: job.id, p_worker_id: body.workerId, p_lease_token: body.leaseToken };
    if (body.action === 'heartbeat') {
      if (body.providerPromptId != null && !PROVIDER_ID.test(body.providerPromptId)) throw new ApiError('INVALID_GENERATION');
      await rpc(db, 'heartbeat_generation', { ...args, p_submission_started: body.submissionStarted === true,
        p_provider_prompt_id: body.providerPromptId || null });
      return json({ ok: true });
    }
    if(job.managed_attempt_id&&['progress','infrastructure_failure'].includes(body.action)){
      await rpc(db,'h3_attempt_progress',{...args,p_stage:body.action==='infrastructure_failure'?'reconciling':body.phase,p_failure:body.action==='infrastructure_failure'?body.reason:null});
      return json({ok:true});
    }
    if (body.action === 'progress') {
      if(!['generating','reconciling'].includes(body.phase))throw new ApiError('INVALID_GENERATION');
      await rpc(db,'generation_provider_progress',{...args,p_phase:body.phase});
      return json({ok:true});
    }
    if(body.action==='trip'||body.action==='shutdown_verified'){
      await rpc(db,'generation_serverless_shutdown',{...args,p_verified:body.action==='shutdown_verified'});
      return json({ok:true});
    }
    if (body.action === 'fail') {
      const result = await rpc(db, 'finish_generation', { ...args, p_success: false });
      return json({ status: result.status });
    }
    if (['complete','recover'].includes(body.action) && job.status === 'succeeded') return json({ status: job.status,ready:true });
    if (job.status !== 'running' || Date.parse(job.lease_expires_at) <= Date.now()) throw new ApiError('LEASE_LOST');
    const resultPath = job.managed_attempt_id?`${job.user_id}/${job.id}/${job.managed_attempt_id}.mp4`:`${job.user_id}/${job.id}.mp4`;
    if (body.action === 'upload') {
      const { data, error } = await db.storage.from(RESULT_BUCKET).createSignedUploadUrl(resultPath);
      if (error) throw error;
      return json({ uploadUrl: data.signedUrl });
    }
    if (body.action === 'complete' || body.action === 'recover') {
      const { data, error } = await db.storage.from(RESULT_BUCKET).info(resultPath);
      const size = data?.size ?? data?.metadata?.size;
      const mime = data?.contentType ?? data?.metadata?.mimetype;
      if(error){
        // Only a confirmed absence can mean "not ready"; a storage outage must
        // defer recovery instead of causing a false refund.
        const missing=String(error.statusCode||error.status)==='404'||['not_found','NoSuchKey'].includes(error.code);
        if(body.action==='recover'&&missing)return json({ready:false});
        throw new ApiError('RESULT_NOT_READY');
      }
      if (!size || size > 52428800 || mime !== 'video/mp4') throw new ApiError('RESULT_NOT_READY');
      const result = await rpc(db, 'finish_generation', { ...args, p_success: true });
      return json({ status: result.status,ready:true });
    }
    throw new ApiError('INVALID_GENERATION');
  } catch (error) { return apiError(error); }
}
export function onRequest() { return json({ error: 'Método no permitido.' }, 405); }
