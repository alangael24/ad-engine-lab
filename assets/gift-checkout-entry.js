const params=new URLSearchParams(location.search);
if(params.has('draft'))await import('./gift-guest-checkout.js');
else if(!params.has('id'))await import('./gift-pay-first-checkout.js');
else {document.querySelector('#checkout-account').hidden=false;await import('./gift-checkout.js');}
