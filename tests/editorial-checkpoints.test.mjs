import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {checkpointedCall,checkpointKey,remoteCheckpoints} from '../workers/editorial-checkpoints.mjs';
import {finishProductionAd} from '../workers/sol-luna-edit.mjs';
import {processRender} from '../workers/studio-worker.mjs';
import {database,user,call as rpc} from './helpers/database.mjs';
import {editorialRecoveryProject} from '../assets/editorial-recovery.js';
function store(){const entries=new Map();return {entries,get:async k=>structuredClone(entries.get(k)),putMedia:async path=>{const bytes=await readFile(path),key=checkpointKey(bytes.toString());entries.set(key,{bytes});return key;},getMedia:async(key,path)=>{await writeFile(path,entries.get(key).bytes);return path;},claim:async k=>{if(entries.has(k))return {claimed:false,...structuredClone(entries.get(k))};entries.set(k,{state:'started',value:{}});return {claimed:true};},save:async(k,state,value)=>entries.set(k,structuredClone({state,value}))};}
const usage=()=>({calls:[],total:0,unknown:false});
function meter(a,{fail=false,unknown=false}={}){const c={id:crypto.randomUUID(),name:a.name,cost:unknown?undefined:.1,status:fail?'failed':'completed'};a.usage.calls.push(c);a.usage.total+=c.cost||0;a.usage.unknown=unknown;}
const env={PRODUCTION_WORKFLOW_PROFILE:'astra-deepseek-v1'};
const scene={id:'one',source:'S01',number:1,start:0,end:2,frames:48,text:'Hello world.',visual:'Moving pattern',motion:'Continues'};
const words=[{text:'Hello',type:'word',start:.1,end:.7},{text:'world.',type:'word',start:.9,end:1.5}];
const plan={direction:'Keep movement',scenes:[{source:'S01',direction:'Keep movement'}],captions:true,captionColor:'yellow',hook:''};
const edl={segments:[{source:'S01',in:0,out:2,frames:48,crop:1}],captions:true,captionGroups:[[0,1]],captionColor:'yellow',captionSize:46,hook:''};
const pass={verdict:'pass',summary:'Revisado',issues:[],coverage:['one']};
test('new process resumes DeepSeek after known failure, retaining Astra direction and original costs',async()=>{
 const root=await mkdtemp(join(tmpdir(),'resume-edit-')),checkpoints=store(),seen=[];let failed=false;
 try{
 const img=join(root,'evidence.jpg');await writeFile(img,'same actual frames');
 const source=join(root,'source.mp4'),voice=join(root,'voice.wav');await writeFile(source,'source');await writeFile(voice,'voice');
 const options={project:{data:{scriptDraft:scene.text,scenes:[scene],aspectRatio:'9:16'}},shots:[],narration:'fixture',words,env,checkpoints,checkpointScope:'same-assets',
 prepare:async()=>({scenes:[{...scene,path:source}],words,narration:voice,duration:2}),boards:async()=>['data:image/jpeg;base64,c2FtZQ=='],render:async({root})=>{const path=join(root,'final.mp4');await writeFile(path,'render');return {path};},evidence:async()=>({sha256:'a'.repeat(64),duration:2,sheets:[img],sampleTimes:[],duplicates:[]}),auditCaptions:async({review})=>review,
 call:async a=>{seen.push(a.name);if(a.name==='edit_ad'&&!failed){failed=true;meter(a,{fail:true});throw Error('EDITORIAL_PROVIDER_UNAVAILABLE');}meter(a);return a.name==='direct_edit'?plan:a.name==='edit_ad'?edl:pass;}};
 await assert.rejects(finishProductionAd({...options,root:join(root,'process-1')}),/PROVIDER_UNAVAILABLE/);
 const r=await finishProductionAd({...options,root:join(root,'process-2')});
 assert.equal(r.status,'succeeded');assert.deepEqual(seen,['direct_edit','edit_ad','edit_ad','review_edit']);
 assert.equal(r.usage.total,.2);assert.equal(r.usage.reusedCalls.length,2);assert.equal(r.usage.reusedCalls.reduce((n,c)=>n+c.cost,0),.2);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('lost checkpoint-save response reuses completed response; unknown provider call never replays',async()=>{
 const cp=store();let n=0,lost=true;const realSave=cp.save;
 cp.save=async(...a)=>{await realSave(...a);if(a[1]==='done'&&lost){lost=false;throw Error('NETWORK_LOST');}};
 const call=checkpointedCall(async a=>{n++;meter(a);return {answer:'saved'};},cp);
 const args={role:'director',name:'plan',schema:{},system:'s',context:{},env};
 await assert.rejects(call({...args,usage:usage()}),/NETWORK_LOST/);
 assert.deepEqual(await call({...args,usage:usage()}),{answer:'saved'});assert.equal(n,1);
 const cp2=store(),ambiguous=checkpointedCall(async a=>{n++;meter(a,{unknown:true,fail:true});throw Error('DISCONNECTED');},cp2);
 await assert.rejects(ambiguous({...args,usage:usage()}),/DISCONNECTED/);
 await assert.rejects(ambiguous({...args,usage:usage()}),/UNCERTAIN/);assert.equal(n,2);
});
test('changing script, evidence, model or scope invalidates the old decision; signed local paths are not keys',async()=>{
 const cp=store();let n=0;const f=checkpointedCall(async a=>{n++;meter(a);return {n};},cp,{scope:'project-assets-v1'});
 const a={role:'director',name:'plan',schema:{},system:'rules',context:{script:'hello'},images:['first frames'],env};
 const run=x=>f({...a,...x,usage:usage()});await run();await run();assert.equal(n,1);
 await run({context:{script:'changed'}});await run({images:['different frames']});await run({env:{PRODUCTION_WORKFLOW_PROFILE:'sol-luna-v1'}});assert.equal(n,4);
 const g=checkpointedCall(async a=>{n++;meter(a);return {};},cp,{scope:'new-assets'});await g({...a,usage:usage()});assert.equal(n,5);
 assert.equal(checkpointKey({b:2,a:1}),checkpointKey({a:1,b:2}));
 const p={data:{creativeMemory:{decisions:['approved','approved','make yellow'],preferences:['large']}}};assert.deepEqual(editorialRecoveryProject(p).data.creativeMemory.decisions,['approved','make yellow']);assert.equal(p.data.creativeMemory.decisions.length,3);
});
test('delivery retry on another host/job retrieves exact approved MP4 without models, render or source downloads',async()=>{
 const root=await mkdtemp(join(tmpdir(),'resume-delivery-')),cp=store(),media=new Map(),actions=[];let edits=0,reject=true,downloadedSources=0;
 const identity=()=>({id:crypto.randomUUID(),leaseToken:crypto.randomUUID(),recovery:'fixed-input-fingerprint',manifest:{narration:{url:'https://test/audio'},scenes:[]},editorial:{project:{id:'project',user_id:'user',data:{scenes:[]}},words:[]}});
 const api=async(a,b)=>{actions.push(a);if(a==='checkpoint'){if(b.op==='get')return {checkpoint:await cp.get(b.key)};if(b.op.startsWith('claim'))return {checkpoint:await cp.claim(b.key)};return cp.save(b.key,b.value.state,b.value.value);}
 if(a==='checkpoint_media')return {uploadUrl:'https://test/checkpoint/'+b.key,downloadUrl:'https://test/checkpoint/'+b.key};
 if(a==='upload')return {uploadUrl:'https://test/delivery'};if(a==='editorial'&&reject)throw Error('EDITORIAL_INVALID');return {};};
 const fetchImpl=async(url,o={})=>{if(o.method==='PUT'){media.set(url,Buffer.from(o.body));return new Response(null,{status:200});}if(media.has(url))return new Response(media.get(url));downloadedSources++;return new Response('source');};
 const edit=async({root})=>{edits++;const path=join(root,'../approved.mp4');await writeFile(path,'exact approved bytes');const hash=createHash('sha256').update('exact approved bytes').digest('hex');return {status:'succeeded',path,edl:{ranges:[]},review:{verdict:'pass',sha256:hash},usage:{calls:[{id:'paid',cost:.4}],total:.4,unknown:false}};};
 const first=identity();try{
 assert.equal(await processRender(first,api,{env,fetchImpl,edit}),false);assert.equal(edits,1);const count=downloadedSources;
 reject=false;assert.equal(await processRender(identity(),api,{env,fetchImpl,edit:()=>assert.fail('must not edit or review again')}),true);
 assert.equal(downloadedSources,count);assert.equal(media.get('https://test/delivery').toString(),'exact approved bytes');
 const cached=[...cp.entries.values()].find(e=>e.state==='done');assert.equal(cached.value.result.usage.total,.4);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('corrupt remote media blocks delivery instead of passing an unrelated video',async()=>{
 const root=await mkdtemp(join(tmpdir(),'resume-hash-'));try{
 const cp=remoteCheckpoints(async()=>({downloadUrl:'https://test/file'}),{}, {fetchImpl:async()=>new Response('wrong bytes')});
 await assert.rejects(cp.getMedia('a'.repeat(64),join(root,'bad.mp4')),/CHECKPOINT_HASH/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('database checkpoints survive a new render lease, fence concurrent owners and isolate customers',async()=>{
 const db=await database();try{
 const u=await user(db),v=await user(db),p=crypto.randomUUID(),q=crypto.randomUUID(),brand=crypto.randomUUID();
 await db.query("insert into studio_brands(id,user_id,data) values($1,$2,'{}')",[brand,u.id]);
 for(const [id,owner] of [[p,u.id],[q,v.id]])await db.query("insert into studio_projects(id,user_id,brand_id,data,brand_snapshot) values($1,$2,$3,'{}','{}')",[id,owner,brand]);
 const render=async(owner,project)=>{const id=crypto.randomUUID(),lease=crypto.randomUUID();await db.query("insert into studio_renders(id,user_id,project_id,project_revision,request_id,manifest,status,worker_id,lease_token,lease_expires_at) values($1,$2,$3,1,$1,'{}','running',$5,$4,now()+interval '2 minutes')",[id,owner,project,lease,'worker-'+id]);return {id,lease};};
 const first=await render(u.id,p),next=await render(u.id,p),foreign=await render(v.id,q),key='a'.repeat(64);
 const act=(r,a,k=key,value={})=>rpc(db,'studio_editorial_checkpoint',['worker-'+r.id,r.id,r.lease,a,k,value]);
 assert.equal((await act(first,'claim')).claimed,true);assert.equal((await act(next,'claim')).claimed,false);
 await assert.rejects(act(next,'save',key,{state:'done',value:{result:1}}),/LEASE_LOST/);
 await act(first,'save',key,{state:'done',value:{result:1}});
 await db.query("update studio_renders set status='failed' where id=$1",[first.id]);
 assert.equal((await act(next,'get')).value.result,1);assert.equal(await act(foreign,'get'),null);
 await assert.rejects(act(first,'get'),/LEASE_LOST/);
 assert.equal((await act(next,'claim')).claimed,false);
 await assert.rejects(act(next,'save',key,{state:'done',value:{result:2}}),/LEASE_LOST/);
 await assert.rejects(act(next,'claim','../foreign'),/CHECKPOINT_INVALID/);
 await act(next,'begin',null);await act(next,'begin',null);
 await db.exec('set role service_role');assert.equal((await act(next,'get')).value.result,1);
 await db.exec('set role authenticated');await assert.rejects(act(next,'get'),/permission denied/);
 }finally{await db.close();}
});
test('worker HTTP checkpoint API persists a response, supports idempotent begin and refuses expired leases',async()=>{
 const {mockSupabase}=await import('./helpers/supabase-http.mjs'),{onRequestPost}=await import('../functions/api/studio-worker.js');
 const db=await database(),original=globalThis.fetch;try{
 const stub=mockSupabase(db);globalThis.fetch=stub.fetch;
 const u=await user(db),p=crypto.randomUUID(),brand=crypto.randomUUID(),id=crypto.randomUUID(),lease=crypto.randomUUID();
 await db.query("insert into studio_brands(id,user_id,data) values($1,$2,'{}')",[brand,u.id]);
 await db.query("insert into studio_projects(id,user_id,brand_id,data,brand_snapshot) values($1,$2,$3,'{}','{}')",[p,u.id,brand]);
 await db.query("insert into studio_renders(id,user_id,project_id,project_revision,request_id,manifest,status,worker_id,lease_token,lease_expires_at) values($1,$2,$3,1,$1,'{}','running','test-http',$4,now()+interval '2 minutes')",[id,u.id,p,lease]);
 const config={SUPABASE_URL:'http://supabase.test',SUPABASE_SERVICE_ROLE_KEY:'fixture',STUDIO_WORKER_TOKEN:'worker-fixture-'.repeat(4)};
 const post=async(body,token=config.STUDIO_WORKER_TOKEN)=>onRequestPost({env:config,request:new Request('https://app.test/api/studio-worker',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({workerId:'test-http',jobId:id,leaseToken:lease,...body})})});
 const cp={action:'checkpoint',key:'b'.repeat(64)};
 assert.equal((await post({...cp,op:'get'},'browser-token')).status,401);
 assert.equal((await post({...cp,op:'claim'})).status,200);
 assert.equal((await post({...cp,op:'save',value:{state:'done',value:{result:{approved:true}}}})).status,200);
 assert.equal((await (await post({...cp,op:'get'})).json()).checkpoint.value.result.approved,true);
 assert.equal((await post({action:'begin_editorial',recoverable:true})).status,200);
 assert.equal((await post({action:'begin_editorial',recoverable:true})).status,200);
 await db.query("update studio_renders set lease_expires_at=now()-interval '1 second' where id=$1",[id]);
 assert.notEqual((await post({...cp,op:'get'})).status,200);
 }finally{globalThis.fetch=original;await db.close();}
});
test('known failed requests have a bounded retry budget and cannot loop indefinitely',async()=>{
 const cp=store();let calls=0;const f=checkpointedCall(async a=>{calls++;meter(a,{fail:true});throw Error('EDITORIAL_PROVIDER_UNAVAILABLE');},cp);
 const args={role:'editor',name:'edit_ad',context:{},schema:{},system:'same',env};
 for(let i=0;i<4;i++)await assert.rejects(f({...args,usage:usage()}),/PROVIDER_UNAVAILABLE/);
 assert.equal(calls,2);
});
test('review transport failure reuses direction, EDL and exact rendered bytes on the next process',async()=>{
 const root=await mkdtemp(join(tmpdir(),'resume-review-')),checkpoints=store();let renders=0,reviews=0;const seen=[];
 try{
 const source=join(root,'source.mp4'),voice=join(root,'voice.wav'),img=join(root,'panel.jpg');await writeFile(source,'original');await writeFile(voice,'voice');await writeFile(img,'actual frames');
 const options={env,checkpoints,checkpointScope:'same-context',project:{data:{scenes:[scene],scriptDraft:scene.text,aspectRatio:'9:16'}},shots:[],words,narration:voice,
 prepare:async()=>({scenes:[{...scene,path:source}],words,narration:voice,duration:2}),boards:async()=>['data:original'],render:async({root})=>{renders++;const path=join(root,'final.mp4');await writeFile(path,'same approved candidate');return {path};},evidence:async path=>{assert.equal(await readFile(path,'utf8'),'same approved candidate');return {sha256:'a'.repeat(64),duration:2,sheets:[img],sampleTimes:[],duplicates:[]};},auditCaptions:async({review})=>review,
 call:async a=>{seen.push(a.name);meter(a);if(a.name==='direct_edit')return plan;if(a.name==='edit_ad')return edl;if(++reviews===1)throw Error('EDITORIAL_PROVIDER_UNAVAILABLE');return pass;}};
 await assert.rejects(finishProductionAd({...options,root:join(root,'first')}),/PROVIDER_UNAVAILABLE/);
 const r=await finishProductionAd({...options,root:join(root,'second')});assert.equal(r.status,'succeeded');assert.equal(renders,1);assert.deepEqual(seen,['direct_edit','edit_ad','review_edit','review_edit']);assert.equal(r.usage.total,.1);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('real FFmpeg candidate and review survive a fresh local workspace byte-for-byte',{skip:!process.env.TEST_MEDIA},async()=>{
 const {command}=await import('../workers/studio-renderer.mjs'),{renderSimpleAd}=await import('../workers/simple-ad-renderer.mjs');
 const root=await mkdtemp(join(tmpdir(),'recovery-real-media-')),checkpoints=store();let models=0,renders=0;
 try{
 const source=join(root,'source.mp4'),voice=join(root,'voice.wav');
 await command('ffmpeg',['-v','error','-y','-f','lavfi','-i','testsrc2=size=320x180:rate=24:duration=2','-an','-c:v','libx264',source]);
 await command('ffmpeg',['-v','error','-y','-f','lavfi','-i','sine=frequency=440:duration=2','-c:a','pcm_s16le',voice]);
 const options={env,checkpoints,checkpointScope:'real-input',project:{data:{scenes:[{...scene,sourceDuration:2}],scriptDraft:scene.text,aspectRatio:'16:9'}},shots:[{sceneId:'one',path:source}],words,narration:voice,
 render:async a=>{renders++;return renderSimpleAd(a);},call:async a=>{models++;meter(a);return a.name==='direct_edit'?plan:a.name==='edit_ad'?edl:pass;}};
 const a=await finishProductionAd({...options,root:join(root,'first')}),b=await finishProductionAd({...options,root:join(root,'second')});
 assert.equal(a.status,'succeeded');assert.equal(b.status,'succeeded');assert.deepEqual(await readFile(a.path),await readFile(b.path));assert.equal(a.review.sha256,b.review.sha256);assert.equal(models,3);assert.equal(renders,1);assert.equal(b.usage.total,0);assert.equal(b.usage.reusedCalls.length,3);
 }finally{await rm(root,{recursive:true,force:true});}
});
