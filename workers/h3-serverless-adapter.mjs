import {H3Adapter} from './h3-adapter.mjs';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
// Runs on CPU. Endpoint health, not a warm GPU, controls queue availability.
export class H3ServerlessAdapter {
  constructor({endpointId,apiKey,fetchImpl=fetch}) {
    if(!/^[a-zA-Z0-9]{8,40}$/.test(endpointId||'')||!apiKey)throw Error('H3_SERVERLESS_CONFIG');
    this.endpointId=endpointId;this.key=apiKey;this.fetch=fetchImpl;this.directUpload=true;
  }
  async request(path,body) {
    const response=await this.fetch(`https://api.runpod.ai/v2/${this.endpointId}/${path}`,{
      ...(body?{method:'POST',body:JSON.stringify(body)}:{}),
      headers:{authorization:`Bearer ${this.key}`,'content-type':'application/json'},
      redirect:'error',signal:AbortSignal.timeout(25000),
    });
    if(!response.ok)throw Error('H3_SERVERLESS_UNAVAILABLE');
    return response.json();
  }
  async ready(){await this.request('health');}
  async build(job,{uploadUrl}={}) {
    // Run exactly the same validation as the GPU graph, without downloading media.
    await new H3Adapter('http://127.0.0.1:8188').build({...job,referenceUrl:null});
    if(!uploadUrl)throw Error('UPLOAD_REQUIRED');
    return {job:{id:job.id,prompt:job.prompt,durationSeconds:job.durationSeconds,
      resolution:job.resolution,aspectRatio:job.aspectRatio,referenceUrl:job.referenceUrl||null},uploadUrl};
  }
  async submit(input) {
    // Never retry POST /run: a lost acknowledgement is not proof of rejection.
    const response=await this.request('run',{input,policy:{executionTimeout:1200000,ttl:1800000}});
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
  async wait(id,assertLease,{timeoutMs=1500000,pollMs=4000}={}) {
    const jobId=this.jobId(id),start=Date.now();let lastSuccess=start;
    while(Date.now()-start<timeoutMs){
      assertLease();let status;
      try{status=await this.request(`status/${jobId}`);lastSuccess=Date.now();}
      catch(error){if(Date.now()-lastSuccess>120000)throw error;await delay(pollMs);continue;}
      if(status.status==='COMPLETED'){
        const out=status.output;
        if(out?.error||out?.uploaded!==true||!Number.isInteger(out.bytes)||out.bytes<8||out.bytes>52428800
          ||!/^[a-f0-9]{64}$/.test(out.sha256||''))throw Error('H3_SERVERLESS_INVALID_OUTPUT');
        return {...out,executionMs:status.executionTime||0,queueMs:status.delayTime||0};
      }
      if(['FAILED','CANCELLED','TIMED_OUT'].includes(status.status))throw Error('H3_SERVERLESS_JOB_FAILED');
      await delay(pollMs);
    }
    throw Error('H3_SERVERLESS_TIMEOUT');
  }
}
