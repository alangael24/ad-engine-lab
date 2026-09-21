// Restore only a known local checkout, never an arbitrary post-login URL.
export function giftCheckoutReturn(raw){
 let value;try{value=JSON.parse(raw);}catch{}
 if(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value?.id||''))return '/regalos/checkout/?id='+encodeURIComponent(value.id);
 return '/regalos/checkout/?package='+(value?.plan==='gift_60'?'gift_60':'gift_120');
}
