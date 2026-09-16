import {onRequestPost as productionWorkerRoute} from '../functions/api/studio-production-worker.js';
import {CHAT_MODEL} from '../assets/chat-model.js';
import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {database,user,call,ready} from './helpers/database.mjs';
import {validatePlan,alignScenes,alignmentFromWords,imageDirection} from '../assets/production-model.js';
import {processProduction} from '../workers/production-worker.mjs';
import {postProduction,getProduction,productionEnabled} from '../src/studio-production.js';
import {mockSupabase} from './helpers/supabase-http.mjs';
let db;before(async()=>{db=await database();});after(async()=>{await db.close();});
async function fixture(){const u=await user(db),photo=crypto.randomUUID();const write=(action,id,data,expected=null)=>call(db,'studio_write',[u.id,action,id,JSON.stringify(data),expected]);
 await write('register_asset',photo,{kind:'image',name:'Product',bucket:'generation-references',storage_path:`${u.id}/${photo}.png`,mime_type:'image/png',size_bytes:100});
 const b=await write('save_brand',crypto.randomUUID(),{name:'Test',product:'Filter',appearance:'Chrome cylinder',claims:'Reduce chlorine',avoid:'No hair growth',productAssetId:photo});
 const p=await write('create_project',crypto.randomUUID(),{title:'Test',brandId:b.id,aspectRatio:'9:16',referenceUrl:'',referenceNotes:'Macro',scriptDraft:'Hola mundo. Conoce el producto.',scenes:[],narrationAssetId:null,creative:{format:'auto',look:'3d'}});
 await db.query("insert into studio_production_workers(id) values('test-producer') on conflict(id) do update set last_seen_at=now()");
 return {u,p,write};
}
const start=(f,id=crypto.randomUUID(),enabled=true)=>call(db,'studio_production_start',[f.u.id,id,f.p.id,f.p.revision,enabled]);
const work=(j,action,data={})=>call(db,'studio_production_work',['test-producer',action,j.id,j.lease_token,JSON.stringify(data)]);
test('hosted service role can save a first brand without Auth password access',async()=>{
 const u=await user(db);
 await db.exec('set role service_role');
 try {
  const b=await call(db,'studio_write',[u.id,'save_brand',crypto.randomUUID(),JSON.stringify({name:'Imported shop',product:'Shoes'})]);
  assert.equal(b.user_id,u.id);
  await assert.rejects(db.query('select * from auth.users'),/permission denied/);
 } finally {await db.exec('reset role');}
});
test('production rollout is limited to permitted users and fails closed without their identity',()=>{
 const env={PRODUCTION_ENABLED:'true',PRODUCTION_ALLOWED_USERS:'account-a, account-b'};
 assert.equal(productionEnabled(env,'account-a'),true);
 assert.equal(productionEnabled(env,'account-b'),true);
 assert.equal(productionEnabled(env,'another-account'),false);
 assert.equal(productionEnabled(env),false);
 assert.equal(productionEnabled({...env,PRODUCTION_ENABLED:'false'},'account-a'),false);
});
test('no-credit accounts stop before media calls and insufficient image balance rolls back the step',async()=>{
 const f=await fixture();await db.query('update credit_balances set image_credits=0 where user_id=$1',[f.u.id]);
 await assert.rejects(start(f),/INSUFFICIENT_CREDITS/);
 assert.equal((await db.query('select count(*)::int n from studio_productions where project_id=$1',[f.p.id])).rows[0].n,0);
 await db.query('update credit_balances set image_credits=1 where user_id=$1',[f.u.id]);
 const initial=await start(f);let j;do{j=await call(db,'studio_production_work',['test-producer','claim']);if(j.id!==initial.id)await work(j,'fail',{code:'TEST_SKIP'});}while(j.id!==initial.id);
 await db.query('update credit_balances set image_credits=0 where user_id=$1',[f.u.id]);
 await assert.rejects(work(j,'begin_step',{key:'image-0',stage:'images'}),/INSUFFICIENT_CREDITS/);
 assert.equal((await db.query('select steps from studio_productions where id=$1',[j.id])).rows[0].steps['image-0'],undefined);
 await work(j,'fail',{code:'INSUFFICIENT_CREDITS'});
});
test('completed images replay without charging; failed image refunds once and a new attempt reuses completed assets',async()=>{
 const f=await fixture(),initial=await start(f);let j;
 do{j=await call(db,'studio_production_work',['test-producer','claim']);if(j.id!==initial.id)await work(j,'fail',{code:'TEST_SKIP'});}while(j.id!==initial.id);
 const plan={continuity:'Same',scenes:[{id:crypto.randomUUID(),text:'Hola mundo.',visual:'First',motion:'Pan'},{id:crypto.randomUUID(),text:'Conoce el producto.',visual:'Second',motion:'Push'}]};
 await work(j,'begin_step',{key:'plan',stage:'planning'});await work(j,'finish_step',{key:'plan',result:plan});
 await work(j,'begin_step',{key:'image-0',stage:'images'});const asset={assetId:crypto.randomUUID()};await work(j,'finish_step',{key:'image-0',result:asset});
 await work(j,'begin_step',{key:'image-0',stage:'images'});
 await work(j,'begin_step',{key:'image-1',stage:'images'});await assert.rejects(work(j,'begin_step',{key:'image-1',stage:'images'}),/PRODUCTION_UNCERTAIN/);
 await work(j,'fail',{code:'PRODUCTION_PROVIDER'});await assert.rejects(work(j,'fail',{code:'PRODUCTION_PROVIDER'}),/LEASE_LOST/);
 assert.equal((await db.query('select image_credits from credit_balances where user_id=$1',[f.u.id])).rows[0].image_credits,19);
 const next=await start(f);assert.deepEqual(next.steps['image-0'].result,asset);assert.equal(next.steps['image-1'],undefined);
 assert.equal((await db.query("select count(*)::int n from credit_ledger where user_id=$1 and reason='image_generation_refunded'",[f.u.id])).rows[0].n,1);
});
test('production start is authenticated, owner-scoped, revision-bound and idempotent',async()=>{
 const f=await fixture(),g=await fixture(),id=crypto.randomUUID();await assert.rejects(start(f,id,false),/PRODUCTION_OFFLINE/);
 const j=await start(f,id);assert.equal((await start(f,id,false)).id,j.id);
 await assert.rejects(call(db,'studio_production_start',[g.u.id,id,f.p.id,f.p.revision,true]),/STUDIO_NOT_FOUND/);
 await assert.rejects(start(f),/PRODUCTION_BUSY/);
 const h=await fixture();await h.write('save_project',h.p.id,h.p.data,h.p.revision);await assert.rejects(start(h),/STUDIO_CONFLICT/);
});
test('durable steps replay completed results and stop ambiguous external submissions',async()=>{
 const f=await fixture();const initial=await start(f);let j;do{j=await call(db,'studio_production_work',['test-producer','claim']);if(j.id!==initial.id)await work(j,'fail',{code:'TEST_SKIP'});}while(j.id!==initial.id);
 assert.equal((await work(j,'begin_step',{key:'plan',stage:'planning'})).status,'started');
 await assert.rejects(work(j,'begin_step',{key:'plan'}),/PRODUCTION_UNCERTAIN/);
 await work(j,'finish_step',{key:'plan',result:{approved:true}});
 assert.deepEqual((await work(j,'begin_step',{key:'plan'})).result,{approved:true});
 await assert.rejects(work(j,'finish_step',{key:'plan',result:{approved:false}}),/IDEMPOTENCY_CONFLICT/);
 await work(j,'write',{key:'save',action:'save_project',data:f.p.data});
 const once=(await db.query('select revision from studio_projects where id=$1',[f.p.id])).rows[0].revision;
 await work(j,'write',{key:'save',action:'save_project',data:f.p.data});assert.equal((await db.query('select revision from studio_projects where id=$1',[f.p.id])).rows[0].revision,once);
 await f.write('save_project',f.p.id,f.p.data,once);await assert.rejects(work(j,'heartbeat'),/STUDIO_CONFLICT/);await work(j,'fail',{code:'STUDIO_CONFLICT'});
});
test('browser roles cannot access production state or privileged worker RPC',async()=>{
 await db.exec('set role authenticated');try{await assert.rejects(db.query('select * from studio_productions'),/permission denied/);await assert.rejects(call(db,'studio_production_work',['test-producer','claim']),/permission denied/);}finally{await db.exec('reset role');}
});
test('director preserves script and legacy direction without copying neighboring shots into current image',()=>{
 const raw={continuity:'Same chrome cylinder, same person, blue CGI.',scenes:[{text:'Hola mundo.',visual:'Man looks at a comb.',motion:'Slow push in.'},{text:'Conoce el producto.',visual:'Show the full filter.',motion:'Slow arc.'}]};
 const p=validatePlan(raw,'Hola mundo. Conoce el producto.');assert.equal(p.scenes.length,2);
 assert.throws(()=>validatePlan(raw,'Hola mundo. Compra ahora.'),/PRODUCTION_SCRIPT_CHANGED/);
 const prompt=imageDirection({brand_snapshot:{appearance:'Cylinder must remain visible'},data:{aspectRatio:'9:16',referenceNotes:'Macro'}},p,1);assert.match(prompt,/Cylinder must remain visible/);assert.doesNotMatch(prompt,/Man looks at a comb/);assert.match(prompt,/Same chrome cylinder/);
});
test('timings follow actual word boundaries and reject missing, reordered or invalid alignment',()=>{
 const p=validatePlan({continuity:'Same set',scenes:[{text:'Hola mundo.',visual:'First',motion:'Pan'},{text:'Conoce el producto.',visual:'Second',motion:'Pan'}]},'Hola mundo. Conoce el producto.');
 const a=alignmentFromWords([{text:'Hola',start:.2,end:.7,type:'word'},{text:'mundo.',start:.8,end:1.5,type:'word'},{text:'Conoce',start:2.2,end:2.8,type:'word'},{text:'el',start:2.9,end:3,type:'word'},{text:'producto.',start:3.1,end:4,type:'word'}]);
 const scenes=alignScenes(p,a,4.2);assert.equal(scenes[0].end,1.85);assert.equal(scenes[1].start,1.85);assert.equal(scenes[1].end,4.2);
 assert.throws(()=>alignScenes(p,{...a,characters:['oops']},4.2),/PRODUCTION_TIMING/);
 assert.throws(()=>alignScenes(p,{...a,character_start_times_seconds:[2,1,2,3,4]},4.2),/PRODUCTION_TIMING/);
});
test('overlong shots split on measured word boundaries without dropping narration',()=>{
 const script=Array.from({length:20},(_,i)=>`word${i}`).join(' '),p=validatePlan({continuity:'Same',scenes:[{text:script,visual:'Shot',motion:'Pan'}]},script);
 const a=alignmentFromWords(script.split(' ').map((text,i)=>({text,start:i,end:i+.8,type:'word'}))),s=alignScenes(p,a,20);
 assert.equal(s.map(x=>x.text).join(' '),script);assert.ok(s.length>1);assert.ok(s.every(x=>x.end-x.start<=15));assert.equal(s.at(-1).end,20);
});
test('production API denies anonymous requests and hides internal lease/provider context',async()=>{
 const f=await fixture(),stub=mockSupabase(db),network=globalThis.fetch;stub.users.set('test-token',f.u);globalThis.fetch=stub.fetch;
 const env={SUPABASE_URL:'http://supabase.test',SUPABASE_SERVICE_ROLE_KEY:'test',PRODUCTION_ENABLED:'true'};
 try{
  assert.equal((await postProduction({env,request:new Request('http://local/api/studio-production',{method:'POST'})})).status,401);
  const r=await postProduction({env,request:new Request('http://local/api/studio-production',{method:'POST',headers:{authorization:'Bearer test-token','content-type':'application/json'},body:JSON.stringify({requestId:crypto.randomUUID(),projectId:f.p.id,expected:f.p.revision})})});assert.equal(r.status,202);
  const read=await getProduction({env,request:new Request('http://local/api/studio-production?project='+f.p.id,{headers:{authorization:'Bearer test-token'}})});const data=await read.json();assert.equal(data.productions.length,1);assert.equal(data.productions[0].snapshot,undefined);assert.equal(data.productions[0].lease_token,undefined);
 }finally{globalThis.fetch=network;}
});
test('unconfigured providers fail before any media generation',async()=>{
 let calls=0;const result=await processProduction({id:crypto.randomUUID(),lease_token:crypto.randomUUID()},async(action)=>{calls++;return {value:{}};},{ready(){throw Error('PRODUCTION_OFFLINE');},plan(){throw Error('should not generate');}});
 assert.equal(result.code,'PRODUCTION_OFFLINE');assert.equal(calls,2);
});
test('production preflight blocks disabled or stale clip coordinators before paid steps',async()=>{
 const f=await fixture(),initial=await start(f);let j;
 do{j=await call(db,'studio_production_work',['test-producer','claim']);if(j.id!==initial.id)await work(j,'fail',{code:'TEST_SKIP'});}while(j.id!==initial.id);
 const stub=mockSupabase(db),network=globalThis.fetch;globalThis.fetch=stub.fetch;
 const env={SUPABASE_URL:'http://supabase.test',SUPABASE_SERVICE_ROLE_KEY:'test',PRODUCTION_WORKER_TOKEN:'test-production-worker-token-32-characters',GENERATION_ENABLED:'false'};
 const invoke=()=>productionWorkerRoute({env,request:new Request('https://app.test/api/studio-production-worker',{method:'POST',headers:{authorization:'Bearer '+env.PRODUCTION_WORKER_TOKEN,'content-type':'application/json'},body:JSON.stringify({workerId:'test-producer',jobId:j.id,leaseToken:j.lease_token,action:'creative_context'})})});
 try{
  await ready(db);let r=await invoke();assert.equal(r.status,503);assert.equal((await r.json()).code,'PRODUCTION_GENERATION_OFFLINE');
  env.GENERATION_ENABLED='true';await db.query("update generation_workers set last_seen_at=now()-interval '2 minutes'");
  r=await invoke();assert.equal(r.status,503);
  await ready(db);r=await invoke();assert.equal(r.status,200,await r.clone().text());
  assert.equal((await db.query('select count(*)::int n from production_spend_reservations where job_id=$1',[j.id])).rows[0].n,0);
  assert.deepEqual((await db.query('select steps from studio_productions where id=$1',[j.id])).rows[0].steps,{});
 }finally{globalThis.fetch=network;await work(j,'fail',{code:'TEST_DONE'});}
});

