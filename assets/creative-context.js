// Shared project memory: provider prompts consume the same bounded, persisted facts.
export function creativeContext(project, plan) {
 const d=project.data||{}, m=d.creativeMemory||{};
 return {product:project.brand_snapshot||{},reference:{url:d.referenceUrl||'',notes:d.referenceNotes||'',assetIds:m.referenceAssetIds||[]},direction:plan?.continuity||d.videoContinuity||'',preferences:m.preferences||[],decisions:m.decisions||[],rejections:m.rejections||[],approvedAssets:m.approvedAssets||[]};
}
export function normalizeCreativeMemory(raw={}) {
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('STUDIO_INVALID');
 const list=(v,max,check)=>{if(v==null)return [];if(!Array.isArray(v)||v.length>max||v.some(x=>!check(x)))throw Error('STUDIO_INVALID');return structuredClone(v);};
 const text=x=>typeof x==='string'&&x.trim().length>0&&x.length<=1200;
 const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x);
 return {version:1,referenceAssetIds:list(raw.referenceAssetIds,3,uuid),preferences:list(raw.preferences,30,text),decisions:list(raw.decisions,50,text),rejections:list(raw.rejections,50,text),approvedAssets:list(raw.approvedAssets,24,uuid)};
}
export function remember(project,{decision,rejection,approvedAssets}={}) {
 const m=normalizeCreativeMemory(project.data?.creativeMemory);
 if(decision)m.decisions=[...m.decisions,decision.slice(0,1200)].slice(-50);
 if(rejection)m.rejections=[...m.rejections,rejection.slice(0,1200)].slice(-50);
 if(approvedAssets)m.approvedAssets=[...new Set(approvedAssets.filter(Boolean))].slice(0,24);
 return {...project,data:{...project.data,creativeMemory:m}};
}
