import { json } from '../../../src/backend.js';
import { apiError, authContext, ownJob, publicJob, rpc, RESULT_BUCKET } from '../../../src/generations.js';

export async function onRequestGet(context) {
  try {
    const { db, user } = await authContext(context);
    const job = await ownJob(db, user.id, context.params.id);
    let resultUrl = null;
    if (job.status === 'succeeded') {
      const { data, error } = await db.storage.from(RESULT_BUCKET).createSignedUrl(job.result_path, 900,
        new URL(context.request.url).searchParams.has('download') ? { download: `CreativeRush-${job.id}.mp4` } : {});
      if (error) throw error; resultUrl = data.signedUrl;
    }
    return json({ job: publicJob(job), resultUrl });
  } catch (error) { return apiError(error); }
}
export async function onRequestDelete(context) {
  try {
    const { db, user } = await authContext(context);
    await ownJob(db, user.id, context.params.id);
    const job = await rpc(db, 'cancel_generation', { p_user_id: user.id, p_job_id: context.params.id });
    return json({ job: publicJob(job) });
  } catch (error) { return apiError(error); }
}
export function onRequest() { return json({ error: 'Método no permitido.' }, 405); }
