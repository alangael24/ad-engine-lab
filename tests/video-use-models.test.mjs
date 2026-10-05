import test from 'node:test';
import assert from 'node:assert/strict';
import {toAnthropic,directorTurn,executorTurn,editorModels,editorModelsConfig} from '../workers/video-use/models.mjs';

const env={ANTHROPIC_API_KEY:'test-anthropic',OPENCODE_API_KEY:'test-opencode'};
const tool=name=>({type:'function',function:{name,description:name,parameters:{type:'object',additionalProperties:false,properties:{},required:[]}}});
const usage=()=>({calls:0,input:0,output:0,cached:0,unmetered:0,executor:{calls:0,input:0,output:0,cached:0,unmetered:0}});
const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','request-id':'req_test'}});
const message=(content,extra={})=>({id:'msg_1',type:'message',role:'assistant',model:'claude-opus-5-5',content,stop_reason:'tool_use',stop_details:null,usage:{input_tokens:1000,cache_read_input_tokens:10000,cache_creation_input_tokens:2000,output_tokens:500},...extra});
const toolUse=(name,input={})=>({type:'tool_use',id:'toolu_1',name,input});
const headerOf=(init,name)=>new Headers(init.headers).get(name);

test('Agent history converts to Claude messages with replayed thinking and cached system prompt',()=>{
 const raw=[{type:'thinking',thinking:'',signature:'sig'},toolUse('inspect',{source:'S01'})];
 const {system,messages}=toAnthropic([
  {role:'system',content:'stable prompt'},
  {role:'user',content:'request'},
  {role:'user',content:[{type:'text',text:'Sample'},{type:'image_url',image_url:{url:'data:image/png;base64,AAAA'}}]},
  {role:'assistant',content:null,anthropic:raw,tool_calls:[{id:'toolu_1',type:'function',function:{name:'inspect',arguments:'{}'}}]},
  {role:'tool',tool_call_id:'toolu_1',content:'panel attached'},
  {role:'user',content:[{type:'image_url',image_url:{url:'https://example.com/a.png'}}]},
  {role:'system',content:'Act now.'},
 ]);
 assert.deepEqual(system,[{type:'text',text:'stable prompt',cache_control:{type:'ephemeral'}}]);
 assert.equal(messages[0].role,'user');assert.equal(messages[0].content.length,3);
 assert.deepEqual(messages[0].content[2],{type:'image',source:{type:'base64',media_type:'image/png',data:'AAAA'}});
 assert.equal(messages[1].content,raw);
 assert.deepEqual(messages[2].content[0],{type:'tool_result',tool_use_id:'toolu_1',content:'panel attached'});
 assert.deepEqual(messages[2].content[1].source,{type:'url',url:'https://example.com/a.png'});
 assert.deepEqual(messages[3],{role:'system',content:'Act now.'});
});

test('Director requests Opus 5.5 without forced tools, with low effort, fallbacks and drop_block',async()=>{
 const calls=[];
 const turn=directorTurn(editorModelsConfig(env),{fetchImpl:async(url,init)=>{calls.push({url:String(url),init,body:JSON.parse(init.body)});return reply(message([{type:'thinking',thinking:'',signature:'sig'},toolUse('render_edit')]));}});
 const u=usage(),out=await turn([{role:'system',content:'prompt'},{role:'user',content:'go'}],[tool('render_edit'),tool('verify_output')],env,u);
 const {url,init,body}=calls[0];
 assert.match(url,/\/v1\/messages/);assert.equal(body.model,'claude-opus-5-5');
 assert.deepEqual(body.tool_choice,{type:'auto',disable_parallel_tool_use:true});
 assert.deepEqual(body.output_config,{effort:'low'});assert.equal(body.thinking.block_binding.prefix_mismatch_behavior,'drop_block');
 assert.equal(body.fallbacks,'default');assert.match(headerOf(init,'anthropic-beta'),/server-side-fallback-2026-07-01/);assert.match(headerOf(init,'anthropic-beta'),/thinking-binding-controls-2026-08-01/);
 assert.equal(out.tool_calls[0].function.name,'render_edit');assert.equal(out.anthropic[0].type,'thinking');
 // 1000 input at $4, 10000 cache reads at $0.20, 2000 cache writes at $5, 500 output at $20 per million.
 assert.equal(+u.costUSD.toFixed(6),.026);assert.equal(u.calls,1);
});

