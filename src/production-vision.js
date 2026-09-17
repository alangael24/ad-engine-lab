import {productionWorkflow} from '../assets/production-workflow.js';
import {editorialCall} from '../workers/editorial-models.mjs';
export const productionPromptModel=env=>productionWorkflow(env).editor;
export const productionVisionModel=env=>productionWorkflow(env).director;
// Preserve the existing validated tool protocol, while routing production vision
// explicitly. The general chat and script writer retain their separate routing.
export const productionVisionFetch=(fetchImpl,url,init,env)=>productionStructuredFetch(fetchImpl,url,init,env,'director');
// H3 transcription of the approved direction is a separate model role. Never
// switch reference analysis or visual direction along with the prompt writer.
export const productionPromptFetch=(fetchImpl,url,init,env)=>productionStructuredFetch(fetchImpl,url,init,env,'prompter');
async function productionStructuredFetch(fetchImpl,url,init,env,role){
 productionWorkflow(env); // Reject retired profiles before any paid request.
 const request=JSON.parse(init.body),tool=request.tools?.[0]?.function;
 if(!tool||request.tools.length!==1)throw Error('PRODUCTION_VISION_TOOL');
 const messages=request.messages||[],images=[],context=[];
 for(const message of messages.filter(x=>x.role!=='system')){
  const content=[];for(const item of typeof message.content==='string'?[{type:'text',text:message.content}]:message.content||[]){
   if(item.type==='image_url')images.push(item.image_url.url);else if(item.type==='text')content.push(item.text);
  }context.push({role:message.role,text:content.join('\n')});
 }
 const usage={total:0,calls:[],unknown:false};
 const raw=await editorialCall({role,name:tool.name,schema:tool.parameters,system:messages.filter(x=>x.role==='system').map(x=>x.content).join('\n'),context,images,usage,env,signal:init.signal,fetchImpl,maxTokens:request.max_tokens,onUsage:env.PRODUCTION_ON_USAGE});
 // editorialCall has already verified the provider model (including valid aliases).
 const last=usage.calls.at(-1),model=last.model;
 const normalized={prompt_tokens:usage.calls.reduce((n,x)=>n+x.input,0),completion_tokens:usage.calls.reduce((n,x)=>n+x.output,0),total_tokens:usage.calls.reduce((n,x)=>n+x.input+x.output,0),calls:usage.calls,cost:usage.total,unknown:usage.unknown};
 return new Response('data: '+JSON.stringify({model,usage:normalized,choices:[{delta:{tool_calls:[{index:0,function:{name:tool.name,arguments:JSON.stringify(raw)}}]},finish_reason:'tool_calls'}]})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
}
export function mergeProductionUsage(a,b){
 if(!a)return b;if(!b)return a;
 return {prompt_tokens:(a.prompt_tokens||0)+(b.prompt_tokens||0),completion_tokens:(a.completion_tokens||0)+(b.completion_tokens||0),total_tokens:(a.total_tokens||0)+(b.total_tokens||0),calls:[...(a.calls||[]),...(b.calls||[])],cost:(a.cost||0)+(b.cost||0),unknown:!!(a.unknown||b.unknown)};
}
