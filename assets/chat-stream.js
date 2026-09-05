// Shared SSE reader: decode UTF-8 across packets and keep incomplete event lines.
export async function readEvents(response,onEvent,maxBytes=500000){
 const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',lines=[],size=0,done=false;
 const flush=()=>{if(!lines.length)return;const data=lines.join('\n');lines=[];if(data!=='[DONE]')onEvent(JSON.parse(data));};
 const line=text=>{if(text.endsWith('\r'))text=text.slice(0,-1);if(!text)flush();else if(text.startsWith('data:'))lines.push(text.slice(5).replace(/^ /,''));};
 try{while(true){const packet=await reader.read();if(packet.done){done=true;buffer+=decoder.decode();break;}size+=packet.value.byteLength;if(size>maxBytes)throw Error('Stream too large');buffer+=decoder.decode(packet.value,{stream:true});let i;while((i=buffer.indexOf('\n'))>=0){line(buffer.slice(0,i));buffer=buffer.slice(i+1);}}
  if(buffer)line(buffer);flush();
 }finally{if(!done)await reader.cancel().catch(()=>{});reader.releaseLock();}
}
export async function readChatResponse(response,onDelta){
 let result;
 await readEvents(response,event=>{
  if(event.type==='delta'&&['message','script'].includes(event.field)&&typeof event.text==='string')onDelta(event);
  if(event.type==='done')result=event.result;
  if(event.type==='error')throw Object.assign(Error(event.error||'No se completó la respuesta.'),{code:event.code||'CHAT_PROVIDER'});
 });
 if(!result)throw Object.assign(Error('La conexión se interrumpió.'),{code:'CHAT_STREAM_INTERRUPTED'});
 return result;
}
