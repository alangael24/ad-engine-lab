import {rpc,UUID} from './generations.js';
import {own} from './studio.js';
import {digest} from './gift-guest.js';
import {personalizationFields,isPayFirst} from '../assets/gift-pay-first-model.js';
import {giftRequest} from '../assets/gift-model.js';
import {giftBriefMissing} from '../assets/gift-brief.js';
import {projectData} from '../assets/studio-model.js';
export async function savePersonalization(db,user,b){
 if(!UUID.test(b.id||''))throw Error('GIFT_INVALID');
 return rpc(db,'gift_personalization_save',{p_user:user,p_order:b.id,p_fields:personalizationFields(b.fields)});
}
export async function completePersonalization(db,user,b){
 if(!UUID.test(b.id||'')||!UUID.test(b.draftId||'')||!/^[a-f0-9]{64}$/.test(b.draftToken||''))throw Error('GIFT_INVALID');
 const o=await own(db,'gift_orders',user,b.id);
 if(o.personalization?.state==='complete'&&o.personalization.draftId===b.draftId)return o;
 if(o.status!=='received'||o.personalization?.state!=='pending')throw Error('GIFT_INVALID');
 const q=await db.from('gift_guest_drafts').select('*').eq('id',b.draftId).maybeSingle();if(q.error)throw q.error;
 const d=q.data;if(!d||d.secret_hash!==await digest(b.draftToken)||Date.parse(d.expires_at)<=Date.now())throw Error('GIFT_NOT_FOUND');
 const plan=o.target_seconds===120?'gift_120':'gift_60';
 if(isPayFirst(d.fields)||giftBriefMissing(d.fields,plan).length)throw Error('GIFT_INVALID');
 const photos=[],assets=[];
 for(const p of d.photos){
  const source=`gift-guests/${d.id}/${p.id}`,info=await db.storage.from('studio-media').info(source);if(info.error||Number(info.data?.size)!==p.size)throw Error('GIFT_INVALID');
  const hex=await digest(`${o.id}:${d.id}:${p.id}`),id=`${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`,path=`gift-orders/${o.id}/${id}`;
  const existing=await db.storage.from('studio-media').info(path);if(existing.error){const copied=await db.storage.from('studio-media').copy(source,path);if(copied.error)throw copied.error;}
  photos.push({id,label:p.label});assets.push({id,kind:'image',name:p.label,bucket:'studio-media',storage_path:path,mime_type:p.mime,size_bytes:p.size});
 }
 const fields={...personalizationFields(d.fields),package:plan},data=projectData(giftRequest(fields,photos));
 return rpc(db,'gift_personalization_complete',{p_user:user,p_order:o.id,p_draft:d.id,p_fields:fields,p_data:data,p_assets:assets});
}
