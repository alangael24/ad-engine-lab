// A production plan preserves the approved narration; models only direct its visuals.
import {ID,fail} from './studio-model.js';
export const compact = text => String(text || '').normalize('NFKC').replace(/\s+/g,' ').trim();
const checkText=(v,max)=>{if(typeof v!=='string'||!v.trim()||v.length>max)fail('PRODUCTION_PLAN');return v.trim();};
export function validatePlan(raw,script,newId=()=>crypto.randomUUID()) {
  if(!raw || !Array.isArray(raw.scenes)||raw.scenes.length<1||raw.scenes.length>12)fail('PRODUCTION_PLAN');
  const continuity=checkText(raw.continuity,2000);
  const scenes=raw.scenes.map(s=>({id:newId(),text:checkText(s.text,500),visual:checkText(s.visual,800),motion:checkText(s.motion,400),...(typeof s.sourceKey==='string'?{sourceKey:checkText(s.sourceKey,80)}:{})}));
  if(compact(scenes.map(s=>s.text).join(' '))!==compact(script))fail('PRODUCTION_SCRIPT_CHANGED');
  return {continuity,scenes};
}
export function imageDirection(project,plan,index) {
  const scene=plan.scenes[index];if(!scene)fail('PRODUCTION_PLAN');
  return `Create one finished advertisement still, no collage, no subtitles or added text.
Reference image 1 is the actual product: preserve its complete geometry, parts, color and proportions. Other reference images define the recurring character and visual world; never replace the product with their props.
Product: ${JSON.stringify(project.brand_snapshot)}
Approved global visual continuity: ${plan.continuity}
Reference direction (style only, not its claims): ${project.data.referenceNotes || ''}
Scene ${index+1}/${plan.scenes.length}. Narration: ${scene.text}
Show: ${scene.visual}
Before: ${plan.scenes[index-1]?.visual || 'Opening shot'}
After: ${plan.scenes[index+1]?.visual || 'End card'}
Compose for ${project.data.aspectRatio}; maintain the same character, product, material and lighting across this ad. Never invent product features or internal mechanisms.`;
}

// Align to the provider's ORIGINAL-text character timestamps, never word-count estimates.
export function alignScenes(plan,alignment,duration,newId=()=>crypto.randomUUID()) {
  if(!Number.isFinite(duration)||duration<=0||duration>120)fail('PRODUCTION_TIMING');
  const {characters,character_start_times_seconds:starts,character_end_times_seconds:ends}=alignment||{};
  if(!Array.isArray(characters)||!Array.isArray(starts)||!Array.isArray(ends)||characters.length!==starts.length||ends.length!==starts.length)fail('PRODUCTION_TIMING');
  let chars='',map=[];
  for(let i=0;i<characters.length;i++) {
    if(typeof characters[i]!=='string'||!Number.isFinite(starts[i])||!Number.isFinite(ends[i])||starts[i]<0||ends[i]<starts[i]||ends[i]>duration+.05||(i&&starts[i]<starts[i-1]))fail('PRODUCTION_TIMING');
    for(const c of characters[i].normalize('NFKC'))if(!/\s/u.test(c)){chars+=c;map.push(i);}
  }
  const plain=s=>Array.from(s.normalize('NFKC')).filter(c=>!(/\s/u.test(c))).join('');
  if(chars!==plain(plan.scenes.map(s=>s.text).join(' '))||!map.length)fail('PRODUCTION_TIMING');
  const out=[];let offset=0,cursor=0;
  for(const [i,s] of plan.scenes.entries()) {
    const words=s.text.match(/\S+/gu)||[],wordMarks=[];
    for(const word of words){const count=Array.from(plain(word)).length;wordMarks.push({text:word,start:starts[map[offset]],end:ends[map[offset+count-1]]});offset+=count;}
    const end=i===plan.scenes.length-1?duration:Math.max(cursor, (ends[map[offset-1]]+starts[map[offset]])/2);
    let from=0;
    while(from<wordMarks.length){
      let to=wordMarks.length,finish=end;
      if(finish-cursor>15){
        to=from+1;
        while(to<wordMarks.length&&(wordMarks[to-1].end+wordMarks[to].start)/2-cursor<=14)to++;
        to--;
        if(to<=from)fail('PRODUCTION_TIMING');
        finish=(wordMarks[to-1].end+wordMarks[to].start)/2;
      }
      if(finish-cursor<.5||finish-cursor>15)fail('PRODUCTION_TIMING');
      out.push({...s,planSceneId:s.id,id:from===0?s.id:newId(),text:wordMarks.slice(from,to).map(w=>w.text).join(' '),start:Math.round(cursor*1000)/1000,end:Math.round(finish*1000)/1000,imageAssetId:null,selectedVersionId:null});
      cursor=finish;from=to;
    }
  }
  if(out.length>24||out.some(s=>!ID.test(s.id)))fail('PRODUCTION_TIMING');
  return out;
}
export function alignmentFromWords(words){
  const spoken=words.filter(w=>w.type==='word');
  return {characters:spoken.map(w=>w.text),character_start_times_seconds:spoken.map(w=>w.start),character_end_times_seconds:spoken.map(w=>w.end)};
}
