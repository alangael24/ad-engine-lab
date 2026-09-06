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
 assert.deepEqual(result.usage,usage);assert.equal(result.requestId,'request-fixture');assert.equal(result.model,'gpt-image-1.5');assert.equal(result.size,'1024x1536');assert.equal(result.quality,'high');
});
