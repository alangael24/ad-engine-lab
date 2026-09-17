// Provider-shaped fixtures for the active Astra + DeepSeek workflow.
export function productionResponse(model,name,value,{finish,usage={input_tokens:100,output_tokens:30}}={}){
 const event=model.startsWith('deepseek')?{model,usage,choices:[{delta:{content:JSON.stringify(value)},finish_reason:finish||'stop'}]}:{type:'response.completed',response:{model,status:finish&&finish!=='tool_calls'?'incomplete':'completed',usage,output:[{type:'function_call',name,arguments:JSON.stringify(value)}]}};
 return new Response('data: '+JSON.stringify(event)+'\n\ndata: [DONE]\n\n');
}
