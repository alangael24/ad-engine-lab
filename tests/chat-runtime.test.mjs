import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createChatRuntime} from '../workers/chat-runtime.mjs';
import {remoteChatEdit} from '../src/chat-runtime-client.js';
import {postStudioChat} from '../src/studio-chat.js';
import {database,user,call} from './helpers/database.mjs';
import {mockSupabase} from './helpers/supabase-http.mjs';
const token='fixture-only-runtime-token-32-characters';
const env={CHAT_RUNTIME_ENABLED:'true',CHAT_RUNTIME_TOKEN:token,OPENAI_API_KEY:'fixture',REFERENCE_FLASH_KEY:'fixture'};
const input={project:{data:{}},versions:[],history:[],visuals:[],message:'Hola',productionEnabled:false};
const result={edit:{operation:'clarify',message:'Hola 🌊',value:null},usage:{calls:[]}};
const headers={'content-type':'application/json','x-chat-runtime-token':token};
async function host(edit){
 const logs=[],runtime=createChatRuntime({env,edit,log:x=>logs.push(x)});
 const server=createServer((req,res)=>{void runtime.handle(req,res).then(handled=>{if(!handled)res.writeHead(404).end();});});server.listen(0,'127.0.0.1');await once(server,'listening');
 const url=`http://127.0.0.1:${server.address().port}/internal/chat-edit`;
 return {runtime,logs,url,async close(){await runtime.close();server.closeAllConnections();await new Promise(r=>server.close(r));}};
}
test('internal chat rejects missing auth, invalid payloads and oversized input without model calls',async()=>{
 let calls=0;const h=await host(async()=>{calls++;return result;});try{
  assert.equal((await fetch(h.url,{method:'POST',body:'{}'})).status,401);
  assert.equal((await fetch(h.url,{headers})).status,405);
  assert.equal((await fetch(h.url,{method:'POST',headers,body:'{'})).status,400);
  assert.equal((await fetch(h.url,{method:'POST',headers,body:JSON.stringify({...input,message:''})})).status,400);
  assert.equal((await fetch(h.url,{method:'POST',headers,body:'x'.repeat(4*1024*1024+1)})).status,413);
  assert.equal(calls,0);
 }finally{await h.close();}
});
test('models run on the CPU host; edge forwards only validated output and visible previews',async()=>{
 let release,started;const gate=new Promise(r=>release=r),seen=new Promise(r=>started=r),deltas=[];
 const h=await host(async(p,v,history,message,e,f,emit)=>{assert.equal(e.CHAT_RUNTIME_MODE,'local');assert.equal(e.PRODUCTION_ENABLED,'false');emit({type:'delta',field:'message',text:'Hola 🌊'});await gate;return result;});
 try{
  const output=remoteChatEdit(input,{CHAT_RUNTIME_URL:'https://runtime.test',CHAT_RUNTIME_TOKEN:token},async(url,opts)=>{assert.equal(url,'https://runtime.test/internal/chat-edit');assert.equal(opts.redirect,'manual');return fetch(h.url,opts);},d=>{deltas.push(d);started();});
  await seen;assert.equal(h.runtime.pendingCount,1);release();assert.deepEqual(await output,result);assert.equal(deltas[0].text,'Hola 🌊');
  assert.ok(!JSON.stringify(h.logs).includes(token));
 }finally{release();await h.close();}
});
test('runtime limits concurrent work and drains requests during shutdown',async()=>{
 let release;const gate=new Promise(r=>release=r),h=await host(async()=>{await gate;return result;});try{
  const running=[];for(let i=0;i<4;i++)running.push(await fetch(h.url,{method:'POST',headers,body:JSON.stringify(input)}));
  assert.equal((await fetch(h.url,{method:'POST',headers,body:JSON.stringify(input)})).status,503);
  let drained=false;const closing=h.runtime.close().then(()=>{drained=true;});await Promise.resolve();assert.equal(drained,false);
  release();await Promise.all(running.map(r=>r.text()));await closing;assert.equal(h.runtime.pendingCount,0);
  assert.equal((await fetch(h.url,{method:'POST',headers,body:JSON.stringify(input)})).status,503);
 }finally{release();await h.close();}
});
test('runtime failure/truncation never falls back to a second model call',async()=>{
 for(const response of [new Response('',{status:503}),new Response('',{status:302,headers:{location:'https://elsewhere.test'}}),new Response('data: {"type":"started"}\n\n'),new Response('data: {"type":"done","result":{"edit":{"operation":"shell"}}}\n\n')]){
  let calls=0;await assert.rejects(remoteChatEdit(input,{CHAT_RUNTIME_URL:'https://runtime.test',CHAT_RUNTIME_TOKEN:token},async()=>{calls++;return response;}));assert.equal(calls,1);
 }
 await assert.rejects(remoteChatEdit(input,{CHAT_RUNTIME_URL:'http://runtime.test',CHAT_RUNTIME_TOKEN:token},()=>{throw Error('must not fetch');}),/CHAT_OFFLINE/);
});
test('remote work preserves ownership, disconnect recovery and request idempotency at the edge',async()=>{
 const db=await database(),owner=await user(db),stub=mockSupabase(db),original=globalThis.fetch;stub.users.set('alice',owner);let modelCalls=0,release;
 const queries=[];
 const gate=new Promise(r=>release=r),h=await host(async(p,v,history)=>{assert.ok(history.every(row=>!('before_data' in row)));modelCalls++;await gate;return {edit:{operation:'set_look',message:'Listo',value:'clay'},usage:{calls:[]}};});
 const settings={SUPABASE_URL:'http://supabase.test',SUPABASE_SERVICE_ROLE_KEY:'fixture',REFERENCE_ANALYSIS_ENABLED:'true',OPENAI_API_KEY:'fixture',REFERENCE_FLASH_KEY:'fixture',CHAT_RUNTIME_MODE:'remote',CHAT_RUNTIME_URL:'https://runtime.test',CHAT_RUNTIME_TOKEN:token};
 globalThis.fetch=(url,opts)=>{if(String(url).includes('/rest/v1/studio_chat_edits'))queries.push(new URL(url));return String(url)==='https://runtime.test/internal/chat-edit'?original(h.url,opts):stub.fetch(url,opts);};
 try{
  const brand=await call(db,'studio_write',[owner.id,'save_brand',crypto.randomUUID(),JSON.stringify({name:'Nebula',product:'Filtro'}),null]);
  const project=await call(db,'studio_write',[owner.id,'create_project',crypto.randomUUID(),JSON.stringify({title:'Test',brandId:brand.id,scenes:[],aspectRatio:'9:16',referenceUrl:'',referenceNotes:''}),null]);
  const body={projectId:project.id,expected:project.revision,requestId:crypto.randomUUID(),message:'Cámbialo a clay'},pending=[];
  const ctx=(auth='alice')=>({env:settings,waitUntil:p=>pending.push(p),request:new Request('https://app.test/api/studio-chat',{method:'POST',headers:{authorization:'Bearer '+auth,accept:'text/event-stream','content-type':'application/json'},body:JSON.stringify(body)})});
  assert.equal((await postStudioChat(ctx('invalid'))).status,401);assert.equal(modelCalls,0);
  const response=await postStudioChat(ctx()),reader=response.body.getReader();await reader.read();await reader.cancel();release();await Promise.all(pending);
  const replay=await postStudioChat(ctx());assert.equal((await replay.json()).edit.status,'succeeded');assert.equal(modelCalls,1);
  assert.equal(queries.length,0); // History comes from the same atomic prepare RPC.
 }finally{release();globalThis.fetch=original;await h.close();await db.close();}
});
test('full runtime route authenticates the user and preserves idempotency without edge JSON processing',async()=>{
 const db=await database(),owner=await user(db),stub=mockSupabase(db),original=globalThis.fetch;
 stub.users.set('alice',owner);let calls=0;
 const h=await host();
 globalThis.fetch=(url,opts)=>{
  if(String(url).startsWith('https://ozkewphfxaohtihxmgoo.supabase.co'))return stub.fetch(String(url).replace('https://ozkewphfxaohtihxmgoo.supabase.co','http://supabase.test'),opts);
  if(String(url)==='https://api.openai.com/v1/responses'){calls++;return Promise.resolve(new Response('data: '+JSON.stringify({model:'gpt-6-astra',choices:[{finish_reason:'tool_calls',delta:{tool_calls:[{index:0,function:{name:'edit_project',arguments:JSON.stringify({operation:'set_look',value:'clay',message:'Listo'})}}]}}]})+'\n\n'));}
  return original(url,opts);
 };
 try{
  const brand=await call(db,'studio_write',[owner.id,'save_brand',crypto.randomUUID(),JSON.stringify({name:'Nebula',product:'Filtro'}),null]);
  const project=await call(db,'studio_write',[owner.id,'create_project',crypto.randomUUID(),JSON.stringify({title:'Test',brandId:brand.id,scenes:[],aspectRatio:'9:16',referenceUrl:'',referenceNotes:''}),null]);
  const body=JSON.stringify({projectId:project.id,expected:project.revision,requestId:crypto.randomUUID(),message:'Cambia a clay. '+ 'x'.repeat(11000)}),url=h.url.replace('/chat-edit','/studio-chat');
  const opts={method:'POST',headers:{...headers,'x-chat-database-key':'fixture','x-chat-reference-enabled':'true',authorization:'Bearer alice'},body};
  assert.equal((await original(url,{...opts,headers:{...opts.headers,authorization:'Bearer invalid'}})).status,401);
  const first=await original(url,opts),data=await first.json();assert.equal(first.status,200,JSON.stringify(data));assert.equal(data.edit.status,'succeeded');
  const repeat=await original(url,opts);assert.equal((await repeat.json()).edit.status,'succeeded');assert.equal(calls,1);
  assert.ok(!JSON.stringify(h.logs).includes('fixture'));
 }finally{globalThis.fetch=original;await h.close();await db.close();}
});
