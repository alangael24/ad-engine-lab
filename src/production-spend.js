// Browser input never determines prices or budget ceilings.
export function paidStep(key){
 if(key==='plan')return 'planning';
 if(key==='narration')return 'narration';
 if(/^(image-\d+|repair-image-\d+-\d+)$/.test(key))return 'image';
 if(/^quality-\d+$/.test(key))return 'quality';
 return null;
}
