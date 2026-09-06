import {apiRequest,getAuthClient} from './auth-client.js';
const $=s=>document.querySelector(s);let session=null,sources=[],busy=false,pending=null,enabled=false,historyKey=null;
const note=m=>$('#status').textContent=m;
function paint(){
 const nextHistory=JSON.stringify(session?.history||[]);if(nextHistory!==historyKey){const history=$('#history');history.replaceChildren();for(const row of session?.history||[]){const p=document.createElement('p');p.className=row.role;p.textContent=row.message;history.append(p);}historyKey=nextHistory;}
 $('#intro').hidden=!!session;$('#approve').hidden=session?.status!=='awaiting_approval';$('#approve').disabled=busy||!enabled;
 const running=['planning','editing'].includes(session?.status);$('#send').disabled=busy||running||!enabled;
 $('#footage').disabled=!!session||busy;$('#reference').disabled=!!session||busy;
 if(session?.url){if($('#preview').dataset.output!==session.outputId){$('#preview').src=session.url;$('#preview').dataset.output=session.outputId;}$('#preview').hidden=false;$('#download').hidden=false;$('#download').href=session.url;}
 if(running)note(session.status==='planning'?'Revisando tu material…':'Editando y revisando tu video…');
}
async function refresh(){const d=await apiRequest('/api/video-edit'+(session?'?session='+session.id:''));enabled=d.enabled;if(d.session)session=d.session;paint();if(!enabled)note('El editor está temporalmente sin conexión.');else if(!['planning','editing'].includes(session?.status))note(session?.status==='failed'?'La edición se interrumpió. Puedes pedir otro intento.':'');}
async function upload(file,reference){
 if(file.size>52428800||!file.name.toLowerCase().endsWith('.mp4'))throw Error('Usa archivos MP4 de hasta 50 MB.');
 const duration=await new Promise((yes,no)=>{const v=document.createElement('video'),u=URL.createObjectURL(file);const finish=(e,d)=>{URL.revokeObjectURL(u);clearTimeout(t);e?no(e):yes(d);};const t=setTimeout(()=>finish(Error('No pude leer el video.')),15000);v.onloadedmetadata=()=>finish(null,v.duration);v.onerror=()=>finish(Error('No pude leer el video.'));v.src=u;});
 const c=await getAuthClient(),{data}=await c.auth.getSession();if(!data.session)throw Error('Inicia sesión para guardar tu material.');
 const r=await fetch('/api/studio?upload=1&kind=clip',{method:'POST',headers:{authorization:`Bearer ${data.session.access_token}`,'content-type':'video/mp4','x-file-name':encodeURIComponent(file.name),'x-duration':String(duration)},body:file});const d=await r.json();if(!r.ok)throw Error(d.error);
 sources.push({id:d.asset.id,reference});const chip=document.createElement('span');chip.className='chip';chip.textContent=(reference?'Referencia: ':'')+file.name;$('#files').append(chip);
}
async function task(fn){if(busy)return;busy=true;paint();try{await fn();}catch(e){note(e.message);if(e.code==='UNAUTHORIZED')$('#login').hidden=false;}finally{busy=false;paint();}}
for(const [id,reference] of [['footage',false],['reference',true]])$('#'+id).onchange=()=>task(async()=>{const files=[...$('#'+id).files];if(sources.length+files.length>8)throw Error('Puedes añadir hasta ocho archivos.');for(const file of files){note('Guardando '+file.name+'…');await upload(file,reference);}note('Material guardado. Cuéntame cómo quieres editarlo.');});
async function send(action){
 const message=action==='approve'?'Aprobar propuesta':$('#message').value.trim();if(action!=='approve'&&message.length<3)throw Error('Describe cómo quieres tu video.');if(!session&&!sources.some(s=>!s.reference))throw Error('Añade al menos un clip para editar.');
 const body={action:session?action:'create',sessionId:session?.id||crypto.randomUUID(),expected:session?.revision,message,...(!session?{sources}:{})};
 const key=JSON.stringify({...body,sessionId:session?.id||'new'});if(!pending||pending.key!==key)pending={key,body:{...body,requestId:crypto.randomUUID()}};
 const d=await apiRequest('/api/video-edit',{method:'POST',body:pending.body});session={id:d.sessionId};pending=null;history.replaceState(null,'','?session='+session.id);$('#message').value='';await refresh();
}
$('#composer').onsubmit=e=>{e.preventDefault();task(()=>send('message'));};$('#approve').onclick=()=>task(()=>send('approve'));
const id=new URL(location.href).searchParams.get('session');if(id)session={id};task(refresh);setInterval(()=>{if(!busy&&session)refresh().catch(()=>{});},3000);
