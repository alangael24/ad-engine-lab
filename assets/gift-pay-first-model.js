import {creatorRequest} from './creator-model.js';
export const isPayFirst=fields=>fields?.flow==='pay_first';
export function giftPurchaseRequest(plan){
 if(!['gift_60','gift_120'].includes(plan))throw Error('GIFT_INVALID');
 return {...creatorRequest('PELÍCULA PERSONALIZADA PARA REGALAR. Pedido pagado, pendiente de que el cliente complete su historia y fotografías. No redactar guion ni producir hasta recibir la personalización.',{kind:'story',targetDuration:plan==='gift_120'?120:60,aspectRatio:'16:9',creative:{format:'auto',look:'3d'}}),productProfile:'creator-v1',title:'Tu película · pendiente de personalizar'};
}
// Allow partial saves without accepting arbitrary project instructions or plan changes.
export function personalizationFields(raw={}){
 const sizes={recipient:80,names:120,additionalNames:120,relationship:30,occasion:30,memory1:300,memory2:300,memory3:300,message:300,avoid:160,emotion:30,tone:30,ratio:10};
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('GIFT_INVALID');
 const result={};for(const [key,max] of Object.entries(sizes)){if(raw[key]===undefined)continue;if(typeof raw[key]!=='string'||raw[key].length>max)throw Error('GIFT_INVALID');result[key]=raw[key];}
 return {...result,look:'3d',briefVersion:'1'};
}
