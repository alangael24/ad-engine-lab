// Concrete story inputs, not word counts or a promise of creative quality.
export function giftBriefMissing(fields,plan=fields.package){
 const missing=[];
 if(!String(fields.memory1||'').trim())missing.push('memory1');
 if(plan==='gift_120'){
  const normalize=v=>String(v||'').trim().toLocaleLowerCase().replace(/\s+/g,' ');
  if(!normalize(fields.memory2)||normalize(fields.memory2)===normalize(fields.memory1))missing.push('memory2');
 }
 if(!String(fields.message||'').trim())missing.push('message');
 return missing;
}
