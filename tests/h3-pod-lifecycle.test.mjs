import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {database,user,ready,reserve,call} from './helpers/database.mjs';
import {tickManagedPod} from '../workers/h3-pod-controller.mjs';
let db;
before(async()=>{db=await database();await db.exec(await readFile(new URL('../supabase/migrations/20260915073916_managed_h3_pod_lifecycle.sql',import.meta.url),'utf8'));});
after(async()=>db.close());
test('persistent admission fences concurrent controllers, preserves creation intent and budgets',async()=>{
 const u=await user(db);await ready(db);await reserve(db,u);
 let s=await call(db,'h3_pod_work',['one','acquire']);
 assert.equal((await call(db,'h3_pod_work',['two','acquire'])).busy,true);
 await assert.rejects(call(db,'h3_pod_work',['one','begin',s.token]),/POD_NOT_ADMITTED/);
 await db.exec('update h3_pod_control set enabled=true,total_limit_microusd=500000');
 s=await call(db,'h3_pod_work',['one','begin',s.token]);const run=s.run;
 await assert.rejects(call(db,'h3_pod_work',['one','begin',s.token]),/POD_NOT_ADMITTED/);
 await call(db,'h3_pod_work',['one','release',s.token]);
 let recovered=await call(db,'h3_pod_work',['two','acquire']);assert.equal(recovered.run.id,run.id);
 await assert.rejects(call(db,'h3_pod_work',['one','attach',s.token,{podId:'abcdefgh'}]),/LEASE_LOST/);
 await call(db,'h3_pod_work',['two','attach',recovered.token,{podId:'abcdefgh'}]);
 await assert.rejects(call(db,'h3_pod_work',['two','attach',recovered.token,{podId:'ijklmnop'}]),/POD_CONFLICT/);
 await call(db,'h3_pod_ready',[run.id,run.worker_prefix]);
 await assert.rejects(call(db,'h3_pod_work',['two','drain',recovered.token,{reason:'idle'}]),/POD_BUSY/);
 await call(db,'h3_pod_work',['two','drain',recovered.token,{reason:'budget_deadline'}]);
 assert.equal((await db.query('select enabled from h3_pod_control')).rows[0].enabled,false);
 await assert.rejects(call(db,'h3_pod_ready',[run.id,run.worker_prefix]),/POD_NOT_ADMITTED/);
 await call(db,'h3_pod_work',['two','close',recovered.token]);
 await db.exec('set role authenticated');
 try{await assert.rejects(call(db,'h3_pod_work',['bad','acquire']),/permission denied/);}finally{await db.exec('reset role');}
});
const env={H3_BACKEND:'pod',CREATIVE_RUSH_URL:'https://app.test',RUNPOD_CONTROL_API_KEY:'control',PRODUCTION_WORKER_TOKEN:'production',GENERATION_WORKER_TOKEN:'generation',H3_POD_IMAGE:'ghcr.io/alangael24/creativerush-h3-pod@sha256:'+'a'.repeat(64)};
const run={id:'run',name:'cr-h3-run',phase:'creating',created_at:new Date(1000).toISOString(),deadline_at:new Date(2401000).toISOString(),reserved_microusd:500000,worker_prefix:'pod_run'};
function mock({state={token:'lease',enabled:true,pending:true,running:false,run:null},pods=[],createThrows=false,cost=.69,clock=1000}={}){
 const calls=[];let deleted=false,exited=false;
 const fetchImpl=async(url,opts={})=>{
  const body=opts.body?JSON.parse(opts.body):null;calls.push({url,body,method:opts.method});
  if(url.endsWith('/api/gpu-pod')){
   if(body.action==='begin')state.run={...run};
   if(body.action==='attach')state.run={...state.run,pod_id:body.data.podId,phase:'preparing'};
   if(body.action==='drain')state.run={...state.run,phase:'draining'};
   return Response.json(state);
  }
  if(url.includes('/catalog/gpus/'))return Response.json({availability:'LOW',price:{community:cost}});
  if(url.endsWith('/pods')&&opts.method==='POST'){if(createThrows)throw Error('lost ack');return Response.json({id:'abcdefgh'});}
  if(url.endsWith('/pods'))return Response.json({pods});
  if(url.endsWith('/action')){if(body.action==='stop')exited=true;else deleted=true;return new Response(null,{status:204});}
  if(deleted)return new Response(null,{status:404});
  return Response.json({id:'abcdefgh',name:'cr-h3-run',gpu:{id:'NVIDIA GeForce RTX 5090',count:1},cloud:'COMMUNITY',cost:.69,status:exited?'EXITED':'RUNNING',runtime:exited?null:{}});
 };
 return {calls,fetchImpl,now:()=>clock};
}
test('a lost create acknowledgement is never followed by a duplicate POST',async()=>{
 const m=mock({createThrows:true});assert.equal((await tickManagedPod(env,m)).status,'create_ack_unknown');
 assert.equal(m.calls.filter(c=>c.url.endsWith('/pods')&&c.method==='POST').length,1);
 const next=mock({state:{token:'new',enabled:true,pending:true,run:{...run}},pods:[{id:'abcdefgh',name:run.name}]});
 await tickManagedPod(env,next);assert.equal(next.calls.filter(c=>c.url.endsWith('/pods')&&c.method==='POST').length,0);
});
test('unapproved price cannot create a pod',async()=>{const m=mock({cost:.99});assert.equal((await tickManagedPod(env,m)).status,'no_approved_capacity');assert.ok(!m.calls.some(c=>c.body?.action==='begin'));});
test('idle stop verifies shutdown before termination and closure',async()=>{
 const m=mock({state:{token:'t',enabled:true,pending:false,running:false,run:{...run,pod_id:'abcdefgh',phase:'running',ready_at:new Date(2000).toISOString(),idle_since:new Date(3000).toISOString()}},clock:150000});
 assert.equal((await tickManagedPod(env,m)).status,'deleted');
 assert.deepEqual(m.calls.filter(c=>c.url.endsWith('/action')).map(c=>c.body.action),['stop','terminate']);
 assert.ok(m.calls.some(c=>c.body?.action==='close'));
});
test('startup timeout drains and disables further rental, even with pending work',async()=>{
 const m=mock({state:{token:'t',enabled:true,pending:true,run:{...run,pod_id:'abcdefgh',phase:'preparing'}},clock:700000});
 assert.equal((await tickManagedPod(env,m)).reason,'startup_failed');
});
test('budget cutoff stops a busy pod and unknown disappearance cannot permit another rental',async()=>{
 const m=mock({state:{token:'t',enabled:true,pending:true,running:true,run:{...run,pod_id:'abcdefgh',phase:'running',ready_at:new Date(2000).toISOString()}},clock:2350000});
 assert.equal((await tickManagedPod(env,m)).reason,'budget_deadline');
 const b=mock({state:{token:'t',enabled:true,pending:true,run:{...run,pod_id:'abcdefgh',phase:'running',ready_at:'yes'}}});
 const base=b.fetchImpl;b.fetchImpl=(url,opts)=>url.endsWith('/pods/abcdefgh')?Promise.resolve(new Response(null,{status:404})):base(url,opts);
 await tickManagedPod(env,b);assert.ok(b.calls.some(c=>c.body?.action==='block'));assert.ok(!b.calls.some(c=>c.body?.action==='close'));
});
test('disabled controller still cleans up an existing attributed GPU',async()=>{
 const m=mock({state:{token:'t',enabled:false,pending:false,running:false,run:{...run,pod_id:'abcdefgh',phase:'running',ready_at:'yes'}}});
 assert.equal((await tickManagedPod(env,m)).status,'deleted');
});
