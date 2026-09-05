import { H3Adapter } from './h3-adapter.mjs';
import { pathToFileURL } from 'node:url';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
export function createApi({ appUrl, token, workerId, fetchImpl = fetch }) {
  const parsed = new URL(appUrl);
  if (parsed.protocol !== 'https:' && !['127.0.0.1','localhost','[::1]'].includes(parsed.hostname)) throw new Error('HTTPS is required');
  if (!token || token.length < 32 || !/^[a-zA-Z0-9_-]{1,80}$/.test(workerId || '')) throw new Error('Worker configuration missing');
  return async (action, body = {}) => {
    const response = await fetchImpl(`${appUrl.replace(/\/$/,'')}/api/worker`, {
      method:'POST', headers:{ 'content-type':'application/json', authorization:`Bearer ${token}` },
      body:JSON.stringify({ action, workerId, ...body }), signal:AbortSignal.timeout(25000),
    });
    const payload = await response.json();
    if (!response.ok) { const error = new Error(payload.code || 'BACKEND_UNAVAILABLE'); error.code = payload.code; throw error; }
    return payload;
  };
}
export async function processJob(job, api, adapter, { fetchImpl = fetch, heartbeatMs = 20000 } = {}) {
  const identity = { jobId:job.id, leaseToken:job.leaseToken };
  let leaseLost = false, beating = false, lastHeartbeat = Date.now();
  const beat = async () => {
    if (beating) return; beating = true;
    try { await api('heartbeat', identity); lastHeartbeat = Date.now(); }
    catch (error) { if (error.code === 'LEASE_LOST' || Date.now() - lastHeartbeat > 110000) leaseLost = true; }
    finally { beating = false; }
  };
  const assertLease = () => { if (leaseLost) throw new Error('LEASE_LOST'); };
  await api('heartbeat', identity);
  const interval = setInterval(beat, heartbeatMs);
  try {
    let promptId = job.providerPromptId;
    if (!promptId && job.submissionStarted) {
      promptId = await adapter.findSubmission(job.id);
      // A crash around submission is ambiguous. Never silently re-generate/bill twice.
      if (!promptId) throw new Error('AMBIGUOUS_SUBMISSION');
    }
    if (!promptId) {
      const workflow = await adapter.build(job); assertLease();
      await api('heartbeat', { ...identity, submissionStarted:true });
      try { promptId = await adapter.submit(workflow, job.id); }
      catch { promptId = await adapter.findSubmission(job.id); if (!promptId) throw new Error('AMBIGUOUS_SUBMISSION'); }
    }
    await api('heartbeat', { ...identity, providerPromptId:promptId });
    const video = await adapter.wait(promptId, assertLease); assertLease();
    const { uploadUrl } = await api('upload', identity);
    const uploaded = await fetchImpl(uploadUrl, { method:'PUT', headers:{ 'content-type':'video/mp4','x-upsert':'false' },
      body:video, signal:AbortSignal.timeout(120000) });
    // An upload may have succeeded before an ack was lost. Completion verifies private storage.
    if (!uploaded.ok && ![400,409].includes(uploaded.status)) throw new Error('UPLOAD_FAILED');
    await api('complete', identity);
    console.log(`completed ${job.id}`);
  } catch (error) {
    // If completion succeeded but the response was lost, this is idempotent and does not refund it.
    if (!leaseLost && error.code !== 'SUBMISSION_ALREADY_STARTED') await api('fail', identity).catch(() => {});
    console.error(`job_failed ${job.id} ${error.code === 'LEASE_LOST' ? 'LEASE_LOST' : 'see_backend_status'}`);
  } finally { clearInterval(interval); }
}
export async function main() {
  const api = createApi({ appUrl:process.env.CREATIVE_RUSH_URL, token:process.env.GENERATION_WORKER_TOKEN,
    workerId:process.env.H3_WORKER_ID });
  const adapter = new H3Adapter(process.env.COMFY_URL || 'http://127.0.0.1:8188');
  let stopping = false;
  for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => { stopping = true; });
  while (!stopping) {
    try {
      await api('sweep');
      await adapter.ready();
      const { job } = await api('claim');
      if (job) await processJob(job, api, adapter); else await delay(5000);
    } catch { console.error('worker_not_ready_retrying'); await delay(10000); }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => { console.error('Invalid worker configuration'); process.exitCode = 1; });
