// A clip-only repair changes motion, not the already approved input images.
// Any image replacement, added/removed/reordered scene or asset change requires
// the normal image review again. Call only after the initial image gate passed.
export function canReuseRepairImages(before,after,issues){
 return Array.isArray(issues)&&issues.length>0&&issues.every(i=>i.action==='replace_clip')
  &&Array.isArray(before)&&Array.isArray(after)&&before.length===after.length
  &&before.every((s,i)=>s.id===after[i].id&&!!s.imageAssetId&&s.imageAssetId===after[i].imageAssetId)
  &&issues.every(i=>before.some(s=>s.id===i.sceneId));
}
