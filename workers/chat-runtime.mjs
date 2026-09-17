import {timingSafeEqual,createHash} from 'node:crypto';
import {callEditor,getStudioChat,postStudioChat} from '../src/studio-chat.js';
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
  if(!['GET','POST'].includes(req.method)||(new URL(req.url,'http://runtime').pathname==='/internal/chat-edit'&&req.method!=='POST')){reply(res,405,'METHOD_NOT_ALLOWED');return;}
  if(pending.size>=4){res.setHeader('retry-after','5');reply(res,503,'CHAT_OFFLINE');return;}
  try{
   if(new URL(req.url,'http://runtime').pathname==='/internal/studio-chat'){await runStudio(req,res);return;}
   if(!req.headers['content-type']?.includes('application/json')){reply(res,400,'CHAT_INVALID');return;}
   if(Number(req.headers['content-length'])>MAX_BODY){reply(res,413,'CHAT_INVALID');req.resume();return;}
   const chunks=[];let size=0;
   for await(const chunk of req){size+=chunk.length;if(size>MAX_BODY){reply(res,413,'CHAT_INVALID');return;}chunks.push(chunk);}
   let b;try{b=JSON.parse(Buffer.concat(chunks,size));}catch{reply(res,400,'CHAT_INVALID');return;}
   if(!b?.project?.data||!Array.isArray(b.versions)||!Array.isArray(b.history)||!Array.isArray(b.visuals)||typeof b.message!=='string'||!b.message.trim()||b.message.length>3000||typeof b.productionEnabled!=='boolean'){reply(res,400,'CHAT_INVALID');return;}
   res.writeHead(200,{'content-type':'text/event-stream; charset=utf-8','cache-control':'no-store, no-transform','x-accel-buffering':'no'});res.flushHeaders();
   const write=event=>{if(!res.destroyed)res.write('data: '+JSON.stringify(event)+'\n\n');};
   let buffered=null,flushTimer;
   const flush=()=>{clearTimeout(flushTimer);flushTimer=null;if(buffered){write(buffered);buffered=null;}};
   const emit=event=>{
    if(event.type!=='delta'){flush();write(event);return;}
    if(buffered&&buffered.field!==event.field)flush();
    if(!buffered)buffered={...event};else buffered.text+=event.text;
    if(buffered.text.length>=256)flush();else if(!flushTimer){flushTimer=setTimeout(flush,100);flushTimer.unref();}
   };
   emit({type:'started'});
   // Keep the connection alive while the script writer reasons without visible text.
   const heartbeat=setInterval(()=>{if(!res.destroyed)res.write(': heartbeat\n\n');},15000);heartbeat.unref();
   const start=Date.now();
   try{
    const result=await edit(b.project,b.versions,b.history,b.message,{...env,CHAT_RUNTIME_MODE:'local',PRODUCTION_ENABLED:b.productionEnabled?'true':'false'},fetch,emit,b.visuals);
    emit({type:'done',result});log({event:'chat_models_complete',wallMs:Date.now()-start,calls:result.usage?.calls?.map(c=>({model:c.model,usage:c.usage}))||[]});
   }catch(e){emit({type:'error',code:e.code||'CHAT_PROVIDER',error:'No se completó la respuesta. Recupera el resultado antes de intentar de nuevo.'});log({event:'chat_models_failed',code:e.code||'CHAT_PROVIDER'});}
   finally{flush();clearInterval(heartbeat);res.end();}
  }catch(e){reply(res,503,'CHAT_PROVIDER');log({event:'chat_transport_failed',code:e.code||'TRANSPORT'});}
 }
 async function runStudio(req,res){
  const key=req.headers['x-chat-database-key'];
  if(typeof key!=='string'||!key){reply(res,503,'CHAT_OFFLINE');return;}
  // Never mutate process.env: independent requests may carry different users.
  const requestEnv={...env,CHAT_RUNTIME_MODE:'local',SUPABASE_URL:'https://ozkewphfxaohtihxmgoo.supabase.co',SUPABASE_SERVICE_ROLE_KEY:key,PRODUCTION_ENABLED:req.headers['x-chat-production-enabled']==='true'?'true':'false',REFERENCE_ANALYSIS_ENABLED:req.headers['x-chat-reference-enabled']==='true'?'true':'false',PRODUCTION_ALLOWED_USERS:req.headers['x-chat-production-users']||''};
  const headers=new Headers();for(const name of ['authorization','accept','content-type'])if(req.headers[name])headers.set(name,req.headers[name]);
  let body;
  if(req.method==='POST'){
   if(Number(req.headers['content-length'])>2400000){reply(res,413,'CHAT_INVALID');req.resume();return;}
   const chunks=[];let size=0;
   for await(const chunk of req){size+=chunk.length;if(size>2400000){reply(res,413,'CHAT_INVALID');return;}chunks.push(chunk);}
   body=Buffer.concat(chunks,size);
  }
  const tasks=[],start=Date.now();
  const context={env:requestEnv,request:new Request('https://creativerushai.com/api/studio-chat'+new URL(req.url,'http://runtime').search,{method:req.method,headers,...(body?{body}:{})}),waitUntil:task=>tasks.push(task)};
  const response=await (req.method==='GET'?getStudioChat:postStudioChat)(context);
  if(!res.destroyed){res.writeHead(response.status,Object.fromEntries(response.headers));res.flushHeaders();}
  // Drain even when the browser leaves: commit/undo/idempotency stay intact.
  try{if(response.body){const reader=response.body.getReader();try{while(true){const {value,done}=await reader.read();if(done)break;if(!res.destroyed)res.write(value);}}finally{reader.releaseLock();}}}
  finally{await Promise.allSettled(tasks);if(!res.destroyed)res.end();log({event:'chat_request_complete',status:response.status,wallMs:Date.now()-start});}
 }
 return {
  ready,
  get pendingCount(){return pending.size;},
  async handle(req,res){
   if(!['/internal/chat-edit','/internal/studio-chat'].includes(new URL(req.url,'http://runtime').pathname))return false;
   const task=run(req,res);pending.add(task);try{await task;}finally{pending.delete(task);}return true;
  },
  async close(){closing=true;await Promise.allSettled([...pending]);}
 };
}
