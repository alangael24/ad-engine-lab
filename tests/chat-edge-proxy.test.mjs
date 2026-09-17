import test from 'node:test';
import assert from 'node:assert/strict';
import {proxyStudioChat} from '../src/chat-edge-proxy.js';
const env={CHAT_RUNTIME_URL:'https://creativerush-production.onrender.com',CHAT_RUNTIME_TOKEN:'runtime-fixture-token-with-32-characters',SUPABASE_URL:'https://ozkewphfxaohtihxmgoo.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'secret-fixture',PRODUCTION_ENABLED:'true',REFERENCE_ANALYSIS_ENABLED:'true'};
test('proxy streams bytes untouched and never forwards client internal headers or exposes secrets',async()=>{
 const request=new Request('https://creativerushai.com/api/studio-chat',{method:'POST',headers:{authorization:'Bearer user','x-chat-database-key':'attacker','content-type':'application/json'},body:'{"request":"unchanged"}'});
 const res=await proxyStudioChat({env,request},async(url,opts)=>{
  assert.equal(url,'https://creativerush-production.onrender.com/internal/studio-chat');assert.equal(opts.redirect,'manual');
  assert.equal(opts.headers.get('x-chat-database-key'),'secret-fixture');assert.equal(opts.headers.get('authorization'),'Bearer user');
  assert.equal(await new Response(opts.body).text(),'{"request":"unchanged"}');
  return new Response('data: arbitrary unchanged bytes\n\n',{headers:{'content-type':'text/event-stream','x-chat-database-key':'must-not-leak'}});
 });
 assert.equal(await res.text(),'data: arbitrary unchanged bytes\n\n');assert.equal(res.headers.get('x-chat-database-key'),null);
});
test('proxy pins destination and refuses redirects without retry or local fallback',async()=>{
 const request=new Request('https://creativerushai.com/api/studio-chat?project=test');let calls=0;
 assert.equal((await proxyStudioChat({env:{...env,CHAT_RUNTIME_URL:'https://attacker.test'},request},()=>{throw Error('must not send secrets');})).status,503);
 const res=await proxyStudioChat({env,request},async()=>{calls++;return new Response('',{status:302,headers:{location:'https://attacker.test'}});});assert.equal(res.status,503);assert.equal(calls,1);
});
