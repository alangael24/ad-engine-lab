import test from 'node:test';
import assert from 'node:assert/strict';
import {editorialTimeline,alignmentWords,repairOnOriginalTimeline} from '../assets/editorial-timeline.js';
import {processRender} from '../workers/studio-worker.mjs';
import {database,user,call} from './helpers/database.mjs';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const scenes=[{id:crypto.randomUUID(),text:'Hello',start:0,end:3,media:{bucket:'private',path:'a'}},{id:crypto.randomUUID(),text:'World',start:3,end:6,media:{bucket:'private',path:'b'}}];
const ranges=[{source:'S01',start:0,end:1},{source:'S01',start:2,end:3},{source:'S02',start:0,end:2}];
test('trimmed output preserves scene identity and maps final review back to original shots',()=>{
 const edited=editorialTimeline(scenes,ranges);assert.equal(edited[1].start,2);assert.equal(edited[1].end,4);assert.equal(edited[1].id,scenes[1].id);
 assert.equal(repairOnOriginalTimeline({issues:[{sceneId:scenes[1].id,at:2.3}]},scenes,edited).issues[0].at,3.3);
 for(const r of [[ranges[2]],ranges.slice(0,2),[ranges[1],ranges[0],ranges[2]],[{...ranges[0],end:9},ranges[2]]])assert.throws(()=>editorialTimeline(scenes,r),/EDITORIAL_INVALID/);
 assert.deepEqual(alignmentWords({characters:['H','i',' ','!'],character_start_times_seconds:[0,.1,.2,.3],character_end_times_seconds:[.1,.2,.3,.4]}).map(w=>w.text),['Hi','!']);
});
test('production render calls the flexible editor, saves its real timings, uploads, then completes',async()=>{
 const actions=[],job={id:crypto.randomUUID(),leaseToken:crypto.randomUUID(),manifest:{narration:{url:'https://test/audio'},scenes:scenes.map(s=>({...s,url:'https://test/video'}))},editorial:{project:{data:{scenes}},words:[]}};
 const api=async(action,data)=>{actions.push({action,data});return action==='upload'?{uploadUrl:'https://test/upload'}:{};};
 const result=await processRender(job,api,{fetchImpl:async()=>new Response(Buffer.from('fixture')),render:()=>assert.fail('must use flexible editor'),edit:async input=>{assert.equal(input.project.data.scenes.length,2);assert.match(input.strategy,/word-synchronized/);const path=join(input.root,'../edited.mp4');await writeFile(path,'verified fixture render');return {status:'succeeded',path,edl:{ranges},usage:{calls:2},message:'Reviewed'};}});
 assert.equal(result,true);assert.deepEqual(actions.map(x=>x.action),['heartbeat','begin_editorial','editorial','upload','complete']);assert.equal(actions.at(-1).data.success,true);assert.match(actions[2].data.sha256,/^[a-f0-9]{64}$/);
});
test('failed editorial review never uploads or completes successfully',async()=>{
 const actions=[];const ok=await processRender({id:crypto.randomUUID(),leaseToken:crypto.randomUUID(),manifest:{narration:{url:'https://test/audio'},scenes:[]},editorial:{project:{data:{scenes:[]}},words:[]}},async(a,d)=>{actions.push({a,d});return {};},{fetchImpl:async()=>new Response('fixture'),edit:async()=>({status:'needs_review',path:null})});
 assert.equal(ok,false);assert.equal(actions.some(x=>x.a==='upload'),false);assert.equal(actions.at(-1).d.success,false);
});
test('editorial database update is lease fenced, immutable and inaccessible to browser roles',async()=>{
 const db=await database();try{
 const u=await user(db),p=crypto.randomUUID(),j=crypto.randomUUID(),r=crypto.randomUUID(),lease=crypto.randomUUID();
 const brand=crypto.randomUUID();await db.query("insert into studio_brands(id,user_id,data) values($1,$2,'{}')",[brand,u.id]);
 await db.query("insert into studio_projects(id,user_id,brand_id,data,brand_snapshot) values($1,$2,$3,'{}','{}')",[p,u.id,brand]);
 await db.query("insert into studio_productions(id,user_id,project_id,initial_revision,expected_revision,snapshot,status) values($1,$2,$3,1,1,'{}','running')",[j,u.id,p]);
 await db.query("insert into studio_renders(id,user_id,project_id,project_revision,request_id,manifest,status,production_id,worker_id,lease_token,lease_expires_at) values($1,$2,$3,1,$1,$4,'running',$5,'editor-test',$6,now()+interval '2 minutes')",[r,u.id,p,JSON.stringify({scenes}),j,lease]);
 const updated=editorialTimeline(scenes,ranges),report={sha256:'a'.repeat(64)};
 await call(db,'studio_editorial_begin',['editor-test',r,lease]);await assert.rejects(call(db,'studio_editorial_begin',['editor-test',r,lease]),/EDITORIAL_UNCERTAIN/);
 await assert.rejects(call(db,'studio_editorial_manifest',['wrong',r,lease,updated,report]),/LEASE_LOST/);
 await assert.rejects(call(db,'studio_editorial_manifest',['editor-test',r,lease,updated.map(s=>({...s,text:'Changed script'})),report]),/EDITORIAL_INVALID/);
 const value=await call(db,'studio_editorial_manifest',['editor-test',r,lease,updated,report]);assert.deepEqual(value.scenes,updated);assert.deepEqual(value.originalScenes,scenes);
 assert.deepEqual(await call(db,'studio_editorial_manifest',['editor-test',r,lease,updated,report]),value);
 await assert.rejects(call(db,'studio_editorial_manifest',['editor-test',r,lease,updated,{sha256:'b'.repeat(64)}]),/IDEMPOTENCY_CONFLICT/);
 await db.exec('set role authenticated');await assert.rejects(call(db,'studio_editorial_manifest',['editor-test',r,lease,updated,report]),/permission denied/);
 }finally{await db.close();}
});

