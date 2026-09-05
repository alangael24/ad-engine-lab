// Uses the existing, tested H3 helper. Never accepts workflow JSON from a customer.
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
    const form = new FormData();
    form.set('prompt', job.prompt); form.set('duration', String(job.durationSeconds));
    form.set('resolution', job.resolution.replace('p',''));
    form.set('aspect', { '9:16':'portrait', '16:9':'landscape', '1:1':'square' }[job.aspectRatio]);
    form.set('preset','turbo8');
    if (job.referenceUrl) {
      const response = await this.fetch(job.referenceUrl, { signal: AbortSignal.timeout(60000) });
      if (!response.ok) throw new Error('Reference download failed');
      const blob = await response.blob();
      if (blob.size > 6291456 || !['image/png','image/jpeg','image/webp'].includes(blob.type)) throw new Error('Invalid reference');
      const extension = { 'image/png':'png','image/jpeg':'jpg','image/webp':'webp' }[blob.type];
      form.set('image', blob, `reference.${extension}`);
    }
    const response = await this.fetch(`${this.baseUrl}/h3-simple/build`, { method:'POST', body:form, signal:AbortSignal.timeout(90000) });
    if (!response.ok) throw new Error('H3 helper not available');
    const built = await response.json();
    if (!built.workflow?.prompt) throw new Error('Invalid H3 helper workflow');
    return built.workflow;
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
