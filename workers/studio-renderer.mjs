import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {resolve} from 'node:path';
export async function command(bin,args,{signal}={}){
 return new Promise((yes,no)=>{const p=spawn(bin,args,{stdio:['ignore','pipe','pipe'],signal});let out='',err='';p.stdout.on('data',x=>{out=(out+x).slice(-1000000);});p.stderr.on('data',x=>{err=(err+x).slice(-50000);});p.on('error',no);p.on('close',code=>code===0?yes(out):no(new Error(`${bin} failed (${code}): ${err.slice(-1200)}`)));});
}
export async function probe(path,options){return JSON.parse(await command('ffprobe',['-v','error','-protocol_whitelist','file,pipe','-show_format','-show_streams','-of','json',path],options));}
const time=s=>{const cs=Math.round(s*100),h=Math.floor(cs/360000),m=Math.floor(cs/6000)%60,sec=Math.floor(cs/100)%60;return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}.${String(cs%100).padStart(2,'0')}`;};
const caption=s=>String(s).replace(/[{}\\]/g,'').replace(/[\r\n]+/g,' ').trim();
export function subtitles(scenes,w,h){
 const margin=Math.round(h*.17),font=Math.round(w*.061);
 let ass=`[Script Info]\nScriptType: v4.00+\nPlayResX: ${w}\nPlayResY: ${h}\nWrapStyle: 0\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,${font},&H00FFFFFF,&H00FFFFFF,&H00201810,&H00000000,-1,0,0,0,100,100,0,0,1,3,0,2,${Math.round(w*.1)},${Math.round(w*.12)},${margin},1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
 // Sentence timings are explicitly reviewed against the narration; no invented word alignment.
 for(const s of scenes)ass+=`Dialogue: 0,${time(s.start)},${time(s.end)},Default,,0,0,0,,${caption(s.text)}\n`;
 return ass;
}
export async function renderTimeline(manifest,directory,{signal}={}){
 const work=resolve(directory);await mkdir(work,{recursive:true});const options={signal};
 if(!Array.isArray(manifest.scenes)||!manifest.scenes.length||manifest.scenes.length>24)throw Error('Invalid storyboard');
 const size={'9:16':[1080,1920],'16:9':[1920,1080],'1:1':[1080,1080]}[manifest.aspectRatio];if(!size)throw Error('Invalid ratio');const [w,h]=size;
 let previous=0;for(const s of manifest.scenes){if(Math.abs(s.start-previous)>.025||s.end-s.start<.5||s.end-s.start>15||s.end>120)throw Error('Invalid scene timing');previous=s.end;}
 const audio=await probe(manifest.narration.path,options),audioStream=audio.streams.find(x=>x.codec_type==='audio');
 if(!audioStream)throw Error('Narration timing mismatch');
 const mapped=manifest.scenes.some(s=>s.narrationStart!=null);
 let narrationPath=manifest.narration.path;
 if(mapped){
  if(manifest.scenes.some(s=>!Number.isFinite(s.narrationStart)||s.narrationStart<0||s.narrationStart>=Number(audio.format.duration)||s.narrationStart+s.end-s.start>Number(audio.format.duration)+.75))throw Error('Narration source range mismatch');
  // Preserve speech associated with each scene when scenes are removed or reordered.
  const filters=manifest.scenes.map((s,i)=>`[0:a]atrim=start=${s.narrationStart}:duration=${s.end-s.start},asetpts=PTS-STARTPTS,apad,atrim=duration=${s.end-s.start}[a${i}]`);
  filters.push(manifest.scenes.map((_,i)=>`[a${i}]`).join('')+`concat=n=${manifest.scenes.length}:v=0:a=1[out]`);
  narrationPath=resolve(work,'edited-narration.wav');
  await command('ffmpeg',['-v','error','-y','-i',manifest.narration.path,'-filter_complex',filters.join(';'),'-map','[out]','-c:a','pcm_s16le',narrationPath],options);
 }else if(Math.abs(Number(audio.format.duration)-previous)>.75)throw Error('Narration timing mismatch');
 const list=[];for(const [i,s] of manifest.scenes.entries()){
  const info=await probe(s.path,options),video=info.streams.find(x=>x.codec_type==='video');
  if(!video||video.width>4096||video.height>4096||Number(info.format.duration)<s.end-s.start-.05)throw Error('Invalid or short clip');
  const file=resolve(work,`part-${String(i).padStart(2,'0')}.mp4`),frames=Math.round(s.end*24)-Math.round(s.start*24);
  await command('ffmpeg',['-v','error','-y','-protocol_whitelist','file,pipe','-i',s.path,'-an','-vf',`fps=24,scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1`,'-frames:v',String(frames),'-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p','-video_track_timescale','12288',file],options);
  list.push(`file '${file.replaceAll("'","'\\''")}'`);
 }
 const concat=resolve(work,'concat.txt'),picture=resolve(work,'picture.mp4'),ass=resolve(work,'captions.ass'),final=resolve(work,'final.mp4');
 await writeFile(concat,list.join('\n'));await writeFile(ass,subtitles(manifest.scenes,w,h));
 await command('ffmpeg',['-v','error','-y','-f','concat','-safe','0','-i',concat,'-c','copy',picture],options);
 // Voice is continuous across picture edits. Only its outer edges receive fades.
 await command('ffmpeg',['-v','error','-y','-i',picture,'-i',narrationPath,'-map','0:v:0','-map','1:a:0','-vf',`ass=filename='${ass.replaceAll("'","\\'").replaceAll(':','\\:')}'`,'-af',`loudnorm=I=-16:TP=-1.5:LRA=11,afade=t=in:d=0.03,afade=t=out:st=${Math.max(0,previous-.03)}:d=0.03,apad`,'-t',String(Math.round(previous*24)/24),'-r','24','-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-ar','48000','-movflags','+faststart',final],options);
 const meta=await probe(final,options);if(Math.abs(Number(meta.format.duration)-Math.round(previous*24)/24)>.05)throw Error('Final timing mismatch');
 if((await stat(final)).size>52428800)throw Error('Render exceeds 50 MB');
 await command('ffmpeg',['-v','error','-i',final,'-f','null','-'],options);return {path:final,meta};
}
