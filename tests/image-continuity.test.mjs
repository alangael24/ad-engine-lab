import test from 'node:test';
import assert from 'node:assert/strict';
import {imagePacket,normalizeShotContract} from '../assets/image-continuity.js';
import {imageDirection,validatePlan} from '../assets/production-model.js';
import {remember} from '../assets/creative-context.js';
import {projectData} from '../assets/studio-model.js';
import {createProductionProviders,callDirector} from '../workers/production-providers.mjs';
import {paidStep} from '../src/production-spend.js';
import {CHAT_MODEL} from '../assets/chat-model.js';
const uuid=()=>crypto.randomUUID();
const contract=(extra={})=>({productVisible:false,characterVisible:true,transition:'cut',camera:'Face close-up',state:'Hands and product offscreen',preserve:['Same face'],change:['Closer crop'],productViewAssetIds:[],...extra});
function fixture(){
 const product=uuid(),character=uuid(),style=uuid(),prior=uuid(),sceneId=uuid();
 const project={brand_snapshot:{productAssetId:product,name:'UNWANTED_PRODUCT',appearance:'UNWANTED_PRODUCT_GEOMETRY'},data:{title:'Test',referenceUrl:'',referenceNotes:'UNWANTED_ROOM_CATALOG',aspectRatio:'9:16',scenes:[],creativeMemory:{characterAssetIds:[character],referenceAssetIds:[style],approvedAssets:[prior],observedStates:[{sceneId,assetId:prior,summary:'Left hand holds bottle on screen-right'}]}}};
 const plan={continuity:'UNWANTED_GLOBAL_PRODUCT_CATALOG',scenes:[{id:sceneId,text:'Tell a story',visual:'Face reaction',motion:'Raise eyebrow',shotContract:contract()}]};
 return {project,plan,product,character,style,prior};
}
test('reaction prompt excludes global product/world catalogs and original product upload',()=>{
 const f=fixture(),packet=imagePacket(f.project,f.plan,0,{previous:{assetId:f.prior}});
 assert.ok(!packet.references.some(r=>r.assetId===f.product));
 assert.ok(packet.references.some(r=>r.assetId===f.character));
 const prompt=imageDirection(f.project,f.plan,0,packet);
 assert.ok(!prompt.includes('UNWANTED'));assert.match(prompt,/CURRENT state/);
 assert.equal(packet.previousObservedState.assetId,f.prior);
});
test('new location drops world references but may retain approved identity/state evidence',()=>{
 const f=fixture();f.plan.scenes[0].shotContract.transition='location_change';
 const packet=imagePacket(f.project,f.plan,0,{anchor:{assetId:f.prior},previous:{assetId:f.prior}});
 assert.equal(packet.includeFilmstrip,false);assert.ok(!packet.references.some(r=>r.assetId===f.style));
 assert.equal(packet.references.filter(r=>r.assetId===f.prior).length,1);
});
test('unapproved and rejected images cannot anchor subsequent generation or contribute observed state',()=>{
 const f=fixture(),unknown=uuid();
 assert.ok(!imagePacket(f.project,f.plan,0,{anchor:{assetId:unknown}}).references.some(r=>r.assetId===unknown));
 const p=remember(f.project,{rejectedAssets:[f.prior]});
 const packet=imagePacket(p,f.plan,0,{previous:{assetId:f.prior}});
 assert.ok(!packet.references.some(r=>r.assetId===f.prior));assert.equal(packet.previousObservedState,null);
 assert.deepEqual(p.data.creativeMemory.observedStates,[]);
});
test('physical product face must come from registered original views; invented IDs fail before provider call',()=>{
 const f=fixture(),view=uuid();f.project.data.creativeMemory.productViews=[{assetId:view,features:'Loop and USB on this side'}];
 f.plan.scenes[0].shotContract=contract({productVisible:true,productViewAssetIds:[view]});
 assert.match(JSON.stringify(imagePacket(f.project,f.plan,0)),/Loop and USB/);
 f.plan.scenes[0].shotContract.productViewAssetIds=[uuid()];
 assert.throws(()=>imagePacket(f.project,f.plan,0),/PRODUCTION_PLAN/);
 assert.throws(()=>normalizeShotContract(contract({productViewAssetIds:[view]})),/PRODUCTION_PLAN/);
});
test('shot contract and asset-bound state survive plan validation and project serialization',()=>{
 const f=fixture(),p=validatePlan(f.plan,'Tell a story');
 assert.deepEqual(p.scenes[0].shotContract,contract());
 f.project.data.scenes=[{...f.plan.scenes[0],start:0,end:3,imageAssetId:f.prior,selectedVersionId:null}];
 const d=projectData(f.project.data);assert.deepEqual(d.scenes[0].shotContract,contract());
 assert.equal(d.creativeMemory.observedStates[0].assetId,f.prior);
 assert.throws(()=>normalizeShotContract(contract({productVisible:'false'})),/PRODUCTION_PLAN/);
});
test('actual multipart request uses scoped reference roles and omits old filmstrip on relocation',async()=>{
 const f=fixture(),loaded=[];f.plan.scenes[0].shotContract.transition='location_change';f.project.referenceEvidence=['data:image/png;base64,iVBORw0KGgo='];
 let body;
 const providers=createProductionProviders({OPENAI_API_KEY:'fixture'},{fetchImpl:async(url,options)=>{
  if(String(url).startsWith('https://storage.test/'))return new Response(Buffer.from([137,80,78,71,13,10,26,10]));
  body=options.body;return new Response(null,{status:503});
 }});
 await assert.rejects(providers.image({project:f.project,plan:f.plan,index:0,previous:{assetId:f.prior},invoke:async(_a,{assetId})=>{loaded.push(assetId);return {url:'https://storage.test/'+assetId};}}));
 assert.deepEqual(loaded,[f.character,f.prior]);assert.equal(body.getAll('image[]').length,2);
 assert.ok(!body.get('prompt').includes('UNWANTED'));assert.equal(body.get('size'),'1024x1536');
});
test('focused reviewer inspects only the requested target and binds observed state to its immutable asset',async()=>{
 const f=fixture(),images=[{assetId:uuid()},{assetId:uuid()}];
 f.plan.scenes.push({...f.plan.scenes[0],id:uuid()});let calls=0;
 const providers=createProductionProviders({REFERENCE_FLASH_KEY:'fixture'},{fetchImpl:async(url,options)=>{
  if(String(url).startsWith('https://storage.test/'))return new Response(Buffer.from([137,80,78,71,13,10,26,10]));
  calls++;assert.match(JSON.stringify(JSON.parse(options.body)),/ACTUAL target state/);
  return new Response('data: '+JSON.stringify({model:CHAT_MODEL,choices:[{delta:{tool_calls:[{index:0,function:{name:'review_ad',arguments:JSON.stringify({verdict:'pass',summary:'Hands empty; no bottle visible in close-up.',issues:[]})}}]},finish_reason:'tool_calls'}]})+'\n\n');
 }});
 const result=await providers.reviewImage({project:f.project,plan:f.plan,images,index:1,invoke:async()=>({url:'https://storage.test/image'})});
 assert.equal(calls,1);assert.deepEqual(result.observedStates,[{sceneId:f.plan.scenes[1].id,assetId:images[1].assetId,summary:'Hands empty; no bottle visible in close-up.'}]);
 assert.equal(paidStep('still-check-1-0'),'quality');assert.equal(paidStep('still-check-1-2'),'quality');
});
test('new director output without a scoped shot contract fails instead of silently using legacy prompts',async()=>{
 const f=fixture();
 await assert.rejects(callDirector(f.project,{REFERENCE_FLASH_KEY:'fixture'},{fetchImpl:async()=>new Response('data: '+JSON.stringify({model:CHAT_MODEL,choices:[{delta:{tool_calls:[{index:0,function:{name:'direct_ad',arguments:JSON.stringify({continuity:'Same person',scenes:[{text:'Tell a story',visual:'Face reaction',motion:'Raise eyebrow'}]})}}]},finish_reason:'tool_calls'}]})+'\n\n')}),/PRODUCTION_PLAN/);
});
