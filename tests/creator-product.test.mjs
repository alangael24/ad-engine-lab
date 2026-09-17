import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {database,user,call} from './helpers/database.mjs';
import {creatorRequest} from '../assets/creator-model.js';
import {projectData} from '../assets/studio-model.js';
import {productPath} from '../assets/product-profiles.js';
import {applyEdit} from '../assets/chat-model.js';
import {chatRequest} from '../src/studio-chat.js';
import {writeScriptChanges} from '../src/script-writer.js';
import {CREATOR_CHAT_SYSTEM,CREATOR_SCRIPT_SYSTEM,CREATOR_DIRECTOR_SYSTEM} from '../src/creator-prompts.js';
import {creativeGuide} from '../assets/creative-formats.js';
import {referenceDirection} from '../assets/reference-model.js';
import {createProductionProviders,callDirector} from '../workers/production-providers.mjs';
import {SCRIPT_MODEL} from '../assets/model-routing.js';
import {CHAT_MODEL} from '../assets/chat-model.js';
let db;before(async()=>{db=await database();});after(async()=>{await db.close();});
const data=(options={})=>projectData({...creatorRequest('El astronauta perdió sus llaves.',{kind:'story',mode:'script',...options}),productProfile:'creator-v1'});
const write=(u,action,id,d,expected=null)=>call(db,'studio_write',[u.id,action,id,JSON.stringify(d),expected]);
const sse=(model,name,args)=>new Response('data: '+JSON.stringify({model,choices:[{delta:{tool_calls:[{index:0,function:{name,arguments:JSON.stringify(args)}}]},finish_reason:'tool_calls'}],usage:{prompt_tokens:12,completion_tokens:15}})+'\n\ndata: [DONE]\n\n');
const shot={productVisible:false,characterVisible:true,transition:'cut',camera:'Medium',state:'Helmet on astronaut, holding keys',endState:'Keys drop on ground',preserve:['Blue suit, round helmet'],change:['Keys fall'],productViewAssetIds:[]};
test('new account creates content without a brand, survives edits and retries, and owns its project',async()=>{
 const u=await user(db),id=crypto.randomUUID();
 const p=await write(u,'create_project',id,data());assert.equal(p.brand_id,null);assert.deepEqual(p.brand_snapshot,{});assert.equal(p.data.creatorBrief.targetDuration,30);
 assert.equal((await write(u,'create_project',id,data())).id,id);
 assert.equal((await db.query('select count(*)::int n from studio_brands where user_id=$1',[u.id])).rows[0].n,0);
 assert.equal(productPath(p.data),'/crear/');
 const edited=applyEdit(p,{operation:'draft_script',value:'El astronauta encontró las llaves en su casco.'});
 const saved=await write(u,'save_project',id,edited,p.revision);assert.equal(saved.data.productProfile,'creator-v1');assert.equal(saved.data.creatorBrief.kind,'story');
 await assert.rejects(write(u,'save_project',id,{...saved.data,productProfile:'ads-sales-v1'},saved.revision),/STUDIO_PRODUCT_LOCKED/);
 await assert.rejects(write(u,'refresh_brand',id,{},saved.revision),/STUDIO_INVALID/);
 const other=await user(db);await assert.rejects(write(other,'save_project',id,saved.data,saved.revision),/STUDIO_NOT_FOUND/);
 await assert.rejects(write(u,'save_project',id,saved.data,p.revision),/STUDIO_CONFLICT/);
});
test('legacy and sales still require brands; creator rejects invented brands and foreign references',async()=>{
 const u=await user(db);
 for(const productProfile of ['continuity-v1','ads-sales-v1'])await assert.rejects(write(u,'create_project',crypto.randomUUID(),{...data(),productProfile}),/STUDIO_NOT_FOUND/);
 assert.throws(()=>projectData({...data(),brandId:crypto.randomUUID()}),/STUDIO_INVALID/);
 await assert.rejects(write(u,'create_project',crypto.randomUUID(),{...data(),creativeMemory:{characterAssetIds:[crypto.randomUUID()]}}),/STUDIO_ASSET_NOT_FOUND/);
 const id=crypto.randomUUID();await write(u,'register_asset',id,{kind:'image',name:'Character',bucket:'generation-references',storage_path:`${u.id}/${id}.png`,mime_type:'image/png',size_bytes:80});
 const p=await write(u,'create_project',crypto.randomUUID(),{...data(),creativeMemory:{characterAssetIds:[id]}});assert.equal(p.data.creativeMemory.characterAssetIds[0],id);
 const v=await user(db);await assert.rejects(write(v,'create_project',crypto.randomUUID(),p.data),/STUDIO_ASSET_NOT_FOUND/);
});
test('creator production queues without a product but still enforces credits, script and explicit enablement',async()=>{
 const u=await user(db),p=await write(u,'create_project',crypto.randomUUID(),data());
 await db.query("insert into studio_production_workers(id) values('creator-test') on conflict(id) do update set last_seen_at=now()");
 const start=(project=p,enabled=true)=>call(db,'studio_production_start',[u.id,crypto.randomUUID(),project.id,project.revision,enabled]);
 await assert.rejects(start(p,false),/PRODUCTION_OFFLINE/);
 await db.query('update credit_balances set image_credits=0 where user_id=$1',[u.id]);await assert.rejects(start(),/INSUFFICIENT_CREDITS/);
 await db.query('update credit_balances set image_credits=20 where user_id=$1',[u.id]);
 const empty=await write(u,'create_project',crypto.randomUUID(),{...data(),scriptDraft:''});await assert.rejects(start(empty),/PRODUCTION_SCRIPT/);
 const j=await start();assert.equal(j.status,'queued');assert.equal(j.snapshot.data.productProfile,'creator-v1');assert.equal(j.snapshot.brand_id,null);
 const grants=(await db.query("select has_function_privilege('anon','public.studio_write(uuid,text,uuid,jsonb,integer)','execute') a,has_function_privilege('authenticated','public.studio_write(uuid,text,uuid,jsonb,integer)','execute') b")).rows[0];assert.equal(grants.a,false);assert.equal(grants.b,false);
});
test('creator direction, chat, reference and script use content rules without changing supplied script',async()=>{
 const project={id:crypto.randomUUID(),revision:1,brand_snapshot:{},data:data()};const before=structuredClone(project.data);
 const request=chatRequest(project,[],[],'Cuenta esta historia');assert.ok(request.messages[0].content.startsWith(CREATOR_CHAT_SYSTEM));
 assert.doesNotMatch(creativeGuide({format:'skeleton',look:'3d'},project.data),/earned product reveal/);
 assert.doesNotMatch(referenceDirection({style:'Colorful'},project.data),/nuestra marca/);
 const edit={operation:'draft_script',value:'Desarrolla la historia'};
 await writeScriptChanges(edit,{project,history:[],message:'Escribe una historia',env:{REFERENCE_FLASH_KEY:'fixture'},request:async(url,options)=>{assert.ok(JSON.parse(options.body).messages[0].content.startsWith(CREATOR_SCRIPT_SYSTEM));return sse(SCRIPT_MODEL,'write_script',{value:'El astronauta encontró las llaves.'});}});
 assert.equal(edit.value,'El astronauta encontró las llaves.');assert.deepEqual(project.data,before);
 let requestBody;
 const plan=await callDirector(project,{PRODUCTION_WORKFLOW_PROFILE:'sol-luna-v1',REFERENCE_FLASH_KEY:'fixture'},{invoke:async()=>{throw Error('No references should load');},fetchImpl:async(url,options)=>{requestBody=JSON.parse(options.body);return sse(CHAT_MODEL,'direct_ad',{continuity:'Same blue astronaut',scenes:[{text:project.data.scriptDraft,visual:'Astronaut on moon',motion:'Keys fall',shotContract:shot}]});}});
 assert.equal(requestBody.input[0].content,CREATOR_DIRECTOR_SYSTEM);assert.equal(plan.scenes[0].text,before.scriptDraft);assert.equal(plan.scenes[0].shotContract.productVisible,false);
});
test('first creator still uses generations; subsequent approved identity uses edits, with measured usage',async()=>{
 const image=Buffer.from([137,80,78,71,13,10,26,10]),usage={input_tokens:40,output_tokens:6250,total_tokens:6290},seen=[];
 const providers=createProductionProviders({OPENAI_API_KEY:'fixture'},{fetchImpl:async(url,options)=>{
  if(String(url).startsWith('https://api.openai.com/')){seen.push({url,body:options.body});return Response.json({usage,data:[{b64_json:image.toString('base64')}]});}
  return new Response(image);
 }});
 const invoke=async(action,d)=>action==='asset'?{url:'https://storage.test/image'}:action==='upload'?{uploadUrl:'https://storage.test/upload'}:{result:{id:d.assetId}};
 const project={brand_snapshot:{},data:data()},plan={continuity:'Blue astronaut',scenes:[{text:'Hola.',visual:'Astronaut keys',shotContract:shot}]};
 const first=await providers.image({project,plan,index:0,invoke});assert.ok(seen[0].url.endsWith('/generations'));assert.equal(JSON.parse(seen[0].body).quality,'medium');assert.deepEqual(first.usage,usage);
 project.data.creativeMemory={approvedAssets:[first.assetId]};await providers.image({project,plan,index:0,invoke,anchor:first});assert.ok(seen[1].url.endsWith('/edits'));assert.equal(seen[1].body.getAll('image[]').length,1);
});

