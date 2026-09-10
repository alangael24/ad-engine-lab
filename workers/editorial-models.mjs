import {readEvents} from '../assets/chat-stream.js';

export const EDITORIAL_VERSION='sol-luna-v1';
export const EDITORIAL_MODELS={director:'gpt-5.6-sol',editor:'gpt-5.6-luna'};
const prices={director:[4,.4,5,20],editor:[.2,.02,.25,1.2]};
export function editorialConfig(env){
 const budget=Number(env.EDITORIAL_MAX_COST_USD||2);
 if(!Number.isFinite(budget)||budget<.1||budget>5)throw Error('EDITORIAL_BUDGET_CONFIG');
 const sol=env.EDITORIAL_SOL_API_KEY||env.OPENAI_API_KEY,luna=env.REFERENCE_FLASH_KEY;
 if(!sol||!luna)throw Error('EDITORIAL_NOT_CONFIGURED');
 return {budget,sol,luna};
}
export function priceUsage(role,u){
 const input=u.input_tokens??u.prompt_tokens,output=u.output_tokens??u.completion_tokens;
 const detail=u.input_tokens_details||u.prompt_tokens_details||{},cached=detail.cached_tokens||0,writes=detail.cache_write_tokens||0;
 if([input,output,cached,writes].some(x=>!Number.isFinite(x)||x<0)||cached+writes>input)throw Error('EDITORIAL_USAGE_UNKNOWN');
 const [i,c,w,o]=prices[role],long=input>272000;
 return {input,output,cached,writes,cost:((input-cached-writes)*i+cached*c+writes*w)*(long?2:1)/1e6+output*o*(long?1.5:1)/1e6};
}
// Stateless bounded calls. Neither model can run code, download URLs or rent GPUs.
export async function editorialCall({role,name,schema,system,context,images=[],usage,env,signal,fetchImpl=fetch}){
 const cfg=editorialConfig(env),model=EDITORIAL_MODELS[role];
 if(!model||role==='editor'&&images.length)throw Error('EDITORIAL_ROLE_INVALID');
 const maxOutput=role==='director'?4500:8000;
 // Conservative reservation: bounded text plus 4K image tokens per supplied panel.
 const text=JSON.stringify(context),estimatedInput=system.length+text.length+JSON.stringify(schema).length+images.length*4096;
 const reservation=(estimatedInput*Math.max(prices[role][0],prices[role][2])+maxOutput*prices[role][3])/1e6;
 if(estimatedInput>200000||usage.calls.length>=7||usage.unknown||usage.total+reservation>cfg.budget)throw Error('EDITORIAL_BUDGET_REACHED');
 const endpoint=role==='director'?'https://api.openai.com/v1/responses':'https://opencode.ai/zen/go/v1/responses';
 const call={role,model,name,status:'started',reserved:reservation};usage.calls.push(call);
 try{
  const r=await fetchImpl(endpoint,{method:'POST',headers:{authorization:`Bearer ${role==='director'?cfg.sol:cfg.luna}`,'content-type':'application/json','x-opencode-session':'creativerush-editorial-'+crypto.randomUUID()},signal:signal?AbortSignal.any([signal,AbortSignal.timeout(180000)]):AbortSignal.timeout(180000),body:JSON.stringify({model,store:false,stream:true,max_output_tokens:maxOutput,reasoning:{effort:'high'},parallel_tool_calls:false,tool_choice:{type:'function',name},tools:[{type:'function',name,description:'Return the requested structured result.',parameters:schema,strict:false}],input:[{role:'system',content:system},{role:'user',content:[{type:'input_text',text},...images.map(url=>({type:'input_image',image_url:url}))]}]})});
  if(!r.ok){call.httpStatus=r.status;throw Error('EDITORIAL_PROVIDER_UNAVAILABLE');}
  let response;
  await readEvents(r,d=>{if(d.response?.usage)call.usage=d.response.usage;if(d.type==='response.completed')response=d.response;if(d.type==='response.failed'||d.type==='response.incomplete'||d.error)throw Error('EDITORIAL_RESPONSE_INCOMPLETE');},2000000);
  if(call.usage){Object.assign(call,priceUsage(role,call.usage));usage.total+=call.cost;}
  if(!response||response.status!=='completed'||response.model!==model||!call.usage)throw Error('EDITORIAL_RESPONSE_INVALID');
  const calls=response.output?.filter(x=>x.type==='function_call')||[];
  if(calls.length!==1||calls[0].name!==name)throw Error('EDITORIAL_RESPONSE_INVALID');
  const result=JSON.parse(calls[0].arguments);call.status='completed';return result;
 }catch(e){
  if(call.usage&&call.cost==null){Object.assign(call,priceUsage(role,call.usage));usage.total+=call.cost;}
  if(!call.usage){usage.unknown=true;call.cost=null;}
  call.status='failed';call.error=e.message;throw e;
 }
}
