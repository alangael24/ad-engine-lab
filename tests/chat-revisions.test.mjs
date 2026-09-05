import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {database,user,call} from './helpers/database.mjs';
import {applyEdit,validateEdit,editFollowup} from '../assets/chat-model.js';
import {visualContext} from '../src/chat-visuals.js';
import {chatRequest} from '../src/studio-chat.js';
import {partialFields} from '../src/chat-stream.js';
import {processProduction} from '../workers/production-worker.mjs';
let db;before(async()=>{db=await database();});after(async()=>db.close());
async function fixture(){
 const u=await user(db),write=(a,id,data,rev=null)=>call(db,'studio_write',[u.id,a,id,JSON.stringify(data),rev]);
 const image=crypto.randomUUID();await write('register_asset',image,{kind:'image',name:'Product',bucket:'generation-references',storage_path:image,mime_type:'image/png',size_bytes:10});
 const brand=await write('save_brand',crypto.randomUUID(),{name:'Test',product:'Filter',productAssetId:image});
 let p=await write('create_project',crypto.randomUUID(),{title:'Test',brandId:brand.id,scenes:[],aspectRatio:'9:16',referenceUrl:'',referenceNotes:''});
 const voice=crypto.randomUUID();await write('register_asset',voice,{kind:'narration',name:'Voice',bucket:'studio-media',storage_path:voice,mime_type:'audio/wav',size_bytes:10,duration_seconds:9});
 p=await write('save_project',p.id,{...p.data,scriptDraft:'Uno. Dos. Tres.',narrationAssetId:voice,timingConfirmed:true,scenes:[0,1,2].map(i=>({id:crypto.randomUUID(),text:['Uno.','Dos.','Tres.'][i],visual:'Visual '+i,start:i*3,end:i*3+3,imageAssetId:image,selectedVersionId:null}))},p.revision);
 const versions=[];for(const s of p.data.scenes){const id=crypto.randomUUID();await write('register_asset',id,{kind:'clip',name:'Clip',bucket:'studio-media',storage_path:id,mime_type:'video/mp4',size_bytes:10,duration_seconds:3});const v=await write('version',p.id,{requestId:crypto.randomUUID(),sceneId:s.id,assetId:id,instruction:'Test',prompt:'Test'},p.revision);versions.push({...v,status:'succeeded'});p=await write('select_version',p.id,{versionId:v.id},p.revision);}
 return {u,p,versions,write};
}
async function complete(f,edit,enabled=false){const id=crypto.randomUUID(),next=applyEdit(f.p,edit,f.versions),data={edit,nextData:next,followup:editFollowup(f.p,edit,next),productionEnabled:enabled};await call(db,'studio_chat_write',[f.u.id,'reserve',id,f.p.id,JSON.stringify({expected:f.p.revision,message:'Change',enabled:true})]);const args=[f.u.id,'complete',id,f.p.id,JSON.stringify(data)];return {row:await call(db,'studio_chat_write',args),args};}
test('batch is atomic, ordered, revision-bound, replayable and undone as one revision',async()=>{
 const f=await fixture(),before=structuredClone(f.p),edit=validateEdit({operation:'batch',message:'Más directo.',changes:[{operation:'remove_scene',sceneId:f.p.data.scenes[1].id},{operation:'move_scene',sceneId:f.p.data.scenes[2].id,position:1}]});
 await call(db,'studio_render_worker',['cpu','claim']);
 const {row,args}=await complete(f,edit);assert.ok(row.result.render.id);assert.equal(row.applied_revision,before.revision+1);
 const saved=(await call(db,'studio_read',[f.u.id,f.p.id])).project;assert.deepEqual(saved.data.scenes.map(s=>s.narrationStart),[6,0]);assert.equal(saved.data.scenes[0].selectedVersionId,before.data.scenes[2].selectedVersionId);
 assert.deepEqual((await call(db,'studio_chat_write',args)).result,row.result);
 assert.equal((await db.query('select count(*)::int n from studio_renders where project_id=$1',[f.p.id])).rows[0].n,1);
 f.p=saved;await complete(f,{operation:'undo',message:'Restaurado.'});assert.deepEqual((await call(db,'studio_read',[f.u.id,f.p.id])).project.data,before.data);
 const bad=validateEdit({operation:'batch',message:'Bad',changes:[{operation:'remove_scene',sceneId:before.data.scenes[1].id},{operation:'edit_text',sceneId:crypto.randomUUID(),value:'Oops'}]});assert.throws(()=>applyEdit(before,bad),/STUDIO_NOT_FOUND/);assert.equal(before.data.scenes.length,3);
 assert.throws(()=>validateEdit({operation:'batch',message:'Bad',changes:[{operation:'produce'}]}),/CHAT_INVALID/);
});
test('media edits queue once at the new revision; offline generation preserves edits',async()=>{
 const f=await fixture(),edit=validateEdit({operation:'edit_scene',message:'Más movimiento.',sceneId:f.p.data.scenes[1].id,value:'Camera circles the product.'});
 const off=await complete(f,edit);assert.equal(off.row.result.productionError,'PRODUCTION_OFFLINE');assert.equal(off.row.status,'succeeded');
 f.p=(await call(db,'studio_read',[f.u.id,f.p.id])).project;assert.equal(f.p.data.scenes[1].imageAssetId,null);assert.ok(f.p.data.scenes[0].selectedVersionId);
 await db.query("insert into studio_production_workers(id) values('revision-worker') on conflict(id) do update set last_seen_at=now()");
 const on=await complete(f,edit,true);assert.ok(on.row.result.productionId);const job=(await db.query('select * from studio_productions where id=$1',[on.row.result.productionId])).rows[0];assert.equal(job.initial_revision,on.row.applied_revision);assert.equal(job.snapshot.data.scenes[1].visual,edit.value);await call(db,'studio_chat_write',on.args);assert.equal((await db.query('select count(*)::int n from studio_productions where project_id=$1',[f.p.id])).rows[0].n,1);
});
test('visual samples bind to current selected media and explicitly expose missing coverage',async()=>{
 const f=await fixture(),s=f.p.data.scenes[0],sample={sceneId:s.id,versionId:s.selectedVersionId,times:[.3,1.5,2.7],sheet:'data:image/jpeg;base64,/9j/AA=='};
 const evidence=visualContext(f.p,f.versions,[sample]);assert.equal(evidence.messages.length,1);assert.deepEqual(evidence.coverage.map(s=>s.sampled),[true,false,false]);
 const request=chatRequest(f.p,f.versions,[],'Más dinámico',false,[sample]);assert.equal(request.messages.at(-1).content[1].image_url.url,sample.sheet);
  for(const bad of [{...sample,versionId:f.versions[1].id},{...sample,times:[1,2,9]},{...sample,sheet:'https://evil.test/img'}, {...sample,sceneId:crypto.randomUUID()}])assert.throws(()=>visualContext(f.p,f.versions,[bad]),/CHAT_INVALID/);
  assert.throws(()=>visualContext(f.p,f.versions,[sample,sample]),/CHAT_INVALID/);
  const grouped={sheet:sample.sheet,scenes:f.p.data.scenes.map(s=>({sceneId:s.id,versionId:s.selectedVersionId,times:sample.times}))};
  assert.deepEqual(visualContext(f.p,f.versions,[grouped]).coverage.map(s=>s.sampled),[true,true,true]);
  assert.throws(()=>visualContext(f.p,f.versions,Array(5).fill(grouped)),/CHAT_INVALID/);
 assert.equal(partialFields('{"operation":"batch","changes":[{"message":"secret","value":"x"}],"message":"Visible words').message,'Visible words');
});
test('undo restores the complete edit even after its production advanced the project revision',async()=>{
 const f=await fixture(),original=structuredClone(f.p.data);
 await db.query("insert into studio_production_workers(id) values('undo-worker') on conflict(id) do update set last_seen_at=now()");
 const edit=validateEdit({operation:'edit_scene',message:'New angle',sceneId:f.p.data.scenes[1].id,value:'New angle'}),{row}=await complete(f,edit,true);
 f.p=(await call(db,'studio_read',[f.u.id,f.p.id])).project;
 f.p=await f.write('save_project',f.p.id,f.p.data,f.p.revision);
 await db.query("update studio_productions set status='succeeded',expected_revision=$2 where id=$1",[row.result.productionId,f.p.revision]);
 await complete(f,{operation:'undo',message:'Restaurado.'});
 assert.deepEqual((await call(db,'studio_read',[f.u.id,f.p.id])).project.data,original);
});
test('revision production regenerates only changed visual, preserves audio and other clips, then assembles',async()=>{
 const f=await fixture(),data=applyEdit(f.p,{operation:'edit_scene',sceneId:f.p.data.scenes[1].id,value:'New angle.'}),writes=[],images=[],clips=[],steps=new Map();
 let current={...f.p,data},versions=[...f.versions],render;
 const api=async(action,{data:d}={})=>{
  if(action==='begin_step')return steps.get(d.key)||{status:'started'};
  if(action==='finish_step'){steps.set(d.key,{status:'done',result:d.result});return {};}
  if(action==='write'){writes.push(d);let result;
   if(d.action==='save_project'){current={...current,data:d.data};result=current;}
   if(d.action==='version'){result={id:crypto.randomUUID(),status:'succeeded'};versions.push(result);}
   if(d.action==='render'){result=render={id:crypto.randomUUID(),status:'succeeded'};}
   return {result};
  }
  if(action==='inspect')return {project:current,versions,renders:render?[render]:[]};
  if(action==='fail')throw Error('unexpected failure');return {};
 };
 const result=await processProduction({id:crypto.randomUUID(),lease_token:crypto.randomUUID(),snapshot:{...f.p,data}},api,{plan(){assert.fail('must not replan existing scenes');},speech(){assert.fail('must keep narration');},image(args){images.push(args);return {assetId:crypto.randomUUID()};},clip(args){clips.push(args);return {assetId:crypto.randomUUID()};}},{pollMs:0});
 assert.equal(result.ok,true);assert.equal(images.length,1);assert.equal(images[0].index,1);assert.ok(images[0].anchor.assetId);assert.equal(clips.length,1);assert.equal(clips[0].scene.id,data.scenes[1].id);assert.equal(current.data.narrationAssetId,data.narrationAssetId);assert.equal(current.data.scenes[2].selectedVersionId,data.scenes[2].selectedVersionId);assert.equal(writes.filter(w=>w.action==='render').length,1);
});
