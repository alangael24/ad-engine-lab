import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareImageContracts,reviewMaterialImages,materialImageReviewEnabled} from '../workers/material-image-review.mjs';
import {editorialCall} from '../workers/editorial-models.mjs';
import {paidStep} from '../src/production-spend.js';
const png=Buffer.from([137,80,78,71,13,10,26,10]);
function fixture(){
 const project={brand_snapshot:{productAssetId:'product',appearance:'Teal bottle'},data:{creative:{format:'auto',look:'3d'},creativeMemory:{characterAssetIds:['hero']}}};
 const plan={continuity:'Brick miniature world, same silver-haired founder.',scenes:['a','b'].map(id=>({id,text:'Approved script',visual:'Founder holds a bottle',motion:'Pan',shotContract:{productVisible:true,characterVisible:true,state:'Founder holds one bottle',preserve:['Mustard vest']}}))};
 plan.imageContracts=prepareImageContracts(project,plan);
 const steps=new Map(),calls=[],costs=[],env={OPENAI_API_KEY:'fixture',OPENCODE_API_KEY:'fixture'};
 const invoke=async(action,d)=>{
  if(action==='asset')return {url:'https://assets.test/'+d.assetId};
  if(action==='begin_step'){assert(paidStep(d.key)==='quality');const old=steps.get(d.key);if(old?.status==='started')throw Error('PRODUCTION_UNCERTAIN');if(old)return old;steps.set(d.key,{status:'started'});return {status:'started'};}
  if(action==='finish_step'){steps.set(d.key,{status:'done',result:structuredClone(d.result)});return {};}
  if(action==='reserve_cost'||action==='record_cost'){assert(steps.has(d.key));costs.push({action,...d});return {};}
  throw Error(action);
 };
 const fetchImpl=async url=>new Response(Buffer.concat([png,Buffer.from(String(url))]));
 const callModel=async args=>{
  calls.push(args);args.usage.calls.push({id:'c'+calls.length,cost:.01,status:'completed'});args.usage.total=.01;await args.onUsage(args.usage);
  return {assessments:args.context.packets.map(p=>({sceneId:p.contract.sceneId,checks:p.scope.map(criterionId=>({criterionId,status:'met',difference:'none',observation:'Visible correct feature',consequence:''}))}))};
 };
 return {project,plan,images:[{assetId:'image-a'},{assetId:'image-b'}],invoke,env,fetchImpl,callModel,steps,calls,costs};
}
test('production inspector is enabled only for the matching model profile',()=>{
 assert.equal(materialImageReviewEnabled({}),true);
 assert.equal(materialImageReviewEnabled({PRODUCTION_IMAGE_REVIEW_MODE:'legacy'}),false);
 assert.throws(()=>materialImageReviewEnabled({PRODUCTION_WORKFLOW_PROFILE:'sol-luna-v1'}),/WORKFLOW_CONFIG/);
 assert.throws(()=>materialImageReviewEnabled({PRODUCTION_IMAGE_REVIEW_MODE:'typo'}));
});
test('contracts derive only pre-image requirements, not subtitle space or invisible subjects',()=>{
 const f=fixture();f.plan.scenes[0].shotContract.productVisible=false;f.plan.scenes[0].shotContract.characterVisible=false;
 const c=prepareImageContracts(f.project,f.plan)[0];assert(!c.criteria.some(x=>['product','character'].includes(x.id)));assert(!JSON.stringify(c).includes('subtitle'));
 const before=JSON.stringify(f.plan.imageContracts);f.plan.scenes[0].visual='repair prompt';assert.equal(JSON.stringify(f.plan.imageContracts),before);
});
test('sequential DeepSeek inspections reuse paid calls in mandatory grouped Astra gate',async()=>{
 const f=fixture();
 for(let i=0;i<2;i++){const r=await reviewMaterialImages({...f,targetIndex:i,images:f.images.slice(0,i+1)});assert.equal(r.verdict,'pass');assert.equal(r.collectionGate,false);}
 assert.deepEqual(f.calls.map(c=>c.role),['inspector','inspector']);
 const r=await reviewMaterialImages(f);assert.equal(r.verdict,'pass');assert.equal(r.collectionGate,true);assert.equal(f.calls.length,3);assert.equal(f.calls[2].role,'director');assert.equal(f.calls[2].context.packets.length,2);
 assert(f.calls[2].images.length<6); // Shared product/hero references occur once.
 assert(f.calls.every(c=>c.images.length>0));assert.equal(f.costs.length,3);
 await reviewMaterialImages(f);assert.equal(f.calls.length,3);
 f.images[1].assetId='replacement';await reviewMaterialImages(f);assert.equal(f.calls.length,5); // Only changed primary plus group.
});
test('uncertain persisted calls stop without dispatch or fallback expense',async()=>{
 const f=fixture();const invoke=f.invoke;f.invoke=async(a,d)=>{if(a==='begin_step')throw Error('PRODUCTION_UNCERTAIN');return invoke(a,d);};
 await assert.rejects(reviewMaterialImages(f),/PRODUCTION_UNCERTAIN/);assert.equal(f.calls.length,0);
});
test('Astra uncertainty blocks animation and never asks for a repair prompt',async()=>{
 const f=fixture(),base=f.callModel;f.callModel=async args=>{const r=await base(args);if(args.role==='director')for(const a of r.assessments)for(const c of a.checks)Object.assign(c,{status:'unverifiable',difference:'unverifiable'});return r;};
 const r=await reviewMaterialImages(f);assert.equal(r.verdict,'blocked');assert(r.issues.every(i=>i.action==='none'));assert.equal(f.calls.filter(c=>c.role==='editor').length,0);
});
test('confirmed defect uses a separately checkpointed DeepSeek repair and preserves contract',async()=>{
 const f=fixture(),base=f.callModel,before=JSON.stringify(f.plan.imageContracts);f.callModel=async args=>{
  if(args.role==='editor'){f.calls.push(args);args.usage.calls.push({cost:.001,status:'completed'});args.usage.total=.001;await args.onUsage(args.usage);return {visual:'Founder holds the correct teal bottle fully visible',motion:'Slow push'};}
  const r=await base(args);for(const a of r.assessments)if(a.sceneId==='a')for(const c of a.checks)if(c.criterionId==='product')Object.assign(c,{status:'violated',difference:'present',observation:'Bottle is red and has wrong geometry',consequence:'Wrong advertised product'});return r;
 };
 const r=await reviewMaterialImages(f);assert.equal(r.verdict,'repair');assert.equal(r.issues.length,1);assert.equal(r.issues[0].action,'replace_image');assert.equal(JSON.stringify(f.plan.imageContracts),before);
 const count=f.calls.length;await reviewMaterialImages(f);assert.equal(f.calls.length,count);
});
test('DeepSeek inspector transport actually sends image inputs and counts provider usage',async()=>{
 let request;const usage={total:0,calls:[],unknown:false};
 const result=await editorialCall({role:'inspector',name:'inspect',schema:{type:'object'},system:'Inspect',context:{},images:['data:image/png;base64,iVBORw0KGgo='],usage,env:{OPENCODE_API_KEY:'fixture'},fetchImpl:async(url,init)=>{
  assert.equal(url,'https://opencode.ai/zen/go/v1/chat/completions');request=JSON.parse(init.body);
  return new Response('data: '+JSON.stringify({model:'deepseek-flash',usage:{prompt_tokens:100,completion_tokens:20},choices:[{delta:{content:'{"assessments":[]}'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');
 }});
 assert.equal(request.messages[1].content[1].type,'image_url');assert.deepEqual(result,{assessments:[]});assert(usage.total>0);
 await assert.rejects(editorialCall({role:'editor',name:'edit',schema:{},system:'',context:{},images:['image'],usage:{total:0,calls:[]},env:{OPENCODE_API_KEY:'fixture'}}),/ROLE_INVALID/);
});
