import test from 'node:test';
import assert from 'node:assert/strict';
import {pagesDispatcher} from '../src/pages-dispatch.js';
test('static dispatch keeps method, query, bearer and waitUntil without cloning the body',async()=>{
 const request=new Request('https://app.test/API/studio-chat/?project=abc',{method:'POST',body:'original',headers:{authorization:'Bearer fixture'}}),pending=[];
 const worker=pagesDispatcher({'/api/studio-chat':{async onRequestPost(c){assert.equal(c.request,request);assert.equal(c.request.headers.get('authorization'),'Bearer fixture');assert.equal(new URL(c.request.url).search,'?project=abc');c.waitUntil(Promise.resolve());return new Response(await c.request.text());}}});
 assert.equal(await (await worker.fetch(request,{}, {waitUntil:p=>pending.push(p)})).text(),'original');assert.equal(pending.length,1);
});
test('dynamic generation IDs and generic method rejection retain handler semantics',async()=>{
 const worker=pagesDispatcher({'/api/generations/[id]':{onRequestGet:c=>Response.json(c.params),onRequest:()=>new Response(null,{status:405})}}),env={ASSETS:{fetch:()=>new Response('asset',{status:404})}};
 assert.deepEqual(await (await worker.fetch(new Request('https://app.test/api/generations/abc%2D123'),env,{})).json(),{id:'abc-123'});
 assert.equal((await worker.fetch(new Request('https://app.test/api/generations/abc',{method:'POST'}),env,{})).status,405);
 assert.equal((await worker.fetch(new Request('https://app.test/api/generations/abc/extra'),env,{})).status,404);
 assert.equal((await worker.fetch(new Request('https://app.test/'),env,{})).status,404);
});
