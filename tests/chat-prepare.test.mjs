import test from 'node:test';
import assert from 'node:assert/strict';
import {database,user,call} from './helpers/database.mjs';
test('compact preparation preserves ownership, eight-entry history, idempotency and undo snapshots',async()=>{
 const db=await database();try{
  const alice=await user(db),bob=await user(db);
  const brand=await call(db,'studio_write',[alice.id,'save_brand',crypto.randomUUID(),JSON.stringify({name:'Test',product:'Test'}),null]);
  const project=await call(db,'studio_write',[alice.id,'create_project',crypto.randomUUID(),JSON.stringify({title:'Test',brandId:brand.id,scenes:[],aspectRatio:'9:16'}),null]);
  for(let i=0;i<10;i++)await db.query("insert into studio_chat_edits(id,user_id,project_id,request_payload,before_data,status,created_at) values($1,$2,$3,$4,$5,'succeeded',now()-make_interval(secs => $6))",[crypto.randomUUID(),alice.id,project.id,JSON.stringify({message:'message '+i}),JSON.stringify(project.data),100-i]);
  const id=crypto.randomUUID(),payload=JSON.stringify({expected:project.revision,message:'Hola',enabled:true});
  await assert.rejects(call(db,'studio_chat_prepare',[bob.id,id,project.id,payload]),/STUDIO_NOT_FOUND/);
  const first=await call(db,'studio_chat_prepare',[alice.id,id,project.id,payload]);
  assert.equal(first.record.claimed,true);assert.ok(!('before_data' in first.record));
  assert.equal(first.context.project.id,project.id);assert.equal(first.history.length,8);
  assert.equal(first.history[0].request_payload.message,'message 3');assert.equal(first.history.at(-1).id,id);
  assert.ok(first.history.every(h=>!('before_data' in h)));
  const replay=await call(db,'studio_chat_prepare',[alice.id,id,project.id,payload]);
  assert.equal(replay.record.claimed,false);assert.ok(!('context' in replay));
  const done=await call(db,'studio_chat_commit',[alice.id,'complete',id,project.id,JSON.stringify({edit:{operation:'clarify',message:'Hola'},usage:{calls:[]},nextData:null})]);
  assert.equal(done.status,'succeeded');assert.ok(!('before_data' in done));
  assert.deepEqual((await db.query('select before_data from studio_chat_edits where id=$1',[id])).rows[0].before_data,project.data);
  await db.exec('set role authenticated');
  await assert.rejects(call(db,'studio_chat_prepare',[alice.id,id,project.id,payload]),/permission denied/);
  await db.exec('reset role');
 }finally{await db.close();}
});
