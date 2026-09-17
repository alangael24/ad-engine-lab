import {readChatResponse} from '../assets/chat-stream.js';
import {validateEdit} from '../assets/chat-model.js';

// Auth, ownership and the durable request ID stay at the edge. Only model work
// moves to the existing CPU server; it never receives database credentials.
export async function remoteChatEdit(input,env,fetchImpl=fetch,onDelta){
 const fail=code=>{throw Object.assign(Error(code),{code});};
 let target;
 try{
  target=new URL(env.CHAT_RUNTIME_URL);
  if(target.protocol!=='https:'||target.username||target.password||target.pathname!=='/'||target.search||target.hash||String(env.CHAT_RUNTIME_TOKEN||'').length<32)throw Error('CONFIG');
 }catch{fail('CHAT_OFFLINE');}
 target.pathname='/internal/chat-edit';
 // No retry or local fallback: a lost response must not buy the same calls twice.
 const response=await fetchImpl(target.href,{method:'POST',headers:{'content-type':'application/json','x-chat-runtime-token':env.CHAT_RUNTIME_TOKEN},body:JSON.stringify(input),redirect:'manual'});
 if(!response.ok){await response.body?.cancel();fail('CHAT_PROVIDER');}
 const result=await readChatResponse(response,delta=>onDelta?.(delta));
 if(!result?.edit)fail('CHAT_INVALID');
 validateEdit(result.edit);
 return result;
}
