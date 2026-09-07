import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {validateReview,repairScenes,repeatedSources} from '../assets/quality-model.js';
import {CHAT_MODEL} from '../assets/chat-model.js';
import {askReview,visualCandidates} from '../workers/production-quality.mjs';
import {processProduction} from '../workers/production-worker.mjs';
import {database,user,call} from './helpers/database.mjs';
import {mockSupabase} from './helpers/supabase-http.mjs';
import {getStudio} from '../src/studio.js';
import {onRequestPost as workerRoute} from '../functions/api/studio-production-worker.js';
const scene=(id,start=0)=>({id,text:`Phrase ${id}`,start,end:start+2,visual:'A distinct view of the product',motion:'Slow continuous motion',imageAssetId:crypto.randomUUID(),selectedVersionId:crypto.randomUUID()});
const issue=s=>({sceneId:s.id,relatedSceneId:null,at:s.start,kind:'repetition',evidence:'Same comb action restarts in this shot.',action:'replace_image',visual:'A distinct close-up of the clean comb resting on the counter.',motion:'Slow continuous push toward the comb.'});
const review=(scenes,verdict='pass',renderId='r')=>({version:1,renderId,sha256:'a'.repeat(64),sampleTimes:scenes.map(s=>({sceneId:s.id,times:[s.start+.1,s.start+1,s.end-.1]})),verdict,summary:'Revisión del montaje.',issues:verdict==='pass'?[]:[issue(scenes[0])]});
test('source audit finds same asset reuse through different version IDs, but accepts disjoint ranges',()=>{
 const a={...scene('a'),media:{bucket:'private',path:'same.mp4'}},b={...scene('b',2),media:a.media};
 assert.equal(repeatedSources([a,b]).length,1);
 assert.equal(repeatedSources([a,{...b,sourceStart:2,sourceEnd:4}]).length,0);
 assert.equal(repeatedSources([a,{...b,media:{bucket:'private',path:'different.mp4'}}]).length,0);
});
test('similar frames are review candidates, not automatic rejection of consistent products',()=>{
 assert.equal(visualCandidates([['0'.repeat(64),'0'.repeat(64)],['0'.repeat(64),'0'.repeat(64)]],[scene('a'),scene('b')]).length,1);
 assert.equal(visualCandidates([['0'.repeat(64),'0'.repeat(64)],['1'.repeat(64),'1'.repeat(64)]],[scene('a'),scene('b')]).length,0);
});
test('review output rejects invented scene IDs, out-of-range evidence and contradictory passes',()=>{
 const scenes=[scene('a')];assert.throws(()=>validateReview({...review(scenes),issues:[issue(scenes[0])]},scenes));
 for(const patch of [{sceneId:'foreign'},{at:20},{relatedSceneId:'foreign'},{kind:'caption',action:'replace_image'}])assert.throws(()=>validateReview({...review(scenes,'repair'),issues:[{...issue(scenes[0]),...patch}]},scenes));
});
test('repair keeps every word, voice, order and duration and changes only flagged media',()=>{
 const scenes=[scene('a'),scene('b',2)],p={data:{scriptDraft:'Exact approved script.',narrationAssetId:'voice',timingConfirmed:true,scenes}};
 const next=repairScenes(p,review(scenes,'repair'));
 assert.equal(next.scriptDraft,p.data.scriptDraft);assert.equal(next.narrationAssetId,'voice');assert.deepEqual(next.scenes[1],scenes[1]);assert.equal(next.scenes[0].text,scenes[0].text);assert.equal(next.scenes[0].end,2);assert.equal(next.scenes[0].imageAssetId,null);assert.equal(p.data.scenes[0].imageAssetId,scenes[0].imageAssetId);
 assert.throws(()=>repairScenes(p,{...review(scenes,'blocked'),issues:[{...issue(scenes[0]),action:'none',kind:'timing'}]}),/BLOCKED/);
});
function pipelineFixture(){
 const scenes=[scene(crypto.randomUUID()),scene(crypto.randomUUID(),2)],snapshot={data:{scriptDraft:scenes.map(s=>s.text).join(' '),narrationAssetId:'voice',timingConfirmed:true,scenes},brand_snapshot:{}},job={id:crypto.randomUUID(),lease_token:crypto.randomUUID(),snapshot};
 const state={project:structuredClone(snapshot),versions:scenes.map(s=>({id:s.selectedVersionId,status:'succeeded'})),renders:[]},steps={},counts={images:0,clips:0,reviews:0,complete:0},writes=[];
 const api=async(action,{data={}}={})=>{
  if(action==='inspect')return {value:structuredClone(state)};
  if(action==='complete'){counts.complete++;return {};}
  if(action==='begin_step'){if(steps[data.key]?.status==='started')throw Error('PRODUCTION_UNCERTAIN');return {value:steps[data.key]|| (steps[data.key]={status:'started'})};}
  if(action==='finish_step'){steps[data.key]={status:'done',result:structuredClone(data.result)};return {value:steps[data.key]};}
  if(action==='write'){
   if(steps[data.key])return {value:steps[data.key]};writes.push(structuredClone(data));let result;
   if(data.action==='save_project'){state.project.data=structuredClone(data.data);result=state.project;}
   if(data.action==='version'){counts.clips++;result={id:crypto.randomUUID(),status:'succeeded'};state.versions.push(result);}
   if(data.action==='select_version'){const version=state.versions.find(v=>v.id===data.data.versionId);state.project.data.scenes.find(s=>!s.selectedVersionId).selectedVersionId=version.id;result=state.project;}
   if(data.action==='render'){result={id:crypto.randomUUID(),status:'succeeded'};state.renders.push(result);}
   steps[data.key]={status:'done',result:structuredClone(result)};return {value:steps[data.key]};
  }return {};
 };
 const providers={reviewImages:async({images})=>({verdict:'pass',summary:'Reviewed',issues:[],assetIds:images.map(x=>x.assetId)}),image:async()=>{counts.images++;return {assetId:crypto.randomUUID()};},clip:async()=>({}),review:async({renderId})=>{counts.reviews++;return review(state.project.data.scenes,counts.reviews===1?'repair':'pass',renderId);}};
 return {job,api,providers,counts,state,steps,writes};
}
test('production repairs one scene, rerenders and only completes after the new render passes',async()=>{
 const f=pipelineFixture(),result=await processProduction(f.job,f.api,f.providers,{pollMs:0});assert.equal(result.ok,true);assert.equal(f.counts.complete,1);assert.equal(f.counts.reviews,2);assert.equal(f.counts.images,1);assert.equal(f.counts.clips,1);assert.equal(f.state.renders.length,2);assert.equal(result.renderId,f.state.renders[1].id);
 assert.deepEqual(Object.fromEntries(Object.entries(f.state.project.data.scenes[1]).filter(([k])=>k!=='planSceneId')),f.job.snapshot.data.scenes[1]);assert.equal(f.state.project.data.narrationAssetId,'voice');
 // A resumed job reuses completed review/image/clip/render steps without extra external calls.
 const again=await processProduction(f.job,f.api,f.providers,{pollMs:0});assert.equal(again.ok,true);assert.equal(f.counts.images,1);assert.equal(f.counts.clips,1);assert.equal(f.counts.reviews,2);
});
test('three unsuccessful reviews stop after two bounded repair rounds and never deliver',async()=>{
 const f=pipelineFixture();f.providers.review=async({renderId})=>{f.counts.reviews++;return review(f.state.project.data.scenes,'repair',renderId);};
 const result=await processProduction(f.job,f.api,f.providers,{pollMs:0});assert.equal(result.code,'PRODUCTION_QUALITY_BLOCKED');assert.equal(f.counts.complete,0);assert.equal(f.counts.images,2);assert.equal(f.counts.reviews,3);
});
test('missing reviewer and provider failures never mark a render delivered',async()=>{
 const f=pipelineFixture();delete f.providers.review;assert.equal((await processProduction(f.job,f.api,f.providers)).code,'PRODUCTION_QUALITY_OFFLINE');assert.equal(f.counts.complete,0);assert.equal(f.counts.images,0);
});
let db;before(async()=>{db=await database();});after(async()=>{await db.close();});
async function dbFixture(){
 const u=await user(db),p=crypto.randomUUID(),j=crypto.randomUUID(),r=crypto.randomUUID(),lease=crypto.randomUUID(),scenes=[scene(crypto.randomUUID())];
 const brand=crypto.randomUUID();await db.query("insert into studio_brands(id,user_id,data) values($1,$2,'{}')",[brand,u.id]);
 await db.query("insert into studio_projects(id,user_id,brand_id,data,brand_snapshot) values($1,$2,$3,$4,'{}')",[p,u.id,brand,JSON.stringify({scenes})]);
 await db.query("insert into studio_productions(id,user_id,project_id,initial_revision,expected_revision,snapshot,status,worker_id,lease_token,lease_expires_at) values($1,$2,$3,1,1,'{}','running','quality-test',$4,now()+interval '120 seconds')",[j,u.id,p,lease]);
 await db.query("insert into studio_renders(id,user_id,project_id,project_revision,request_id,manifest,status,result_path,production_id,quality_status) values($1,$2,$3,1,$1,$4,'succeeded',$5,$6,'pending')",[r,u.id,p,JSON.stringify({scenes}),u.id+'/render.mp4',j]);
 const work=(action,data={})=>call(db,'studio_production_work',['quality-test',action,j,lease,JSON.stringify(data)]);
 return {u,p,j,r,lease,scenes,work};
}
test('database refuses unreviewed completion; only an exact current render can pass',async()=>{
 const f=await dbFixture();await assert.rejects(f.work('complete',{key:'completed',renderId:f.r}),/QUALITY_REQUIRED/);
 await f.work('begin_step',{key:'quality-0',stage:'quality'});
 await assert.rejects(f.work('finish_step',{key:'quality-0',stage:'quality',result:review(f.scenes,'pass',crypto.randomUUID())}),/QUALITY_INVALID/);
 await assert.rejects(f.work('finish_step',{key:'quality-0',stage:'quality',result:{...review(f.scenes,'pass',f.r),issues:[issue(f.scenes[0])]} }),/QUALITY_INVALID/);
 await f.work('finish_step',{key:'quality-0',stage:'quality',result:review(f.scenes,'pass',f.r)});
 assert.equal((await f.work('complete',{key:'completed',renderId:f.r})).status,'succeeded');
});
test('draft download is blocked, list says reviewing, foreign review media is inaccessible',async()=>{
 const f=await dbFixture(),other=await user(db),stub=mockSupabase(db),network=globalThis.fetch;stub.users.set('owner',f.u);globalThis.fetch=stub.fetch;
 const env={SUPABASE_URL:'http://supabase.test',SUPABASE_SERVICE_ROLE_KEY:'test',PRODUCTION_WORKER_TOKEN:'private-test-production-token-32-chars'};
 try{
  const get=q=>getStudio({env,request:new Request('http://app.test/api/studio?'+q,{headers:{authorization:'Bearer owner'}})});
  assert.equal((await get('render='+f.r)).status,409);const list=await (await get('project='+f.p)).json();assert.equal(list.renders[0].status,'reviewing');
  const foreign=crypto.randomUUID();
  const bad=await workerRoute({env,request:new Request('http://app.test/api/studio-production-worker',{method:'POST',headers:{authorization:'Bearer '+env.PRODUCTION_WORKER_TOKEN,'content-type':'application/json'},body:JSON.stringify({workerId:'quality-test',action:'review_media',jobId:f.j,leaseToken:f.lease,data:{renderId:foreign}})})});assert.equal(bad.status,404);
 }finally{globalThis.fetch=network;}
});
test('browser roles cannot write quality approvals or execute either privileged worker function',async()=>{
 await db.exec('set role authenticated');try{await assert.rejects(db.query("update studio_renders set quality_status='passed'"),/permission denied/);await assert.rejects(call(db,'studio_production_work_before_quality',['x','claim']),/permission denied/);}finally{await db.exec('reset role');}
});
test('automatic render creation atomically records its production and pending quality gate',async()=>{
 const f=await dbFixture(),voice=crypto.randomUUID(),clip=crypto.randomUUID();
 for(const [id,kind,mime,ext] of [[voice,'narration','audio/mpeg','mp3'],[clip,'clip','video/mp4','mp4']])await call(db,'studio_write',[f.u.id,'register_asset',id,JSON.stringify({kind,name:'Fixture',bucket:'studio-media',storage_path:`${f.u.id}/${id}.${ext}`,mime_type:mime,size_bytes:100,duration_seconds:2}),null]);
 const data={title:'QA',aspectRatio:'9:16',scriptDraft:f.scenes[0].text,scenes:f.scenes.map(s=>({...s,imageAssetId:null,selectedVersionId:null})),narrationAssetId:voice,timingConfirmed:true};
 await f.work('write',{key:'prepare',action:'save_project',stage:'images',data});
 const version=await f.work('write',{key:'clip',stage:'clips',action:'version',data:{requestId:crypto.randomUUID(),sceneId:f.scenes[0].id,assetId:clip,prompt:'Fixture'}});
 await f.work('write',{key:'select',stage:'clips',action:'select_version',data:{versionId:version.result.id}});
 await db.query("insert into studio_workers(id) values('qa-render') on conflict(id) do update set last_seen_at=now()");
 const render=await f.work('write',{key:'render',stage:'assembly',action:'render',data:{requestId:crypto.randomUUID()}});
 const record=(await db.query('select production_id,quality_status from studio_renders where id=$1',[render.result.id])).rows[0];
 assert.equal(record.production_id,f.j);assert.equal(record.quality_status,'pending');
});
test('repair batch is capped at three scenes even if the reviewer identifies more',()=>{
 const scenes=Array.from({length:5},(_,i)=>scene('s'+i,i*2)),project={data:{scenes,narrationAssetId:'voice',scriptDraft:'Keep'}};
 const r={...review(scenes,'repair'),issues:scenes.map(issue)},next=repairScenes(project,r);
 assert.equal(next.scenes.filter(s=>s.selectedVersionId===null).length,3);assert.deepEqual(next.scenes[3],scenes[3]);assert.deepEqual(next.scenes[4],scenes[4]);
});
test('malformed reviewer response cannot reach completion or paid repairs',async()=>{
 const f=pipelineFixture();f.providers.review=async({renderId})=>({...review(f.state.project.data.scenes,'pass',renderId),issues:[issue(f.state.project.data.scenes[0])]});
 const result=await processProduction(f.job,f.api,f.providers,{pollMs:0});assert.equal(result.code,'PRODUCTION_QUALITY_INVALID');assert.equal(f.counts.complete,0);assert.equal(f.counts.images,0);assert.equal(f.counts.clips,0);
});

