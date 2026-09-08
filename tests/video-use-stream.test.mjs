import test from 'node:test';
import assert from 'node:assert/strict';
import {modelTurn,estimatedLunaCost,checkEditorBudget,validateEDL,editFingerprint} from '../workers/video-use/agent.mjs';
import {CHAT_MODEL} from '../assets/chat-model.js';

test('editor accepts a valid tool payload fragmented into a large SSE transport',async()=>{
 const args=JSON.stringify({code:'x'.repeat(5000)}),usage={calls:0,input:0,output:0,cached:0,unmetered:0};
 const chunks=[{model:CHAT_MODEL,choices:[{delta:{tool_calls:[{index:0,id:'call1',function:{name:'run_python',arguments:''}}]}}]}];
 for(const char of args)chunks.push({choices:[{delta:{tool_calls:[{index:0,function:{arguments:char}}]}}]});
 chunks.push({choices:[{delta:{},finish_reason:'tool_calls'}],usage:{prompt_tokens:100,completion_tokens:200}});
 const body=chunks.map(x=>'data: '+JSON.stringify(x)+'\n\n').join('')+'data: [DONE]\n\n';
 assert.ok(body.length>150000);
 const r=await modelTurn([],[],{REFERENCE_FLASH_KEY:'fixture'},usage,{fetchImpl:async()=>new Response(body)});
 assert.equal(r.tool_calls[0].function.arguments,args);
 assert.equal(usage.calls,1);
});
test('editor budget charges cache hits, writes and outputs without rejecting repeated context as fresh input',()=>{
 const measured={calls:18,input:317121,output:9425,cached:260221,cacheWrite:50000,unmetered:0};
 assert.doesNotThrow(()=>checkEditorBudget(measured));
 assert.ok(Math.abs(estimatedLunaCost(measured)-.03039442)<1e-8);
 assert.throws(()=>checkEditorBudget({...measured,input:2000000,cached:0,cacheWrite:0}),/budget reached/);
 assert.throws(()=>checkEditorBudget({...measured,calls:80}),/budget reached/);
 assert.throws(()=>checkEditorBudget({...measured,unmetered:2}),/budget reached/);
 assert.throws(()=>checkEditorBudget(measured,{VIDEO_USE_MAX_MODEL_COST_USD:'NaN'}),/Invalid/);
});


test('caption exclusion is a real bounded edit, not a no-op',async()=>{
 const sources={S01:{duration:3,width:128,height:128,fps:24}},base={ranges:[{source:'S01',start:0,end:3}],subtitles:'master.srt'};
 const a=validateEDL(base,sources,{}),b=validateEDL({...base,caption_exclusions:[{start:1,end:2}]},sources,{});
 assert.notEqual(await editFingerprint(a,async()=>''),await editFingerprint(b,async()=>''));
 assert.throws(()=>validateEDL({...base,caption_exclusions:[{start:1,end:4}]},sources,{}));
 assert.throws(()=>validateEDL({...base,caption_exclusions:[{start:2,end:1}]},sources,{}));
});
