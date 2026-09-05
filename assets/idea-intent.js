// Route links without pretending a saved reference URL has been watched.
export function ideaIntent(value){
 const text=value.trim(),match=text.match(/https?:\/\/[^\s<>]+|\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s<>]*)?/i);
 if(!match)return {text,url:'',kind:'idea'};
 try{
  const raw=match[0].replace(/[),.!?;]+$/,''),url=new URL(/^https?:\/\//i.test(raw)?raw:'https://'+raw);
  const host=url.hostname.toLowerCase().replace(/^www\./,'');
  const video=/(^|\.)(tiktok\.com|youtu\.be|youtube\.com|instagram\.com|facebook\.com|fb\.watch|vimeo\.com|pinterest\.com|pin\.it)$/.test(host)||/\.(mp4|webm|mov)$/i.test(url.pathname);
  return {text,url:url.href,kind:video?'reference':'store',idea:text.replace(match[0],'').trim()};
 }catch{return {text,url:'',kind:'idea'};}
}
export function storeProductData(p){
 return {name:(p.brand||p.name).slice(0,80),product:[p.name,p.description].filter(Boolean).join('. ').slice(0,600),appearance:'',benefits:'',claims:'',avoid:'',sourceUrl:p.url,sourceText:(p.sourceText||p.description||'').slice(0,6000),productAssetId:null};
}
