import {mkdir,writeFile,readFile,stat,rename,rm,readdir,utimes} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {command,probe,subtitles} from './studio-renderer.mjs';
import {validateSimpleEdit} from '../assets/simple-edit.js';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const filterPath=p=>p.replaceAll('\\','\\\\').replaceAll("'","'\\''").replaceAll(':','\\:');
const time=t=>{const n=Math.round(t*100);return `${Math.floor(n/360000)}:${String(Math.floor(n/6000)%60).padStart(2,'0')}:${String(Math.floor(n/100)%60).padStart(2,'0')}.${String(n%100).padStart(2,'0')}`;};
const clean=s=>String(s).replace(/[{}\\\r\n]/g,' ').trim();
export function wordCaptions(edl,words,w,h,scenes=[]){
 let ass=subtitles([],w,h).replace(`Arial,${Math.round(w*.061)},`,`DejaVu Sans,${Math.round(w*edl.captionSize/720)},`);
 // The hook is a separate layer. Changing subtitle color must not recolor it.
 const hookStyle=ass.split('\n').find(line=>line.startsWith('Style: Default,')).replace('Style: Default,','Style: Hook,');
 if(edl.captionColor==='yellow')ass=ass.replace('&H00FFFFFF','&H0000EFFF');
 ass=ass.replace('[Events]',hookStyle+'\n\n[Events]');
 if(edl.captions)for(const [a,b] of edl.captionGroups){
  if((edl.sourceCaptionScenes||[]).some(id=>{const s=scenes.find(s=>s.source===id);return s&&words[a].start>=s.start-.001&&words[b].end<=s.end+.001;}))continue;
  const text=edl.captionHighlight?words.slice(a,b+1).map((x,i,ws)=>`{\\k${Math.max(1,Math.round(((ws[i+1]?.start??x.end)-x.start)*100))}}${clean(x.text)}`).join(' '):clean(words.slice(a,b+1).map(x=>x.text).join(' '));
  const fade=edl.captionFadeMs?`{\\fad(${edl.captionFadeMs},${edl.captionFadeMs})}`:'';
  const end=Math.min(words[b].end+.06,words[b+1]?.start??Infinity);
  ass+=`Dialogue: 0,${time(words[a].start)},${time(end)},Default,,0,0,0,,${fade}${text}\n`;
 }
 if(edl.hook)ass+=`Dialogue: 1,0:00:00.00,${time(Math.min(3,words.at(-1).end))},Hook,,0,0,0,,{\\an8\\pos(${Math.round(w/2)},${Math.round(h*.12)})}${clean(edl.hook)}\n`;
 return ass;
}
export async function sourceBoards(scenes,directory,{signal}={}){
 await mkdir(directory,{recursive:true});const images=[];
 for(const [i,s] of scenes.entries()){
  const frames=[],length=s.sourceDuration??s.end-s.start;
  for(const [k,t] of [0,length/2,Math.max(0,length-.08)].entries()){
   const p=resolve(directory,`s${i}-${k}.jpg`);
   await command('ffmpeg',['-v','error','-y','-protocol_whitelist','file,pipe','-ss',String(t),'-i',s.path,'-frames:v','1','-vf','scale=240:426:force_original_aspect_ratio=decrease,pad=240:426:(ow-iw)/2:(oh-ih)/2','-update','1',p],{signal});frames.push(p);
  }
  const p=resolve(directory,`scene-${i+1}.jpg`),inputs=frames.flatMap(p=>['-i',p]);
  await command('ffmpeg',['-v','error','-y',...inputs,'-filter_complex','[0:v][1:v][2:v]hstack=inputs=3','-frames:v','1','-update','1',p],{signal});
  images.push('data:image/jpeg;base64,'+(await readFile(p)).toString('base64'));
 }
 return images;
}
export async function prepareSimpleSources({root,project,shots,narration,words,signal}){
 await mkdir(root,{recursive:true});
 const scenes=project.data.scenes||[];let end=0;
 if(!scenes.length||scenes.length>24)throw Error('EDITORIAL_SCENES');
 const sourceWords=words.filter(w=>!w.type||w.type==='word');
 if(!sourceWords.length||sourceWords.length>600||sourceWords.some((w,i)=>typeof w.text!=='string'||!Number.isFinite(w.start)||!Number.isFinite(w.end)||w.start<0||w.end<w.start||(i&&w.start<sourceWords[i-1].start)))throw Error('EDITORIAL_WORDS');
 const mapped=[],local=[];
 const audio=await probe(narration,{signal}),audioDuration=Number(audio.format.duration);
 if(!audio.streams.some(x=>x.codec_type==='audio'))throw Error('EDITORIAL_AUDIO');
 for(const [i,s] of scenes.entries()){
  const duration=s.end-s.start,from=s.narrationStart??s.start,shot=shots.find(x=>x.sceneId===s.id);
  if(!shot||Math.abs(s.start-end)>.025||duration<.5||duration>15||s.end>120||!Number.isFinite(from)||from<0||from+duration>audioDuration+.15)throw Error('EDITORIAL_SCENES');
  const meta=await probe(shot.path,{signal});
  if(!meta.streams.some(x=>x.codec_type==='video')||Number(meta.format.duration)<duration-.025)throw Error('EDITORIAL_CLIP_SHORT');
  const sceneWords=sourceWords.filter(w=>w.start>=from-.015&&w.start<from+duration-.015).map(w=>({...w,start:w.start-from+s.start,end:w.end-from+s.start}));
  mapped.push(...sceneWords);local.push({...s,sourceDuration:Number(meta.format.duration),path:resolve(shot.path),number:i+1,source:'S'+String(i+1).padStart(2,'0'),frames:Math.round(s.end*24)-Math.round(s.start*24)});end=s.end;
 }
 const norm=s=>(s.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu)||[]).join(' ');
 if(norm(mapped.map(x=>x.text).join(' '))!==norm(project.data.scriptDraft)||mapped.some(w=>w.end>end+.05))throw Error('EDITORIAL_SCRIPT_COVERAGE');
 let voice=resolve(narration);
 if(scenes.some(s=>s.narrationStart!=null)){
  voice=resolve(root,'voice.wav');
  const filters=scenes.map((s,i)=>`[0:a]atrim=start=${s.narrationStart??s.start}:duration=${s.end-s.start},asetpts=PTS-STARTPTS[a${i}]`);
  filters.push(scenes.map((_,i)=>`[a${i}]`).join('')+`concat=n=${scenes.length}:v=0:a=1[out]`);
  await command('ffmpeg',['-v','error','-y','-i',narration,'-filter_complex',filters.join(';'),'-map','[out]','-c:a','pcm_s16le',voice],{signal});
 }else if(Math.abs(audioDuration-end)>.15)throw Error('EDITORIAL_AUDIO_TIMING');
 return {scenes:local,words:mapped,narration:voice,duration:Math.round(end*24)/24};
}
export async function renderSimpleAd({edl,scenes,words,narration,duration,root,cacheDirectory,cacheNamespace='',aspectRatio='9:16',signal}){
 validateSimpleEdit(edl,scenes,words);
 const dims={'9:16':[720,1280],'16:9':[1280,720],'1:1':[720,720]}[aspectRatio];if(!dims)throw Error('EDITORIAL_RATIO');
 const [w,h]=dims,cache=resolve(cacheDirectory||root,'parts');await mkdir(cache,{recursive:true});await mkdir(root,{recursive:true});const parts=[],hashes=new Map(),reuse={reused:0,encoded:0};
 // Bounded, disposable CPU cache. Source content and encoding settings define
 // identity; temporary download paths and subtitle changes do not invalidate it.
 const entries=await Promise.all((await readdir(cache)).filter(n=>/^[a-f0-9]{64}\.mp4$/.test(n)).map(async n=>({path:resolve(cache,n),...(await stat(resolve(cache,n)).catch(()=>({size:0,mtimeMs:0})))})));
 let bytes=entries.reduce((n,e)=>n+e.size,0);for(const e of entries.sort((a,b)=>a.mtimeMs-b.mtimeMs))if(Date.now()-e.mtimeMs>7*86400000||bytes>536870912){await rm(e.path,{force:true});bytes-=e.size;}
 for(const [i,r] of edl.segments.entries()){
  const s=scenes.find(s=>s.source===r.source);if(!hashes.has(s.path))hashes.set(s.path,digest(await readFile(s.path)));
  const key=digest(JSON.stringify({version:2,namespace:cacheNamespace,in:r.in,out:r.out,frames:r.frames,crop:r.crop,w,h,sha256:hashes.get(s.path)})),p=resolve(cache,key+'.mp4');
  if(!(await stat(p).catch(()=>null))){
   const rate=r.frames/24/(r.out-r.in),vf=`trim=start=${r.in}:end=${r.out},setpts=(PTS-STARTPTS)*${rate},fps=24,scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},crop=iw/${r.crop}:ih/${r.crop},scale=${w}:${h},setsar=1,tpad=stop_mode=clone:stop_duration=0.05,format=yuv420p`;
   const pending=resolve(cache,`${key}.${crypto.randomUUID()}.tmp.mp4`);
   try{await command('ffmpeg',['-v','error','-y','-protocol_whitelist','file,pipe','-i',s.path,'-an','-vf',vf,'-frames:v',String(r.frames),'-c:v','libx264','-threads','2','-preset','veryfast','-crf','20','-video_track_timescale','12288',pending],{signal});
    const m=await probe(pending,{signal});if(Math.abs(Number(m.format.duration)-r.frames/24)>.025)throw Error('EDITORIAL_SEGMENT_DURATION');await rename(pending,p);reuse.encoded++;
   }finally{await rm(pending,{force:true});}
  }else{reuse.reused++;const now=new Date();await utimes(p,now,now);}
  parts.push(p);
 }
 const list=resolve(root,'concat.txt'),picture=resolve(root,'picture.mp4'),ass=resolve(root,'captions.ass'),final=resolve(root,'final.mp4');
 await writeFile(list,parts.map(p=>`file '${p.replaceAll("'","'\\''")}'`).join('\n'));
 await writeFile(ass,wordCaptions(edl,words,w,h,scenes));
 await command('ffmpeg',['-v','error','-y','-f','concat','-safe','0','-i',list,'-c','copy',picture],{signal});
 await command('ffmpeg',['-v','error','-y','-i',picture,'-i',narration,'-map','0:v:0','-map','1:a:0','-vf',`ass=filename='${filterPath(ass)}'`,'-af','apad=pad_dur=0.05','-t',String(duration),'-c:v','libx264','-threads','2','-preset','veryfast','-crf','20','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-movflags','+faststart',final],{signal});
 const meta=await probe(final,{signal});if(Math.abs(Number(meta.format.duration)-duration)>.06||!meta.streams.some(x=>x.codec_type==='audio')||(await stat(final)).size>52428800)throw Error('EDITORIAL_RENDER_INVALID');
 await command('ffmpeg',['-v','error','-i',final,'-f','null','-'],{signal});
 return {path:final,sha256:digest(await readFile(final)),meta,reuse};
}
