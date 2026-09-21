import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {giftRequest,GIFT_SCRIPT_REQUEST} from '../assets/gift-model.js';
import {projectData} from '../assets/studio-model.js';
import {database,user,call} from './helpers/database.mjs';
const input={recipient:'Ana',names:'Ana y Luis',occasion:'anniversary',memory1:'Nos conocimos en Puebla. Luis olvidó su paraguas rojo.',memory2:'',memory3:'',message:'Gracias por ser mi casa.',avoid:'No añadir hijos.',look:'3d',tone:'warm',ratio:'16:9'};
let db;before(async()=>{db=await database();});after(async()=>db.close());
test('gift project preserves memories and owned photos through save and idempotent retries without starting production',async()=>{
 const u=await user(db),photo=crypto.randomUUID(),id=crypto.randomUUID();
 await call(db,'studio_write',[u.id,'register_asset',photo,JSON.stringify({kind:'image',name:'Pareja',bucket:'generation-references',storage_path:`${u.id}/${photo}.jpg`,mime_type:'image/jpeg',size_bytes:120}),null]);
 const data=projectData(giftRequest(input,[{id:photo,label:'Ana a la izquierda; Luis a la derecha'}]));
 const create=()=>call(db,'studio_write',[u.id,'create_project',id,JSON.stringify(data),null]);
 const p=await create();assert.equal((await create()).id,p.id);assert.equal(p.brand_id,null);assert.equal(p.data.creatorBrief.targetDuration,60);assert.equal(p.data.scriptDraft,'');assert.deepEqual(p.data.creativeMemory.characterAssetIds,[photo]);assert.match(p.data.idea,/paraguas rojo/);assert.match(p.data.referenceNotes,/Ana a la izquierda/);
 const saved=await call(db,'studio_write',[u.id,'save_project',id,JSON.stringify({...p.data,scriptDraft:'Ana, todo empezó con un paraguas rojo.'}),p.revision]);assert.equal(saved.data.idea,p.data.idea);assert.deepEqual(saved.data.creativeMemory.characterAssetIds,[photo]);
 assert.equal((await db.query('select count(*)::int n from studio_productions where user_id=$1',[u.id])).rows[0].n,0);
 const stranger=await user(db);await assert.rejects(call(db,'studio_write',[stranger.id,'create_project',crypto.randomUUID(),JSON.stringify(data),null]),/STUDIO_ASSET_NOT_FOUND/);
});
test('maximum form lengths and three labeled references fit the existing production contract',()=>{
 const raw={...input,recipient:'a'.repeat(80),names:'b'.repeat(120),memory1:'c'.repeat(300),memory2:'d'.repeat(300),memory3:'e'.repeat(300),message:'f'.repeat(300),avoid:'g'.repeat(160)};
 const data=projectData(giftRequest(raw,Array.from({length:3},()=>({id:crypto.randomUUID(),label:'h'.repeat(100)}))));assert.ok(data.idea.length<=3000);assert.equal(data.creativeMemory.characterAssetIds.length,3);
 assert.throws(()=>giftRequest({...input,memory1:''}));assert.throws(()=>giftRequest(input,[{id:crypto.randomUUID(),label:''}]));assert.throws(()=>giftRequest({...input,look:'unknown'}));
 assert.match(GIFT_SCRIPT_REQUEST,/no inicies imágenes, voz ni video todavía/);
});

test('selected gift duration reaches the validated brief and story instructions',()=>{
 const one=projectData(giftRequest({...input,package:'gift_60'})),two=projectData(giftRequest({...input,package:'gift_120'}));
 assert.equal(one.creatorBrief.targetDuration,60);assert.equal(two.creatorBrief.targetDuration,120);
 assert.match(two.idea,/aproximadamente dos minutos/);assert.match(one.idea,/aproximadamente un minuto/);
 assert.throws(()=>giftRequest({...input,package:'gift_999'}));
});
