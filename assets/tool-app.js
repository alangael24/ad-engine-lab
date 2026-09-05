import { apiRequest, onAccountChange, setCredits } from './tool-account.js';
const $ = selector => document.querySelector(selector);
const prompt = $('#scene-prompt'), generate = $('#generate-button');
let session = null, available = false, balance = 0, sending = false, timer, refreshVersion = 0;
let reference = null, referenceUrl = null, referenceId = null, pendingId = null;
let jobs = [], jobSignature = '', loading = false;
const statuses = { queued:'En cola', running:'Generando', succeeded:'Listo', failed:'Saldo devuelto', canceled:'Cancelado · saldo devuelto' };
const options = () => ({ durationSeconds:Number($('#duration-select').value), resolution:$('#resolution-select').value, aspectRatio:$('#ratio-select').value });
function notify(text, tone = 'neutral') { $('#status-text').textContent = text; $('#prepared-status').dataset.tone = tone; $('#prepared-status').classList.add('is-visible'); }
function update() {
  const cost = options().durationSeconds / 5;
  $('#char-count').textContent = `${prompt.value.length} / 1600`;
  $('#generation-cost').textContent = sending ? 'Enviando…' : `Usa ${cost} ${cost === 1 ? 'clip' : 'clips'} de tu saldo`;
  generate.disabled = !session || !available || sending || prompt.value.trim().length < 8 || balance < cost;
  generate.setAttribute('aria-label', `Generar video · ${cost} ${cost === 1 ? 'clip' : 'clips'} de saldo`);
}
function changed() { pendingId = null; update(); }
function clearReference() {
  reference = null; referenceId = null; $('#reference-file').value = '';
  if (referenceUrl) URL.revokeObjectURL(referenceUrl); referenceUrl = null;
  $('#reference-image').removeAttribute('src'); $('#reference-preview').classList.remove('is-visible'); changed();
}
function setReference(file) {
  if (!file || !['image/png','image/jpeg','image/webp'].includes(file.type) || file.size > 6291456) {
    notify('Usa una foto JPG, PNG o WebP de hasta 6 MB.', 'error'); return;
  }
  clearReference(); reference = file; referenceUrl = URL.createObjectURL(file);
  $('#reference-image').src = referenceUrl; $('#reference-preview').classList.add('is-visible'); changed();
}
function element(tag, text, className) { const node = document.createElement(tag); if (text) node.textContent = text; if (className) node.className = className; return node; }
function action(label, callback) { const button = element('button',label); button.type = 'button'; button.addEventListener('click', async () => {
  button.disabled = true; try { await callback(); } catch(error) { notify(error.message,'error'); } finally { button.disabled = false; }
}); return button; }
function useJob(job) {
  prompt.value = job.prompt; $('#duration-select').value = job.durationSeconds; $('#resolution-select').value = job.resolution;
  $('#ratio-select').value = job.aspectRatio; clearReference(); changed(); prompt.focus();
  if (job.hasReference) notify('Para volver a usar esta idea, adjunta de nuevo tu imagen de referencia.');
}
function renderJobs() {
  const signature = JSON.stringify(jobs);
  if (signature === jobSignature) return; jobSignature = signature;
  const results = $('#generation-results'), recent = $('#recent-list'); results.replaceChildren(); recent.replaceChildren();
  if (!jobs.length) { results.append(element('p','Todavía no has generado videos.')); recent.append(element('p','Tus videos aparecerán aquí.','recent-empty')); return; }
  for (const job of jobs) {
    const card = element('article',null,'job-card'); card.dataset.status = job.status;
    card.append(element('span',statuses[job.status] || job.status,'job-status'), element('h3',job.prompt),
      element('p',`${job.durationSeconds} s · ${job.resolution} · ${job.aspectRatio} · ${job.creditCost} clips de saldo`));
    const actions = element('div',null,'job-actions');
    if (job.status === 'succeeded') {
      actions.append(action('Ver video', async () => {
        const revision = refreshVersion;
        const result = await apiRequest(`/api/generations/${job.id}`);
        if (revision !== refreshVersion) return;
        let video = card.querySelector('video');
        if (!video) { video = element('video'); video.controls = true; video.playsInline = true; card.insertBefore(video,actions); }
        video.src = result.resultUrl; await video.play().catch(() => {});
      }), action('Descargar', async () => {
        const revision = refreshVersion;
        const result = await apiRequest(`/api/generations/${job.id}?download=1`);
        if (revision !== refreshVersion) return;
        const link = element('a'); link.href = result.resultUrl; link.rel = 'noopener'; link.download = `CreativeRush-${job.id}.mp4`; link.click();
      }));
    }
    if (job.status === 'queued') actions.append(action('Cancelar', async () => {
      await apiRequest(`/api/generations/${job.id}`, { method:'DELETE' }); await refresh();
    }));
    actions.append(action('Usar esta idea', () => useJob(job)));
    if (job.error) card.append(element('p',job.error));
    card.append(actions); results.append(card);
  }
  jobs.slice(0,8).forEach(job => { const button = action(`${statuses[job.status]} · ${job.prompt.slice(0,32)}`, () => useJob(job)); button.className = 'recent-item'; recent.append(button); });
}
async function refresh() {
  clearTimeout(timer); if (!session || loading) return;
  const revision = refreshVersion; loading = true;
  try {
    const result = await apiRequest('/api/generations'); if (revision !== refreshVersion) return;
    jobs = result.jobs; available = result.available; balance = result.balance.video_credits;
    setCredits(balance, result.balance.image_credits); renderJobs();
    $('#service-status').textContent = available ? 'Tu estudio está listo · videos privados' : 'Generación no disponible · no se descuenta saldo';
    if (balance < options().durationSeconds / 5) notify('No tienes saldo suficiente para esta duración. Elige una duración menor o revisa tu pack.');
  } catch(error) { if (revision === refreshVersion) { available = false; notify(error.message,'error'); $('#service-status').textContent = 'No se pudo conectar con el servicio'; } }
  finally { loading = false; update(); if (session) timer = setTimeout(refresh, available && jobs.some(j => ['queued','running'].includes(j.status)) ? 5000 : 15000); }
}
onAccountChange(next => {
  const changedUser = next?.user.id !== session?.user.id;
  session = next;
  if (changedUser || !next) { refreshVersion++; jobs=[]; jobSignature=''; available=false; balance=0; pendingId=null; clearReference(); renderJobs(); }
  update(); if (next) refresh(); else clearTimeout(timer);
});
prompt.addEventListener('input',changed);
['#duration-select','#resolution-select','#ratio-select'].forEach(selector => $(selector).addEventListener('change',changed));
$('#reference-file').addEventListener('change',event => setReference(event.target.files?.[0]));
$('#remove-reference').addEventListener('click',clearReference);
$('#assets-button').addEventListener('click',() => $('#reference-file').click());
const composer = $('#composer');
['dragenter','dragover'].forEach(name => composer.addEventListener(name,event => { event.preventDefault(); composer.classList.add('is-dragging'); }));
['dragleave','drop'].forEach(name => composer.addEventListener(name,event => { event.preventDefault(); composer.classList.remove('is-dragging'); }));
composer.addEventListener('drop',event => setReference(event.dataTransfer.files[0]));
['#new-project','#mobile-new'].forEach(selector => $(selector)?.addEventListener('click',() => { prompt.value=''; clearReference(); update(); prompt.focus(); }));
generate.addEventListener('click',async () => {
  if (generate.disabled) return;
  sending=true; pendingId ||= crypto.randomUUID(); update();
  const revision=refreshVersion, requestId=pendingId, selectedReference=reference;
  const payload={ requestId, prompt:prompt.value.trim(), ...options() };
  try {
    let uploadedId=referenceId;
    if (selectedReference && !uploadedId) {
      uploadedId=(await apiRequest('/api/references',{ method:'POST', body:selectedReference, raw:true })).referenceId;
      if (reference === selectedReference) referenceId=uploadedId;
    }
    if (revision !== refreshVersion) return;
    await apiRequest('/api/generations',{ method:'POST',body:{...payload,referenceId:uploadedId || null} });
    if (revision !== refreshVersion) return;
    if (pendingId === requestId) pendingId=null;
    notify('Tu video está en cola. Puedes cerrar la pestaña; lo encontrarás aquí cuando termine.'); await refresh();
  } catch(error) { if (revision === refreshVersion) notify(`${error.message} Si hubo un problema de conexión, pulsa de nuevo: no se cobrará dos veces la misma solicitud.`,'error'); }
  finally { sending=false; update(); }
});
prompt.addEventListener('keydown',event => { if ((event.ctrlKey || event.metaKey) && event.key==='Enter') { event.preventDefault(); generate.click(); } });
document.addEventListener('visibilitychange',() => { if (!document.hidden && session) refresh(); });
update();
