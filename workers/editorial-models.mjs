import {readEvents} from '../assets/chat-stream.js';
import {productionWorkflow} from '../assets/production-workflow.js';
export const EDITORIAL_VERSION='sol-luna-v1'; // Stable EDL/manifest schema, not model choice.
export const EDITORIAL_MODELS=productionWorkflow();
// USD per million tokens: input, cache read, cache write, output. Snapshot 2026-09-11.
const prices={'gpt-6-astra':[10,1,12.5,50],'gpt-5.6-sol':[4,.4,5,20],'gpt-5.6-luna':[.2,.02,.25,1.2],'deepseek-flash':[.3,.006,.3,1.2]};
export function editorialConfig(env={}){
 const profile=productionWorkflow(env),budget=Number(env.EDITORIAL_MAX_COST_USD||2),timeout=Number(env.EDITORIAL_TIMEOUT_MS||900000);
 if(!Number.isFinite(budget)||budget<.1||budget>5||!Number.isInteger(timeout)||timeout<30000||timeout>1800000)throw Error('EDITORIAL_BUDGET_CONFIG');
 return {...profile,budget,timeout,directorKey:env.EDITORIAL_ASTRA_API_KEY||env.EDITORIAL_SOL_API_KEY||env.OPENAI_API_KEY,editorKey:env.OPENCODE_API_KEY||env.REFERENCE_FLASH_KEY};
}
export function priceUsage(role,u,model=role==='director'?'gpt-6-astra':'deepseek-flash'){
 const input=u.input_tokens??u.prompt_tokens,output=u.output_tokens??u.completion_tokens;
 const detail=u.input_tokens_details||u.prompt_tokens_details||{},cached=detail.cached_tokens??u.prompt_cache_hit_tokens??0,writes=detail.cache_write_tokens??0;
 if(!prices[model]||[input,output,cached,writes].some(x=>!Number.isFinite(x)||x<0)||cached+writes>input)throw Error('EDITORIAL_USAGE_UNKNOWN');
 const [i,c,w,o]=prices[model],long=['gpt-5.6-sol','gpt-5.6-luna'].includes(model)&&input>272000;
 return {input,output,cached,writes,cost:((input-cached-writes)*i+cached*c+writes*w)*(long?2:1)/1e6+output*o*(long?1.5:1)/1e6};
}
function validModel(actual,expected){return actual===expected||expected==='deepseek-flash'&&/^deepseek-v4\.1-flash(?:[-\w.]*)$/.test(actual||'');}
async function attemptCall({role,name,schema,system,context,images=[],usage,env,signal,fetchImpl,repair=false,onUsage,maxTokens}){
 const cfg=editorialConfig(env),model=cfg[role],key=role==='director'?cfg.directorKey:cfg.editorKey;
 if(!model||role==='editor'&&images.length)throw Error('EDITORIAL_ROLE_INVALID');
 if(!key)throw Error('EDITORIAL_NOT_CONFIGURED');
 const deepseek=model==='deepseek-flash',maxOutput=deepseek?(repair?16000:12000):role==='director'?Math.min(12000,Math.max(4500,maxTokens||0)):12000;
 const text=JSON.stringify(context),estimatedInput=new TextEncoder().encode(system+text+JSON.stringify(schema)).length+images.length*10000;
 const reservation=(estimatedInput*Math.max(prices[model][0],prices[model][2])+maxOutput*prices[model][3])/1e6;
 const held=usage.calls.filter(x=>x.cost==null&&x.status==='started').reduce((n,x)=>n+x.reserved,0);
 if(estimatedInput>200000||usage.calls.length>=9||usage.unknown||usage.total+held+reservation>cfg.budget)throw Error('EDITORIAL_BUDGET_REACHED');
 const call={id:crypto.randomUUID(),role,model,name,workflowProfile:cfg.version,status:'started',reserved:reservation,startedAt:new Date().toISOString(),basis:role==='editor'?'OpenCode usage at peak API-equivalent rates; subscription debit unavailable':'OpenAI API usage at standard rates'};
 usage.calls.push(call);let result,error;
 // Persist the reservation before dispatch so a crashed process cannot erase
 // an in-flight paid request from the audit trail.
 if(onUsage)await onUsage(structuredClone(usage));
 try{
  const endpoint=deepseek?'https://opencode.ai/zen/go/v1/chat/completions':role==='director'?'https://api.openai.com/v1/responses':'https://opencode.ai/zen/go/v1/responses';
  const body=deepseek?{model,reasoning_effort:'low',thinking:{type:'enabled'},stream:true,stream_options:{include_usage:true},max_tokens:maxOutput,response_format:{type:'json_object'},messages:[{role:'system',content:system+'\nReturn exactly one JSON object satisfying this schema: '+JSON.stringify(schema)},{role:'user',content:text}]}:{model,store:false,stream:true,max_output_tokens:maxOutput,reasoning:{effort:cfg.reasoning},parallel_tool_calls:false,tool_choice:{type:'function',name},tools:[{type:'function',name,description:'Return the requested structured result.',parameters:schema,strict:false}],input:[{role:'system',content:system},{role:'user',content:[{type:'input_text',text},...images.map(url=>({type:'input_image',image_url:url}))]}]};
  const r=await fetchImpl(endpoint,{method:'POST',headers:{authorization:`Bearer ${key}`,'content-type':'application/json','x-opencode-session':'creativerush-editorial-'+call.id},signal:signal?AbortSignal.any([signal,AbortSignal.timeout(cfg.timeout)]):AbortSignal.timeout(cfg.timeout),body:JSON.stringify(body)});
  call.requestId=r.headers.get('x-request-id');call.httpStatus=r.status;
  if(!r.ok)throw Error('EDITORIAL_PROVIDER_UNAVAILABLE');
  let response,actual,finish,textOut='',providerError=false;
  await readEvents(r,d=>{
   if(d.usage||d.response?.usage)call.usage=d.usage||d.response.usage;
   if(d.error||['response.failed','response.incomplete','error'].includes(d.type))providerError=true;
   if(deepseek){actual=d.model||actual;for(const c of d.choices||[]){finish=c.finish_reason||finish;textOut+=c.delta?.content||'';}}
   else if(d.type==='response.completed')response=d.response;
  },2000000);
  call.returnedModel=deepseek?actual:response?.model;
  if(!call.usage)throw Error('EDITORIAL_USAGE_UNKNOWN');
  if(providerError||deepseek&&finish!=='stop'||!deepseek&&response?.status!=='completed')throw Error('EDITORIAL_RESPONSE_INCOMPLETE');
  if(!validModel(call.returnedModel,model))throw Error('EDITORIAL_MODEL_MISMATCH');
  if(!deepseek){const calls=response.output?.filter(x=>x.type==='function_call')||[];if(calls.length!==1||calls[0].name!==name)throw Error('EDITORIAL_RESPONSE_INVALID');textOut=calls[0].arguments;}
  try{result=JSON.parse(textOut);}catch{throw Error('EDITORIAL_RESPONSE_JSON');}
  if(!result||typeof result!=='object'||Array.isArray(result))throw Error('EDITORIAL_RESPONSE_JSON');
  call.status='completed';
 }catch(e){call.status='failed';call.error=e.message;error=e;}
 finally{
  try{if(call.usage){Object.assign(call,priceUsage(role,call.usage,model));usage.total+=call.cost;}else usage.unknown=true;}catch(e){usage.unknown=true;error=e;}
  call.completedAt=new Date().toISOString();
  console.log(JSON.stringify({event:'production_model_usage',...call}));
  if(onUsage)await onUsage(structuredClone(usage));
 }
 if(error)throw error;return result;
}
// Retry only a known, metered formatting/truncation failure; ambiguous requests stay blocked.
export async function editorialCall(args){
 const options={fetchImpl:fetch,...args,env:args.env||{},images:args.images||[]};
 try{return await attemptCall(options);}catch(e){
  if(args.role!=='editor'||args.usage.unknown||args.signal?.aborted||!['EDITORIAL_RESPONSE_INCOMPLETE','EDITORIAL_RESPONSE_JSON','EDITORIAL_RESPONSE_INVALID'].includes(e.message))throw e;
  return attemptCall({...options,repair:true,system:options.system+'\nThe previous metered response was incomplete or invalid JSON. Return a concise complete JSON object. Preserve the supplied direction and all validation constraints.'});
 }
}
