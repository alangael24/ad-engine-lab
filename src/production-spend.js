// Browser input never determines prices or budget ceilings.
export function paidStep(key){
 if(/^material-call-[a-f0-9]{64}$/.test(key))return 'quality';
 if(key.startsWith('material-v1-'))return null; // Actual subcalls own their reservations and measured costs.
 if(key==='plan')return 'planning';
 if(key==='narration'||/^narration-scene-[0-9a-f-]{36}$/.test(key))return 'narration';
 if(/^(image-\d+|repair-image-\d+-\d+)$/.test(key))return 'image';
 if(/^(quality-\d+|still-check-\d+-[0-2]|image-review-\d+|repair-still-review-\d+)$/.test(key))return 'quality';
 return null;
}

export function measuredStepCost(result){
 if(result?.reusedAudio||result?.reusedEditorialReview)return 0;
 const cost=result?.providerUsage?.cost??result?.usage?.costUsd??result?.costUsd;
 return Number.isFinite(cost)&&cost>=0?cost:null;
}

export function measuredEditorialCost(usage){
 if(usage?.unknown!==false||!Array.isArray(usage.calls)||!Number.isFinite(usage.total)||usage.total<0)return null;
 if(usage.calls.some(c=>!Number.isFinite(c.cost)||c.cost<0||c.status==='started'))return null;
 const sum=usage.calls.reduce((n,c)=>n+c.cost,0);
 return Math.abs(sum-usage.total)<0.000001?sum:null;
}
