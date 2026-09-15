import test from 'node:test';
import assert from 'node:assert/strict';
import {runtimeWorkerEnvironment} from '../workers/runtime-identity.mjs';
import {database,user,call} from './helpers/database.mjs';
test('overlapping runtime boots cannot share an owner ID and unrelated settings remain intact',()=>{
 const env={PRODUCTION_WORKER_ID:'production-1',STUDIO_WORKER_ID:'render-1',OPENAI_API_KEY:'private-fixture'};
 const a=runtimeWorkerEnvironment(env),b=runtimeWorkerEnvironment(env);
 for(const key of ['PRODUCTION_WORKER_ID','STUDIO_WORKER_ID']){
  assert.notEqual(a[key],b[key]);assert.match(a[key],/^[\w-]{1,80}$/);
 }
 assert.equal(a.OPENAI_API_KEY,env.OPENAI_API_KEY);assert.equal(env.STUDIO_WORKER_ID,'render-1');
 assert.equal(runtimeWorkerEnvironment({...env,STUDIO_WORKER_ID:'a'.repeat(80)}).STUDIO_WORKER_ID.length,80);
 assert.throws(()=>runtimeWorkerEnvironment({...env,STUDIO_WORKER_ID:''}),/IDENTITY/);
});
test('a new deployment cannot reclaim or fail the old deployment’s in-progress render',async()=>{
 const db=await database();try{
  const u=await user(db),brand=crypto.randomUUID(),project=crypto.randomUUID(),render=crypto.randomUUID();
  await db.query("insert into studio_brands(id,user_id,data) values($1,$2,'{}')",[brand,u.id]);
  await db.query("insert into studio_projects(id,user_id,brand_id,data,brand_snapshot) values($1,$2,$3,'{}','{}')",[project,u.id,brand]);
  await db.query("insert into studio_renders(id,user_id,project_id,project_revision,request_id,manifest,status) values($1,$2,$3,1,$1,'{}','queued')",[render,u.id,project]);
  const env={PRODUCTION_WORKER_ID:'production',STUDIO_WORKER_ID:'renderer'},a=runtimeWorkerEnvironment(env),b=runtimeWorkerEnvironment(env);
  const first=await call(db,'studio_render_worker',[a.STUDIO_WORKER_ID,'claim']);
  assert.equal(first.id,render);
  assert.equal(await call(db,'studio_render_worker',[b.STUDIO_WORKER_ID,'claim']),null);
  await assert.rejects(call(db,'studio_render_worker',[b.STUDIO_WORKER_ID,'complete',render,first.lease_token,false]),/LEASE_LOST/);
  assert.equal((await db.query('select status from studio_renders where id=$1',[render])).rows[0].status,'running');
 }finally{await db.close();}
});
