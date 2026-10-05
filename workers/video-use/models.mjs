// Production model routing for the video editor: Claude Opus 5.5 directs (plans,
// briefs, reviews) and DeepSeek v4.1 Flash executes (writes the EDL and overlays,
// builds animations, describes filmstrips). Selected with VIDEO_USE_MODELS;
// "astra" keeps the legacy single-model loop in agent.mjs.
import Anthropic from '@anthropic-ai/sdk';
import {boundedVisualContext} from './agent.mjs';

export const DIRECTOR_MODEL='claude-opus-5-5';
export const EXECUTOR_MODEL='deepseek-v4.1-flash';
// USD per million tokens (input, cache read, cache write, output). Server-side
// fallbacks can answer with an earlier Opus, so those rates are kept too.
const PRICES={
 'claude-opus-5-5':[4,.2,5,20],
 'claude-opus-5':[5,.5,6.25,25],
 'claude-opus-4-8':[5,.5,6.25,25],
 // OpenCode peak API-equivalent rates; a Go subscription does not debit these.
 'deepseek-v4.1-flash':[.3,.006,.3,1.2],
};
const price=model=>PRICES[model]||PRICES[Object.keys(PRICES).find(k=>model?.startsWith(k))]||PRICES['claude-opus-5'];
// Sub-agent roles that only execute or describe; direction and review stay on the director.
const EXECUTOR_TOOLS=new Set(['build_animation','observations']);
const BETAS=['server-side-fallback-2026-07-01','thinking-binding-controls-2026-08-01'];

export function editorModelsConfig(env={}){
 const profile=env.VIDEO_USE_MODELS||'opus-deepseek';
 if(!['opus-deepseek','astra'].includes(profile))throw Error('VIDEO_USE_MODELS_CONFIG');
 if(profile==='astra')return {profile};
 const budget=Number(env.VIDEO_USE_MAX_MODEL_COST_USD||1.5);
 if(!Number.isFinite(budget)||budget<.1||budget>5)throw Error('VIDEO_USE_BUDGET_CONFIG');
 const directorKey=env.ANTHROPIC_API_KEY,executorKey=env.OPENCODE_API_KEY||env.REFERENCE_FLASH_KEY;
 if(!directorKey||!executorKey)throw Error('VIDEO_USE_MODELS_NOT_CONFIGURED');
 return {profile,budget,directorKey,executorKey,effort:env.VIDEO_USE_DIRECTOR_EFFORT||'low'};
}

// The agent keeps an OpenAI-style history; Claude needs system blocks, tool_use /
// tool_result pairs and its own assistant content (thinking blocks) replayed unchanged.
export function toAnthropic(messages){
 const system=[],out=[];
 const push=(role,blocks)=>{const last=out.at(-1);if(last?.role===role&&role==='user')last.content.push(...blocks);else out.push({role,content:blocks});};
 const image=url=>{const d=/^data:(image\/[\w.+-]+);base64,(.*)$/s.exec(url);return {type:'image',source:d?{type:'base64',media_type:d[1],data:d[2]}:{type:'url',url}};};
 messages.forEach((m,i)=>{
  if(m.role==='system'){
   // The first system message is the stable, cross-job prompt; later ones are operator notes.
   if(i===0)system.push({type:'text',text:m.content,cache_control:{type:'ephemeral'}});else out.push({role:'system',content:m.content});
  }else if(m.role==='assistant'){
   const blocks=m.anthropic||[...(m.content?[{type:'text',text:m.content}]:[]),...(m.tool_calls||[]).map(c=>({type:'tool_use',id:c.id,name:c.function.name,input:JSON.parse(c.function.arguments||'{}')}))];
   out.push({role:'assistant',content:blocks.length?blocks:[{type:'text',text:'(no content)'}]});
  }else if(m.role==='tool')push('user',[{type:'tool_result',tool_use_id:m.tool_call_id,content:typeof m.content==='string'?m.content:JSON.stringify(m.content)}]);
  else push('user',typeof m.content==='string'?[{type:'text',text:m.content}]:m.content.map(c=>c.type==='image_url'?image(c.image_url.url):{type:'text',text:c.text}));
 });
 return {system,messages:out};
}

function record(usage,model,u){
 const input=u.input_tokens||0,read=u.cache_read_input_tokens??u.prompt_tokens_details?.cached_tokens??0,write=u.cache_creation_input_tokens||0,output=u.output_tokens??u.completion_tokens??0;
 const prompt=u.prompt_tokens!=null?u.prompt_tokens-read:input;
 const [i,r,w,o]=price(model),cost=(prompt*i+read*r+write*w+output*o)/1e6;
 usage.calls++;usage.input+=prompt+read+write;usage.cached+=read;usage.cacheWrite=(usage.cacheWrite||0)+write;usage.output+=output;usage.costUSD=(usage.costUSD||0)+cost;
 return cost;
}

