import {FORMATS,LOOKS,creativeLabel} from './creative-formats.js';
import {ideaIntent,storeProductData} from './idea-intent.js';
const $=s=>document.querySelector(s),el=(tag,text)=>{const n=document.createElement(tag);if(text)n.textContent=text;return n;};
export function ideaComposer({task,tell,brands,create,openBrand,home,startChat,attachReference,api,saveBrand}){
 let fingerprint=null,brandId=null,creative={format:'auto',look:'auto'},file=null,requestId=null,currentProject=null,resumeAfterChoice=false,waitingForStore=false,savedIdea='',savedReference='',imported=null;
 const input=$('#idea-input'),status=$('#idea-status');
 const note=text=>{status.textContent=text;status.hidden=!text;};
 const closeChoices=()=>{$('#product-picker').hidden=true;};
 function closeDialogs(){document.querySelectorAll('.creative-dialog[open]').forEach(d=>d.close());$('#idea-options').open=false;}
 function remember(id){brandId=id;try{localStorage.setItem('studio-last-product',id);}catch{}controls();}
 function controls(){
  if(!brands().some(b=>b.id===brandId)){let last;try{last=localStorage.getItem('studio-last-product');}catch{}brandId=brands().some(b=>b.id===last)?last:brands().length===1?brands()[0].id:null;}
  const onboarding=waitingForStore||!brands().length;
  $('.home-heading h1').textContent=onboarding?'¿Qué producto vamos a anunciar?':'¿Qué anuncio quieres crear?';
  input.placeholder=onboarding?'Ej. mitienda.com':'Describe tu idea o añade una referencia…';
  $('#empty').classList.toggle('needs-product',onboarding);
  $('#idea-label').className=onboarding?'home-input-label':'sr-only';
  $('#idea-label').textContent=onboarding?'Pega el enlace de tu tienda o producto':'Tu idea o referencia';
  $('#idea-submit').textContent=onboarding?'Continuar':'↑';
  input.setAttribute('inputmode',onboarding?'url':'text');
  $('#idea-attach').hidden=onboarding;$('#idea-options').hidden=onboarding;
  $('#idea-submit').setAttribute('aria-label',onboarding?'Continuar':'Crear anuncio');$('#idea-submit').title=onboarding?'Continuar':'Crear anuncio';
  const b=brands().find(b=>b.id===brandId);$('#idea-product').hidden=!b;$('#idea-product').textContent=b?b.data.name+' ⌄':'';
  $('#idea-style').textContent=creative.format==='auto'&&creative.look==='auto'?'Estilo automático':creativeLabel(creative);
 }
 function askStore(){closeChoices();closeDialogs();waitingForStore=true;if(!savedIdea&&input.value.trim()&&ideaIntent(input.value).kind==='idea')savedIdea=input.value.trim();input.value='';resize();controls();note('');input.focus();}
 function choices(title,products,choose){const root=$('#idea-products');root.replaceChildren();$('#product-question').textContent=title;for(const p of products){const b=el('button');b.type='button';b.className='product-choice';if(p.image){const img=el('img');img.src=p.image;img.alt='';img.referrerPolicy='no-referrer';b.append(img);}b.append(el('span',p.name));b.onclick=()=>task(()=>choose(p));root.append(b);}$('#idea-manual').hidden=true;$('#product-picker').hidden=false;}
 function chooseProduct(){
  if(!brands().length){askStore();return;}
  choices('¿Para qué producto?',brands().map(b=>({id:b.id,name:b.data.name})),async p=>{waitingForStore=false;remember(p.id);closeChoices();if(resumeAfterChoice){resumeAfterChoice=false;waitingForStore=false;input.value=savedIdea||input.value;await submit();}});
 }
 function styles(){for(const [selector,options,key] of [['#format-options',FORMATS,'format'],['#look-options',LOOKS,'look']]){const root=$(selector);root.replaceChildren();for(const [id,option] of Object.entries(options)){const b=el('button');b.type='button';b.className=key==='format'?'format-card format-'+id:'look-chip look-'+id;b.setAttribute('aria-pressed',String(creative[key]===id));b.append(el('strong',option.name));b.onclick=()=>{creative={...creative,[key]:id};styles();controls();};root.append(b);}}}
 function attachment(){const root=$('#idea-attachment');root.replaceChildren();root.hidden=!file;if(file){root.append(el('span',file.name));const remove=el('button','×');remove.type='button';remove.setAttribute('aria-label','Quitar referencia');remove.onclick=()=>{file=null;$('#idea-file').value='';attachment();};root.append(remove);}}
 function selectFile(f){if(!f)return;if(!f.type.startsWith('video/')||f.size>200*1024*1024){tell('Usa un video de hasta 200 MB.',true);return;}file=f;attachment();input.focus();}
 function step(name){document.querySelectorAll('[data-step]').forEach(n=>n.hidden=n.dataset.step!==name);document.querySelectorAll('[data-workflow]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.workflow===name)));}
 async function useProduct(p){
  note('Preparando tu producto…');
  if(p.description===undefined){const details=await api('/api/store-import',{method:'POST',body:{action:'inspect',url:p.url}});p=details.products.find(x=>x.description!==undefined);if(!p)throw Error('No pude leer ese producto. Prueba su enlace directo.');}
  // Reuse the same saved asset and brand identity if delivery is interrupted.
  if(imported?.url!==p.url)imported={url:p.url,id:crypto.randomUUID(),data:storeProductData(p),photo:p.images?.[0]?.token};
  if(imported.photo&&!imported.data.productAssetId){const {asset}=await api('/api/store-import',{method:'POST',body:{action:'image',token:imported.photo}});imported.data.productAssetId=asset.id;}
  const existing=brands().find(b=>b.id===imported.id);
  const brand=existing||await saveBrand(imported.id,imported.data);
  waitingForStore=false;remember(brand.id);closeChoices();resumeAfterChoice=false;
  if(savedIdea||file){await launch(savedIdea||'Crea un anuncio inspirado en este video.');return;}
  input.value='';resize();note('');input.focus();
 }
 async function inspect(url){
  note('Leyendo tu tienda…');
  try{
   const d=await api('/api/store-import',{method:'POST',body:{action:'inspect',url}});
   if(d.products.length===1){await useProduct(d.products[0]);return;}
   if(!d.products.length)throw Error('No encontré productos. Pega el enlace directo de uno.');
   note('');choices('¿Qué producto anunciamos?',d.products.map(p=>({...p,image:p.images?.[0]?.url})),async p=>{try{await useProduct(p);}catch(e){note(e.message);}});
  }catch(e){note(e.message||'No pude abrir tu tienda. Prueba el enlace de un producto.');$('#idea-manual').hidden=false;$('#product-question').textContent='';$('#idea-products').replaceChildren();$('#product-picker').hidden=false;}
 }
 async function launch(idea){
  const nextFingerprint=JSON.stringify({idea,creative,brandId,referenceUrl:savedReference});if(nextFingerprint!==fingerprint){requestId=crypto.randomUUID();fingerprint=nextFingerprint;}requestId??=crypto.randomUUID();
  note('Preparando tu anuncio…');
  await create(requestId,{title:idea.slice(0,100),idea,creative,brandId,referenceUrl:savedReference,referenceNotes:'',aspectRatio:'9:16',scenes:[],narrationAssetId:null,timingConfirmed:false});requestId=null;
  input.value='';savedIdea='';savedReference='';waitingForStore=false;note('');closeChoices();resize();
  if(file){const selected=file;file=null;$('#idea-file').value='';attachment();await attachReference(selected);}else await startChat(idea.slice(0,2000));
 }
 async function submit(){
  const button=$('#idea-submit');button.disabled=true;
  try{
   const parsed=ideaIntent(input.value),hasBrand=brands().some(b=>b.id===brandId);
   if(parsed.kind==='store'){
    if(parsed.idea&&!waitingForStore)savedIdea=parsed.idea;
    await inspect(parsed.url);return;
   }
   if(waitingForStore){note('Pega el enlace de tu producto o añade sus datos.');if(brands().length)chooseProduct();else{$('#idea-products').replaceChildren();$('#product-question').textContent='';$('#idea-manual').hidden=false;$('#product-picker').hidden=false;}return;}
   const idea=parsed.text||savedIdea||(file?'Crea un anuncio inspirado en este video.':'');
   if(!idea){input.focus();return;}
   if(parsed.kind==='reference')savedReference=parsed.url;
   if(!hasBrand){savedIdea=idea;resumeAfterChoice=true;chooseProduct();return;}
   await launch(idea);
  }finally{button.disabled=false;}
 }
 $('#idea-product').onclick=chooseProduct;$('#idea-style').onclick=()=>{styles();$('#idea-options').open=false;$('#style-picker').showModal();};$('#style-done').onclick=closeDialogs;
 document.querySelectorAll('[data-close-dialog]').forEach(b=>b.onclick=()=>b.closest('dialog').close());
 $('#product-close').onclick=()=>{closeChoices();resumeAfterChoice=false;};
 $('#idea-import').onclick=askStore;$('#idea-manual').onclick=()=>openBrand();
 $('#idea-attach').onclick=()=>$('#idea-file').click();$('#idea-file').onchange=()=>selectFile($('#idea-file').files[0]);
 const form=$('#idea-form');
 form.addEventListener('dragover',e=>{if(e.dataTransfer.types.includes('Files')){e.preventDefault();form.classList.add('dragging');}});
 form.addEventListener('dragleave',()=>form.classList.remove('dragging'));
 form.addEventListener('drop',e=>{form.classList.remove('dragging');if(e.dataTransfer.files.length){e.preventDefault();selectFile(e.dataTransfer.files[0]);}});
 input.addEventListener('paste',e=>{const f=[...(e.clipboardData?.files||[])].find(f=>f.type.startsWith('video/'));if(f){e.preventDefault();selectFile(f);}});
 const resize=()=>{input.style.height='auto';input.style.height=Math.min(input.scrollHeight,170)+'px';};input.addEventListener('input',resize);
 input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&matchMedia('(pointer:fine)').matches){e.preventDefault();if(!$('#idea-submit').disabled)form.requestSubmit();}});
 document.querySelectorAll('[data-workflow]').forEach(b=>b.onclick=()=>step(b.dataset.workflow));
 form.onsubmit=e=>{e.preventDefault();task(submit);};
 return {refresh:controls,open(id){if(id)remember(id);controls();home();input.focus();},hasDraft:()=>Boolean(file||savedIdea||input.value.trim()),project(p){$('#project-idea').textContent=p.data.idea||p.data.title;$('#project-direction').textContent='';const c=p.data.creative||{format:'auto',look:'auto'};if(c.format!=='auto')$('#context-copy').append(el('p',FORMATS[c.format].description));if(c.look==='clay')$('#context-copy').append(el('p','Plastilina: un mundo artesanal con textura y continuidad entre escenas.'));if(currentProject!==p.id){currentProject=p.id;step('idea');}},step};
}