test('resumed coordinator retains inherited still approvals after its own prepare write',async()=>{
 const f=await fixture();await ready(db);
 const claim=async(id)=>{let j;do{j=await call(db,'studio_production_work',['test-producer','claim']);if(j.id!==id)await work(j,'fail',{code:'TEST_SKIP'});}while(j.id!==id);return j;};
 const old=await claim((await start(f)).id),scene={id:crypto.randomUUID(),text:'Hola mundo. Conoce el producto.',visual:'Full filter',motion:'Flowing water',start:0,end:5,imageAssetId:f.p.brand_snapshot.productAssetId};
 const saved=await work(old,'write',{key:'prepare',stage:'images',action:'save_project',data:{...f.p.data,scenes:[scene]}});
 const steps={plan:{status:'done',result:{scenes:[scene]}},timing:{status:'done',result:[{id:scene.id,planSceneId:scene.id}]},'still-check-0-0':{status:'done',result:{verdict:'pass',issues:[],assetIds:[scene.imageAssetId]}}};
 await db.query('update studio_productions set steps=steps||$2::jsonb where id=$1',[old.id,JSON.stringify(steps)]);
 await work(old,'fail',{code:'TEST_RESTART'});
 f.p=(await db.query('select * from studio_projects where id=$1',[f.p.id])).rows[0];
 const j=await claim((await start(f)).id),stub=mockSupabase(db),network=globalThis.fetch;
 globalThis.fetch=stub.fetch;
 const env={SUPABASE_URL:'http://supabase.test',SUPABASE_SERVICE_ROLE_KEY:'test',PRODUCTION_WORKER_TOKEN:'test-production-worker-token-32-characters',GENERATION_ENABLED:'true'};
 const context=()=>productionWorkerRoute({env,request:new Request('https://app.test/api/studio-production-worker',{method:'POST',headers:{authorization:'Bearer '+env.PRODUCTION_WORKER_TOKEN,'content-type':'application/json'},body:JSON.stringify({workerId:'test-producer',jobId:j.id,leaseToken:j.lease_token,action:'creative_context'})})});
 try{
  for(let n=0;n<2;n++){
   const r=await context();assert.equal(r.status,200,await r.clone().text());
   assert.equal((await r.json()).value.recoveredStillApprovals[scene.id]?.assetId,scene.imageAssetId);
   if(!n)await work(j,'write',{key:'prepare',stage:'images',action:'save_project',data:f.p.data});
  }
  const current=(await db.query('select * from studio_projects where id=$1',[f.p.id])).rows[0];
  await f.write('save_project',f.p.id,{...current.data,scriptDraft:'Changed by customer'},current.revision);
  assert.notEqual((await context()).status,200);
 }finally{globalThis.fetch=network;await work(j,'fail',{code:'TEST_DONE'});}
});