function reviewStream(raw){return new Response('data: '+JSON.stringify({model:CHAT_MODEL,usage:{prompt_tokens:100,completion_tokens:30,total_tokens:130},choices:[{delta:{tool_calls:[{index:0,function:{name:'review_ad',arguments:JSON.stringify(raw)}}]},finish_reason:'tool_calls'}]})+'\n\ndata: [DONE]\n\n');}
test('malformed review gets one bounded correction without waiving an actual defect',async()=>{
 const scenes=[scene('a')],bad={...review(scenes,'repair'),issues:[{...issue(scenes[0]),motion:'x'.repeat(401)}]},good=review(scenes,'repair');let calls=0;
 const result=await askReview('Review actual frames',[],{REFERENCE_FLASH_KEY:'fixture'},async(_url,init)=>{calls++;if(calls===2)assert.match(JSON.parse(init.body).input[0].content,/text_limit_400/);return reviewStream(calls===1?bad:good);},null,scenes);
 assert.equal(calls,2);assert.equal(result.raw.verdict,'repair');assert.equal(result.raw.issues.length,1);assert.equal(result.usage.total_tokens,260);
});
test('two invalid reviews remain blocked and provider failures are not automatically retried',async()=>{
 const scenes=[scene('a')];let calls=0;await assert.rejects(askReview('Review',[],{REFERENCE_FLASH_KEY:'fixture'},async()=>{calls++;return reviewStream({...review(scenes,'pass'),issues:[issue(scenes[0])]});},null,scenes),/QUALITY_INVALID/);assert.equal(calls,2);
 calls=0;await assert.rejects(askReview('Review',[],{REFERENCE_FLASH_KEY:'fixture'},async()=>{calls++;return new Response('',{status:503});},null,scenes),/QUALITY_OFFLINE/);assert.equal(calls,1);
});

