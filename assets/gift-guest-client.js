const KEY='creativerush-gift-guest-v1',ACCESS='creativerush-gift-private-access';
export async function guestRequest(path,{token,body,method='GET',file}={}){
 const headers={};if(token)headers['x-gift-draft']=token;
 if(body)headers['content-type']='application/json';if(file)headers['content-type']=file.type;
 const r=await fetch(path,{method,headers,body:file|| (body?JSON.stringify(body):undefined)}),b=await r.json();if(!r.ok)throw Error(b.error||'No pudimos guardar tu historia. Inténtalo de nuevo.');return b;
}
export async function guestAvailable(){try{return Boolean((await guestRequest('/api/gift-guest?config=1')).enabled);}catch{return false;}}
export function storedGuest(){try{return JSON.parse(sessionStorage.getItem(KEY));}catch{return null;}}
const save=p=>sessionStorage.setItem(KEY,JSON.stringify(p));
async function hash(file){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer())),b=>b.toString(16).padStart(2,'0')).join('');}
export async function saveGuest(fields,photos,status){
 let pending=storedGuest();
 // A changed story starts a new immutable draft; an unchanged retry resumes uploads.
 const hashes=await Promise.all(photos.map(p=>hash(p.file)));
 if(!pending||JSON.stringify(pending.fields)!==JSON.stringify(fields)||photos.length&&JSON.stringify(pending.photos.map(p=>[p.hash,p.label]))!==JSON.stringify(photos.map((p,i)=>[hashes[i],p.label]))){
  pending={id:crypto.randomUUID(),token:Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join(''),fields,
   photos:photos.map((p,i)=>({id:crypto.randomUUID(),label:p.label,hash:hashes[i],mime:p.file.type,size:p.file.size})),uploaded:[]};save(pending);
 }
 await guestRequest('/api/gift-guest?create=1',{method:'POST',body:pending});
 for(const p of pending.photos){
  if(pending.uploaded.includes(p.id))continue;
  const file=photos.find((_,i)=>hashes[i]===p.hash)?.file;if(!file)throw Error('Tu historia está guardada. Vuelve a seleccionar las fotos pendientes para terminar de subirlas.');
  status('Guardando sus fotos…');await guestRequest(`/api/gift-guest?draft=${pending.id}&upload=${p.id}`,{token:pending.token,method:'POST',file});pending.uploaded.push(p.id);save(pending);
 }
 return pending;
}
export function rememberPortal(portal){const token=new URL(portal,location.origin).hash.slice(6);if(/^[a-f0-9]{64}$/.test(token))localStorage.setItem(ACCESS,token);}
export function privateAccess(){const token=new URLSearchParams(location.hash.slice(1)).get('gift');if(/^[a-f0-9]{64}$/.test(token||'')){localStorage.setItem(ACCESS,token);history.replaceState(null,'',location.pathname+location.search);return token;}return null;}
export function lastPrivateAccess(){return localStorage.getItem(ACCESS);}
