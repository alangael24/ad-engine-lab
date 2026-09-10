// Browser input never determines prices or budget ceilings.
export function paidStep(key){
 if(key==='plan')return 'planning';
 if(key==='narration'||/^narration-scene-[0-9a-f-]{36}$/.test(key))return 'narration';
 if(/^(image-\d+|repair-image-\d+-\d+)$/.test(key))return 'image';
 if(/^(quality-\d+|still-check-\d+-[0-2]|image-review-\d+|repair-still-review-\d+)$/.test(key))return 'quality';
 return null;
}
