const $=s=>document.querySelector(s);
const node=(tag,text)=>{const n=document.createElement(tag);if(text)n.textContent=text;return n;};
export function storePanel({api,task,tell,getBrand,changed}){
 let selected=null,epoch=0;
 const show=()=>{$('#brand-form').hidden=false;};
 function photos(images=[]){const root=$('#store-photos');root.replaceChildren();for(const image of images){const b=node('button');b.type='button';b.className='store-photo';b.setAttribute('aria-label','Usar esta foto del producto');b.setAttribute('aria-pressed',String(selected?.token===image.token));const img=node('img');img.src=image.url;img.alt='Foto del producto en la tienda';img.referrerPolicy='no-referrer';img.loading='lazy';b.append(img);b.onclick=()=>{selected=image;getBrand().data.productAssetId=null;$('#brand-photo-preview').hidden=true;photos(images);changed();};root.append(b);}root.hidden=!images.length;}
 async function choose(p){
  const current=epoch;
  if(p.description===undefined){const details=await api('/api/store-import',{method:'POST',body:{action:'inspect',url:p.url}});if(current!==epoch)return;p=details.products.find(x=>x.description!==undefined)||null;if(!p){show();throw Error('No encontramos la descripción. Escribe qué producto quieres anunciar.');}}
  const brand=getBrand();if(brand.revision&&!confirm('¿Reemplazar la descripción y la foto de esta ficha con el producto seleccionado?'))return;
  const values={name:p.brand||p.name,product:[p.name,p.description].filter(Boolean).join('. ').slice(0,600),appearance:'',benefits:'',claims:'',avoid:'',sourceUrl:p.url,sourceText:p.sourceText||p.description||''};
  Object.assign(brand.data,values,{productAssetId:null});for(const [k,v] of Object.entries(values)){const field=$('#brand-form').elements.namedItem(k);if(field)field.value=v;}
  selected=p.images?.[0]||null;photos(p.images);$('#brand-photo-preview').hidden=true;$('#store-source').textContent='Información obtenida de '+new URL(p.url).hostname+'. Puedes editarla.';show();changed();$('#store-products').replaceChildren();$('#store-status').textContent='Producto listo. Guarda la marca para usarlo en tus anuncios.';
 }
 $('#store-form').onsubmit=e=>{e.preventDefault();task(async()=>{const current=epoch;const button=$('#store-load');button.disabled=true;$('#store-status').textContent='Buscando productos en tu tienda…';try{const result=await api('/api/store-import',{method:'POST',body:{action:'inspect',url:$('#store-url').value.trim()}});if(current!==epoch)return;const root=$('#store-products');root.replaceChildren();if(result.products.length===1&&result.products[0].description!==undefined){await choose(result.products[0]);return;}$('#store-status').textContent=result.products.length?'Elige el producto que quieres anunciar.':'No encontramos productos. Prueba su enlace directo o completa la ficha manualmente.';for(const p of result.products){const card=node('button');card.type='button';card.className='store-product';if(p.images?.[0]){const img=node('img');img.src=p.images[0].url;img.referrerPolicy='no-referrer';img.alt='';img.loading='lazy';card.append(img);}card.append(node('span',p.name));card.onclick=()=>task(()=>choose(p));root.append(card);}}catch(e){if(current===epoch){$('#store-status').textContent=e.message;show();}}finally{button.disabled=false;}});};
 $('#store-manual').onclick=()=>{show();$('#brand-form [name=name]').focus();};
 return {
  open(brand){epoch++;selected=null;photos();$('#store-url').value=brand.data.sourceUrl||'';$('#store-status').textContent='';$('#store-products').replaceChildren();$('#store-source').textContent=brand.data.sourceUrl?'Datos de tu tienda, editables.':'';$('#brand-form').hidden=!brand.revision;$('#brand-details').open=false;},
  clearPhoto(){selected=null;photos();},
  async savePhoto(){if(!selected)return;const token=selected.token,brand=getBrand();const {asset}=await api('/api/store-import',{method:'POST',body:{action:'image',token}});brand.data.productAssetId=asset.id;if(getBrand()===brand)selected=null;},
 };
}