test('defective still blocks H3 and delivery when the review cannot offer a safe correction',async()=>{
 const f=pipelineFixture();f.providers.reviewImages=async({plan,images})=>({verdict:'blocked',summary:'Wrong product',issues:[{...issue({...plan.scenes[0],start:0}),action:'none',visual:'',motion:''}],assetIds:images.map(x=>x.assetId)});
 const r=await processProduction(f.job,f.api,f.providers,{pollMs:0});
 assert.equal(r.code,'PRODUCTION_IMAGES_BLOCKED');assert.equal(f.counts.clips,0);assert.equal(f.counts.complete,0);assert.equal(f.state.renders.length,0);
 assert.match(f.state.project.data.creativeMemory.rejections[0],/Same comb/);
});
test('still correction reaches H3 only after new asset is reviewed; old clip is invalidated',async()=>{
 const f=pipelineFixture();let reviews=0;const before=f.job.snapshot.data.scenes[0].imageAssetId;
 f.providers.review=async({renderId})=>review(f.state.project.data.scenes,'pass',renderId);
 f.providers.reviewImages=async({plan,images,project})=>{
  reviews++;if(reviews>1){assert.notEqual(images[0].assetId,before);assert.ok(project.data.creativeMemory.rejections.length);}
  return {verdict:reviews===1?'repair':'pass',summary:'Still review',issues:reviews===1?[issue({...plan.scenes[0],start:0})]:[],assetIds:images.map(x=>x.assetId)};
 };
 const r=await processProduction(f.job,f.api,f.providers,{pollMs:0});
 assert.equal(r.ok,true);assert.equal(reviews,2);assert.equal(f.counts.clips,1);assert.equal(f.counts.images,1);
 assert.ok(f.state.project.data.creativeMemory.approvedAssets.includes(f.state.project.data.scenes[0].imageAssetId));
});
test('review of another asset and a no-change repair both fail closed before H3',async()=>{
 for(const kind of ['wrong-asset','no-change']){
  const f=pipelineFixture();f.providers.reviewImages=async({plan,images})=>({verdict:kind==='wrong-asset'?'pass':'repair',summary:'Review',issues:kind==='wrong-asset'?[]:[{...issue({...plan.scenes[0],start:0}),visual:plan.scenes[0].visual,motion:plan.scenes[0].motion}],assetIds:kind==='wrong-asset'?images.map(()=>crypto.randomUUID()):images.map(x=>x.assetId)});
  const r=await processProduction(f.job,f.api,f.providers,{pollMs:0});assert.equal(r.code,kind==='wrong-asset'?'PRODUCTION_IMAGE_REVIEW_INVALID':'PRODUCTION_REPAIR_NO_CHANGE');assert.equal(f.counts.clips,0);assert.equal(f.counts.images,0);
 }
});

test('caption/timing feedback returns to the editor without regenerating images or clips',async()=>{
 const f=pipelineFixture();let n=0;
 f.providers.review=async({renderId})=>++n===1?{...review(f.state.project.data.scenes,'blocked',renderId),issues:[{...issue(f.state.project.data.scenes[0]),kind:'caption',action:'none',visual:'',motion:'',evidence:'Caption stays on screen after the line ends.'}]}:review(f.state.project.data.scenes,'pass',renderId);
 const result=await processProduction(f.job,f.api,f.providers,{pollMs:0});
 assert.equal(result.ok,true);assert.equal(f.state.renders.length,2);assert.equal(f.counts.images,0);assert.equal(f.counts.clips,0);assert.match(f.state.project.data.creativeMemory.rejections.join(' '),/Caption stays/);assert.equal(f.counts.complete,1);
});
