// Read only string-valued fields of a partially received, flat tool-argument object.
// Incomplete escapes and surrogate pairs are withheld until their next packet.
function stringAt(source,start){
 let text='',i=start+1;
 for(;i<source.length;i++){
  const c=source[i];if(c==='"')return {text,end:i+1,complete:true};
  if(c!=='\\'){text+=c;continue;}
  const escape=source[++i];if(escape===undefined)break;
  if(escape==='u'){const hex=source.slice(i+1,i+5);if(!/^[0-9a-fA-F]{4}$/.test(hex))break;text+=String.fromCharCode(parseInt(hex,16));i+=4;}
  else{const map={'"':'"','\\':'\\','/':'/','b':'\b','f':'\f','n':'\n','r':'\r','t':'\t'};if(!(escape in map))break;text+=map[escape];}
 }
 if(/[\uD800-\uDBFF]$/.test(text))text=text.slice(0,-1);
 return {text,end:source.length,complete:false};
}
export function partialFields(source){
 const result={};let i=0;const space=()=>{while(/\s/.test(source[i]||'!'))i++;};space();if(source[i++]!=='{')return result;
 while(i<source.length){space();if(source[i]!=='"')break;const key=stringAt(source,i);if(!key.complete)break;i=key.end;space();if(source[i++]!==':')break;space();
  if(source[i]==='"'){const value=stringAt(source,i);if(['operation','message','value'].includes(key.text))result[key.text]=value.text;if(!value.complete)break;i=value.end;}
  else{while(i<source.length&&!['}',','].includes(source[i])){if(['{','['].includes(source[i]))return result;i++;}}
  space();if(source[i++]!==',')break;
 }
 return result;
}
export function previewEmitter(onDelta){
 const sent={message:'',script:''};
 return args=>{const fields=partialFields(args),values={message:fields.message,script:['draft_script','set_hook'].includes(fields.operation)?fields.value:undefined};
  for(const [field,text] of Object.entries(values))if(typeof text==='string'&&text.startsWith(sent[field])&&text.length>sent[field].length){onDelta?.({type:'delta',field,text:text.slice(sent[field].length)});sent[field]=text;}
 };
}
