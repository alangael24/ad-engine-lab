import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {database,user,call} from './helpers/database.mjs';
let db;before(async()=>{db=await database();});after(async()=>{await db.close();});
async function fixture(){
 const u=await user(db),asset=crypto.randomUUID(),worker='recovery-test';
 const write=(a,id,d)=>call(db,'studio_write',[u.id,a,id,d]);
 await write('register_asset',asset,{kind:'image',name:'Product',bucket:'generation-references',storage_path:u.id+'/'+asset+'.png',mime_type:'image/png',size_bytes:100});
 const b=await write('save_brand',crypto.randomUUID(),{name:'Test',product:'Filter',productAssetId:asset});
 const p=await write('create_project',crypto.randomUUID(),{title:'Test',brandId:b.id,aspectRatio:'9:16',scriptDraft:'Hola mundo.',scenes:[]});
 await db.query('insert into studio_production_workers(id) values($1) on conflict(id) do update set last_seen_at=now()',[worker]);
 const start=()=>call(db,'studio_production_start',[u.id,crypto.randomUUID(),p.id,p.revision,true]);
 await start();const old=await call(db,'studio_production_work',[worker,'claim']);
 const key='material-call-'+'c'.repeat(64),result={costUsd:.04,assessments:[]};
 await call(db,'studio_production_work',[worker,'begin_step',old.id,old.lease_token,{key,stage:'images'}]);
 await call(db,'studio_production_work',[worker,'finish_step',old.id,old.lease_token,{key,result}]);
 await call(db,'studio_production_work',[worker,'fail',old.id,old.lease_token,{code:'TEST_FAILURE'}]);
 await start();const j=await call(db,'studio_production_work',[worker,'claim']);
 return {old,j,key,result,recover:(k=key)=>call(db,'recover_production_step',[worker,j.id,j.lease_token,k,'images']),
  close:()=>call(db,'studio_production_work',[worker,'fail',j.id,j.lease_token,{code:'TEST_DONE'}])};
}
test('atomic recovery survives a lost reply without another cost or credit entry',async()=>{
 const x=await fixture();try{
  const balances=await db.query('select * from credit_balances where user_id=$1',[x.j.user_id]);
  const first=await x.recover();assert.deepEqual(first.result,x.result);assert.equal(first.recoveredFrom,x.old.id);
  assert.equal(await x.recover(),null); // The retry reads the already committed step.
  const saved=(await db.query('select steps from studio_productions where id=$1',[x.j.id])).rows[0].steps[x.key];
  assert.deepEqual(saved,first);assert.deepEqual(await db.query('select * from credit_balances where user_id=$1',[x.j.user_id]),balances);
  assert.equal((await db.query('select count(*)::int n from production_spend_reservations where job_id=$1',[x.j.id])).rows[0].n,0);
 }finally{await x.close();}
});
test('recovery rejects changed inputs, another owner, a stale plan and uncertain work',async()=>{
 for(const mutation of [
  "snapshot=jsonb_set(snapshot,'{data,scriptDraft}','\"Changed\"')",
  "snapshot=jsonb_set(snapshot,'{brand_snapshot,name}','\"Changed\"')",
  "snapshot=jsonb_set(snapshot,'{user_id}','\"different-owner\"')",
  'expected_revision=expected_revision+1',
  "steps=jsonb_set(steps,array[$2,'status'],'\"started\"')"
 ]){
  const x=await fixture();try{
   await db.query('update studio_productions set '+mutation+' where id=$1',mutation.includes('$2')?[x.old.id,x.key]:[x.old.id]);
   assert.equal(await x.recover(),null);
  }finally{await x.close();}
 }
 const x=await fixture();try{
  await db.query("update studio_productions set steps=steps||'{\"plan\":{\"status\":\"done\",\"result\":{\"changed\":true}}}' where id=$1",[x.j.id]);
  assert.equal(await x.recover(),null);
  await assert.rejects(call(db,'recover_production_step',['other',x.j.id,crypto.randomUUID(),x.key,'images']),/LEASE_LOST/);
 }finally{await x.close();}
});
test('recovery never imports rendering, selection or clip jobs into another production',async()=>{
 const x=await fixture();try{
  for(const key of ['render','quality-0','prepare','select-0','clip-0','repair-plan-0']){
   await db.query("update studio_productions set steps=jsonb_set(steps,array[$2],'{\"status\":\"done\",\"result\":{\"id\":\"foreign-job\"}}') where id=$1",[x.old.id,key]);
   assert.equal(await x.recover(key),null);
  }
 }finally{await x.close();}
});
