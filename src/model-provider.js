import {WORKFLOW_MODEL} from '../assets/model-routing.js';
import {readEvents} from '../assets/chat-stream.js';

export function responsesRequest(chat) {
 const input=[];
 for(const m of chat.messages||[]) {
  if(m.role==='tool') {input.push({type:'function_call_output',call_id:m.tool_call_id,output:typeof m.content==='string'?m.content:JSON.stringify(m.content)});continue;}
  if(m.content) input.push({role:m.role,content:typeof m.content==='string'?m.content:m.content.map(c=>c.type==='image_url'?{type:'input_image',image_url:c.image_url.url,...(c.image_url.detail?{detail:c.image_url.detail}:{})}:{type:m.role==='assistant'?'output_text':'input_text',text:c.text})});
  for(const t of m.tool_calls||[]) input.push({type:'function_call',call_id:t.id,name:t.function.name,arguments:t.function.arguments});
 }
 const out={model:chat.model,input,stream:true,store:false,reasoning:{effort:'high'},max_output_tokens:Math.max(chat.max_tokens||0,24000)};
 if(chat.tools?.length) {
  out.tools=chat.tools.map(t=>({type:'function',...t.function,strict:false}));
  out.tool_choice=chat.tool_choice?.function?{type:'function',name:chat.tool_choice.function.name}:chat.tool_choice||'auto';
  out.parallel_tool_calls=false;
 } else out.text={format:{type:'json_object'}};
 return out;
}

// Normalize Responses SSE into the existing, validated streaming tool protocol.
// No model fallback: callers still verify the actual returned model and completion.
export function openCodeHeaders(headers){return {...headers,'x-opencode-session':headers?.['x-opencode-session']||'creativerush-'+crypto.randomUUID()};}
export async function modelFetch(fetchImpl,url,init) {
 init={...init,headers:openCodeHeaders(init.headers)};
 const chat=JSON.parse(init.body);
 if(chat.model!==WORKFLOW_MODEL)return fetchImpl(url,init);
 const response=await fetchImpl(url.replace(/chat\/completions$/, 'responses'),{...init,body:JSON.stringify(responsesRequest(chat))});
 if(!response.ok)return response;
 const encoder=new TextEncoder();
 const stream=new ReadableStream({async start(controller){
  const emit=d=>controller.enqueue(encoder.encode('data: '+JSON.stringify(d)+'\n\n'));
  let model,complete=false,textSeen=false;const calls=new Map();
  const add=(index,item)=>{if(calls.has(index))return;calls.set(index,{args:false});emit({model,choices:[{delta:{tool_calls:[{index,id:item.call_id,type:'function',function:{name:item.name,arguments:''}}]}}]});};
  try {
   await readEvents(response,d=>{
    if(d.error||['response.failed','response.incomplete','error'].includes(d.type))throw Error('Model response failed or incomplete');
    if(d.response?.model)model=d.response.model;
    // Some compatible gateways retain Chat SSE envelopes.
    if(Array.isArray(d.choices)){emit(d);if(d.choices.some(c=>c.finish_reason))complete=true;return;}
    if(d.type==='response.output_item.added'&&d.item?.type==='function_call')add(d.output_index,d.item);
    if(d.type==='response.function_call_arguments.delta'){
     if(!calls.has(d.output_index))throw Error('Tool delta without item');
     calls.get(d.output_index).args=true;emit({model,choices:[{delta:{tool_calls:[{index:d.output_index,function:{arguments:d.delta}}]}}]});
    }
    if(d.type==='response.output_text.delta'){textSeen=true;emit({model,choices:[{delta:{content:d.delta}}]});}
    if(d.type==='response.completed'){
     if(d.response.status!=='completed')throw Error('Incomplete response');
     for(const [i,item] of (d.response.output||[]).entries()){
      if(item.type==='function_call'){add(i,item);if(!calls.get(i).args)emit({model,choices:[{delta:{tool_calls:[{index:i,function:{arguments:item.arguments}}]}}]});}
      if(item.type==='message'&&!textSeen)for(const c of item.content||[])if(c.type==='output_text')emit({model,choices:[{delta:{content:c.text}}]});
     }
     const u=d.response.usage;emit({model,usage:u?{prompt_tokens:u.input_tokens,completion_tokens:u.output_tokens,prompt_tokens_details:u.input_tokens_details}:undefined,choices:[{delta:{},finish_reason:calls.size?'tool_calls':'stop'}]});complete=true;
    }
   },2000000);
   if(!complete)throw Error('Truncated model stream');
   controller.close();
  }catch(e){controller.error(e);}
 }});
 return new Response(stream,{status:200,headers:{'content-type':'text/event-stream'}});
}
