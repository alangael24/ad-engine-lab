export function scriptVariantCards(variants,{disabled=false,onChoose=()=>{}}={}){
 const root=document.createElement('section');root.className='script-variants';root.setAttribute('aria-label','Tres variantes de guion');
 for(const [i,option] of variants.options.entries()){
  const card=document.createElement('article');card.className='script-variant';
  const heading=document.createElement('h3');heading.textContent=`${i+1}. ${option.title}`;
  const angle=document.createElement('p');angle.className='script-variant-angle';angle.textContent=option.angle;
  const script=document.createElement('p');script.className='script-variant-copy';script.textContent=option.script;
  const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent=`Usar variante ${i+1}`;button.disabled=disabled;
  button.onclick=()=>onChoose(i+1,variants.id);card.append(heading,angle,script,button);root.append(card);
 }
 return root;
}
