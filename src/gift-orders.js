import {completePersonalization,savePersonalization} from './gift-personalization.js';
import {whatsappPhone} from '../assets/gift-whatsapp-model.js';
import {isGiftAdmin} from './gift-admin.js';
import {json} from './backend.js';
import {authContext,readJson,rpc,UUID,apiError} from './generations.js';
import {own,signed} from './studio.js';
import {secondsBalance} from './video-packages.js';
import {guestOrderContext} from './gift-guest.js';
const errors={GIFT_WHATSAPP_INVALID:[400,'Revisa tu número de WhatsApp e incluye el código de país. Para México: +52 y 10 dígitos.'],GIFT_NOT_FOUND:[404,'No encontramos ese pedido en tu cuenta.'],GIFT_INVALID:[400,'Este paso no está disponible para tu pedido.'],GIFT_CONFLICT:[409,'El guion cambió. Revisa la versión más reciente antes de aprobarlo.'],GIFT_BALANCE:[402,'Necesitas comprar la película o tener suficientes segundos disponibles para aprobar la producción.']};
const publicOrder=o=>({id:o.id,status:o.status,script:o.script,revision:o.revision,targetSeconds:o.target_seconds,customerNote:o.customer_note,title:o.brief?.title,personalization:o.personalization||null,createdAt:o.created_at,deliveredAt:o.delivered_at,deliveredSeconds:o.delivered_seconds});
function error(e){if(e.message==='STUDIO_NOT_FOUND'||e.code==='STUDIO_NOT_FOUND')return json({code:'GIFT_NOT_FOUND',error:errors.GIFT_NOT_FOUND[1]},404);const k=Object.keys(errors).find(k=>e.code===k||e.message?.includes(k));return k?json({code:k,error:errors[k][1]},errors[k][0]):apiError(e);}
export async function getGiftOrder(context){try{
 const url=new URL(context.request.url),id=url.searchParams.get('id');
 const {db,user,guest}=context.request.headers.has('x-gift-access')?await guestOrderContext(context,id):await authContext(context);
 if(!id){const q=await db.from('gift_orders').select('*').eq('user_id',user.id).order('created_at',{ascending:false}).limit(100);if(q.error)throw q.error;return json({orders:q.data.map(publicOrder),canAdmin:isGiftAdmin(user,context.env)});}
 const o=await own(db,'gift_orders',user.id,id);
 if(url.searchParams.has('download')){if(o.status!=='ready'||!o.asset_id)throw Error('GIFT_INVALID');const a=await own(db,'studio_assets',user.id,o.asset_id);return json({url:await signed(db,a.bucket,a.storage_path,true)});}
 const contact=await db.from('gift_guest_checkouts').select('whatsapp_phone,whatsapp_consented_at,checkout_session_id').eq('order_id',o.id).maybeSingle();if(contact.error)throw contact.error;
 const whatsapp=contact.data?.checkout_session_id&&o.status!=='cancelled'?{phone:contact.data.whatsapp_phone||'',consentedAt:contact.data.whatsapp_consented_at}:null;
 return json({whatsapp,order:publicOrder(o),seconds:guest?{available:o.target_seconds}:await secondsBalance(db,user.id),canAdmin:!guest&&isGiftAdmin(user,context.env),guest:Boolean(guest)});
}catch(e){return error(e);}}
export async function postGiftOrder(context){try{
 const b=await readJson(context.request,12000);
 const {db,user,guest}=context.request.headers.has('x-gift-access')?await guestOrderContext(context,b.id):await authContext(context);
 if(b.action==='personalize_save'||b.action==='personalize_submit'){
  const o=b.action==='personalize_save'?await savePersonalization(db,user.id,b):await completePersonalization(db,user.id,b);return json({order:publicOrder(o)});
 }
 if(b.action==='whatsapp'){
  if(!UUID.test(b.id||''))throw Error('GIFT_INVALID');
  let phone;try{phone=whatsappPhone(b.phone,b.consent);}catch{throw Error('GIFT_WHATSAPP_INVALID');}
  const whatsapp=await rpc(db,'gift_order_whatsapp',{p_user:user.id,p_order:b.id,p_phone:phone});return json({whatsapp});
 }
 if(guest&&!['approve','changes'].includes(b.action))throw Error('GIFT_INVALID');
 if(!UUID.test(b.id||'')||!['submit','approve','changes','package'].includes(b.action)||(b.action!=='submit'&&(!Number.isInteger(b.expected)||b.expected<1))||typeof(b.note??'')!=='string')throw Error('GIFT_INVALID');
 if(b.action==='package'){if(![60,120].includes(b.seconds))throw Error('GIFT_INVALID');const o=await rpc(db,'gift_order_package',{p_user:user.id,p_id:b.id,p_expected:b.expected,p_seconds:b.seconds});return json({order:publicOrder(o)});}
 const o=await rpc(db,'gift_order_customer',{p_user:user.id,p_id:b.id,p_action:b.action,p_expected:b.expected??null,p_note:b.note??''});return json({order:publicOrder(o)});
}catch(e){return error(e);}}
