import {timingSafeEqual,createHash} from 'node:crypto';
import {callEditor} from '../src/studio-chat.js';
import {workflowApiKey} from '../src/model-provider.js';

const MAX_BODY=4*1024*1024;
const digest=value=>createHash('sha256').update(String(value||'')).digest();
export function createChatRuntime({env=process.env,edit=callEditor,log=entry=>console.log(JSON.stringify(entry))}={}){
 const pending=new Set();let closing=false;
 const ready=env.CHAT_RUNTIME_ENABLED==='true'&&String(env.CHAT_RUNTIME_TOKEN||'').length>=32&&!!workflowApiKey(env)&&!!(env.OPENCODE_API_KEY||env.REFERENCE_FLASH_KEY);
 const reply=(res,status,code)=>{if(!res.destroyed&&!res.headersSent)res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'}).end(JSON.stringify({code}));};
 async function run(req,res){
  if(!ready||closing){reply(res,503,'CHAT_OFFLINE');return;}
  if(!timingSafeEqual(digest(req.headers['x-chat-runtime-token']),digest(env.CHAT_RUNTIME_TOKEN))){reply(res,401,'UNAUTHORIZED');return;}
  if(req.method!=='POST'){reply(res,405,'METHOD_NOT_ALLOWED');return;}
  if(pending.size>=4){res.setHeader('retry-after','5');reply(res,503,'CHAT_OFFLINE');return;}
  try{
   if(!req.headers['content-type']?.includes('application/json')){reply(res,400,'CHAT_INVALID');return;}
   if(Number(req.headers['content-length'])>MAX_BODY){reply(res,413,'CHAT_INVALID');req.resume();return;}
   const chunks=[];let size=0;
   for await(const chunk of req){size+=chunk.length;if(size>MAX_BODY){reply(res,413,'CHAT_INVALID');return;}chunks.push(chunk);}
   let b;try{b=JSON.parse(Buffer.concat(chunks,size));}catch{reply(res,400,'CHAT_INVALID');return;}
   if(!b?.project?.data||!Array.isArray(b.versions)||!Array.isArray(b.history)||!Array.isArray(b.visuals)||typeof b.message!=='string'||!b.message.trim()||b.message.length>3000||typeof b.productionEnabled!=='boolean'){reply(res,400,'CHAT_INVALID');return;}
   res.writeHead(200,{'content-type':'text/event-stream; charset=utf-8','cache-control':'no-store, no-transform','x-accel-buffering':'no'});res.flushHeaders();
   const emit=event=>{if(!res.destroyed)res.write('data: '+JSON.stringify(event)+'\n\n');};
   emit({type:'started'});
   // Keep the connection alive while the script writer reasons without visible text.
   const heartbeat=setInterval(()=>{if(!res.destroyed)res.write(': heartbeat\n\n');},15000);heartbeat.unref();
   const start=Date.now();
   try{
    const result=await edit(b.project,b.versions,b.history,b.message,{...env,CHAT_RUNTIME_MODE:'local',PRODUCTION_ENABLED:b.productionEnabled?'true':'false'},fetch,emit,b.visuals);
    emit({type:'done',result});log({event:'chat_models_complete',wallMs:Date.now()-start,calls:result.usage?.calls?.map(c=>({model:c.model,usage:c.usage}))||[]});
   }catch(e){emit({type:'error',code:e.code||'CHAT_PROVIDER',error:'No se completó la respuesta. Recupera el resultado antes de intentar de nuevo.'});log({event:'chat_models_failed',code:e.code||'CHAT_PROVIDER'});}
   finally{clearInterval(heartbeat);res.end();}
  }catch(e){reply(res,503,'CHAT_PROVIDER');log({event:'chat_transport_failed',code:e.code||'TRANSPORT'});}
 }
 return {
  ready,
  get pendingCount(){return pending.size;},
  async handle(req,res){
   if(new URL(req.url,'http://runtime').pathname!=='/internal/chat-edit')return false;
   const task=run(req,res);pending.add(task);try{await task;}finally{pending.delete(task);}return true;
  },
  async close(){closing=true;await Promise.allSettled([...pending]);}
 };
}