test('Director asks again once when Opus answers without a tool call',async()=>{
 const responses=[message([{type:'text',text:'Thinking aloud'}],{stop_reason:'end_turn'}),message([toolUse('submit_review',{passed:true,message:'ok'})])];
 const bodies=[];
 const turn=directorTurn(editorModelsConfig(env),{fetchImpl:async(url,init)=>{bodies.push(JSON.parse(init.body));return reply(responses.shift());}});
 const u=usage(),out=await turn([{role:'system',content:'prompt'},{role:'user',content:'go'}],[tool('submit_review')],env,u);
 assert.equal(out.tool_calls[0].function.name,'submit_review');assert.equal(u.calls,2);
 assert.equal(bodies[1].messages.at(-1).content[0].text,'Respond by calling exactly one of the available tools.');
});

test('Director refusals surface as a coded error',async()=>{
 const turn=directorTurn(editorModelsConfig(env),{fetchImpl:async()=>reply(message([],{stop_reason:'refusal',stop_details:{type:'refusal',category:'cyber'}}))});
 await assert.rejects(turn([{role:'system',content:'p'},{role:'user',content:'go'}],[tool('render_edit')],env,usage()),e=>e.code==='DIRECTOR_REFUSAL'&&e.category==='cyber');
});

test('Executor retries transient OpenCode failures and meters DeepSeek usage',async()=>{
 const responses=[reply({error:{message:'upstream'}},502),reply({model:'deepseek-v4.1-flash',choices:[{finish_reason:'tool_calls',message:{content:null,tool_calls:[{id:'c1',type:'function',function:{name:'write_file',arguments:'{"path":"edl.json","content":"{}"}'}}]}}],usage:{prompt_tokens:20000,completion_tokens:1000,prompt_tokens_details:{cached_tokens:15000}}})];
 const urls=[];
 const turn=executorTurn(editorModelsConfig(env),{fetchImpl:async url=>{urls.push(String(url));return responses.shift();},sleep:async()=>{}});
 const u=usage().executor,out=await turn([{role:'system',content:'exec'},{role:'user',content:'brief'}],[tool('write_file')],env,u);
 assert.equal(urls.length,2);assert.match(urls[0],/opencode\.ai\/zen\/go/);
 assert.equal(out.tool_calls[0].function.name,'write_file');
 // 5000 uncached at $0.30, 15000 cached at $0.006, 1000 output at $1.20 per million.
 assert.equal(+u.costUSD.toFixed(6),.00279);
});

test('Editor routing sends sub-agent observations to DeepSeek and enforces the shared budget',async()=>{
 const seen=[];
 const fetchImpl=async url=>{seen.push(String(url));return String(url).includes('opencode')?reply({model:'deepseek-v4.1-flash',choices:[{finish_reason:'tool_calls',message:{tool_calls:[{id:'o1',type:'function',function:{name:'observations',arguments:'{"message":"ok"}'}}]}}],usage:{prompt_tokens:10,completion_tokens:5}}):reply(message([toolUse('render_edit')]));};
 const models=editorModels({...env,VIDEO_USE_MAX_MODEL_COST_USD:'0.1'},{fetchImpl});
 const u=usage();
 await models.callModel([{role:'system',content:'p'},{role:'user',content:'look'}],[tool('observations')],env,u);
 assert.equal(u.executor.calls,1);assert.equal(u.calls,0);assert.match(seen[0],/opencode/);
 await models.callModel([{role:'system',content:'p'},{role:'user',content:'go'}],[tool('render_edit')],env,u);
 assert.equal(u.calls,1);assert.match(seen[1],/anthropic/);
 u.costUSD=.2;assert.throws(()=>models.checkBudget(u),/budget reached/);
});

test('Editor model profile fails closed without keys and keeps Astra as a rollback',()=>{
 assert.throws(()=>editorModelsConfig({}),/VIDEO_USE_MODELS_NOT_CONFIGURED/);
 assert.deepEqual(editorModels({VIDEO_USE_MODELS:'astra'}),{});
 assert.throws(()=>editorModelsConfig({VIDEO_USE_MODELS:'other'}),/VIDEO_USE_MODELS_CONFIG/);
});
