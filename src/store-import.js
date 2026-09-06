// Public storefront extraction. No model calls, scripts, cookies, or credential forwarding.
import {json} from './backend.js';
import {authContext,readJson,readBounded,rpc,imageType} from './generations.js';
import {studioError} from './studio.js';
const err=(code='STORE_READ')=>{throw Object.assign(new Error(code),{code});};
export function storeUrl(value,base){
 if(typeof value!=='string'||value.length>2000)err('STORE_URL');
 let u;try{u=new URL(value.includes('://')||base?value:'https://'+value,base);}catch{err('STORE_URL');}
 const h=u.hostname.toLowerCase();
 if(u.protocol!=='https:'||u.username||u.password||u.port||!h.includes('.')||h.endsWith('.')||/^[\d.]+$/.test(h)||h.includes(':')||/(^|\.)(localhost|local|internal|test|invalid|example|arpa|onion)$/.test(h)||h==='metadata.google.internal')err('STORE_URL');
 u.hash='';return u;
}
export function publicAddress(ip){
 if(ip.includes(':'))return /^2[0-9a-f]{3}:/i.test(ip)&&!/^2001:(?:0:|db8:|10:|20:|2:)/i.test(ip)&&!/^2002:/i.test(ip);
 const p=ip.split('.').map(Number);if(p.length!==4||p.some(x=>!Number.isInteger(x)||x<0||x>255))return false;
 const [a,b,c]=p;return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0||b===2)||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19||b===51&&c===100)||a===203&&b===0&&c===113);
}
export async function publicFetch(value,{request=fetch,max=2000000,types=['text/html','application/xhtml+xml']}={}){
 let u=storeUrl(value);const signal=AbortSignal.timeout(18000);
 for(let redirects=0;redirects<4;redirects++){
  const records=await Promise.all(['A','AAAA'].map(async type=>{const r=await request(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(u.hostname)}&type=${type}`,{headers:{accept:'application/dns-json'},signal});if(!r.ok)err();const d=JSON.parse(new TextDecoder().decode(await readBounded(r,32000)));return (d.Answer||[]).filter(x=>[1,28].includes(x.type)).map(x=>x.data);}));
  const ips=records.flat();if(!ips.length||ips.some(ip=>!publicAddress(ip)))err('STORE_URL');
  const response=await request(u.href,{redirect:'manual',headers:{accept:types.join(', '),'user-agent':'CreativeRush/1.0 (store import)'},signal});
  if([301,302,303,307,308].includes(response.status)){await response.body?.cancel();u=storeUrl(response.headers.get('location'),u);continue;}
  if(!response.ok||!types.includes(response.headers.get('content-type')?.split(';')[0].trim().toLowerCase())){await response.body?.cancel();err();}
  return {url:u.href,bytes:await readBounded(response,max)};
 }
 err();
}
const entities={amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' ',aacute:'á',eacute:'é',iacute:'í',oacute:'ó',uacute:'ú',ntilde:'ñ'};
function decode(s){return String(s||'').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,(all,n)=>{if(n[0]!=='#')return entities[n]??all;const c=n[1].toLowerCase()==='x'?parseInt(n.slice(2),16):Number(n.slice(1));return c>0&&c<=0x10ffff?String.fromCodePoint(c):'';});}
export function plain(s,max=600){return decode(String(s||'').replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,' ').replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim().slice(0,max);}
function attrs(tag){const a={};for(const m of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g))a[m[1].toLowerCase()]=decode(m[2]??m[3]??m[4]);return a;}
const safeUrl=(v,base)=>{try{return storeUrl(v,base).href;}catch{return '';}};
function pictures(value,base){return [...new Set((Array.isArray(value)?value:[value]).map(x=>safeUrl(typeof x==='object'?x?.url||x?.contentUrl:x,base)).filter(Boolean))].slice(0,6);}
function product(p,base,brand){const name=plain(p.name,120);if(!name)return null;const url=safeUrl(p.url||base,base);return {name,brand:plain(typeof p.brand==='string'?p.brand:p.brand?.name||brand,80),description:plain(p.description,600),sourceText:plain(p.description,6000),url,images:pictures(p.image,base)};}
export function parseStore(html,url){
 const meta={};for(const m of html.matchAll(/<meta\b[^>]*>/gi)){const a=attrs(m[0]);meta[(a.property||a.name||'').toLowerCase()]=a.content||'';}
 const title=plain(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1],120);
 let brand=plain(meta['og:site_name'],80);const products=[],nodes=[];
 for(const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)){if(attrs(m[1]).type?.toLowerCase()!=='application/ld+json'||m[2].length>400000)continue;try{nodes.push(JSON.parse(m[2]));}catch{}}
 for(let n=0;n<nodes.length&&n<2500;n++){const x=nodes[n];if(!x||typeof x!=='object')continue;if(Array.isArray(x)){nodes.push(...x.slice(0,100));continue;}const types=[x['@type']].flat();if(types.some(t=>['Organization','OnlineStore','WebSite'].includes(t))&&!brand)brand=plain(x.name,80);if(types.includes('Product')){const p=product(x,url,brand);if(p)products.push(p);}for(const v of Object.values(x))if(v&&typeof v==='object')nodes.push(v);}
 if(!products.length&&(meta['og:type']==='product'||/\/(?:products|product|producto)\/[^/]+/.test(new URL(url).pathname))){const p=product({name:meta['og:title']||title,description:meta.description||meta['og:description'],image:meta['og:image']},url,brand);if(p)products.push(p);}
 const links=[];for(const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)){const a=attrs(m[1]),href=safeUrl(a.href,url);if(href&&new URL(href).origin===new URL(url).origin&&/\/(?:products|product|producto)\/[^/?#]+/.test(new URL(href).pathname)&&!links.some(x=>x.url===href))links.push({name:plain(m[2],120)||decode(new URL(href).pathname.split('/').filter(Boolean).at(-1)).replace(/-/g,' '),url:href,images:[]});if(links.length>=12)break;}
 // JSON-LD often repeats one product for every size and places its photo only
 // on the variants. Merge that page into one usable product, keeping the largest
 // published version of each photo instead of a 100px thumbnail.
 const grouped=new Map();
 for(const p of products.slice(0,30)){
  const previous=grouped.get(p.url);
  grouped.set(p.url,previous?{...previous,name:p.name.length<previous.name.length?p.name:previous.name,
   description:previous.description||p.description,sourceText:previous.sourceText||p.sourceText,
   images:[...previous.images,...p.images]}:p);
 }
 const unique=[...grouped.values()].slice(0,12).map(p=>{
  const photos=new Map();for(const src of p.images){const u=new URL(src),key=u.origin+u.pathname,old=photos.get(key);
   if(!old||Number(u.searchParams.get('width')||0)>Number(new URL(old).searchParams.get('width')||0))photos.set(key,src);}
  const isPage=new URL(p.url).pathname===new URL(url).pathname;
  const description=p.description||(isPage?plain(meta.description||meta['og:description'],600):'');
  return {...p,description,sourceText:p.sourceText||description,images:[...photos.values()].slice(0,6)};
 });
 return {url,brand:brand||new URL(url).hostname.replace(/^www\./,''),products:unique,links,shopify:/cdn\.shopify\.com|Shopify\.shop/.test(html)};
}
export async function inspectStore(value,request=fetch){
 const page=await publicFetch(value,{request});const result=parseStore(new TextDecoder().decode(page.bytes),page.url);
 if(!result.products.length&&result.shopify){try{const r=await publicFetch(new URL('/products.json?limit=12',page.url).href,{request,types:['application/json']});const data=JSON.parse(new TextDecoder().decode(r.bytes));result.products=(data.products||[]).slice(0,12).map(p=>product({name:p.title,description:p.body_html,brand:p.vendor,url:new URL('/products/'+encodeURIComponent(p.handle),page.url).href,image:p.images?.map(x=>x.src)},page.url,result.brand)).filter(Boolean);}catch{/* Product links remain available when a storefront disables its catalogue. */}}
 if(!result.products.length)result.products=result.links;
 result.products=result.products.map(p=>({...p,brand:p.brand||result.brand}));delete result.links;delete result.shopify;return result;
}
const enc=new TextEncoder();
async function key(env){return crypto.subtle.importKey('raw',enc.encode('store-image-v1:'+env.SUPABASE_SERVICE_ROLE_KEY),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);}
export async function imageToken(url,user,env){const payload=btoa(JSON.stringify({url,user,assetId:crypto.randomUUID(),expires:Date.now()+1800000}));const sig=await crypto.subtle.sign('HMAC',await key(env),enc.encode(payload));return payload+'.'+btoa(String.fromCharCode(...new Uint8Array(sig)));}
export async function tokenData(token,user,env){try{if(typeof token!=='string'||token.length>6000)err();const [p,s,...rest]=token.split('.');if(rest.length||!await crypto.subtle.verify('HMAC',await key(env),Uint8Array.from(atob(s),c=>c.charCodeAt(0)),enc.encode(p)))err();const d=JSON.parse(atob(p));if(d.user!==user||d.expires<Date.now())err();storeUrl(d.url);return d;}catch{err('STORE_IMAGE');}}
export async function postStoreImport(context){try{
 const {db,user}=await authContext(context),b=await readJson(context.request,10000);
 if(b.action==='image'){
  const t=await tokenData(b.token,user.id,context.env);
  const find=()=>db.from('studio_assets').select('*').eq('user_id',user.id).eq('id',t.assetId).maybeSingle();const old=await find();if(old.error)throw old.error;if(old.data)return json({asset:old.data});
  const r=await publicFetch(t.url,{max:6291456,types:['image/jpeg','image/png','image/webp']});const [mime,ext]=imageType(r.bytes),bucket='generation-references',path=`${user.id}/${t.assetId}.${ext}`;
  const up=await db.storage.from(bucket).upload(path,r.bytes,{contentType:mime,upsert:false});if(up.error){const again=await find();if(again.data)return json({asset:again.data});err('STORE_IMAGE');}
  try{const asset=await rpc(db,'studio_write',{p_user_id:user.id,p_action:'register_asset',p_id:t.assetId,p_data:{kind:'image',name:'Producto de la tienda',bucket,storage_path:path,mime_type:mime,size_bytes:r.bytes.length,duration_seconds:null}});return json({asset});}catch(e){await db.storage.from(bucket).remove([path]);throw e;}
 }
 if(b.action!=='inspect')err('STORE_URL');
 const result=await inspectStore(b.url);
 for(const p of result.products)p.images=await Promise.all((p.images||[]).map(async url=>({url,token:await imageToken(url,user.id,context.env)})));
 return json(result);
 }catch(e){const messages={STORE_URL:'Pega un enlace HTTPS público de tu tienda o producto.',STORE_READ:'No pudimos leer esa página. Prueba el enlace directo del producto o completa la ficha manualmente.',STORE_IMAGE:'No pudimos guardar esa foto. Vuelve a leer la tienda o sube una foto del producto.'};return messages[e.code]?json({code:e.code,error:messages[e.code]},422):studioError(e);}}
