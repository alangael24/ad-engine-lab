import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {database,user,call} from './helpers/database.mjs';
import {mockSupabase} from './helpers/supabase-http.mjs';
import {postStudioChat} from '../src/studio-chat.js';
import {onRequestPost as renderWorker} from '../functions/api/studio-worker.js';
import {CHAT_MODEL} from '../assets/chat-model.js';
import {SIMPLE_EDIT_VERSION} from '../assets/simple-edit.js';
import {QUALITY_VERSION} from '../assets/quality-model.js';
import {alignmentWords} from '../assets/editorial-timeline.js';
import {projectFingerprint} from '../src/partial-edit.js';

let db,stub,original,currentEdit,calls=0;
const env={SUPABASE_URL:'http://supabase.test',SUPABASE_SERVICE_ROLE_KEY:'fixture',REFERENCE_ANALYSIS_ENABLED:'true',REFERENCE_FLASH_KEY:'fixture',STUDIO_WORKER_TOKEN:'worker-fixture-'.repeat(4)};
const context=(body,worker=false,token='alice')=>({env,request:new Request('https://app.test/api/'+(worker?'studio-worker':'studio-chat'),{method:'POST',headers:{authorization:'Bearer '+(worker?env.STUDIO_WORKER_TOKEN:token),'content-type':'application/json'},body:JSON.stringify(body)})});
const worker=async(body)=>{const r=await renderWorker(context({workerId:'partial-test',...body},true));const result=await r.json();assert.equal(r.status,200,JSON.stringify(result));return result;};
before(async()=>{
 db=await database();stub=mockSupabase(db);original=globalThis.fetch;
 globalThis.fetch=async(url,opts)=>{
  if(String(url).startsWith('https://opencode.ai/')){calls++;return new Response('data: '+JSON.stringify({model:CHAT_MODEL,choices:[{delta:{tool_calls:[{index:0,function:{name:'edit_project',arguments:JSON.stringify(currentEdit)}}]},finish_reason:'tool_calls'}]})+'\n\n');}
  return stub.fetch(url,opts);
 };
});
after(async()=>{globalThis.fetch=original;await db.close();});
async function fixture(){
 const u=await user(db);stub.users.set('alice',u);
 const write=(a,id,data,rev=null)=>call(db,'studio_write',[u.id,a,id,data,rev]);
 const image=crypto.randomUUID(),audio=crypto.randomUUID();
 for(const [id,kind,bucket,mime,duration] of [[image,'image','generation-references','image/png',null],[audio,'narration','studio-media','audio/wav',9]])await write('register_asset',id,{kind,name:kind,bucket,storage_path:`${u.id}/${id}`,mime_type:mime,size_bytes:100,...(duration?{duration_seconds:duration}:{})});
 const brand=await write('save_brand',crypto.randomUUID(),{name:'Brand',product:'Product',productAssetId:image});
 let p=await write('create_project',crypto.randomUUID(),{title:'Ad',brandId:brand.id,aspectRatio:'9:16',referenceUrl:'',referenceNotes:'',scenes:[]});
 p=await write('save_project',p.id,{...p.data,scriptDraft:'Uno. Dos. Tres.',narrationAssetId:audio,timingConfirmed:true,scenes:['Uno.','Dos.','Tres.'].map((text,i)=>({id:crypto.randomUUID(),text,visual:'Action '+i,start:i*3,end:i*3+3,imageAssetId:image,selectedVersionId:null}))},p.revision);
 for(const s of p.data.scenes){
  const id=crypto.randomUUID();await write('register_asset',id,{kind:'clip',name:'Clip',bucket:'studio-media',storage_path:`${u.id}/${id}`,mime_type:'video/mp4',size_bytes:100,duration_seconds:4});
  const v=await write('version',p.id,{requestId:crypto.randomUUID(),sceneId:s.id,assetId:id,instruction:'Import',prompt:'Test'},p.revision);
  p=await write('select_version',p.id,{versionId:v.id},p.revision);
 }
 const alignment={characters:[],character_start_times_seconds:[],character_end_times_seconds:[]};
 for(const s of p.data.scenes)for(const [i,c] of [...s.text+' '].entries()){alignment.characters.push(c);alignment.character_start_times_seconds.push(s.start+.2+i*.1);alignment.character_end_times_seconds.push(s.start+.3+i*.1);}
 const words=alignmentWords(alignment),edit={segments:p.data.scenes.map((s,i)=>({source:`S0${i+1}`,in:.1,out:3.1,frames:72,crop:1})),captions:true,captionGroups:[[0,0],[1,1],[2,2]],captionColor:'white',captionSize:46,hook:''};
 await db.query("insert into studio_productions(id,user_id,project_id,initial_revision,expected_revision,snapshot,status,steps) values($1,$2,$3,$4,$4,$5,'succeeded',$6)",[crypto.randomUUID(),u.id,p.id,p.revision,p,{narration:{status:'done',result:{assetId:audio,alignment}}}]);
 await worker({action:'claim'});
 const queued=await write('render',p.id,{requestId:crypto.randomUUID()},p.revision);
 const render=(await db.query('select * from studio_renders where id=$1',[queued.id])).rows[0];
 const manifest={...render.manifest,originalScenes:render.manifest.scenes,editorial:{version:SIMPLE_EDIT_VERSION,edit,words,projectFingerprint:await projectFingerprint(p.data)}};
 await db.query("update studio_renders set status='succeeded',quality_status='passed',manifest=$2 where id=$1",[render.id,manifest]);
 return {u,p,write,base:render,edit,words};
}
async function chat(f,message){
 const body={projectId:f.p.id,requestId:crypto.randomUUID(),expected:f.p.revision,message};
 const response=await postStudioChat(context(body));assert.equal(response.status,200,await response.clone().text());
 f.p=(await call(db,'studio_read',[f.u.id,f.p.id])).project;return {body,row:(await response.json()).edit};
}
test('authenticated local edit renders once with no generation, preserves resources, gates review, and undo restores its blueprint',async()=>{
 const f=await fixture(),before=structuredClone(f.p.data);
 const creditBefore=(await db.query('select * from credit_balances where user_id=$1',[f.u.id])).rows;
 currentEdit={operation:'set_caption_color',value:'yellow',message:'Subtítulos amarillos.'};
 const {body,row}=await chat(f,'Solo cambia los subtítulos a amarillo');
 assert.ok(row.result.render.id);assert.equal(f.p.data.editing.baseRenderId,f.base.id);assert.equal(f.p.data.editing.scoped,true);
 assert.deepEqual(f.p.data.scenes,before.scenes);assert.equal(f.p.data.narrationAssetId,before.narrationAssetId);
 const count=calls;assert.equal((await postStudioChat(context(body))).status,200);assert.equal(calls,count);
 assert.equal((await db.query('select count(*)::int n from studio_renders where project_id=$1',[f.p.id])).rows[0].n,2);
 assert.equal((await db.query('select count(*)::int n from studio_productions where project_id=$1',[f.p.id])).rows[0].n,1);
 assert.deepEqual((await db.query('select * from credit_balances where user_id=$1',[f.u.id])).rows,creditBefore);
 const {job}=await worker({action:'claim'}),identity={jobId:job.id,leaseToken:job.leaseToken};
 assert.equal(job.id,row.result.render.id);assert.equal(job.editorial.base.id,f.base.id);assert.deepEqual(job.editorial.base.edl,f.edit);assert.deepEqual(job.editorial.words,f.words);
 assert.equal(job.manifest.scenes[0].sourceDuration,4);
 await worker({action:'begin_editorial',...identity});
 await assert.rejects(call(db,'studio_render_worker',['partial-test','complete',job.id,job.leaseToken,true]),/EDITORIAL_REVIEW_REQUIRED/);
 const sha256='a'.repeat(64),review={version:QUALITY_VERSION,editorialVersion:SIMPLE_EDIT_VERSION,model:'gpt-5.6-sol',sha256,duration:9,coverage:f.p.data.scenes.map(s=>s.id),verdict:'pass',summary:'Readable captions.',issues:[]};
 await worker({action:'editorial',...identity,version:SIMPLE_EDIT_VERSION,segments:f.edit.segments,edit:{...f.edit,captionColor:'yellow'},words:f.words,sha256,review});
 stub.media.set(`studio-media/${f.u.id}/renders/${job.id}.mp4`,{size:1000,contentType:'video/mp4'});
 await worker({action:'complete',...identity,success:true});
 const saved=(await db.query('select * from studio_renders where id=$1',[job.id])).rows[0];assert.equal(saved.quality_status,'passed');assert.equal(saved.manifest.editorial.edit.captionColor,'yellow');
 currentEdit={operation:'undo',value:null,message:'Restaurado.'};await chat(f,'Deshaz el cambio');assert.deepEqual(f.p.data,before);
 const restored=await worker({action:'claim'});assert.equal(restored.job.editorial.base.id,f.base.id);assert.equal(restored.job.editorial.base.edl.captionColor,'white');
 await worker({action:'complete',jobId:restored.job.id,leaseToken:restored.job.leaseToken,success:false});
});
test('a foreign blueprint or incomplete legacy render cannot silently rebuild an approved edit',async()=>{
 const f=await fixture(),other=await fixture();stub.users.set('alice',f.u);
 await db.query("update studio_renders set manifest=manifest-'editorial' where project_id=$1",[f.p.id]);
 f.p=await f.write('save_project',f.p.id,{...f.p.data,editing:{baseRenderId:other.base.id,scoped:true}},f.p.revision);
 currentEdit={operation:'set_caption_color',value:'yellow',message:'Amarillo.'};
 const req=()=>({projectId:f.p.id,requestId:crypto.randomUUID(),expected:f.p.revision,message:'Subtítulos amarillos'});
 const response=await postStudioChat(context(req()));assert.notEqual(response.status,200);
 assert.equal((await db.query('select count(*)::int n from studio_renders where project_id=$1',[f.p.id])).rows[0].n,1);
 const {editing,...data}=f.p.data;f.p=await f.write('save_project',f.p.id,data,f.p.revision);
 const legacy=await postStudioChat(context(req()));assert.equal(legacy.status,409);assert.equal((await legacy.json()).code,'EDITORIAL_BASE_REQUIRED');
 assert.equal((await db.query('select count(*)::int n from studio_renders where project_id=$1',[f.p.id])).rows[0].n,1);
});
