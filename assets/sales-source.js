// The client landing is saved with the brand revision; writing a script never
// refetches it or silently changes the product's offer.
export function salesSource(value){
 if(value==null)return undefined;
 const invalid=()=>{throw Object.assign(Error('STUDIO_INVALID'),{code:'STUDIO_INVALID'});};
 if(typeof value!=='object'||Array.isArray(value))invalid();
 const text=(v,max)=>typeof v==='string'&&v.length<=max?v.trim():invalid();
 const url=text(value.url,2000);let u;try{u=new URL(url);}catch{invalid();}
 if(u.protocol!=='https:'||u.username||u.password)invalid();
 return {url,title:text(value.title,160),text:text(value.text,12000),truncated:value.truncated===true};
}