test('chat approval creates one production atomically and duplicate completion reuses it',async()=>{
 const f=await fixture(),id=crypto.randomUUID(),payload={expected:f.p.revision,message:'Me gusta, haz el video',enabled:true};
 await call(db,'studio_chat_write',[f.u.id,'reserve',id,f.p.id,JSON.stringify(payload)]);
 const done={edit:{operation:'produce',message:'Starting'},nextData:null,productionEnabled:true};
 const e=await call(db,'studio_chat_write',[f.u.id,'complete',id,f.p.id,JSON.stringify(done)]);assert.equal(e.result.productionId,id);
 const replay=await call(db,'studio_chat_write',[f.u.id,'complete',id,f.p.id,JSON.stringify(done)]);assert.equal(replay.result.productionId,id);
 assert.equal((await db.query('select count(*)::int n from studio_productions where project_id=$1',[f.p.id])).rows[0].n,1);
 const g=await fixture(),gid=crypto.randomUUID();await call(db,'studio_chat_write',[g.u.id,'reserve',gid,g.p.id,JSON.stringify({...payload,expected:g.p.revision})]);
 await assert.rejects(call(db,'studio_chat_write',[g.u.id,'complete',gid,g.p.id,JSON.stringify({...done,productionEnabled:false})]),/PRODUCTION_OFFLINE/);
 assert.equal((await db.query('select status from studio_chat_edits where id=$1',[gid])).rows[0].status,'running');
});