test('chat editing instructions persist and start one complete production instead of a bare render',async()=>{
 const {applyEdit,validateEdit,editFollowup}=await import('../assets/chat-model.js');
 const db=await database();try{
 const u=await user(db),brand=crypto.randomUUID(),photo=crypto.randomUUID(),p=crypto.randomUUID();
 await call(db,'studio_write',[u.id,'register_asset',photo,{kind:'image',name:'Product',bucket:'generation-references',storage_path:`${u.id}/product.png`,mime_type:'image/png',size_bytes:100}]);
 await call(db,'studio_write',[u.id,'save_brand',brand,{name:'Brand',product:'Shower',productAssetId:photo}]);
 const project=await call(db,'studio_write',[u.id,'create_project',p,{title:'Ad',brandId:brand,aspectRatio:'9:16',referenceUrl:'',referenceNotes:'',scriptDraft:'Hello World',scenes:scenes.map(s=>({...s,visual:'Product shot',imageAssetId:photo,selectedVersionId:null})),narrationAssetId:null}]);
 const edit=validateEdit({operation:'finish_edit',message:'Ajusté el ritmo.',value:'Trim silence and remove subtitles.'}),next=applyEdit(project,edit),followup=editFollowup(project,edit,next);
 assert.equal(followup,'produce');assert.match(next.creativeMemory.decisions[0],/Trim silence/);
 await db.query("insert into studio_production_workers(id) values('test')");
 const id=crypto.randomUUID();await call(db,'studio_chat_write',[u.id,'reserve',id,p,{expected:project.revision,message:'Trim silence',enabled:true}]);
 const data={edit,nextData:next,followup,productionEnabled:true};
 const first=await call(db,'studio_chat_write',[u.id,'complete',id,p,data]),second=await call(db,'studio_chat_write',[u.id,'complete',id,p,data]);
 assert.equal(first.result.productionId,id);assert.deepEqual(first,second);
 assert.equal((await db.query('select count(*)::int n from studio_productions where project_id=$1',[p])).rows[0].n,1);
 assert.equal((await db.query('select count(*)::int n from studio_renders where project_id=$1',[p])).rows[0].n,0);
 }finally{await db.close();}
});

test('queued production executes actual flexible rendering and submits the shortened final timeline', {skip:!process.env.VIDEO_USE_PYTHON},async()=>{
 const {mkdtemp,readFile,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{processCommand}=await import('../workers/video-use/sandbox.mjs'),{CHAT_MODEL}=await import('../assets/chat-model.js');
 const root=await mkdtemp(join(tmpdir(),'editorial-e2e-'));try{
 const source=join(root,'source.mp4');await processCommand('ffmpeg',['-v','error','-y','-f','lavfi','-i','testsrc2=size=320x180:rate=24:duration=2','-f','lavfi','-i','sine=frequency=440:duration=2','-c:v','libx264','-c:a','aac','-shortest',source]);
 const bytes=await readFile(source),id=crypto.randomUUID(),still=crypto.randomUUID(),scene={id,text:'Hello world.',start:0,end:2,imageAssetId:still,visual:'Wave',motion:'Slow wave',url:'https://fixture/clip'};
 const edl={ranges:[{source:'S01',start:.2,end:1.6}],subtitles:'master.srt',grade:'none',output:{width:320,height:180,fps:24}},calls=[['write_file',{path:'edl.json',content:JSON.stringify(edl)}],['render_edit',{}],['verify_output',{}],['submit_review',{passed:true,message:'Reviewed all final frames.'}]];let n=0,uploaded=null;
 const request=async(url,options={})=>{
  if(String(url).startsWith('https://opencode.ai/')){
   const body=JSON.parse(options.body),observation=body.tools[0]?.name==='observations';const [name,args]=observation?['observations',{message:'Fixture panels reviewed.'}]:calls[n++];
   return new Response('data: '+JSON.stringify({model:CHAT_MODEL,usage:{prompt_tokens:50,completion_tokens:10},choices:[{delta:{tool_calls:[{index:0,id:'call'+n,function:{name,arguments:JSON.stringify(args)}}]},finish_reason:'tool_calls'}]})+'\n\n');
  }
  if(options.method==='PUT'){uploaded=options.body;return new Response(null,{status:200});}return new Response(bytes);
 };
 const actions=[],api=async(action,data)=>{actions.push({action,data});return action==='upload'?{uploadUrl:'https://fixture/upload'}:{};};
 const ok=await processRender({id:crypto.randomUUID(),leaseToken:crypto.randomUUID(),manifest:{narration:{url:'https://fixture/voice'},scenes:[scene]},editorial:{project:{brand_snapshot:{product:'Fixture'},data:{scriptDraft:scene.text,scenes:[scene],creativeMemory:{approvedAssets:[still]}}},words:[{type:'word',text:'Hello',start:.3,end:.6},{type:'word',text:'world.',start:1,end:1.4}]}},api,{fetchImpl:request,env:{REFERENCE_FLASH_KEY:'fixture',VIDEO_USE_PYTHON:process.env.VIDEO_USE_PYTHON}});
 assert.equal(ok,true);assert.ok(uploaded.length>1000);assert.equal(n,4);assert.deepEqual(actions.find(x=>x.action==='editorial').data.ranges,edl.ranges);assert.equal(editorialTimeline([scene],edl.ranges)[0].end,1.4000000000000001);
 }finally{await rm(root,{recursive:true,force:true});}
});
