import {json} from './backend.js';
import {authContext,apiError,UUID} from './generations.js';
import {own,signed} from './studio.js';
// Only server-managed metadata from a freshly verified Auth user grants access.
// user_metadata, request headers and query parameters never grant this role.
// An explicitly configured email is allowed only after Auth verifies ownership.
export const isGiftAdmin=(user,env={})=>user?.app_metadata?.creativerush_gift_admin===true||Boolean(user?.email_confirmed_at&&user?.email&&(env.GIFT_ADMIN_EMAILS||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean).includes(user.email.toLowerCase()));
const statuses=['received','script_ready','approved','producing','ready','cancelled'];
const summary=o=>({id:o.id,title:o.brief?.title||'Película personalizada',status:o.status,targetSeconds:o.target_seconds,reservedSeconds:o.reserved_seconds,deliveredSeconds:o.delivered_seconds,createdAt:o.created_at,updatedAt:o.updated_at});
export async function getGiftAdmin(context){try{
 const {db,user}=await authContext(context);
 if(!isGiftAdmin(user,context.env))return json({code:'FORBIDDEN',error:'Esta sección está disponible únicamente para la cuenta administradora.'},403);
 const url=new URL(context.request.url),id=url.searchParams.get('id');
 if(id){
  if(!UUID.test(id))return json({error:'Pedido no válido.'},400);
  const q=await db.from('gift_orders').select('*').eq('id',id).maybeSingle();if(q.error)throw q.error;
  const o=q.data;if(!o)return json({error:'No encontramos ese pedido.'},404);
  if(url.searchParams.has('download')){
   if(o.status!=='ready'||!o.asset_id)return json({error:'La película todavía no está entregada.'},409);
   const asset=await own(db,'studio_assets',o.user_id,o.asset_id);return json({url:await signed(db,asset.bucket,asset.storage_path,true)});
  }
  const customer=await db.auth.admin.getUserById(o.user_id);if(customer.error)throw customer.error;
  const ids=[...new Set(o.brief?.creativeMemory?.characterAssetIds||[])].filter(x=>UUID.test(x)).slice(0,20);
  const photos=await Promise.all(ids.map(async assetId=>{
   // The project snapshot is never authority to sign another customer's asset.
   const a=await own(db,'studio_assets',o.user_id,assetId);
   if(a.kind!=='image'||!['image/jpeg','image/png','image/webp'].includes(a.mime_type))throw Error('GIFT_REFERENCE_INVALID');
   return {id:a.id,name:a.name,url:await signed(db,a.bucket,a.storage_path)};
  }));
  return json({order:{...summary(o),revision:o.revision,script:o.script,brief:o.brief,customerNote:o.customer_note,reviewNote:o.review_note,approvedAt:o.approved_at,deliveredAt:o.delivered_at,customerEmail:customer.data.user?.email||'',photos}});
 }
 const status=url.searchParams.get('status')||'',page=Number(url.searchParams.get('page')||0);
 if(status&&!statuses.includes(status)||!Number.isInteger(page)||page<0||page>10000)return json({error:'Filtro no válido.'},400);
 let q=db.from('gift_orders').select('id,brief,status,target_seconds,reserved_seconds,delivered_seconds,created_at,updated_at').order('created_at',{ascending:false}).order('id',{ascending:false}).range(page*50,page*50+50);
 if(status)q=q.eq('status',status);
 const r=await q;if(r.error)throw r.error;
 return json({orders:r.data.slice(0,50).map(summary),page,hasMore:r.data.length>50});
}catch(e){return apiError(e);}}
