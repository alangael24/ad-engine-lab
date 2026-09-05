import {FORMATS,LOOKS,creativeLabel,creativeGuide} from './creative-formats.js';
const $=s=>document.querySelector(s),el=(tag,text)=>{const n=document.createElement(tag);if(text)n.textContent=text;return n;};
export function ideaComposer({task,tell,brands,create,openBrand,home,getProject,startChat}){
 let fingerprint=null,brandId=null,creative={format:'auto',look:'auto'},file=null,requestId=null,currentProject=null,resumeAfterChoice=false;
 function closeDialogs(){document.querySelectorAll('.creative-dialog[open]').forEach(d=>d.close());}
 function productLabel(){const b=brands().find(b=>b.id===brandId);$('#idea-product').textContent=b?'＠ '+b.data.name:'＠ Producto';}
 function controls(){if(!brandId&&brands().length===1)brandId=brands()[0].id;productLabel();$('#idea-style').textContent='✧ '+creativeLabel(creative);}
 function chooseProduct(){const root=$('#idea-products');root.replaceChildren();for(const b of brands()){const button=el('button',b.data.name);button.type='button';button.className='product-choice';button.append(el('small',b.data.product.slice(0,140)));button.onclick=()=>{brandId=b.id;controls();closeDialogs();if(resumeAfterChoice){resumeAfterChoice=false;$('#idea-form').requestSubmit();}};root.append(button);}$('#product-picker').showModal();}
 function styles(){for(const [selector,options,key] of [['#format-options',FORMATS,'format'],['#look-options',LOOKS,'look']]){const root=$(selector);root.replaceChildren();for(const [id,option] of Object.entries(options)){const b=el('button');b.type='button';b.className=key==='format'?'format-card format-'+id:'look-chip look-'+id;b.setAttribute('aria-pressed',String(creative[key]===id));if(key==='format'){const art=el('span',id==='skeleton'?'☠':id==='explainer'?'◎':'✦');art.className='format-art';art.setAttribute('aria-hidden','true');b.append(art);}b.append(el('strong',option.name));if(option.description)b.append(el('small',option.description));b.onclick=()=>{creative={...creative,[key]:id};styles();controls();};root.append(b);}}}
 function attachment(){const root=$('#idea-attachment');root.replaceChildren();root.hidden=!file;if(file){root.append(el('span','▤ '+file.name));const remove=el('button','×');remove.type='button';remove.setAttribute('aria-label','Quitar referencia');remove.onclick=()=>{file=null;$('#idea-file').value='';attachment();};root.append(remove);}}
 function step(name){document.querySelectorAll('[data-step]').forEach(n=>n.hidden=n.dataset.step!==name);document.querySelectorAll('[data-workflow]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.workflow===name)));}
 $('#idea-product').onclick=chooseProduct;$('#idea-style').onclick=()=>{styles();$('#style-picker').showModal();};$('#style-done').onclick=closeDialogs;
 document.querySelectorAll('[data-close-dialog]').forEach(b=>b.onclick=()=>b.closest('dialog').close());
 $('#idea-import').onclick=()=>{closeDialogs();openBrand();};
 $('#idea-attach').onclick=()=>$('#idea-file').click();$('#idea-file').onchange=()=>{const f=$('#idea-file').files[0];if(f&&(!f.type.startsWith('video/')||f.size>200*1024*1024)){tell('Usa un video de hasta 200 MB.',true);return;}file=f||null;attachment();};
 document.querySelectorAll('[data-starter]').forEach(b=>b.onclick=()=>{$('#idea-input').value=b.dataset.starter;$('#idea-input').focus();});
 document.querySelectorAll('[data-workflow]').forEach(b=>b.onclick=()=>step(b.dataset.workflow));
 $('#idea-form').onsubmit=e=>{e.preventDefault();task(async()=>{
  const idea=$('#idea-input').value.trim();
  if(/^https:\/\/\S+$/.test(idea)||/^[a-z0-9.-]+\.[a-z]{2,}(?:\/\S*)?$/i.test(idea)){openBrand();$('#store-url').value=idea;$('#store-status').textContent='Pulsa «Encontrar mi producto» para traer la ficha de tu tienda.';return;}
  if(!idea){tell('Escribe la idea de tu anuncio.',true);$('#idea-input').focus();return;}
  if(!brands().some(b=>b.id===brandId)){resumeAfterChoice=true;chooseProduct();return;}
  const button=$('#idea-submit');button.disabled=true;
  // Preserve the same request identity after an ambiguous create response.
  const nextFingerprint=JSON.stringify({idea,creative,brandId});if(nextFingerprint!==fingerprint){requestId=crypto.randomUUID();fingerprint=nextFingerprint;}requestId??=crypto.randomUUID();
  try{const p=await create(requestId,{title:idea.slice(0,100),idea,creative,brandId,referenceUrl:'',referenceNotes:'',aspectRatio:'9:16',scenes:[],narrationAssetId:null,timingConfirmed:false});requestId=null;
   if(file){const transfer=new DataTransfer();transfer.items.add(file);$('#reference-file').files=transfer.files;$('#reference-file').dispatchEvent(new Event('change'));file=null;$('#idea-file').value='';attachment();$('#reference-dialog').showModal();tell('Idea guardada. La referencia está lista para analizar.');}else{await startChat(idea.slice(0,2000));}
   $('#idea-input').value='';
  }finally{button.disabled=false;}
 });};
 return {refresh:controls,open(id){if(id)brandId=id;controls();home();$('#idea-input').focus();},hasDraft:()=>Boolean(file||$('#idea-input').value.trim()),project(p){$('#project-idea').textContent=p.data.idea||p.data.title;$('#project-direction').textContent='Dirección: '+creativeLabel(p.data.creative);const c=p.data.creative||{format:'auto',look:'auto'};if(c.format!=='auto')$('#context-copy').append(el('p',FORMATS[c.format].description));if(c.look==='clay')$('#context-copy').append(el('p','Plastilina: un mundo artesanal con textura y continuidad entre escenas.'));if(currentProject!==p.id){currentProject=p.id;step('idea');}},step};
}
