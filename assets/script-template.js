const form=document.querySelector('#script-form');
const output=document.querySelector('#script-output');
const status=document.querySelector('#copy-status');
form.addEventListener('submit',event=>{
 event.preventDefault();
 const data=new FormData(form);
 const clean=name=>String(data.get(name)||'').trim().replace(/[.?!¿¡]+$/,'');
 const product=clean('product'),problem=clean('problem').replace(/^[¿¡]+/,''),benefit=clean('benefit'),proof=clean('proof'),cta=clean('cta');
 if(![product,problem,benefit,proof,cta].every(Boolean)){status.textContent='Completa los cinco campos con información de tu producto.';document.querySelector('#script-result').hidden=false;return;}
 output.value=`¿${problem}?

Conoce ${product}.

La idea es ${benefit.charAt(0).toLowerCase()+benefit.slice(1)}.

Mira: ${proof}.

${cta}.`;
 document.querySelector('#script-result').hidden=false;status.textContent='Borrador listo. Puedes editarlo antes de copiar.';output.focus();
});
document.querySelector('#copy-script').addEventListener('click',async()=>{
 try{await navigator.clipboard.writeText(output.value);status.textContent='Guion copiado.';}
 catch{output.focus();output.select();status.textContent='Seleccionamos el texto. Cópialo con el menú o el atajo de tu dispositivo.';}
});