test('creator writer retries an oversized draft once, meters both calls and never silently truncates',async()=>{
 const project={id:crypto.randomUUID(),data:data({targetDuration:15}),brand_snapshot:{}},edit={operation:'draft_script',value:'Comedia'};let calls=0;const deltas=[];
 const usage=await writeScriptChanges(edit,{project,history:[],message:'Guion',env:{REFERENCE_FLASH_KEY:'fixture'},onDelta:d=>deltas.push(d),request:async(url,options)=>{calls++;assert.match(JSON.parse(options.body).messages[0].content,/máximo 39 palabras/);return sse(SCRIPT_MODEL,'write_script',{value:calls===1?'Palabra '.repeat(100):'El astronauta buscó sus llaves en toda la Luna. Las llevaba dentro del casco.'});}});
 assert.equal(calls,2);assert.equal(usage.length,2);assert.ok(edit.value.endsWith('casco.'));assert.ok(!JSON.stringify(deltas).includes('Palabra'));
 calls=0;await assert.rejects(writeScriptChanges({operation:'draft_script',value:'Comedia'},{project,history:[],message:'Guion',env:{REFERENCE_FLASH_KEY:'fixture'},request:async()=>{calls++;return sse(SCRIPT_MODEL,'write_script',{value:'Palabra '.repeat(100)});}}),/CHAT_SCRIPT_DURATION/);assert.equal(calls,2);
});
