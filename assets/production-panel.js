const stages={queued:'Tu anuncio está en cola.',planning:'Preparando las escenas de tu guion…',narration:'Preparando la narración…',timing:'Sincronizando las escenas con la voz…',images:'Preparando las imágenes…',clips:'Preparando las tomas…',assembly:'Montando tu video y sus subtítulos…',quality:'Revisando las escenas y la narración…',repair:'Ajustando las escenas que lo necesitan…',completed:'Tu video está listo.'};
export function productionPanel({api,task,getProject,isDirty,tell,refresh,getRenders=()=>[]}){
 const root=document.createElement('section');root.className='production-panel';root.setAttribute('aria-label','Producción del anuncio');
 const status=document.createElement('p');status.setAttribute('role','status');
 const button=document.createElement('button');button.type='button';button.className='primary';button.textContent='Aprobar guion y crear video';
 const video=document.createElement('video');video.controls=true;video.playsInline=true;video.hidden=true;video.preload='metadata';
 const download=document.createElement('a');download.textContent='Descargar video';download.className='text-button';download.hidden=true;download.download='CreativeRush.mp4';
 root.append(status,button,video,download);document.querySelector('.chat-composer').before(root);
 let timer,currentId,lastRender,lastCompletedJob,lastSyncedJob,polling=false;
 async function open(p){
  clearTimeout(timer);currentId=p.id;
  const r=await api('/api/studio-production?project='+p.id);if(getProject()?.id!==p.id)return;
  const j=r.productions[0],active=j&&['queued','running'].includes(j.status),render=getRenders().find(x=>x.project_revision===p.revision);
  const syncKey=j&&!active?j.id+':'+j.status:null;
  if(syncKey&&lastSyncedJob!==syncKey&&!isDirty()){lastSyncedJob=syncKey;await refresh(p.id);return;}
  const renderId=render?render.status==='succeeded'?render.id:null:j?.status==='succeeded'?j.renderId:null;
  root.hidden=!j&&!p.data.scriptDraft?.trim()&&!render;
  download.hidden=!renderId;
  button.hidden=Boolean(active)||!r.enabled;button.disabled=!r.enabled||!p.data.scriptDraft?.trim();button.textContent=j?.status==='succeeded'?'Crear otra versión':j&&['failed','uncertain'].includes(j.status)?'Reintentar':'Aprobar guion y crear video';
  status.textContent=j?(j.error||stages[j.stage]||'Preparando tu anuncio…'):(r.enabled?'Revisa el guion. Al aprobarlo, nos encargamos de producir el video.':'Puedes trabajar en el guion. La creación de video todavía no está activada.');
  if(!active&&render&&!j?.error)status.textContent=render.status==='succeeded'?'Tu video está listo.':render.status==='quality_failed'?'El video necesita ajustes antes de entregarlo.':render.status==='reviewing'?'Revisando tu video…':render.status==='failed'?'No pudimos terminar el montaje. Puedes pedir que lo intentemos de nuevo.':'Montando tu video…';
  if(!active&&!render&&renderId)status.textContent='Tu última versión. Los cambios posteriores todavía no aparecen en este video.';
  if(renderId){if(lastRender!==renderId){const media=await api('/api/studio?render='+renderId);if(getProject()?.id!==p.id)return;video.src=media.url;lastRender=renderId;}video.hidden=false;download.onclick=e=>{e.preventDefault();task(async()=>{const media=await api('/api/studio?render='+renderId+'&download=1');const a=document.createElement('a');a.href=media.url;a.download='CreativeRush.mp4';a.rel='noopener';a.click();});};download.href=video.src;if(j?.status==='succeeded'&&lastCompletedJob!==j.id){lastCompletedJob=j.id;await refresh(p.id);return;}}else{video.hidden=true;video.removeAttribute('src');lastRender=null;}
  if(active)timer=setTimeout(async()=>{if(polling||getProject()?.id!==p.id)return;polling=true;try{await open(getProject());}catch{status.textContent='Reconectando con tu producción…';timer=setTimeout(()=>open(getProject()).catch(()=>{}),5000);}finally{polling=false;}},4000);
 }
 button.onclick=()=>task(async()=>{if(isDirty()){tell('Guarda el guion antes de aprobarlo.',true);return;}const p=getProject(),key='studio-production:'+p.id;let request;try{request=JSON.parse(sessionStorage.getItem(key));}catch{}request??={requestId:crypto.randomUUID(),projectId:p.id,expected:p.revision};sessionStorage.setItem(key,JSON.stringify(request));button.disabled=true;
  try{await api('/api/studio-production',{method:'POST',body:request});sessionStorage.removeItem(key);await open(p);}catch(e){if(e.code==='STUDIO_CONFLICT'){sessionStorage.removeItem(key);await refresh(p.id);}else await open(p);throw e;}
 });
 return {open,stop(){clearTimeout(timer);}};
}
