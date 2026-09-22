// A delivery preference, never a marketing subscription.
export function whatsappPhone(value,consent){
 if(consent!==true)return null;
 const raw=String(value||'').trim();
 if(raw.length>40||!/^[+0-9 ()-]+$/.test(raw))throw Error('Escribe un número válido con código de país. Ejemplo: +52 55 1234 5678.');
 let phone=raw.replace(/[ ()-]/g,'');
 if(/^\d{10}$/.test(phone))phone='+52'+phone;
 if(!/^\+[1-9]\d{7,14}$/.test(phone))throw Error('Incluye el código de país. Para México usa +52 y los 10 dígitos de tu número.');
 if(phone.startsWith('+52')&&!/^\+52\d{10}$/.test(phone))throw Error('Para México usa +52 seguido de 10 dígitos.');
 return phone;
}
