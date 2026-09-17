import test from 'node:test';
import assert from 'node:assert/strict';
import {modelFetch} from '../src/model-provider.js';
import {readEvents} from '../assets/chat-stream.js';
import {WORKFLOW_MODEL} from '../assets/model-routing.js';
test('streamed provider credit exhaustion is not misclassified as invalid script JSON',async()=>{
 let calls=0;const response=await modelFetch(async()=>{calls++;return new Response('data: '+JSON.stringify({type:'error',error:{code:'credit_balance_exhausted'}})+'\n\n');},'unused',{body:JSON.stringify({model:WORKFLOW_MODEL,messages:[]})},{OPENAI_API_KEY:'fixture'});
 await assert.rejects(readEvents(response,()=>{}),e=>e.code==='CHAT_PROVIDER_QUOTA');assert.equal(calls,1);
});
