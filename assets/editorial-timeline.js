// Output times change when silence is trimmed; source identities do not.
export function editorialTimeline(scenes,ranges){
 if(!Array.isArray(ranges)||!ranges.length||ranges.length>120)throw Error('EDITORIAL_INVALID');
 let last=-1,offset=0;const groups=scenes.map(()=>[]);
 for(const r of ranges){
  const i=Number(/^S(\d{2})$/.exec(r.source||'')?.[1])-1,s=scenes[i];
  if(!s||i<last||i>last+1||!Number.isFinite(r.start)||!Number.isFinite(r.end)||r.start<0||r.end> s.end-s.start+.025||r.end-r.start<.15||groups[i].some(p=>r.start<p.end-.001))throw Error('EDITORIAL_INVALID');
  groups[i].push({start:r.start,end:r.end});last=i;
 }
 if(groups.some(g=>!g.length))throw Error('EDITORIAL_INVALID');
 return scenes.map((s,i)=>{const duration=groups[i].reduce((n,r)=>n+r.end-r.start,0);if(duration<.5)throw Error('EDITORIAL_INVALID');const start=offset;offset+=duration;return {...s,start,end:offset,sourceRanges:groups[i]};});
}
export function alignmentWords(a){
 if(!a||!Array.isArray(a.characters)||a.characters.length!==a.character_start_times_seconds?.length||a.characters.length!==a.character_end_times_seconds?.length)throw Error('EDITORIAL_ALIGNMENT_REQUIRED');
 const words=[];let text='',start,end;
 for(let i=0;i<a.characters.length;i++){
  const c=a.characters[i],from=a.character_start_times_seconds[i],to=a.character_end_times_seconds[i];
  if(!Number.isFinite(from)||!Number.isFinite(to)||from<0||to<from)throw Error('EDITORIAL_ALIGNMENT_REQUIRED');
  if(/\s/.test(c)){if(text)words.push({type:'word',text,start,end});text='';}
  else{if(!text)start=from;text+=c;end=to;}
 }
 if(text)words.push({type:'word',text,start,end});if(!words.length)throw Error('EDITORIAL_ALIGNMENT_REQUIRED');return words;
}
export function repairOnOriginalTimeline(review,original,edited){
 return {...review,issues:review.issues.map(issue=>{const s=original.find(s=>s.id===issue.sceneId),e=edited.find(s=>s.id===issue.sceneId);if(!s||!e)throw Error('EDITORIAL_INVALID');return {...issue,at:Math.min(s.end,Math.max(s.start,s.start+(issue.at-e.start)))};})};
}
