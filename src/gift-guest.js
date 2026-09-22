import {getSupabaseAdmin,json,normalizeEmail,isExistingUserError} from './backend.js';
import {readJson,readBounded,imageType,rpc,UUID,apiError} from './generations.js';
import {giftRequest} from '../assets/gift-model.js';
import {projectData} from '../assets/studio-model.js';
import {VIDEO_PACKAGES} from './video-packages.js';

const TOKEN=/^[a-f0-9]{64}$/;
export const guestEnabled=env=>env.GIFT_GUEST_ENABLED==='true'&&Boolean(env.RESEND_API_KEY&&env.GIFT_EMAIL_FROM&&env.GIFT_EMAIL_VERIFIED==='true');
export const randomToken=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
export async function digest(value){const bytes=typeof value==='string'?new TextEncoder().encode(value):value;return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');}
const fail=code=>{throw Error(code);};
async function one(db,table,column,value){const q=await db.from(table).select('*').eq(column,value).maybeSingle();if(q.error)throw q.error;return q.data;}
export async function guestOrderContext(context,id){
 const token=context.request.headers.get('x-gift-access')||'';
 if(!TOKEN.test(token)||!UUID.test(id||''))fail('GIFT_NOT_FOUND');
 const db=getSupabaseAdmin(context.env),c=await one(db,'gift_guest_checkouts','access_token',token);
 if(!c?.order_id||c.order_id!==id)fail('GIFT_NOT_FOUND');
 const order=await one(db,'gift_orders','id',id);if(!order)fail('GIFT_NOT_FOUND');
 return {db,user:{id:order.user_id},guest:true};
}
async function draftContext(context){
 const url=new URL(context.request.url),id=url.searchParams.get('draft'),token=context.request.headers.get('x-gift-draft')||'';
 if(!UUID.test(id||'')||!TOKEN.test(token))fail('GIFT_NOT_FOUND');
 const db=getSupabaseAdmin(context.env),d=await one(db,'gift_guest_drafts','id',id);
 if(!d||d.secret_hash!==await digest(token)||Date.parse(d.expires_at)<=Date.now())fail('GIFT_NOT_FOUND');
 return {db,d,url};
}
function guestError(e){
 if(e.message==='GIFT_NOT_FOUND')return json({error:'Este enlace privado no está disponible. Abre el enlace original de tu pedido.',code:e.message},404);
 if(e.message==='GIFT_INVALID')return json({error:'Revisa tu historia y las fotos antes de continuar.',code:e.message},400);
 return apiError(e);
}
export async function guestGet(context){try{
 const url=new URL(context.request.url);
 if(url.searchParams.has('config'))return json({enabled:guestEnabled(context.env)});
 if(url.searchParams.has('order')){
  const token=context.request.headers.get('x-gift-access')||'';if(!TOKEN.test(token))fail('GIFT_NOT_FOUND');
  const c=await one(getSupabaseAdmin(context.env),'gift_guest_checkouts','access_token',token);
  if(!c)fail('GIFT_NOT_FOUND');return json({orderId:c.order_id,pending:!c.order_id});
 }
 const {d}=await draftContext(context);return json({title:giftRequest(d.fields,d.photos).title,plan:d.fields.package});
}catch(e){return guestError(e);}}
export async function guestPost(context){try{
 if(!guestEnabled(context.env))return json({error:'El pago sin registro todavía no está disponible.',code:'GIFT_GUEST_DISABLED'},503);
 const url=new URL(context.request.url),db=getSupabaseAdmin(context.env);
 if(url.searchParams.has('create')){
  const b=await readJson(context.request,12000);
  if(!UUID.test(b.id||'')||!TOKEN.test(b.token||'')||!Array.isArray(b.photos))fail('GIFT_INVALID');
  const photos=b.photos.map(p=>({id:p.id,label:p.label,hash:p.hash,mime:p.mime,size:p.size}));
  if(new Set(photos.map(p=>p.id)).size!==photos.length||photos.some(p=>!UUID.test(p.id||'')||!TOKEN.test(p.hash||'')||!['image/png','image/jpeg','image/webp'].includes(p.mime)||!Number.isInteger(p.size)||p.size<1||p.size>6291456))fail('GIFT_INVALID');
  try{giftRequest(b.fields,photos);}catch{fail('GIFT_INVALID');}
  const ip=context.request.headers.get('cf-connecting-ip');if(!ip)fail('GIFT_INVALID');
  await rpc(db,'gift_guest_create',{p_id:b.id,p_hash:await digest(b.token),p_ip:await digest(ip),p_fields:b.fields,p_photos:photos});
  return json({id:b.id});
 }
 const {d}=await draftContext(context);
 if(url.searchParams.has('upload')){
  const photo=d.photos.find(p=>p.id===url.searchParams.get('upload'));if(!photo)fail('GIFT_NOT_FOUND');
  const bytes=await readBounded(context.request,6291456);
  if(bytes.length!==photo.size||imageType(bytes)[0]!==photo.mime||await digest(bytes)!==photo.hash)fail('GIFT_INVALID');
  // Hash-locked slots: retries can only restore the same photo, never overwrite it.
  const path=`gift-guests/${d.id}/${photo.id}`;
  const uploaded=await db.storage.from('studio-media').upload(path,bytes,{contentType:photo.mime,upsert:true});if(uploaded.error)throw uploaded.error;
  return json({id:photo.id});
 }
 if(url.searchParams.has('checkout')){
  const b=await readJson(context.request,1000),plan=VIDEO_PACKAGES[b.plan];if(!['gift_60','gift_120'].includes(b.plan)||!plan)fail('GIFT_INVALID');
  for(const p of d.photos){const info=await db.storage.from('studio-media').info(`gift-guests/${d.id}/${p.id}`);if(info.error||Number(info.data?.size)!==p.size)fail('GIFT_INVALID');}
  const c=await rpc(db,'gift_guest_checkout',{p_draft:d.id,p_plan:b.plan,p_token:randomToken()});
  const portal=`/regalos/pedido/#gift=${c.access_token}`;
  if(c.order_id)return json({paid:true,portal});
  const payment=new URL(plan.url);payment.searchParams.set('client_reference_id','gift_'+c.id);payment.searchParams.set('locale','es');
  return json({url:payment.href,portal});
 }
 fail('GIFT_INVALID');
}catch(e){return guestError(e);}}

export async function fulfillGuest(db,event,session,plan,paymentLinkId){
 const id=String(session.client_reference_id||'').slice(5);if(!UUID.test(id))fail('GIFT_INVALID');
 let c=await one(db,'gift_guest_checkouts','id',id);
 if(!c||c.plan!==plan.code||session.payment_status!=='paid'||session.currency!=='mxn'||session.amount_total!==plan.amount*100)fail('GIFT_INVALID');
 if(c.order_id&&c.checkout_session_id===session.id)return {applied:false,orderId:c.order_id};
 if(c.order_id)c=await rpc(db,'gift_guest_repeat_payment',{p_parent:c.id,p_session:session.id,p_token:randomToken()});
 if(c.order_id)return {applied:false,orderId:c.order_id};
 // Do not mark an email as verified merely because it was entered during payment.
 const email=normalizeEmail(session.customer_details?.email||session.customer_email);if(!email||!email.includes('@'))fail('GIFT_INVALID');
 const created=await db.auth.admin.createUser({email,email_confirm:false});if(created.error&&!isExistingUserError(created.error))throw created.error;
 const d=await one(db,'gift_guest_drafts','id',c.draft_id);if(!d)fail('GIFT_NOT_FOUND');
 const photos=[],assets=[];
 for(const p of d.photos){
  const hex=await digest(`${c.id}:${p.id}`),assetId=`${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;
  const path=`gift-orders/${c.id}/${assetId}`;
  const info=await db.storage.from('studio-media').info(path);
  if(info.error){const copy=await db.storage.from('studio-media').copy(`gift-guests/${d.id}/${p.id}`,path);if(copy.error)throw copy.error;}
  photos.push({id:assetId,label:p.label});assets.push({id:assetId,kind:'image',name:p.label,bucket:'studio-media',storage_path:path,mime_type:p.mime,size_bytes:p.size});
 }
 const data=projectData(giftRequest({...d.fields,package:plan.code},photos));
 return rpc(db,'gift_guest_fulfill',{p_checkout:c.id,p_event:event.id,p_session:session.id,p_link:paymentLinkId,p_email:email,p_customer:typeof session.customer==='string'?session.customer:null,p_plan:plan.code,p_amount:session.amount_total,p_currency:session.currency,p_data:data,p_assets:assets});
}
