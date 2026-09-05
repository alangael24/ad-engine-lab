export function chatPanel({api,task,getProject,isDirty,refresh,tell}){
 const $=s=>document.querySelector(s),log=$('#chat-history'),form=$('#chat-form'),input=$('#chat-input'),scriptCard=$('#chat-script'),scriptText=$('#chat-script-text');
 let projectId=null,available=false,rows=[],poll=null,inFlight=false,view=0,deliveryNote='',polls=0,followLatest=true,streamNodes=null;
 const drafts=new Map(),key=id=>'studio-chat:'+id;
 const pending=id=>{try{return JSON.parse(sessionStorage.getItem(key(id)));}catch{return null;}};
 const saveDraft=(id,value)=>{drafts.set(id,value);try{sessionStorage.setItem(key(id)+':draft',value);}catch{}};
 const active=()=>getProject()?.id===projectId;
 function line(text,kind){const p=document.createElement('p');p.className='chat-message '+kind;p.textContent=text;log.append(p);return p;}
 function busyLine(text){const p=line(text,'detail chat-working');p.setAttribute('role','status');}
 function streaming(event,id){
  if(projectId!==id||!active())return;
  if(!streamNodes){
   log.querySelectorAll('.chat-working').forEach(n=>n.remove());
   const root=document.createElement('article');root.className='chat-streaming';root.setAttribute('aria-label','Respuesta en curso');
   const message=document.createElement('p');message.className='chat-message assistant';
   const script=document.createElement('p');script.className='stream-script';script.hidden=true;root.append(message,script);log.append(root);
   streamNodes={root,message,script,text:{message:'',script:''}};
  }
  streamNodes.text[event.field]+=event.text;
  const text=streamNodes.text[event.field],lastSpace=Math.max(text.lastIndexOf(' '),text.lastIndexOf('\n'));
  // Reveal complete words as they arrive; no timer or simulated typing.
  streamNodes[event.field].textContent=lastSpace>=0?text.slice(0,lastSpace+1):'';
  if(event.field==='script'){streamNodes.script.hidden=false;scriptCard.hidden=true;}
  if(followLatest)reveal();
 }
 function controls(){const waiting=pending(projectId)||rows.some(r=>r.status==='running');$('#chat-send').disabled=!available||Boolean(waiting)||inFlight;$('#chat-recover').hidden=!waiting||inFlight;$('#chat-recover').textContent='Comprobar respuesta';$('#chat-status').textContent=!available?'Asistente temporalmente sin conexión.':waiting?'Puedes escribir tu siguiente mensaje mientras termino.':'';}
 function paint(){
  const script=getProject()?.data.scriptDraft?.trim();scriptCard.hidden=!script;scriptText.textContent=script||'';
  log.replaceChildren();const request=pending(projectId),idea=getProject()?.data.idea;
  $('#project-idea').hidden=rows.some(r=>r.message===idea)||request?.message===idea;
  $('#project-idea').parentElement.hidden=$('#project-idea').hidden;
  const scriptRow=rows.findLastIndex(r=>r.status==='succeeded'&&['draft_script','set_hook'].includes(r.result?.operation));
  if(!rows.length&&!request)line('Tengo el contexto de tu producto. Dime qué quieres crear o cambiar.','assistant');
  for(const [index,r] of rows.entries()){line(r.message,'user');if(r.status==='succeeded'){
   line(r.result.message,'assistant');if(index===scriptRow&&script)log.append(scriptCard);
   if(r.result.operation==='set_look'||r.result.operation==='edit_scene')line('La dirección está actualizada. El video cambiará al producir las nuevas tomas.','detail');
   if(r.result.renderError)line(({STUDIO_WORKER_OFFLINE:'El montaje está temporalmente sin conexión.',STUDIO_RENDER_BUSY:'Tu montaje está esperando a que terminen los anteriores.',STUDIO_NARRATION_REQUIRED:'El cambio está guardado. Falta la narración para montarlo.',STUDIO_AUDIO_TIMING:'El cambio está guardado. El audio necesita sincronizarse antes del montaje.',STUDIO_NOT_READY:'El cambio está guardado. Faltan tomas para montar el video.',STUDIO_CLIP_TOO_SHORT:'El cambio está guardado. Una toma necesita más duración.'}[r.result.renderError]||'El cambio está guardado; todavía no pude montar el video.'),'detail');
  }else if(r.status==='running')busyLine('Estoy trabajando en tu anuncio…');
  else line(r.status==='uncertain'?'No pude confirmar esta respuesta. Tu anuncio conserva la última versión guardada.':r.result?.message||'No pude completar este cambio. Tu anuncio se conservó.','detail');}
  if(request&&!rows.some(r=>r.id===request.requestId)){line(request.message,'user');busyLine(deliveryNote||'Estoy trabajando en tu anuncio…');}
  else if(deliveryNote)line(deliveryNote,'detail');
  if(scriptRow<0&&script)log.append(scriptCard);controls();
 }
 const reveal=()=>requestAnimationFrame(()=>{if(active())window.scrollTo({top:document.documentElement.scrollHeight});});
 window.addEventListener('scroll',()=>{followLatest=window.innerHeight+window.scrollY>=document.documentElement.scrollHeight-120;},{passive:true});
 function stop(){clearTimeout(poll);view++;}
 function schedule(id){clearTimeout(poll);if(!pending(id)&&!rows.some(r=>r.status==='running'))return;if(polls++>=30)return;poll=setTimeout(async()=>{if(projectId!==id||!active()||inFlight)return;try{await sync(id);}catch{deliveryNote='La conexión se interrumpió. Estoy comprobando si tu respuesta quedó guardada.';paint();schedule(id);}},3500);}
 async function sync(id){
  const expectedView=view,d=await api('/api/studio-chat?project='+id);
  if(expectedView!==view||projectId!==id||!active())return;
  available=d.enabled;rows=d.edits;
  const request=pending(id),saved=request&&rows.find(r=>r.id===request.requestId),wasPending=Boolean(request);
  if(saved&&saved.status!=='running'){sessionStorage.removeItem(key(id));deliveryNote='';}
  paint();schedule(id);
  if(wasPending&&saved&&saved.status!=='running'){const follow=followLatest;await refresh(id);if(follow)reveal();}
 }
 async function open(p){
  if(projectId!==p.id){if(projectId)saveDraft(projectId,input.value);stop();projectId=p.id;rows=[];deliveryNote='';polls=0;input.value=drafts.get(p.id)||sessionStorage.getItem(key(p.id)+':draft')||'';}
  await sync(p.id);
 }
 async function send(message){
  if(!available||inFlight||!active())return;
  if(isDirty()){tell('Guarda los cambios de los detalles antes de continuar en el chat.',true);return;}
  const p=getProject(),id=p.id;message=message.trim();if(!message)return;
  const existing=pending(id);
  if(existing&&existing.message!==message){await sync(id);return;}
  const request=existing||{projectId:id,expected:p.revision,requestId:crypto.randomUUID(),message};
  sessionStorage.setItem(key(id),JSON.stringify(request));if(!existing){input.value='';input.style.height='auto';saveDraft(id,'');}polls=0;inFlight=true;streamNodes=null;deliveryNote='';paint();
  followLatest=true;reveal();
  try{
   const r=await api('/api/studio-chat',{method:'POST',body:request,onDelta:event=>streaming(event,id)});
   if(r.edit.status!=='running')sessionStorage.removeItem(key(id));
   if(projectId===id&&active()){rows=rows.filter(x=>x.id!==r.edit.id).concat(r.edit);const follow=followLatest;await refresh(id);if(follow)reveal();}
  }catch(e){
   // A lost response never creates a second request identity. Read persisted state first.
   if(['CHAT_OFFLINE','CHAT_LIMIT','STUDIO_CONFLICT','CHAT_BUSY','PRODUCTION_BUSY','UNAUTHORIZED','STUDIO_NOT_FOUND'].includes(e.code)){
    sessionStorage.removeItem(key(id));if(projectId===id){deliveryNote=e.message;if(!input.value){input.value=message;saveDraft(id,message);}}
   }else if(projectId===id)deliveryNote='La conexión se interrumpió. Estoy comprobando si tu respuesta quedó guardada.';
   if(projectId===id&&active())try{await sync(id);}catch{}
  }finally{streamNodes=null;inFlight=false;if(projectId===id&&active()){paint();schedule(id);input.focus({preventScroll:true});}}
 }
 form.onsubmit=e=>{e.preventDefault();task(()=>send(input.value));};
 $('#chat-recover').onclick=()=>task(async()=>{
  const id=projectId;await sync(id);const request=pending(id);
  // Explicit retry reuses the exact payload; server idempotency prevents duplicate work.
  if(request&&!rows.some(r=>r.id===request.requestId))await send(request.message);
 });
 const resize=()=>{input.style.height='auto';input.style.height=Math.min(input.scrollHeight,180)+'px';};
 input.addEventListener('input',()=>{saveDraft(projectId,input.value);resize();});
 input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&matchMedia('(pointer:fine)').matches){e.preventDefault();if(!$('#chat-send').disabled)form.requestSubmit();}});
 return {open,stop,send};
}
