import {productionWorkflow} from '../assets/production-workflow.js';
import {WORKFLOW_MODEL} from '../assets/model-routing.js';
import {modelFetch} from './model-provider.js';
import {editorialCall} from '../workers/editorial-models.mjs';
export const productionVisionModel=env=>productionWorkflow(env).version==='astra-deepseek-v1'?'gpt-6-astra':WORKFLOW_MODEL;
// Preserve the existing validated tool protocol, while routing production vision
// explicitly. The general chat and script writer retain their separate routing.
export async function productionVisionFetch(fetchImpl,url,init,env){
 if(productionWorkflow(env).version!=='astra-deepseek-v1')return modelFetch(fetchImpl,url,init);
 const request=JSON.parse(init.body),tool=request.tools?.[0]?.function;
 if(!tool||request.tools.length!==1)throw Error('PRODUCTION_VISION_TOOL');
 const messages=request.messages||[],images=[],context=[];
 for(const message of messages.filter(x=>x.role!=='system')){
  const content=[];for(const item of typeof message.content==='string'?[{type:'text',text:message.content}]:message.content||[]){
   if(item.type==='image_url')images.push(item.image_url.url);else if(item.type==='text')content.push(item.text);
  }context.push({role:message.role,text:content.join('\n')});
 }
 const usage={total:0,calls:[],unknown:false};
 const raw=await editorialCall({role:'director',name:tool.name,schema:tool.parameters,system:messages.filter(x=>x.role==='system').map(x=>x.content).join('\n'),context,images,usage,env,signal:init.signal,fetchImpl,maxTokens:request.max_tokens});
 const last=usage.calls.at(-1),model=last.returnedModel;
 const normalized={prompt_tokens:usage.calls.reduce((n,x)=>n+x.input,0),completion_tokens:usage.calls.reduce((n,x)=>n+x.output,0),total_tokens:usage.calls.reduce((n,x)=>n+x.input+x.output,0),calls:usage.calls,cost:usage.total,unknown:usage.unknown};
 return new Response('data: '+JSON.stringify({model,usage:normalized,choices:[{delta:{tool_calls:[{index:0,function:{name:tool.name,arguments:JSON.stringify(raw)}}]},finish_reason:'tool_calls'}]})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
}
export function mergeProductionUsage(a,b){
 if(!a)return b;if(!b)return a;
 return {prompt_tokens:(a.prompt_tokens||0)+(b.prompt_tokens||0),completion_tokens:(a.completion_tokens||0)+(b.completion_tokens||0),total_tokens:(a.total_tokens||0)+(b.total_tokens||0),calls:[...(a.calls||[]),...(b.calls||[])],cost:(a.cost||0)+(b.cost||0),unknown:!!(a.unknown||b.unknown)};
}
