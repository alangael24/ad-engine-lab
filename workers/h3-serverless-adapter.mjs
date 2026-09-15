import {H3Adapter} from './h3-adapter.mjs';
import {H3_LIMITS,realClock} from '../src/h3-lifecycle.js';
// Runs on CPU. Endpoint health, not a warm GPU, controls queue availability.
export class H3ServerlessAdapter {
  constructor({endpointId,apiKey,controlApiKey,fetchImpl=fetch,clock=realClock}) {
    if(!/^[a-zA-Z0-9]{8,40}$/.test(endpointId||'')||!apiKey)throw Error('H3_SERVERLESS_CONFIG');
    this.endpointId=endpointId;this.key=apiKey;this.controlKey=controlApiKey;this.fetch=fetchImpl;this.directUpload=true;this.clock=clock;
  }
  async request(path,body) {
    const response=await this.fetch(`https://api.runpod.ai/v2/${this.endpointId}/${path}`,{
      ...(body?{method:'POST',body:JSON.stringify(body)}:{}),
      headers:{authorization:`Bearer ${this.key}`,'content-type':'application/json'},
      redirect:'error',signal:AbortSignal.timeout(25000),
    });
    if(!response.ok){
      const detail=await response.json().catch(()=>null);
      throw Object.assign(Error('H3_SERVERLESS_UNAVAILABLE'),{httpStatus:response.status,
        providerCode:detail?.code,retryable:response.status!==404});
    }
    return response.json();
  }
  async ready(){
    const health=await this.request('health'),w=health.workers||{};
    if(w.unhealthy>0 && !(w.initializing||w.ready||w.running||w.idle))throw Error('H3_SERVERLESS_UNHEALTHY');
  }
  async build(job,{uploadUrl}={}) {
    // Run exactly the same validation as the GPU graph, without downloading media.
    await new H3Adapter('http://127.0.0.1:8188').build({...job,referenceUrl:null});
    if(!uploadUrl)throw Error('UPLOAD_REQUIRED');
    return {job:{id:job.id,prompt:job.prompt,durationSeconds:job.durationSeconds,
      resolution:job.resolution,aspectRatio:job.aspectRatio,referenceUrl:job.referenceUrl||null},uploadUrl};
  }
  async submit(input,_jobId,{assertLease=()=>{}}={}) {
    // Only an explicit paused-endpoint rejection proves no job was accepted.
    // Control-plane activation can precede runtime propagation by a few seconds.
    // Never retry a lost acknowledgement, generic 409, timeout or 5xx response.
    let response;
    for(let attempt=0;attempt<4;attempt++){
      assertLease();
      try{
        response=await this.request('run',{input,policy:{executionTimeout:H3_LIMITS.executionMs,ttl:H3_LIMITS.providerTtlMs}});
        break;
      }catch(error){
        if(error.httpStatus!==409||error.providerCode!=='ENDPOINT_PAUSED'||attempt===3)throw error;
        await this.clock.sleep(5000);
      }
    }
    if(!/^[a-zA-Z0-9_-]{1,100}$/.test(response.id||''))throw Error('H3_SERVERLESS_INVALID_ID');
    return `rp:${this.endpointId}:${response.id}`;
  }
  jobId(id) {
    const match=/^rp:([a-zA-Z0-9]{8,40}):([a-zA-Z0-9_-]{1,100})$/.exec(id||'');
    if(!match||match[1]!==this.endpointId)throw Error('H3_PROVIDER_MISMATCH');
    return match[2];
  }
  // Runpod cannot recover an unknown job ID by our metadata. Fail closed.
  async findSubmission(){return null;}
  async cancel(id){await this.request(`cancel/${this.jobId(id)}`,{});}
  async cancelAndVerify(id) {
    const jobId=this.jobId(id);
    try { await this.cancel(id); } catch(error) { if(error.httpStatus!==404)throw error; }
    try {
      const state=await this.request(`status/${jobId}`);
      return ['CANCELLED','FAILED','TIMED_OUT'].includes(state.status);
    } catch(error) { if(error.httpStatus===404)return true;throw error; }
  }
  async shutdownAndVerify(assertLease=()=>{}){
    if(!this.controlKey)throw Error('H3_SHUTDOWN_CREDENTIAL_REQUIRED');
    const control=async(path='',body)=>{
      assertLease();
      const response=await this.fetch(`https://api.runpod.io/v2/serverless/${this.endpointId}${path}`,{
        ...(body?{method:'PATCH',body:JSON.stringify(body)}:{}),
        headers:{authorization:`Bearer ${this.controlKey}`,'content-type':'application/json'},
        redirect:'error',signal:AbortSignal.timeout(25000),
      });
      if(!response.ok)throw Error('H3_SHUTDOWN_UNCONFIRMED');
      return response.json();
    };
    // This dedicated endpoint may only be scaled DOWN. Never change its GPU,
    // image, environment or min/max upward. An acknowledgement is not proof.
    const before=await control();
    if(before.workers?.min!==0||before.workers?.max!==0){
      try{await control('',{workers:{min:0,max:0}});}catch{/* A lost PATCH ack may still have applied. Read it back. */}
    }
    const endpoint=await control(),workers=await control('/workers'),health=await this.request('health');
    assertLease();
    return endpoint.workers?.min===0&&endpoint.workers?.max===0
      &&workers.summary?.total===0&&Array.isArray(workers.workers)&&workers.workers.length===0
      &&health.jobs?.inQueue===0&&health.jobs?.inProgress===0;
  }
  async wait(id,assertLease,{pollMs=4000,submittedAt,executionStartedAt,deadlineAt,onProgress=async()=>{}}={}) {
    const jobId=this.jobId(id),start=submittedAt??this.clock.now();
    const hardDeadline=deadlineAt??start+H3_LIMITS.providerTtlMs;
    let lastSuccess=this.clock.now(),executionStart=executionStartedAt??null;
    while(this.clock.now()<hardDeadline){
      assertLease();let status;
      try{status=await this.request(`status/${jobId}`);lastSuccess=this.clock.now();}
      catch(error){
        if(error.httpStatus===404)throw Object.assign(Error('H3_SERVERLESS_RESULT_UNAVAILABLE'),{retryable:true});
        if(this.clock.now()-lastSuccess>120000)throw Object.assign(error,{retryable:true});
        await this.clock.sleep(pollMs);continue;
      }
      if(status.status==='COMPLETED'){
        const out=status.output;
        if(out?.error||out?.uploaded!==true||!Number.isInteger(out.bytes)||out.bytes<8||out.bytes>52428800
          ||!/^[a-f0-9]{64}$/.test(out.sha256||''))throw Error('H3_SERVERLESS_INVALID_OUTPUT');
        return {...out,executionMs:status.executionTime||0,queueMs:status.delayTime||0};
      }
      if(['FAILED','CANCELLED','TIMED_OUT'].includes(status.status))throw Error('H3_SERVERLESS_JOB_FAILED');
      if(status.status==='IN_PROGRESS'){
        if(executionStart===null){
          executionStart=this.clock.now()-Math.min(Math.max(Number(status.executionTime)||0,0),H3_LIMITS.executionMs);
          await onProgress('generating');
        }
        if(this.clock.now()-executionStart>=H3_LIMITS.executionMs)throw Error('H3_SERVERLESS_EXECUTION_TIMEOUT');
      } else if(status.status==='IN_QUEUE'){
        if(executionStart!==null)throw Error('H3_SERVERLESS_UNEXPECTED_RETRY');
        if(this.clock.now()-start>=H3_LIMITS.preparationMs)throw Error('H3_SERVERLESS_PREPARATION_TIMEOUT');
      } else throw Object.assign(Error('H3_SERVERLESS_UNKNOWN_STATUS'),{retryable:true});
      await this.clock.sleep(pollMs);
    }
    throw Error('H3_SERVERLESS_TIMEOUT');
  }
}
