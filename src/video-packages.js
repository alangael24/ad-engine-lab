// Prices and entitlements are server-owned; checkout input selects a code only.
export const VIDEO_PACKAGES = Object.freeze({
  minute_1: Object.freeze({code:'minute_1', name:'CreativeRush — 1 anuncio completo', amount:500, currency:'MXN', videoSeconds:60,
    paymentLinkId:'plink_1UGV1iEudyi7fxH7ivDoeENH', url:'https://buy.stripe.com/00wfZhgfJ2CT7Kg69ibwk03'}),
  minute_3: Object.freeze({code:'minute_3', name:'CreativeRush — 3 anuncios completos', amount:1000, currency:'MXN', videoSeconds:180,
    paymentLinkId:'plink_1UGV6qEudyi7fxH7On9MgVuV', url:'https://buy.stripe.com/14A8wP2oT1yP9So41abwk04'}),
  minute_8: Object.freeze({code:'minute_8', name:'CreativeRush — 8 anuncios completos', amount:2000, currency:'MXN', videoSeconds:480,
    paymentLinkId:'plink_1UGVCAEudyi7fxH7bTMhxCss', url:'https://buy.stripe.com/eVqcN5fbF6T9c0w1T2bwk05'}),
});

export async function deliverySettled(db,render) {
  if(!render.production_id)return true;
  const {data,error}=await db.from('video_seconds_reservations').select('status,render_id').eq('production_id',render.production_id).maybeSingle();
  if(error)throw error;
  return !data || data.status==='settled' && data.render_id===render.id;
}

export async function secondsBalance(db, userId) {
  const [balance, holds] = await Promise.all([
    db.from('credit_balances').select('video_seconds,seconds_plan').eq('user_id',userId).maybeSingle(),
    db.from('video_seconds_reservations').select('reserved_seconds').eq('user_id',userId).eq('status','held'),
  ]);
  if(balance.error)throw balance.error;if(holds.error)throw holds.error;
  return {available:balance.data?.video_seconds||0, reserved:(holds.data||[]).reduce((n,r)=>n+r.reserved_seconds,0), enabled:balance.data?.seconds_plan===true};
}
