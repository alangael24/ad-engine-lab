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
