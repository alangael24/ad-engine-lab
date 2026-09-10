// Shared validation for worker and API: picture edits cannot remove speech.
export const SIMPLE_EDIT_VERSION='sol-luna-v1';
export function validateSimpleEdit(edl,scenes,words){
 if(!edl||!Array.isArray(edl.segments)||!edl.segments.length||edl.segments.length>72)throw Error('EDITORIAL_SEGMENTS');
 let last=-1;const groups=scenes.map(()=>[]);
 for(const r of edl.segments){
  const i=Number(/^S(\d{2})$/.exec(r.source||'')?.[1])-1,s=scenes[i];
  if(!s||i<last||i>last+1||!Number.isFinite(r.in)||!Number.isFinite(r.out)||r.in<0||r.out>(s.sourceDuration??s.media?.duration??s.end-s.start)+.002||r.out-r.in<.15||!Number.isInteger(r.frames)||r.frames<6||!Number.isFinite(r.crop)||r.crop<1||r.crop>1.12)throw Error('EDITORIAL_SEGMENTS');
  const speed=(r.out-r.in)/(r.frames/24);
  if(speed<.75||speed>1.6||groups[i].some(p=>r.in<p.out-.001))throw Error('EDITORIAL_REUSE_OR_SPEED');
  groups[i].push({...r});last=i;
 }
 for(const [i,s] of scenes.entries())if(groups[i].reduce((n,r)=>n+r.frames,0)!==Math.round(s.end*24)-Math.round(s.start*24))throw Error('EDITORIAL_SPEECH_TIMING');
 if(!['white','yellow'].includes(edl.captionColor)||typeof edl.captions!=='boolean'||!Number.isInteger(edl.captionSize)||edl.captionSize<34||edl.captionSize>58)throw Error('EDITORIAL_CAPTIONS');
 if(!Array.isArray(edl.captionGroups)||edl.captionGroups.length>600)throw Error('EDITORIAL_CAPTIONS');
 if(edl.captions){
  let expected=0;
  for(const g of edl.captionGroups){if(!Array.isArray(g)||g.length!==2||g.some(x=>!Number.isInteger(x))||g[0]!==expected||g[1]<g[0]||g[1]>=words.length||g[1]-g[0]>7)throw Error('EDITORIAL_CAPTION_COVERAGE');expected=g[1]+1;}
  if(expected!==words.length)throw Error('EDITORIAL_CAPTION_COVERAGE');
 }else if(edl.captionGroups.length)throw Error('EDITORIAL_CAPTIONS');
 if(typeof edl.hook!=='string'||edl.hook.length>100)throw Error('EDITORIAL_HOOK');
 return {...edl,segments:groups.flat()};
}
export function simpleEditTimeline(scenes,segments){
 // API validates picture intervals without accepting narration edits from a worker.
 const fake={segments,captions:false,captionGroups:[],captionColor:'white',captionSize:46,hook:''};
 validateSimpleEdit(fake,scenes,[]);
 return scenes.map((s,i)=>({...s,sourceRanges:segments.filter(r=>r.source==='S'+String(i+1).padStart(2,'0')).map(r=>({start:r.in,end:r.out,outputDuration:r.frames/24,crop:r.crop}))}));
}
