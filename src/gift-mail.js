import {rpc} from './generations.js';
export function giftEmail(kind,url,pending=false){
 const copy=pending&&kind==='received'?['Tu regalo está pagado: personalízalo','Gracias por tu compra. Abre tu pedido para contarnos su historia, añadir las fotos y preparar tu película. Puedes hacerlo ahora o continuar después desde este enlace.']:{received:['Recibimos tu historia','Tu pedido está confirmado. Aquí podrás revisar el guion y seguir el avance de tu película.'],script_ready:['Tu guion está listo para revisar','Lee tu guion, pide los cambios que necesites y apruébalo cuando esté listo.'],ready:['Tu película está lista','Tu regalo ya está terminado. Abre este enlace para descargarlo y compartirlo.']}[kind];
 if(!copy)throw Error('INVALID_EMAIL_KIND');
 return {subject:`${copy[0]} — CreativeRush`,text:`${copy[1]}\n\n${url}\n\nEste enlace es privado y permite acceder a tu pedido. Guárdalo y no lo compartas.\nCreativeRush Regalos`};
}
export async function sendGiftMail(db,env,{fetcher=fetch}={}){
 if(!env.RESEND_API_KEY||!env.GIFT_EMAIL_FROM||env.GIFT_EMAIL_VERIFIED!=='true')return {configured:false,sent:0};
 let sent=0,failed=0;
 for(let n=0;n<5;n++){
  const m=await rpc(db,'gift_email_claim');if(!m)break;
  try{
   const q=await db.from('gift_guest_checkouts').select('email,access_token').eq('order_id',m.order_id).single();if(q.error||!q.data?.email)throw Error('ORDER_EMAIL_MISSING');
   const app=new URL(env.APP_URL||'https://creativerushai.com');if(app.protocol!=='https:')throw Error('INVALID_APP_URL');
   const url=new URL('/regalos/pedido/',app);url.hash='gift='+q.data.access_token;
   const order=await db.from('gift_orders').select('personalization').eq('id',m.order_id).single();if(order.error)throw order.error;
   const res=await fetcher('https://api.resend.com/emails',{method:'POST',headers:{authorization:`Bearer ${env.RESEND_API_KEY}`,'content-type':'application/json','idempotency-key':`gift-${m.id}`},body:JSON.stringify({from:env.GIFT_EMAIL_FROM,to:[q.data.email],...giftEmail(m.kind,url.href,order.data?.personalization?.state==='pending')}),signal:AbortSignal.timeout(15000)});
   if(!res.ok)throw Error(`MAIL_HTTP_${res.status}`);const body=await res.json();if(typeof body.id!=='string')throw Error('MAIL_RESPONSE_INVALID');
   await rpc(db,'gift_email_finish',{p_id:m.id,p_lease:m.lease,p_provider:body.id,p_error:null});sent++;
  }catch(e){
   // Do not log provider response bodies, recipient email or private links.
   const code=/^(MAIL_HTTP_\d+|ORDER_EMAIL_MISSING|INVALID_APP_URL|MAIL_RESPONSE_INVALID)$/.test(e.message)?e.message:'MAIL_RETRY';
   await rpc(db,'gift_email_finish',{p_id:m.id,p_lease:m.lease,p_provider:null,p_error:code});failed++;
  }
 }
 return {configured:true,sent,failed};
}
