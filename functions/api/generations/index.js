import { json } from '../../../src/backend.js';
import { apiError, authContext, readJson, validateGeneration, rpc, publicJob, generationAvailability, ApiError } from '../../../src/generations.js';

export async function onRequestGet(context) {
  try {
    const { db, user } = await authContext(context);
    const [jobs, balance, available] = await Promise.all([
      db.from('generation_jobs').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(50),
      db.from('credit_balances').select('video_credits,image_credits').eq('user_id', user.id).maybeSingle(),
      generationAvailability(db, context.env),
    ]);
    if (jobs.error) throw jobs.error; if (balance.error) throw balance.error;
    return json({ jobs: jobs.data.map(publicJob), balance: balance.data || { video_credits: 0, image_credits: 0 }, available, imageGenerationAvailable: false });
  } catch (error) { return apiError(error); }
}

export async function onRequestPost(context) {
  try {
    const { db, user } = await authContext(context);
    const args = validateGeneration(await readJson(context.request));
    // Retry an existing request even during maintenance; never create new work while disabled.
    if (context.env.GENERATION_ENABLED !== 'true') {
      const { data, error } = await db.from('generation_jobs').select('*').eq('user_id', user.id).eq('request_id', args.p_request_id).maybeSingle();
      if (error) throw error; if (!data) throw new ApiError('WORKER_OFFLINE');
    }
    const job = await rpc(db, 'reserve_generation', { p_user_id: user.id, ...args });
    return json({ job: publicJob(job) }, 202);
  } catch (error) { return apiError(error); }
}
export function onRequest() { return json({ error: 'Método no permitido.' }, 405); }
