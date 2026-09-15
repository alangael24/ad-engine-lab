import { H3Adapter } from './h3-adapter.mjs';
import { H3ServerlessAdapter } from './h3-serverless-adapter.mjs';
import { pathToFileURL } from 'node:url';
import {H3_LIMITS,realClock} from '../src/h3-lifecycle.js';

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
export async function processJob(job, api, adapter, { fetchImpl = fetch, heartbeatMs = 20000,clock=realClock } = {}) {
  const identity = { jobId:job.id, leaseToken:job.leaseToken };
  let leaseLost = false, beating = false, lastHeartbeat = clock.now(), promptId = job.providerPromptId;
  const serverless=adapter.directUpload===true,submittedAt=Date.parse(job.providerSubmittedAt||job.providerClaimedAt)||clock.now();
  const deadlineAt=Date.parse(job.providerDeadlineAt)||submittedAt+H3_LIMITS.providerTtlMs+H3_LIMITS.reconciliationMs;
  let shutdownRequired=job.providerShutdownRequired===true,executing=Boolean(job.providerStartedAt);
  const recover=async()=>Boolean((await api('recover',identity)).ready);
  // Retrying an immutable checkpoint is safe; POST /run is never retried.
  const checkpoint=async body=>{
    for(let n=0;n<3;n++){
      try{return await api('heartbeat',body);}
      catch(error){
        if(error.code==='LEASE_LOST'||error.code==='PROVIDER_CONFLICT')throw error;
        if(n===2)throw Object.assign(error,{retryable:true});
        await clock.sleep(500);
      }
    }
  };
  const beat = async () => {
    if (beating) return; beating = true;
    try { await api('heartbeat', identity); lastHeartbeat = clock.now(); }
    catch (error) { if (error.code === 'LEASE_LOST' || clock.now() - lastHeartbeat > 110000) leaseLost = true; }
    finally { beating = false; }
  };
  const assertLease = () => { if (leaseLost) throw new Error('LEASE_LOST'); };
  const shutdown=async()=>{
    await api('heartbeat',identity);assertLease();
    if(!await adapter.shutdownAndVerify(assertLease))return false;
    await api('shutdown_verified',identity);shutdownRequired=false;return true;
  };
  await api('heartbeat', identity);
  const interval = clock.setInterval(beat, heartbeatMs);
  try {
    if(shutdownRequired&&!await shutdown())return {status:'deferred',reason:'SHUTDOWN_UNCONFIRMED'};
    if(serverless&&job.submissionStarted&&await recover())return {status:'succeeded',recovered:true};
    if(serverless&&(job.providerPhase==='reconciling'||clock.now()>=deadlineAt))throw Error('H3_SERVERLESS_TIMEOUT');
    if (!promptId && job.submissionStarted) {
      promptId = await adapter.findSubmission(job.id);
      // A crash around submission is ambiguous. Never silently re-generate/bill twice.
      if (!promptId) throw Object.assign(new Error('AMBIGUOUS_SUBMISSION'),{retryable:serverless});
    }
    if (!promptId) {
      const target = adapter.directUpload ? await api('upload', identity) : {};
      const workflow = await adapter.build(job, target); assertLease();
      await api('heartbeat', { ...identity, submissionStarted:true });
      try { promptId = await adapter.submit(workflow, job.id, {assertLease}); }
      catch { promptId = await adapter.findSubmission(job.id); if (!promptId) throw Object.assign(new Error('AMBIGUOUS_SUBMISSION'),{retryable:serverless}); }
    }
    await checkpoint({ ...identity, providerPromptId:promptId });
    const video = await adapter.wait(promptId, assertLease,{
      submittedAt,executionStartedAt:Date.parse(job.providerStartedAt)||undefined,
      deadlineAt:Math.min(deadlineAt,submittedAt+H3_LIMITS.providerTtlMs),
      onProgress:async phase=>{executing=true;try{return await api('progress',{...identity,phase});}catch(error){throw Object.assign(error,{retryable:true});}},
    }); assertLease();
    if (adapter.directUpload) {
      if (video.jobId !== job.id) throw new Error('H3_RESULT_JOB_MISMATCH');
      console.log(JSON.stringify({event:'h3_serverless_result',jobId:job.id,executionMs:video.executionMs,queueMs:video.queueMs,bytes:video.bytes}));
    } else {
    const { uploadUrl } = await api('upload', identity);
    const uploaded = await fetchImpl(uploadUrl, { method:'PUT', headers:{ 'content-type':'video/mp4','x-upsert':'false' },
      body:video, signal:AbortSignal.timeout(120000) });
    // An upload may have succeeded before an ack was lost. Completion verifies private storage.
    if (!uploaded.ok && ![400,409].includes(uploaded.status)) throw new Error('UPLOAD_FAILED');
    }
    await api('complete', identity);
    console.log(`completed ${job.id}`);
    return {status:'succeeded'};
  } catch (error) {
    if(serverless){
      // Losing ownership never authorizes this process to cancel another owner's work.
      if(leaseLost||error.code==='LEASE_LOST'||error.message==='LEASE_LOST')return {status:'deferred',reason:'LEASE_LOST'};
      if(error.code==='SUBMISSION_ALREADY_STARTED')return {status:'deferred',reason:'SUBMISSION_ALREADY_STARTED'};
      try {
        if(shutdownRequired&&!await shutdown())return {status:'deferred',reason:'SHUTDOWN_UNCONFIRMED'};
        if(await recover())return {status:'succeeded',recovered:true};
        if(error.retryable&&clock.now()<deadlineAt)return {status:'deferred',reason:error.message};
        if(error.message==='H3_SERVERLESS_PREPARATION_TIMEOUT'||(!executing&&['H3_SERVERLESS_TIMEOUT','H3_SERVERLESS_JOB_FAILED'].includes(error.message))){
          // Stop repeated cold-start spend. This survives coordinator restarts.
          await api('trip',identity);shutdownRequired=true;
        }
        // Persist cleanup intent before any cancellation. A restart will never
        // resume inference or reset the original deadline after this point.
        await api('progress',{...identity,phase:'reconciling'});
        if(promptId){
          let cancelled=false;
          try{cancelled=await adapter.cancelAndVerify(promptId);}catch(cancelError){if(!shutdownRequired)throw cancelError;}
          // A broken inference API must not prevent the control-plane stop.
          if(shutdownRequired&&!await shutdown())return {status:'deferred',reason:'SHUTDOWN_UNCONFIRMED'};
          if(!cancelled){
            if(await recover())return {status:'succeeded',recovered:true};
            return {status:'deferred',reason:'CANCELLATION_UNCONFIRMED'};
          }
          if(await recover())return {status:'succeeded',recovered:true};
        } else if(job.submissionStarted||error.message==='AMBIGUOUS_SUBMISSION'){
          // Unknown acknowledgement: the provider TTL bounds any orphan job.
          // Retain the reservation until that deadline; do not generate again.
          if(clock.now()<deadlineAt)return {status:'deferred',reason:'AMBIGUOUS_SUBMISSION'};
        }
        if(shutdownRequired&&!await shutdown())return {status:'deferred',reason:'SHUTDOWN_UNCONFIRMED'};
        await api('fail',identity);
        return {status:'failed',reason:error.message};
      } catch {return {status:'deferred',reason:'RECONCILIATION_UNAVAILABLE'};}
    }
    if(promptId && adapter.cancel) await adapter.cancel(promptId).catch(()=>{});
    // If completion succeeded but the response was lost, this is idempotent and does not refund it.
    if (!leaseLost && error.code !== 'SUBMISSION_ALREADY_STARTED') await api('fail', identity).catch(() => {});
    console.error(`job_failed ${job.id} ${error.code === 'LEASE_LOST' ? 'LEASE_LOST' : 'see_backend_status'}`);
  } finally { clock.clearInterval(interval); }
}
export async function main() {
  if(process.env.H3_SERVERLESS_ENDPOINT_ID&&!process.env.RUNPOD_CONTROL_API_KEY)throw Error('H3_SHUTDOWN_CREDENTIAL_REQUIRED');
  const api = createApi({ appUrl:process.env.CREATIVE_RUSH_URL, token:process.env.GENERATION_WORKER_TOKEN,
    workerId:workerInstanceId(process.env.H3_WORKER_ID) });
  const adapter = process.env.H3_SERVERLESS_ENDPOINT_ID
    ? new H3ServerlessAdapter({endpointId:process.env.H3_SERVERLESS_ENDPOINT_ID,apiKey:process.env.RUNPOD_SERVERLESS_API_KEY,controlApiKey:process.env.RUNPOD_CONTROL_API_KEY})
    : new H3Adapter(process.env.COMFY_URL || 'http://127.0.0.1:8188');
  let stopping = false;
  for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => { stopping = true; });
  while (!stopping) {
    try {
      await api('sweep');
      const {job}=await claimReadyJob(api,adapter);
      if (job) {
        const outcome=await processJob(job, api, adapter);
        if(outcome?.status==='deferred')await delay(10000);
      } else await delay(5000);
    } catch { console.error('worker_not_ready_retrying'); await delay(10000); }
  }
}
export function workerInstanceId(base){
  if(!/^[a-zA-Z0-9_-]{1,80}$/.test(base||''))throw Error('Worker configuration missing');
  // Overlapping deploys must not share a lease identity. A new instance can
  // adopt the previous submission only after the previous lease expires.
  return base.slice(0,43)+'_'+crypto.randomUUID();
}
export async function claimReadyJob(api,adapter){
  // A broken GPU deployment must not block recovery of an already uploaded clip.
  if(adapter.directUpload){
    const pending=await api('claim',{backend:'serverless',recoverOnly:true});
    if(pending.job)return pending;
  }
  await adapter.ready();
  return api('claim',{backend:adapter.directUpload?'serverless':'comfy'});
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => { console.error('Invalid worker configuration'); process.exitCode = 1; });
