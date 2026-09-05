import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {database,user,call} from './helpers/database.mjs';
import {validatePlan,alignScenes,alignmentFromWords,imageDirection} from '../assets/production-model.js';
import {processProduction} from '../workers/production-worker.mjs';
import {postProduction,getProduction} from '../src/studio-production.js';
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
test('director must preserve the approved script and every scene retains product and neighbor context',()=>{
 const raw={continuity:'Same chrome cylinder, same person, blue CGI.',scenes:[{text:'Hola mundo.',visual:'Man looks at a comb.',motion:'Slow push in.'},{text:'Conoce el producto.',visual:'Show the full filter.',motion:'Slow arc.'}]};
 const p=validatePlan(raw,'Hola mundo. Conoce el producto.');assert.equal(p.scenes.length,2);
 assert.throws(()=>validatePlan(raw,'Hola mundo. Compra ahora.'),/PRODUCTION_SCRIPT_CHANGED/);
 const prompt=imageDirection({brand_snapshot:{appearance:'Cylinder must remain visible'},data:{aspectRatio:'9:16',referenceNotes:'Macro'}},p,1);assert.match(prompt,/Cylinder must remain visible/);assert.match(prompt,/Man looks at a comb/);assert.match(prompt,/Same chrome cylinder/);
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
