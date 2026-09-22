import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {giftRequest,GIFT_SCRIPT_REQUEST,giftDraftStep,giftQuestions,GIFT_OCCASIONS} from '../assets/gift-model.js';
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
 const raw={...input,relationship:'family',emotion:'gratitude',occasion:'pregnancy',recipient:'a'.repeat(80),names:'b'.repeat(120),memory1:'c'.repeat(300),memory2:'d'.repeat(300),memory3:'e'.repeat(300),message:'f'.repeat(300),avoid:'g'.repeat(160)};
 const data=projectData(giftRequest(raw,Array.from({length:3},()=>({id:crypto.randomUUID(),label:'h'.repeat(100)}))));assert.ok(data.idea.length<=3000);const {names,...compact}=raw;assert.ok(giftRequest({...compact,additionalNames:names},Array.from({length:3},()=>({id:crypto.randomUUID(),label:'h'.repeat(100)}))).idea.length<=3000);assert.equal(data.creativeMemory.characterAssetIds.length,3);
 assert.throws(()=>giftRequest({...input,memory1:''}));assert.throws(()=>giftRequest(input,[{id:crypto.randomUUID(),label:''}]));assert.throws(()=>giftRequest({...input,look:'unknown'}));assert.throws(()=>giftRequest({...input,look:'clay'}));assert.match(giftRequest(input).idea,/Estilo visual único: animación 3D tipo Pixar/);
 assert.match(GIFT_SCRIPT_REQUEST,/no inicies imágenes, voz ni video todavía/);
});

test('guided answers reach the stored director brief for every occasion without starting production',async()=>{
 const u=await user(db);
 for(const occasion of Object.keys(GIFT_OCCASIONS)){
  const data=projectData(giftRequest({...input,occasion,relationship:'mother',emotion:'gratitude',package:'gift_120',memory1:'Quiero decirle a Ana que será abuela.',memory2:'Siempre dice: aquí hay sitio para uno más.'}));
  const p=await call(db,'studio_write',[u.id,'create_project',crypto.randomUUID(),JSON.stringify(data),null]);
  assert.match(p.data.idea,/Relación con quien regala: Mi mamá/);
  assert.match(p.data.idea,/Emoción que debe transmitir: Gratitud/);
  assert.match(p.data.idea,/aquí hay sitio para uno más/);
  assert.match(p.data.idea,/será abuela/);
  assert.equal(p.data.creatorBrief.targetDuration,120);
 }
 assert.equal((await db.query('select count(*)::int n from studio_productions where user_id=$1',[u.id])).rows[0].n,0);
 assert.throws(()=>giftRequest({...input,emotion:'invalid'}));
 assert.throws(()=>giftRequest({...input,relationship:'invalid'}));
});

test('old drafts retain a useful step after merging the story and removing duplicate duration',()=>{
 assert.deepEqual([0,1,2,3].map(step=>giftDraftStep({version:2,step})),[1,0,0,1]);
 assert.deepEqual([0,1,2].map(step=>giftDraftStep({step})),[0,0,1]);
 assert.equal(giftDraftStep({version:3,step:3}),1);
 assert.equal(giftDraftStep(null),0);
 assert.deepEqual([0,1,2,3].map(step=>giftDraftStep({version:4,step})),[0,1,1,1]);
});

test('occasion-specific prompts take precedence over the relationship',()=>{
 assert.match(giftQuestions({relationship:'mother',occasion:'pregnancy'}).memory,/noticia/);
 assert.match(giftQuestions({relationship:'mother',occasion:'thanks'}).memory,/hizo por ti/);
 assert.match(giftQuestions({relationship:'father',occasion:'memorial'}).hint,/No necesitas explicar la pérdida/);
});

test('selected gift duration reaches the validated brief and story instructions',()=>{
 const one=projectData(giftRequest({...input,package:'gift_60'})),two=projectData(giftRequest({...input,package:'gift_120'}));
 assert.equal(one.creatorBrief.targetDuration,60);assert.equal(two.creatorBrief.targetDuration,120);
 assert.match(two.idea,/aproximadamente dos minutos/);assert.match(one.idea,/aproximadamente un minuto/);
 assert.throws(()=>giftRequest({...input,package:'gift_999'}));
});

test('minimal intake needs no duplicate protagonist name and keeps optional details',()=>{
 const {names,...minimal}=input;
 assert.match(projectData(giftRequest(minimal)).idea,/Para: Ana\. Otros protagonistas y pronunciación: No indicados\./);
 assert.match(projectData(giftRequest({...minimal,additionalNames:'su hija Sofía'})).idea,/Otros protagonistas y pronunciación: su hija Sofía/);
 assert.match(projectData(giftRequest(input)).idea,/Ana y Luis/);
 assert.throws(()=>giftRequest({...minimal,recipient:''}));
});
