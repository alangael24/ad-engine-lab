import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {database,user,call} from './helpers/database.mjs';
import {validateEDL,runVideoUse,boundedVisualContext} from '../workers/video-use/agent.mjs';
import {createSandbox,safePath,processCommand} from '../workers/video-use/sandbox.mjs';
import {CHAT_MODEL} from '../assets/chat-model.js';
const migration=new URL('../supabase/migrations/20260905202655_video_use_editor.sql',import.meta.url);
const media={S01:{duration:4,width:320,height:180,fps:24}};
const transcript={S01:{words:[{type:'word',text:'Hola',start:.5,end:.9},{type:'word',text:'mundo',start:2.2,end:2.8}]}};
const edl={ranges:[{source:'S01',start:.4,end:1},{source:'S01',start:2.1,end:3}],total_duration_s:1.5,grade:'none',subtitles:'master.srt',output:{width:320,height:180,fps:24}};
test('EDL rejects word cuts, missing padding, foreign/reference sources and invalid output; preserves arbitrary grade and captions',()=>{
 assert.equal(validateEDL(edl,media,transcript).total_duration_s,1.5);
 for(const r of [{...edl.ranges[0],start:.7},{...edl.ranges[0],start:.49},{...edl.ranges[0],source:'OTHER'}])assert.throws(()=>validateEDL({...edl,ranges:[r]},media,transcript));
 assert.throws(()=>validateEDL(edl,{S01:{...media.S01,reference:true}},transcript));
 assert.throws(()=>validateEDL({...edl,total_duration_s:99},media,transcript));
 assert.throws(()=>validateEDL({...edl,output:{width:99999,height:1,fps:24}},media,transcript));
});
test('sessions enforce ownership, explicit current-plan approval, replay, worker fencing and stale-job failure',async()=>{
 const db=await database();try{
  await db.exec(await readFile(migration,'utf8'));const a=await user(db),b=await user(db),id=crypto.randomUUID();
  await call(db,'studio_write',[a.id,'register_asset',id,{kind:'clip',name:'source.mp4',bucket:'studio-media',storage_path:a.id+'/source.mp4',mime_type:'video/mp4',size_bytes:1000,duration_seconds:4},null]);
  await db.query("insert into video_edit_workers(id) values('worker')");
  const sessionId=crypto.randomUUID(),requestId=crypto.randomUUID(),data={sessionId,message:'Edita este video',sources:[{id,reference:false}],action:'create'};
  await assert.rejects(()=>call(db,'video_edit_write',[b.id,'create',crypto.randomUUID(),{...data,sessionId:crypto.randomUUID()}]),/STUDIO_ASSET_NOT_FOUND/);
  const created=await call(db,'video_edit_write',[a.id,'create',requestId,data]);assert.equal(created.sessionId,sessionId);
  assert.deepEqual(await call(db,'video_edit_write',[a.id,'create',requestId,data]),created);
  await assert.rejects(()=>call(db,'video_edit_write',[a.id,'approve',crypto.randomUUID(),{sessionId,message:'sí',expected:1}]),/VIDEO_EDIT_BUSY/);
  const j=await call(db,'video_edit_work',['worker','claim']);assert.equal(j.kind,'plan');
  await assert.rejects(()=>call(db,'video_edit_work',['other','finish',j.id,j.lease_token,{status:'awaiting_approval',message:'Una propuesta.'}]),/LEASE_LOST/);
  await assert.rejects(()=>call(db,'video_edit_work',['worker','finish',j.id,j.lease_token,{status:'succeeded',message:'No aprobado.'}]),/VIDEO_EDIT_INVALID/);
  await call(db,'video_edit_work',['worker','finish',j.id,j.lease_token,{status:'awaiting_approval',message:'Conservar el saludo y añadir subtítulos.'}]);
  await assert.rejects(()=>call(db,'video_edit_write',[b.id,'approve',crypto.randomUUID(),{sessionId,message:'sí',expected:1}]),/STUDIO_NOT_FOUND/);
  await assert.rejects(()=>call(db,'video_edit_write',[a.id,'approve',crypto.randomUUID(),{sessionId,message:'sí',expected:5}]),/STUDIO_CONFLICT/);
  await call(db,'video_edit_write',[a.id,'approve',crypto.randomUUID(),{sessionId,message:'sí',expected:1}]);
  const edit=await call(db,'video_edit_work',['worker','claim']);assert.equal(edit.kind,'edit');
  await db.query("update video_edit_jobs set lease_expires_at=now()-interval '1 second' where id=$1",[edit.id]);
  assert.equal(await call(db,'video_edit_work',['worker','claim']),null);
  assert.equal((await db.query('select status from video_edit_sessions where id=$1',[sessionId])).rows[0].status,'failed');
  await db.exec('set role authenticated');await assert.rejects(()=>db.query('select * from video_edit_sessions'),/permission denied/);await assert.rejects(()=>call(db,'video_edit_work',['attacker','claim']),/permission denied/);
 }finally{await db.close();}
});
const python=process.env.VIDEO_USE_PYTHON;
test('isolated runtime blocks filesystem escape and network; actual video-use render has captions and reviewed output', {skip:!python},async()=>{
 const root=await mkdtemp(resolve(tmpdir(),'video-use-test-'));try{
  await mkdir(resolve(root,'sources'));await mkdir(resolve(root,'edit/transcripts'),{recursive:true});
  const sb=await createSandbox(root,{python});
  const outside=resolve(root,'../'+root.split('/').at(-1)+'-secret');await writeFile(outside,'test-secret');
  await assert.rejects(()=>sb.run([python,'-c',`open(${JSON.stringify(outside)}).read()`]),/Operation not permitted|PermissionError/);await rm(outside);
  await assert.rejects(()=>sb.run([python,'-c','import socket; socket.create_connection(("1.1.1.1",443),1)']),/Operation not permitted|PermissionError/);
  await assert.rejects(()=>safePath(resolve(root,'edit'),'../../outside'));
  await processCommand('ffmpeg',['-v','error','-y','-f','lavfi','-i','testsrc2=size=320x180:rate=24:duration=4','-f','lavfi','-i','sine=frequency=440:duration=4','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',resolve(root,'sources/S01.mp4')]);
  await writeFile(resolve(root,'edit/transcripts/S01.json'),JSON.stringify(transcript.S01));await writeFile(resolve(root,'edit/takes_packed.md'),'[0.50-0.90] Hola\n[2.20-2.80] mundo');
  let n=0;const calls=[['submit_review',{passed:true,message:'Premature approval'}],['write_file',{path:'edl.json',content:JSON.stringify(edl)}],['render_edit',{}],['verify_output',{}],['submit_review',{passed:true,message:'La edición conserva las palabras y sus subtítulos.'}]];
  const fake=async(url,opts)=>{const request=JSON.parse(opts.body);assert.equal(request.model,CHAT_MODEL);if(request.tools[0]?.function.name!=='observations')assert.match(request.messages[0].content,/Video Use/);if(n===1)assert.match(JSON.stringify(request.messages.at(-1)),/Verify the current render/);const [name,args]=request.tools[0]?.function.name==='observations'?['observations',{message:'All fixture windows preserve the requested content.'}]:calls[n++];return new Response('data: '+JSON.stringify({model:CHAT_MODEL,usage:{prompt_tokens:100,completion_tokens:20},choices:[{delta:{tool_calls:[{index:0,id:'call'+n,function:{name,arguments:JSON.stringify(args)}}]},finish_reason:'tool_calls'}]})+'\n\ndata: [DONE]\n\n');};
  const result=await runVideoUse({root,mode:'edit',request:'Test fixture',strategy:'Preserve two spoken words with captions; synthetic integration fixture.',sources:media,transcripts:transcript,env:{REFERENCE_FLASH_KEY:'test'},fetchImpl:fake,sandboxOptions:{python}});
  assert.equal(result.status,'succeeded');assert.equal(result.usage.calls,7);assert.equal(result.usage.input,700);
  const srt=await readFile(resolve(root,'edit/master.srt'),'utf8');assert.match(srt,/00:00:00,100/);assert.match(srt,/00:00:00,700/);assert.match(srt,/Hola/);
  const info=JSON.parse(await processCommand('ffprobe',['-v','error','-show_format','-show_streams','-of','json',result.path]));assert.ok(Math.abs(Number(info.format.duration)-1.5)<.15);
  // Regression: silent source produced infinite LUFS and previously failed export.
  await processCommand('ffmpeg',['-v','error','-y','-i',resolve(root,'sources/S01.mp4'),'-an','-c:v','copy',resolve(root,'sources/silent.mp4')]);
  await writeFile(resolve(root,'edit/silent.json'),JSON.stringify({ranges:[{source:'S01',start:0,end:1}],sources:{S01:resolve(root,'sources/silent.mp4')},total_duration_s:1,grade:'none'}));
  await sb.run([sb.python,sb.vendor+'/helpers/render.py',sb.edit+'/silent.json','-o',sb.edit+'/silent.mp4','--no-subtitles']);
  const silent=JSON.parse(await processCommand('ffprobe',['-v','error','-show_format','-of','json',resolve(root,'edit/silent.mp4')]));assert.ok(Math.abs(Number(silent.format.duration)-1)<.15);

 }finally{await rm(root,{recursive:true,force:true});}
});