test('clip preparation checkpoints prompts before enqueue, survives lost replies and rejects conflicting replay',async()=>{
 const f=await fixture();await ready(db);const initial=await start(f);let j;
 do{j=await call(db,'studio_production_work',['test-producer','claim']);if(j.id!==initial.id)await work(j,'fail',{code:'TEST_SKIP'});}while(j.id!==initial.id);
 const scene={id:crypto.randomUUID(),text:'Hola mundo.',visual:'Show the complete filter.',motion:'Continuous flowing water.',start:0,end:5,imageAssetId:f.p.brand_snapshot.productAssetId};
 await work(j,'write',{key:'prepare-test',stage:'images',action:'save_project',data:{...f.p.data,scenes:[scene]}});
 const stub=mockSupabase(db),network=globalThis.fetch;let llm=0,failEnqueue=false;
 globalThis.fetch=async(input,opts)=>{
  if(failEnqueue&&String(input).endsWith('/rpc/studio_production_work')){const b=JSON.parse(opts.body);if(b.p_action==='write'&&b.p_data?.action==='version'){const after=failEnqueue==='after';failEnqueue=false;if(after)await stub.fetch(input,opts);return Response.json({message:'TEST_ENQUEUE_UNAVAILABLE'},{status:503});}}
  if(String(input).startsWith('https://opencode.ai/')){
   llm++;const req=JSON.parse(opts.body);assert.equal(req.model,'deepseek-flash');assert.equal(req.messages[1].content[1].type,'image_url');
   return new Response('data: '+JSON.stringify({model:'deepseek-v4.1-flash',usage:{prompt_tokens:100,completion_tokens:100},choices:[{delta:{content:JSON.stringify({integrated_multimodal_description:'[Shot 1] Live-action close-up of the complete filter in <Picture 1>. Water flows steadily as the camera slowly pushes in, preserving every product part through the final frame.'})},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');
  }return stub.fetch(input,opts);
 };
 const env={SUPABASE_URL:'http://supabase.test',SUPABASE_SERVICE_ROLE_KEY:'test',PRODUCTION_WORKER_TOKEN:'test-production-worker-token-32-characters',GENERATION_ENABLED:'true',PRODUCTION_WORKFLOW_PROFILE:'astra-deepseek-v1',OPENCODE_API_KEY:'test-only'};
 const data={workerId:'test-producer',jobId:j.id,leaseToken:j.lease_token,action:'write',data:{key:'clip-test',stage:'clips',action:'version',data:{requestId:crypto.randomUUID(),sceneId:scene.id}}};
 const invoke=(body=data)=>productionWorkerRoute({env,request:new Request('https://app.test/api/studio-production-worker',{method:'POST',headers:{authorization:'Bearer '+env.PRODUCTION_WORKER_TOKEN,'content-type':'application/json'},body:JSON.stringify(body)})});
 try{
  const prep={...data,action:'prepare_clip'};
  const prepared=await invoke(prep);assert.equal(prepared.status,200,await prepared.clone().text());
  assert.equal((await invoke(prep)).status,200);assert.equal(llm,1);
  assert.equal((await db.query('select count(*)::int n from generation_jobs where request_id=$1',[data.data.data.requestId])).rows[0].n,0);
  const checkpoint=(await db.query('select steps from studio_productions where id=$1',[j.id])).rows[0].steps['clip-test-prompt'];
  assert.equal(checkpoint.status,'done');assert.match(checkpoint.result.prompt,/For the target video/);
  const conflict=await invoke({...prep,data:{...prep.data,data:{...prep.data.data,requestId:crypto.randomUUID()}}});assert.equal(conflict.status,409);assert.equal(llm,1);
  failEnqueue=true;const failed=await invoke();assert.notEqual(failed.status,200);assert.equal(llm,1);
  failEnqueue='after';const lostReply=await invoke();assert.notEqual(lostReply.status,200);assert.equal(llm,1);
  const first=await invoke();assert.equal(first.status,200,await first.clone().text());const second=await invoke();assert.equal(second.status,200,await second.clone().text());assert.equal(llm,1);
  const rows=(await db.query('select prompt from generation_jobs where request_id=$1',[data.data.data.requestId])).rows;assert.equal(rows.length,1);assert.ok(rows[0].prompt.startsWith('For the target video'));assert.match(rows[0].prompt,/overall_soundscape: N\/A/);
  const spend=(await db.query('select measured_microusd from production_spend_reservations where job_id=$1 and step_key=$2',[j.id,'clip-test-prompt'])).rows;
  assert.equal(Number(spend[0].measured_microusd),150);
  const uncertainKey='clip-uncertain';
  await work(j,'begin_step',{key:uncertainKey+'-prompt',stage:'clips'});
  const uncertain=await invoke({...prep,data:{...prep.data,key:uncertainKey,data:{...prep.data.data,requestId:crypto.randomUUID()}}});
  assert.notEqual(uncertain.status,200);assert.match(await uncertain.text(),/PRODUCTION_UNCERTAIN/);assert.equal(llm,1);
  await db.query("update studio_productions set lease_expires_at=now()-interval '1 second' where id=$1",[j.id]);
  const stale=await invoke(prep);assert.notEqual(stale.status,200);assert.equal(llm,1);
 }finally{globalThis.fetch=network;}
});
test('temporary test allowance expires and preserves the normal daily attempt limit',async()=>{
 const f=await fixture();
 for(let i=0;i<5;i++){const j=await start(f);await db.query("update studio_productions set status='failed' where id=$1",[j.id]);}
 await assert.rejects(start(f),/PRODUCTION_LIMIT/);
 await db.query("insert into production_attempt_allowances values($1,7,now()+interval '1 hour')",[f.u.id]);
 const extra=await start(f);assert.equal(extra.status,'queued');
 await db.query("update studio_productions set status='failed' where id=$1",[extra.id]);
 await db.query("update production_attempt_allowances set expires_at=now()-interval '1 minute' where user_id=$1",[f.u.id]);
 await assert.rejects(start(f),/PRODUCTION_LIMIT/);
});

test('explicit retry preserves paid voice and fences an ambiguous synthesis checkpoint',async()=>{
 const f=await fixture(),initial=await start(f);let j;
 do{j=await call(db,'studio_production_work',['test-producer','claim']);if(j.id!==initial.id)await work(j,'fail',{code:'TEST_SKIP'});}while(j.id!==initial.id);
 const key='voice-'+'a'.repeat(32),pending='voice-'+'b'.repeat(32),saved={assetId:crypto.randomUUID(),duration:3,subtitleUrl:'https://example.test/subtitle',usage:{costUsd:.01}};
 await work(j,'begin_step',{key,stage:'narration'});await work(j,'finish_step',{key,result:saved});
 await work(j,'begin_step',{key:pending,stage:'narration'});await work(j,'fail',{code:'PRODUCTION_VOICE_UNCERTAIN'});
 const retry=await start(f);assert.deepEqual(retry.steps[key].result,saved);assert.equal(retry.steps[pending].status,'started');
 do{j=await call(db,'studio_production_work',['test-producer','claim']);if(j.id!==retry.id)await work(j,'fail',{code:'TEST_SKIP'});}while(j.id!==retry.id);
 assert.deepEqual((await work(j,'begin_step',{key,stage:'narration'})).result,saved);
 await assert.rejects(work(j,'begin_step',{key:pending,stage:'narration'}),/PRODUCTION_UNCERTAIN/);
 await work(j,'fail',{code:'TEST_DONE'});
});

test('material inspector subcalls persist and settle without charging their outer review twice',async()=>{
 const f=await fixture();await ready(db);const initial=await start(f);let j;
 do{j=await call(db,'studio_production_work',['test-producer','claim']);if(j.id!==initial.id)await work(j,'fail',{code:'TEST_SKIP'});}while(j.id!==initial.id);
 const stub=mockSupabase(db),network=globalThis.fetch;globalThis.fetch=stub.fetch;
 const env={SUPABASE_URL:'http://supabase.test',SUPABASE_SERVICE_ROLE_KEY:'test',PRODUCTION_WORKER_TOKEN:'test-production-worker-token-32-characters'};
 const invoke=async(action,data)=>{const r=await productionWorkerRoute({env,request:new Request('https://app.test/api/studio-production-worker',{method:'POST',headers:{authorization:'Bearer '+env.PRODUCTION_WORKER_TOKEN,'content-type':'application/json'},body:JSON.stringify({workerId:'test-producer',jobId:j.id,leaseToken:j.lease_token,action,data})})});assert.equal(r.status,200,await r.clone().text());return (await r.json()).value;};
 try{
  await invoke('begin_step',{key:'material-v1-image-review-0',stage:'images'});
  const key='material-call-'+'a'.repeat(64);await invoke('begin_step',{key,stage:'images'});
  await invoke('reserve_cost',{key,costUsd:.2});await invoke('record_cost',{key,costUsd:.035});
  const result={assessments:[],costUsd:.035};await invoke('finish_step',{key,stage:'images',result});
  assert.deepEqual((await invoke('begin_step',{key,stage:'images'})).result,result);
  await invoke('finish_step',{key:'material-v1-image-review-0',stage:'images',result:{costUsd:0}});
  const rows=(await db.query('select step_key,measured_microusd from production_spend_reservations where job_id=$1',[j.id])).rows;
  assert.equal(rows.length,1);assert.equal(rows[0].step_key,key);assert.equal(Number(rows[0].measured_microusd),35000);
 }finally{globalThis.fetch=network;await work(j,'fail',{code:'TEST_DONE'});}
});