export function directorTurn(cfg,{fetchImpl=fetch}={}){
 const client=new Anthropic({apiKey:cfg.directorKey,fetch:fetchImpl,maxRetries:2});
 return async function turn(messages,tools,env,usage,{signal}={}){
  const {system,messages:history}=toAnthropic(boundedVisualContext(messages));
  const request={model:DIRECTOR_MODEL,max_tokens:16000,system,messages:history,
   tools:tools.map(t=>({name:t.function.name,description:t.function.description,input_schema:t.function.parameters})),
   // Opus 5.5 rejects forced tool use: steer from the prompt and verify a call happened.
   tool_choice:{type:'auto',disable_parallel_tool_use:true},
   output_config:{effort:cfg.effort},
   // Batch image release edits earlier turns; drop stale thinking instead of failing.
   thinking:{type:'adaptive',block_binding:{prefix_mismatch_behavior:'drop_block'}},
   cache_control:{type:'ephemeral'},fallbacks:'default',betas:BETAS};
  for(let attempt=0;attempt<2;attempt++){
   const r=await client.beta.messages.create(request,{signal});
   record(usage,r.model,r.usage||{});
   if(r.stop_reason==='refusal')throw Object.assign(Error('Director declined the request'),{code:'DIRECTOR_REFUSAL',category:r.stop_details?.category});
   const call=r.content.find(b=>b.type==='tool_use');
   if(call&&tools.some(t=>t.function.name===call.name)){
    const text=r.content.filter(b=>b.type==='text').map(b=>b.text).join('\n').trim();
    return {role:'assistant',content:text||null,anthropic:r.content,tool_calls:[{id:call.id,type:'function',function:{name:call.name,arguments:JSON.stringify(call.input??{})}}]};
   }
   // auto tool choice does not guarantee a call: ask once more, append-only.
   request.messages=[...history,{role:'assistant',content:r.content},{role:'user',content:[{type:'text',text:'Respond by calling exactly one of the available tools.'}]}];
  }
  throw Error('Incomplete director tool response');
 };
}

export function executorTurn(cfg,{fetchImpl=fetch,sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}){
 return async function turn(messages,tools,env,usage,{signal}={}){
  let lastError;
  // Transient provider failures and malformed tool responses are retried; each attempt is metered.
  for(const wait of [0,2000,5000]){
   if(wait)await sleep(wait);
   if(signal?.aborted)throw Error('Job canceled');
   let d,r;
   try{
    r=await fetchImpl('https://opencode.ai/zen/go/v1/chat/completions',{method:'POST',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(600000)]):AbortSignal.timeout(600000),
     headers:{authorization:`Bearer ${cfg.executorKey}`,'content-type':'application/json','x-opencode-session':'creativerush-editor-'+crypto.randomUUID()},
     body:JSON.stringify({model:EXECUTOR_MODEL,reasoning_effort:'low',max_tokens:12000,tool_choice:'required',parallel_tool_calls:false,tools,messages:boundedVisualContext(messages).map(({anthropic,...m})=>m)})});
    d=await r.json();
   }catch(e){if(signal?.aborted)throw e;lastError=Error('Executor unavailable');continue;}
   if(!r.ok||d.error){lastError=Error('Executor unavailable');if(r.status&&r.status<500&&r.status!==429)break;continue;}
   if(d.usage)record(usage,d.model,d.usage);else usage.unmetered++;
   if(!String(d.model).startsWith(EXECUTOR_MODEL))throw Error('Unexpected executor model: '+d.model);
   const c=d.choices?.[0],calls=(c?.message?.tool_calls||[]).filter(x=>tools.some(t=>t.function.name===x.function?.name));
   if(c?.finish_reason==='tool_calls'&&calls.length)return {role:'assistant',content:c.message.content||null,tool_calls:[calls[0]].map(x=>({id:x.id,type:'function',function:{name:x.function.name,arguments:x.function.arguments}}))};
   lastError=Error('Incomplete executor tool response');
  }
  throw lastError;
 };
}

// Options for runVideoUse: director loop on Opus, executor and sub-agents on DeepSeek.
export function editorModels(env,{fetchImpl=fetch,sleep}={}){
 const cfg=editorModelsConfig(env);
 if(cfg.profile==='astra')return {};
 const director=directorTurn(cfg,{fetchImpl}),executor=executorTurn(cfg,{fetchImpl,sleep});
 const spent=usage=>(usage.costUSD||0)+(usage.executor?.costUSD||0);
 const checkBudget=usage=>{if(usage.calls>=80||usage.unmetered>=2||spent(usage)>=cfg.budget)throw Error('Editing model budget reached');};
 return {
  checkBudget,
  callModel:(messages,tools,env,usage,opts)=>{checkBudget(usage);return tools.length===1&&EXECUTOR_TOOLS.has(tools[0].function.name)?executor(messages,tools,env,usage.executor||usage,opts):director(messages,tools,env,usage,opts);},
  executeModel:executor,
 };
}
