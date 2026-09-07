import test from 'node:test';
import assert from 'node:assert/strict';
import {createProductionProviders} from '../workers/production-providers.mjs';
test('provider diagnostics preserve status and error code without logging secret-bearing messages',async()=>{
 const lines=[],original=console.error;console.error=line=>lines.push(line);
 try{
  const providers=createProductionProviders({OPENAI_API_KEY:'private-fixture'},{fetchImpl:async()=>new Response(JSON.stringify({error:{code:'billing_hard_limit_reached',type:'invalid_request_error',message:'Never log private-fixture'}}),{status:400})});
  await assert.rejects(providers.image({project:{brand_snapshot:{},data:{aspectRatio:'9:16'}},plan:{continuity:'Keep',scenes:[{text:'Hello',visual:'Product'}]},index:0}),/PRODUCTION_IMAGE_QUOTA/);
  assert.equal(JSON.parse(lines[0]).code,'billing_hard_limit_reached');assert.equal(JSON.parse(lines[0]).status,400);assert.ok(!lines.join('').includes('private-fixture'));
 }finally{console.error=original;}
});
test('generated image retains provider usage and request ID for reconciliation',async()=>{
 const usage={input_tokens:40,output_tokens:6250,total_tokens:6290};
 const providers=createProductionProviders({OPENAI_API_KEY:'fixture'},{fetchImpl:async(url)=>String(url).startsWith('https://api.openai.com/')?Response.json({usage,data:[{b64_json:Buffer.from([137,80,78,71,13,10,26,10]).toString('base64')}]},{headers:{'x-request-id':'request-fixture'}}):new Response(null,{status:200})});
 const result=await providers.image({project:{brand_snapshot:{},data:{aspectRatio:'9:16'}},plan:{continuity:'Same product',scenes:[{text:'Hello',visual:'Product'}]},index:0,invoke:async(action,data)=>action==='upload'?{uploadUrl:'https://storage.test/upload'}:{result:{id:data.assetId}}});
 assert.deepEqual(result.usage,usage);assert.equal(result.requestId,'request-fixture');assert.equal(result.model,'gpt-image-1.5');assert.equal(result.size,'1024x1536');assert.equal(result.quality,'medium');
});

test('explicit GPT Image 2 medium reaches the provider without legacy fidelity parameter',async()=>{
 let captured;
 const providers=createProductionProviders({OPENAI_API_KEY:'fixture',PRODUCTION_IMAGE_MODEL:'gpt-image-2',PRODUCTION_IMAGE_QUALITY:'medium'},{fetchImpl:async(url,options)=>{captured=options.body;return new Response(null,{status:503});}});
 await assert.rejects(providers.image({project:{brand_snapshot:{},data:{aspectRatio:'9:16'}},plan:{continuity:'Same',scenes:[{text:'Hi',visual:'Product'}]},index:0}));
 assert.equal(captured.get('model'),'gpt-image-2');assert.equal(captured.get('quality'),'medium');assert.equal(captured.has('input_fidelity'),false);
});

test('director receives the actual product and reference images, bounded to four visual inputs',async()=>{
 const {callDirector}=await import('../workers/production-providers.mjs'),{CHAT_MODEL}=await import('../assets/chat-model.js');
 let request;const image='data:image/png;base64,iVBORw0KGgo=';
 const project={brand_snapshot:{productAssetId:crypto.randomUUID()},data:{scriptDraft:'Hello.',referenceNotes:'Large eyes',creativeMemory:{referenceAssetIds:[crypto.randomUUID(),crypto.randomUUID()]}},referenceEvidence:[image,image,image]};
 await callDirector(project,{REFERENCE_FLASH_KEY:'fixture'},{invoke:async()=>({url:'https://storage.test/image'}),fetchImpl:async(url,options)=>{
  if(String(url).startsWith('https://storage.test/'))return new Response(Buffer.from([137,80,78,71,13,10,26,10]));
  request=JSON.parse(options.body);
  return new Response('data: '+JSON.stringify({model:CHAT_MODEL,choices:[{delta:{tool_calls:[{index:0,function:{name:'direct_ad',arguments:JSON.stringify({continuity:'Large eyes',scenes:[{text:'Hello.',visual:'Wave',motion:'Raise hand'}]})}}]},finish_reason:'tool_calls'}]})+'\n\n');
 }});
 const content=request.input[1].content;assert.equal(content.filter(x=>x.type==='input_image').length,4);assert.match(JSON.stringify(content),/Actual product, authoritative geometry/);assert.match(JSON.stringify(content),/Large eyes/);
});
