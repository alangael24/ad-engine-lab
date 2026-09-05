// Sample the selected media, cache by immutable media id and used duration.
// No raw frames are stored in the chat history or sessionStorage.
export function createVisualCollector(api){
 const cache=new Map();
 async function capture(scene){
  const clip=!!scene.selectedVersionId,id=scene.selectedVersionId||scene.imageAssetId;if(!id)return null;
  const key=id+':'+(scene.end-scene.start);if(cache.has(key))return {...cache.get(key),sceneId:scene.id};
  const {url}=await api('/api/studio?'+(clip?'version=':'asset=')+id);
  const media=document.createElement(clip?'video':'img');media.crossOrigin='anonymous';
  if(clip){media.muted=true;media.playsInline=true;media.preload='auto';}
  const wait=event=>new Promise((resolve,reject)=>{
   const clear=()=>{clearTimeout(timer);media.removeEventListener(event,ok);media.removeEventListener('error',bad);};
   const ok=()=>{clear();resolve();},bad=()=>{clear();reject(Error('MEDIA_UNAVAILABLE'));};
   const timer=setTimeout(bad,6000);media.addEventListener(event,ok,{once:true});media.addEventListener('error',bad,{once:true});
  });
  try{
   const loaded=wait(clip?'loadeddata':'load');media.src=url;await loaded;
   const duration=clip?Math.min(scene.end-scene.start,media.duration):0;
   if(clip&&(!Number.isFinite(duration)||duration<=0))return null;
   const times=clip?[.1,.5,.9].map(f=>Math.round(duration*f*1000)/1000):[0];
   const canvas=document.createElement('canvas');canvas.width=240*times.length;canvas.height=426;
   const ctx=canvas.getContext('2d');ctx.fillStyle='#111';ctx.fillRect(0,0,canvas.width,canvas.height);
   for(const [i,t] of times.entries()){
    if(clip&&Math.abs(media.currentTime-t)>.001){const seeked=wait('seeked');media.currentTime=t;await seeked;}
    const w=clip?media.videoWidth:media.naturalWidth,h=clip?media.videoHeight:media.naturalHeight,scale=Math.min(240/w,426/h);
    ctx.drawImage(media,i*240+(240-w*scale)/2,(426-h*scale)/2,w*scale,h*scale);
   }
   const sheet=canvas.toDataURL('image/jpeg',.55);if(sheet.length>140000)return null;
   const result={sceneId:scene.id,...(clip?{versionId:id}:{imageAssetId:id}),times,sheet};
   if(cache.size>=48)cache.delete(cache.keys().next().value);cache.set(key,result);return result;
  }finally{media.removeAttribute('src');if(clip)media.load();}
 }
 return async project=>{
  const out=[],scenes=project.data.scenes.slice(0,24),started=Date.now();let cursor=0;
  await Promise.all([0,1,2].map(async()=>{while(cursor<scenes.length&&Date.now()-started<25000){const s=scenes[cursor++];try{const frame=await capture(s);if(frame)out.push(frame);}catch{/* Missing evidence is explicit in server coverage. */}}}));
  out.sort((a,b)=>scenes.findIndex(s=>s.id===a.sceneId)-scenes.findIndex(s=>s.id===b.sceneId));
  const sheets=[],groupSize=Math.max(1,Math.ceil(out.length/4));let size=0;
  for(let i=0;i<out.length;i+=groupSize){
   const group=out.slice(i,i+groupSize),cols=Math.min(2,group.length),canvas=document.createElement('canvas');canvas.width=720*cols;canvas.height=456*Math.ceil(group.length/cols);
   const ctx=canvas.getContext('2d');ctx.fillStyle='#111';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.font='20px sans-serif';
   for(const [j,s] of group.entries()){
    const img=new Image();img.src=s.sheet;await img.decode();const x=(j%cols)*720,y=Math.floor(j/cols)*456;
    ctx.fillStyle='white';ctx.fillText('Scene '+(scenes.findIndex(p=>p.id===s.sceneId)+1),x+8,y+22);ctx.drawImage(img,x,y+30);
   }
   const sheet=canvas.toDataURL('image/jpeg',.55);size+=sheet.length;
   if(sheet.length<=600000&&size<=2200000)sheets.push({sheet,scenes:group.map(({sheet,...sample})=>sample)});
  }
  return sheets;
 };
}