test('HTTP routes reject anonymous users and expose only the owner session; no render before approval',async()=>{
 const {mockSupabase}=await import('./helpers/supabase-http.mjs');const {getVideoEdit,postVideoEdit}=await import('../src/video-use.js');const {onRequestPost:worker}=await import('../functions/api/video-edit-worker.js');
 const db=await database(),network=globalThis.fetch;
 try{
  await db.exec(await readFile(migration,'utf8'));const stub=mockSupabase(db),a=await user(db),b=await user(db);stub.users.set('owner',a);stub.users.set('other',b);globalThis.fetch=stub.fetch;
  const env={SUPABASE_URL:'http://supabase.test',SUPABASE_SERVICE_ROLE_KEY:'test',VIDEO_USE_ENABLED:'true',VIDEO_USE_WORKER_TOKEN:'test-worker-key-at-least-thirty-two-characters'};
  const ctx=(path,method='GET',body,token='owner')=>({env,request:new Request('http://localhost'+path,{method,headers:{authorization:'Bearer '+token,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})})});
  assert.equal((await getVideoEdit(ctx('/api/video-edit','GET',null,'invalid'))).status,401);
  assert.equal((await worker(ctx('/api/video-edit-worker','POST',{action:'claim',workerId:'worker'},'invalid'))).status,401);
  await worker(ctx('/api/video-edit-worker','POST',{action:'claim',workerId:'worker'},env.VIDEO_USE_WORKER_TOKEN));
  const asset=crypto.randomUUID();await call(db,'studio_write',[a.id,'register_asset',asset,{kind:'clip',name:'source',bucket:'studio-media',storage_path:a.id+'/source.mp4',mime_type:'video/mp4',size_bytes:1000,duration_seconds:4},null]);
  const body={requestId:crypto.randomUUID(),sessionId:crypto.randomUUID(),action:'create',message:'Edita este video',sources:[{id:asset,reference:false}]};
  assert.equal((await postVideoEdit(ctx('/api/video-edit','POST',body))).status,202);
  const other=await getVideoEdit(ctx('/api/video-edit?session='+body.sessionId,'GET',null,'other'));assert.equal(other.status,404);
  const own=await(await getVideoEdit(ctx('/api/video-edit?session='+body.sessionId))).json();assert.equal(own.session.status,'planning');assert.equal(own.session.url,null);assert.equal(own.session.sources,undefined);
  const claimed=await(await worker(ctx('/api/video-edit-worker','POST',{action:'claim',workerId:'worker'},env.VIDEO_USE_WORKER_TOKEN))).json();assert.equal(claimed.job.kind,'plan');assert.match(claimed.job.sources[0].url,/test-private/);
 }finally{globalThis.fetch=network;await db.close();}
});

test('Flash requests retain at most four images without losing textual observations',()=>{
 const input=Array.from({length:8},(_,i)=>({role:'user',content:[{type:'text',text:'source '+i},{type:'image_url',image_url:{url:'image'+i}}]}));
 const output=boundedVisualContext(input);assert.equal(output.flatMap(m=>m.content).filter(x=>x.type==='image_url').length,4);assert.equal(input[0].content[1].type,'image_url');assert.equal(output[0].content[0].text,'source 0');
});
