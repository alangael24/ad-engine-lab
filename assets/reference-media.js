import {sampleFrames} from './reference-model.js';
const error=message=>{throw new Error(message);};
function event(target,name,action){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>done(new Error('No pudimos leer el video. Prueba con un MP4 H.264 de hasta 120 segundos.')),15000);const ok=()=>done(),bad=()=>done(new Error('El navegador no puede leer este formato de video.'));function done(e){clearTimeout(timer);target.removeEventListener(name,ok);target.removeEventListener('error',bad);e?reject(e):resolve();}target.addEventListener(name,ok,{once:true});target.addEventListener('error',bad,{once:true});action();});}
function bytesBase64(bytes){let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(s);}
export function monoWav(samples,rate=16000){const buffer=new ArrayBuffer(44+samples.length*2),v=new DataView(buffer);const text=(n,s)=>{for(let i=0;i<s.length;i++)v.setUint8(n+i,s.charCodeAt(i));};text(0,'RIFF');v.setUint32(4,buffer.byteLength-8,true);text(8,'WAVEfmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,rate,true);v.setUint32(28,rate*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);text(36,'data');v.setUint32(40,samples.length*2,true);for(let i=0;i<samples.length;i++){const s=Math.max(-1,Math.min(1,samples[i]));v.setInt16(44+i*2,s<0?s*32768:s*32767,true);}return new Uint8Array(buffer);}
export async function prepareReference(file,{silent=false,progress=()=>{}}={}){
  if(!file||file.size>200*1024*1024||!/^video\//.test(file.type))error('Sube un video de hasta 200 MB y de 2 a 120 segundos.');
  const url=URL.createObjectURL(file),video=document.createElement('video');video.muted=true;video.playsInline=true;video.preload='auto';
  try{
    progress('Leyendo la referencia…');await event(video,'loadeddata',()=>{video.src=url;});
    const duration=video.duration,frames=sampleFrames(duration);if(!video.videoWidth||!video.videoHeight)error('El video no tiene imagen.');
    const original=await file.arrayBuffer();const digest=await crypto.subtle.digest('SHA-256',original);const sha256=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
    let audio=null;
    if(!silent){
      progress('Preparando el audio de la referencia…');
      const Audio=window.AudioContext||window.webkitAudioContext;const context=new Audio();let decoded;
      try{decoded=await context.decodeAudioData(original);}catch{throw Object.assign(new Error('No pudimos extraer el audio.'),{code:'REFERENCE_AUDIO_UNREADABLE'});}finally{await context.close();}
      if(Math.abs(decoded.duration-duration)>1)error('La duración del audio no coincide con el video. Exporta ambos en un solo MP4.');
      const offline=new OfflineAudioContext(1,Math.ceil(duration*16000),16000),src=offline.createBufferSource();src.buffer=decoded;src.connect(offline.destination);src.start();
      const mono=await offline.startRendering();audio=bytesBase64(monoWav(mono.getChannelData(0)));
    }
    const width=360,height=Math.round(width*video.videoHeight/video.videoWidth);if(height>720||height<120)error('Usa un video vertical, horizontal o cuadrado de proporciones habituales.');
    const capacity=Math.ceil(frames.length/4),sheets=[];
    for(let offset=0;offset<frames.length;offset+=capacity){
      const part=frames.slice(offset,offset+capacity),canvas=document.createElement('canvas');canvas.width=width*2;canvas.height=(height+28)*Math.ceil(capacity/2);const ctx=canvas.getContext('2d');ctx.fillStyle='#000';ctx.fillRect(0,0,canvas.width,canvas.height);
      for(let i=0;i<part.length;i++){
        const f=part[i];progress(`Leyendo imagen ${offset+i+1} de ${frames.length}…`);await event(video,'seeked',()=>{video.currentTime=f.time;});
        const x=(i%2)*width,y=Math.floor(i/2)*(height+28);ctx.drawImage(video,x,y,width,height);ctx.fillStyle='#fff';ctx.font='bold 19px monospace';ctx.fillText(`${f.id} · ${f.time.toFixed(2)} s`,x+7,y+height+21);
      }
      sheets.push(canvas.toDataURL('image/jpeg',.75));
    }
    return {source:{name:file.name.slice(0,180),sha256,duration,width:video.videoWidth,height:video.videoHeight},frames,sheets,audio,silent};
  }finally{video.removeAttribute('src');video.load();URL.revokeObjectURL(url);}
}
