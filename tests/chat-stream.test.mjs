import test from 'node:test';import assert from 'node:assert/strict';
import {partialFields,previewEmitter} from '../src/chat-stream.js';
import {readEvents,readChatResponse} from '../assets/chat-stream.js';
import {callEditor,postStudioChat} from '../src/studio-chat.js';
import {CHAT_MODEL} from '../assets/chat-model.js';
import {database,user,call} from './helpers/database.mjs';
import {mockSupabase} from './helpers/supabase-http.mjs';
const encoder=new TextEncoder(),event=d=>'data: '+JSON.stringify(d)+'\n\n';
const piece=args=>({model:CHAT_MODEL,choices:[{delta:{tool_calls:[{index:0,function:{name:'edit_project',arguments:args}}]}}]});
test('partial JSON handles escapes and withholds incomplete Unicode without exposing other fields',()=>{
 const source=JSON.stringify({operation:'draft_script',message:'Aquí "sí". 🌊',value:'Primera\nsegunda',sceneId:'private-id'}),deltas=[],emit=previewEmitter(d=>deltas.push(d));
 for(let i=0;i<=source.length;i++)emit(source.slice(0,i));
 assert.equal(deltas.filter(x=>x.field==='message').map(x=>x.text).join(''),'Aquí "sí". 🌊');
 assert.equal(deltas.filter(x=>x.field==='script').map(x=>x.text).join(''),'Primera\nsegunda');
 assert.ok(!JSON.stringify(deltas).includes('private-id'));
 assert.equal(partialFields('{"message":"x\\uD83C').message,'x');
 assert.equal(partialFields('{"message":"fake \\"value\\": text"}').value,undefined);
});
test('SSE survives byte-by-byte UTF-8 packets and detects a missing completion',async()=>{
 const bytes=encoder.encode(': keepalive\r\ndata: '+JSON.stringify({type:'delta',field:'message',text:'Hola 🌊'})+'\r\n\r\n'+event({type:'done',result:{edit:{status:'succeeded'}}}));
 const response=()=>new Response(new ReadableStream({start(c){for(const byte of bytes)c.enqueue(Uint8Array.of(byte));c.close();}}));
 const seen=[];assert.equal((await readChatResponse(response(),d=>seen.push(d))).edit.status,'succeeded');assert.equal(seen[0].text,'Hola 🌊');
 await assert.rejects(readChatResponse(new Response(event({type:'delta',field:'message',text:'Partial'})),()=>{}),/interrumpió/);
});
test('director previews arrive before upstream completes; truncated tool output still rejects',async()=>{
 let controller,first;const received=new Promise(r=>first=r),out=[];
 const response=new Response(new ReadableStream({start(c){controller=c;}}));
 const result=callEditor({data:{}},[],[],'Hola',{},async()=>response,d=>{out.push(d);first();});
 controller.enqueue(encoder.encode(event(piece('{"operation":"draft_script","message":"Hola mundo. ","value":"Una'))));
 await received;assert.ok(out.length);let settled=false;result.finally(()=>{settled=true;}).catch(()=>{});await Promise.resolve();assert.equal(settled,false);
 controller.enqueue(encoder.encode(event({choices:[{delta:{tool_calls:[{index:0,function:{arguments:' frase."}'}}]},finish_reason:'tool_calls'}]})));controller.close();assert.equal((await result).edit.value,'Una frase.');
 await assert.rejects(callEditor({data:{}},[],[],'X',{},async()=>new Response(event(piece('{"operation":"draft_script","message":"Hola')))),/CHAT_INVALID/);
});
test('stream preview never commits until validation; lost browser does not duplicate the completed request',async()=>{
 const db=await database(),owner=await user(db),stub=mockSupabase(db),original=globalThis.fetch;stub.users.set('alice',owner);let providerCalls=0,controller;
 const env={SUPABASE_URL:'http://supabase.test',SUPABASE_SERVICE_ROLE_KEY:'fixture',REFERENCE_ANALYSIS_ENABLED:'true',REFERENCE_FLASH_KEY:'fixture'};
 globalThis.fetch=async(url,options)=>{if(String(url).includes('opencode.ai')){providerCalls++;return new Response(new ReadableStream({start(c){controller=c;}}));}return stub.fetch(url,options);};
 try{
  const b=await call(db,'studio_write',[owner.id,'save_brand',crypto.randomUUID(),JSON.stringify({name:'Nebula',product:'Filtro'}),null]);
  const p=await call(db,'studio_write',[owner.id,'create_project',crypto.randomUUID(),JSON.stringify({title:'Test',brandId:b.id,scenes:[],aspectRatio:'9:16',referenceUrl:'',referenceNotes:''}),null]);
  const request={projectId:p.id,expected:p.revision,requestId:crypto.randomUUID(),message:'Escribe el guion'},pending=[];
  const ctx=()=>({env,waitUntil:p=>pending.push(p),request:new Request('https://app.test/api/studio-chat',{method:'POST',headers:{authorization:'Bearer alice',accept:'text/event-stream','content-type':'application/json'},body:JSON.stringify(request)})});
  const response=await postStudioChat(ctx());assert.match(response.headers.get('content-type'),/event-stream/);const reader=response.body.getReader();await reader.read();
  // The async provider request starts after the initial status packet.
  while(!controller)await new Promise(r=>setTimeout(r,1));
  controller.enqueue(encoder.encode(event(piece('{"operation":"draft_script","message":"Aquí tienes el guion. ","value":"Hola '))));
  const chunk=await reader.read();assert.match(new TextDecoder().decode(chunk.value),/delta/);
  assert.equal((await call(db,'studio_read',[owner.id,p.id])).project.revision,p.revision);
  await reader.cancel();
  controller.enqueue(encoder.encode(event({choices:[{delta:{tool_calls:[{index:0,function:{arguments:'mundo."}'}}]},finish_reason:'tool_calls'}]})));controller.close();await Promise.all(pending);
  assert.equal((await call(db,'studio_read',[owner.id,p.id])).project.data.scriptDraft,'Hola mundo.');
  const replay=await postStudioChat(ctx());assert.equal((await replay.json()).edit.status,'succeeded');assert.equal(providerCalls,1);
 }finally{globalThis.fetch=original;await db.close();}
});
