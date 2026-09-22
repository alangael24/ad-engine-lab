import {guestAvailable} from './gift-guest-client.js';
const params=new URLSearchParams(location.search);
if(params.has('draft'))await import('./gift-guest-checkout.js');
else if(!params.has('id')&&await guestAvailable())location.replace('/regalos/?package='+(params.get('package')==='gift_60'?'gift_60':'gift_120'));
else await import('./gift-checkout.js');
