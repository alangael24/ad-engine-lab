import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {database,user,call} from './helpers/database.mjs';
import {giftRequest} from '../assets/gift-model.js';
import {projectData} from '../assets/studio-model.js';
test('package changes preserve story, invalidate old script, reject foreign/stale/approved orders and do not spend balance',async()=>{
 const db=await database();try{
 await db.exec(await readFile(new URL('../supabase/migrations/20260921235857_gift_checkout_package_choice.sql',import.meta.url),'utf8'));
 const u=await user(db),stranger=await user(db),id=crypto.randomUUID();
 const data=projectData(giftRequest({recipient:'Ana',names:'Ana y Luis',occasion:'anniversary',memory1:'El primer café en Puebla',look:'3d',tone:'warm',ratio:'16:9',package:'gift_60'}));
 await call(db,'studio_write',[u.id,'create_project',id,JSON.stringify(data),null]);
 let o=await call(db,'gift_order_customer',[u.id,id,'submit',null,'']);
 o=await call(db,'gift_order_operator',[id,'script',o.revision,JSON.stringify({script:'Un café inolvidable.'})]);
 const before=await db.query('select * from credit_balances where user_id=$1',[u.id]);
 await assert.rejects(call(db,'gift_order_package',[stranger.id,id,o.revision,120]),/GIFT_NOT_FOUND/);
 await assert.rejects(call(db,'gift_order_package',[u.id,id,o.revision-1,120]),/GIFT_CONFLICT/);
 await assert.rejects(call(db,'gift_order_package',[u.id,id,o.revision,90]),/GIFT_INVALID/);
 const changed=await call(db,'gift_order_package',[u.id,id,o.revision,120]);
 assert.equal(changed.target_seconds,120);assert.equal(changed.status,'received');assert.equal(changed.script,'');assert.equal(changed.brief.creatorBrief.targetDuration,120);assert.match(changed.brief.idea,/dos minutos/);assert.match(changed.brief.idea,/primer café/);
 assert.equal((await call(db,'gift_order_package',[u.id,id,o.revision,120])).revision,changed.revision);
 const proj=(await db.query('select data from studio_projects where id=$1',[id])).rows[0].data;assert.equal(proj.creatorBrief.targetDuration,120);
 assert.deepEqual((await db.query('select * from credit_balances where user_id=$1',[u.id])).rows,before.rows);
 await db.query("update gift_orders set status='approved',reserved_seconds=120 where id=$1",[id]);
 await assert.rejects(call(db,'gift_order_package',[u.id,id,changed.revision,60]),/GIFT_INVALID/);
 }finally{await db.close();}
});
