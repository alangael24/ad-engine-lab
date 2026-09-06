// Server-owned H3 graph, based on the verified Nebula production workflow.
import {readFileSync} from 'node:fs';
const template = JSON.parse(readFileSync(new URL('./workflows/h3.json', import.meta.url), 'utf8'));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
export class H3Adapter {
  constructor(baseUrl, { fetchImpl = fetch } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, ''); this.fetch = fetchImpl;
    const parsed = new URL(this.baseUrl);
    if (!['http:','https:'].includes(parsed.protocol)) throw new Error('Invalid ComfyUI URL');
  }
  async json(resource, body) {
    const response = await this.fetch(`${this.baseUrl}${resource}`, {
      ...(body ? { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}),
      signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) throw new Error('ComfyUI request failed');
    return response.json();
  }
  async ready() { await this.json('/system_stats'); }
  async build(job) {
    if (![5,10,15].includes(job.durationSeconds) || !['480p','720p'].includes(job.resolution)
      || !['9:16','16:9','1:1'].includes(job.aspectRatio) || typeof job.prompt !== 'string'
      || job.prompt.length < 8 || job.prompt.length > 1600) throw new Error('Invalid H3 job');
    const graph = structuredClone(template.prompt);
    // Narration is assembled separately; omit the audio decoder to save RAM.
    delete graph['23']; delete graph['24']; delete graph['91'].inputs.audio;
    const short = job.resolution === '720p' ? 736 : 480;
    const long = job.resolution === '720p' ? 1312 : 832;
    const [width,height] = job.aspectRatio === '9:16' ? [short,long] : job.aspectRatio === '16:9' ? [long,short] : [short,short];
    graph['104'].inputs = {...graph['104'].inputs,width,height,length:job.durationSeconds*24,
      prompt:job.prompt};
    graph['15'].inputs.noise_seed = Math.floor(Math.random()*2147483647);
    graph['92'].inputs.filename_prefix = 'creativerush/h3';
    graph['119'] = {class_type:'LoraLoaderModelOnly',inputs:{model:['6',0],lora_name:'minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors',strength_model:1}};
    graph['120'] = {class_type:'MiniMaxH3SigmaShift',inputs:{model:['119',0],shift_video:12,shift_audio:3}};
    graph['16'].inputs.model = ['120',0];
    Object.assign(graph['9'].inputs,{model:['120',0],steps:8});
    graph['17'].inputs.sampler_name = 'euler';
    if (job.referenceUrl) {
      const response = await this.fetch(job.referenceUrl, {redirect:'error',signal:AbortSignal.timeout(60000)});
      if (!response.ok) throw new Error('Reference download failed');
      const mime=(response.headers.get('content-type')||'').split(';')[0];
      if (!['image/png','image/jpeg','image/webp'].includes(mime) || Number(response.headers.get('content-length'))>6291456) throw new Error('Invalid reference');
      const reader=response.body.getReader(),parts=[];let size=0;
      while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>6291456){await reader.cancel();throw new Error('Invalid reference');}parts.push(value);}
      if(!size)throw new Error('Invalid reference');
      const form=new FormData(),extension={'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[mime];
      form.set('image',new Blob(parts,{type:mime}),`reference-${crypto.randomUUID()}.${extension}`);form.set('overwrite','false');
      const upload=await this.fetch(`${this.baseUrl}/upload/image`,{method:'POST',body:form,signal:AbortSignal.timeout(60000)});
      if(!upload.ok)throw new Error('Image upload failed');
      const media=await upload.json();if(typeof media.name!=='string'||!media.name)throw new Error('Invalid image upload');
      graph['200']={class_type:'LoadImage',inputs:{image:[media.subfolder,media.name].filter(Boolean).join('/'),upload:'image'}};
      graph['104'].inputs.first_frame=['200',0];
    }
    return {prompt:graph};
  }
  async submit(workflow, jobId) {
    const response = await this.json('/prompt', { ...workflow, extra_data: { ...workflow.extra_data, creativeRushJobId: jobId } });
    if (!response.prompt_id) throw new Error('H3 did not accept prompt');
    return response.prompt_id;
  }
  async findSubmission(jobId) {
    const queue = await this.json('/queue');
    // Comfy queue tuple: [number, prompt_id, prompt, extra_data, outputs_to_execute].
    const queued = [...(queue.queue_running || []), ...(queue.queue_pending || [])]
      .find(row => row[3]?.creativeRushJobId === jobId);
    if (queued) return queued[1];
    const history = await this.json('/history?max_items=200');
    return Object.entries(history).find(([,record]) => record.prompt?.[3]?.creativeRushJobId === jobId)?.[0] || null;
  }
  async wait(promptId, assertLease, { timeoutMs = 40 * 60 * 1000, pollMs = 4000 } = {}) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      assertLease();
      const history = await this.json(`/history/${encodeURIComponent(promptId)}`);
      const record = history[promptId];
      if (record?.status?.status_str === 'error') throw new Error('H3 generation failed');
      const media = findVideo(record?.outputs);
      if (media && record?.status?.completed !== false) return this.download(media);
      await delay(pollMs);
    }
    throw new Error('H3 generation timed out');
  }
  async download(media) {
    const query = new URLSearchParams({ filename:media.filename, subfolder:media.subfolder || '', type:media.type || 'output' });
    const response = await this.fetch(`${this.baseUrl}/view?${query}`, { signal:AbortSignal.timeout(90000) });
    if (!response.ok || Number(response.headers.get('content-length')) > 52428800) throw new Error('Invalid H3 result');
    // Bound streaming memory even when the upstream omits Content-Length.
    const reader = response.body.getReader(); const parts = []; let size = 0;
    while (true) { const {value,done} = await reader.read(); if (done) break;
      size += value.length; if (size > 52428800) { await reader.cancel(); throw new Error('H3 result too large'); } parts.push(value); }
    const blob = new Blob(parts, { type:'video/mp4' });
    if (new TextDecoder().decode(await blob.slice(4,8).arrayBuffer()) !== 'ftyp') throw new Error('H3 output is not MP4');
    return blob;
  }
}
export function findVideo(value) {
  if (!value || typeof value !== 'object') return null;
  if (typeof value.filename === 'string' && value.filename.toLowerCase().endsWith('.mp4')) return value;
  for (const child of Object.values(value)) { const found = findVideo(child); if (found) return found; }
  return null;
}
