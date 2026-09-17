import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {callEditor,chatRequest,postStudioChat,getStudioChat} from '../src/studio-chat.js';
import {CHAT_MODEL,applyEdit,validateEdit,editFollowup} from '../assets/chat-model.js';
import {SCRIPT_MODEL} from '../assets/model-routing.js';
import {selectScriptVariant,normalizeScriptVariants} from '../assets/script-variants.js';
import {projectData} from '../assets/studio-model.js';
import {scriptVariantCards} from '../assets/script-variant-cards.js';
import {database,user,call} from './helpers/database.mjs';
import {mockSupabase} from './helpers/supabase-http.mjs';
const env={OPENAI_API_KEY:'fixture-astra',REFERENCE_FLASH_KEY:'fixture',REFERENCE_ANALYSIS_ENABLED:'true',SUPABASE_URL:'http://supabase.test',SUPABASE_SERVICE_ROLE_KEY:'fixture',PRODUCTION_ENABLED:'true'};
const project=()=>({id:crypto.randomUUID(),revision:1,brand_snapshot:{product:'Organizador de cables'},data:projectData({productProfile:'ads-sales-v1',title:'Tres propuestas',idea:'Un anuncio de 30 segundos',scriptDraft:'',brandId:null,referenceUrl:'',referenceNotes:'',aspectRatio:'9:16',scenes:[]})});
const values=['¿Dónde cayó el cargador? Organiza tus cables en la mesa. Elige el tuyo.','¿Otra cinta para sujetar el cable? Mantén el cargador a mano con este organizador. Consulta los modelos.','Tu mesa también puede estar ordenada. Agrupa tus cables con nuestro organizador. Encuentra el tuyo.'];
const titles=['El problema diario','La alternativa improvisada','Una mesa ordenada'];
const result=()=>({variants:values.map((value,i)=>({title:titles[i],salesPlan:{angle:titles[i],insights:[{kind:'mechanism',text:'Organiza cables',basis:'source',sourceIds:['brand:product']}]},value}))});
const stream=(raw,model=CHAT_MODEL,finish='tool_calls')=>new Response('data: '+JSON.stringify({model,choices:[{delta:{tool_calls:[{index:0,function:{name:model===CHAT_MODEL?'edit_project':'write_script',arguments:JSON.stringify(raw)}}]},finish_reason:finish}],usage:{prompt_tokens:50,completion_tokens:60}})+'\n\ndata: [DONE]\n\n');
const coordinator={operation:'draft_script',value:'Tres enfoques distintos para 30 segundos',message:'Aquí tienes las opciones.'};
async function generate(p=project(),provided=result()){
 let count=0;const requests=[];
 const output=await callEditor(p,[],[],'Crea un anuncio de 30 segundos con hook fuerte.',env,async(_,init)=>{requests.push(JSON.parse(init.body));return ++count===1?stream(coordinator):stream(provided,SCRIPT_MODEL);});
 return {p,output,count,requests};
}
test('one writing call produces exactly three complete choices; no script or media is silently approved',async()=>{
 const {p,output,count,requests}=await generate();assert.equal(count,2);assert.equal(output.edit.operation,'propose_scripts');assert.equal(output.edit.variants.options.length,3);
 const next=applyEdit(p,output.edit);assert.equal(next.scriptDraft,'');assert.deepEqual(next.scriptVariants.options.map(o=>o.script),values);assert.equal(next.narrationAssetId,null);assert.equal(editFollowup(p,output.edit,next),null);
 assert.equal(output.usage.calls.length,2);assert.equal(output.usage.calls[1].salesPlans.length,3);
 assert.equal(requests[1].tools[0].function.parameters.properties.variants.minItems,3);assert.match(requests[1].messages[0].content,/ángulo de venta distinto/);
 assert.deepEqual(projectData(next).scriptVariants,next.scriptVariants);
});
test('choosing by text keeps the stored script exactly and does not call the writer',async()=>{
 const {p,output}=await generate();p.data=applyEdit(p,output.edit);let count=0;
 const selected=await callEditor(p,[],[],'Me gusta la segunda, usemos esa.',env,async()=>{count++;return stream({operation:'select_script',position:2,value:null,message:'Elegida.'});});
 const next=applyEdit(p,selected.edit);assert.equal(count,1);assert.equal(next.scriptDraft,values[1]);assert.equal(next.scriptVariants,undefined);assert.equal(editFollowup(p,selected.edit,next),null);
 const ambiguous=await callEditor(p,[],[],'Hazlo.',env,async()=>stream({operation:'produce',value:null,message:'Producción.'}));
 assert.equal(ambiguous.edit.operation,'clarify');assert.equal(applyEdit(p,ambiguous.edit),null);
 assert.throws(()=>applyEdit(p,{operation:'set_hook',value:'Otro hook.',message:'Cambio.'}),/CHAT_VARIANTS_STALE/);
});
test('incomplete, duplicated, invalidly sourced or truncated variant sets never replace the draft',async()=>{
 for(const malformed of [()=>({variants:result().variants.slice(0,2)}),()=>({variants:[...result().variants,result().variants[0]]}),()=>({variants:Array(3).fill(result().variants[0])}),()=>{const r=result();r.variants[1].salesPlan.insights[0].sourceIds=['invented'];return r;}]){
  const p=project(),saved=structuredClone(p.data);await assert.rejects(generate(p,malformed()),/CHAT_INVALID/);assert.deepEqual(p.data,saved);
 }
 await assert.rejects(callEditor(project(),[],[],'Crea un anuncio',env,async(_,init)=>JSON.parse(init.body).model===CHAT_MODEL?stream(coordinator):stream(result(),SCRIPT_MODEL,'length')),/CHAT_INVALID/);
});
test('supplied scripts and revisions stay single; variants do not change the other product profiles',async()=>{
 for(const profile of [undefined,'creator-v1']){const p=project();p.data.productProfile=profile;assert.equal(chatRequest(p,[],[],'Idea').tools[0].function.parameters.properties.operation.enum.includes('select_script'),false);}
 const {p,output}=await generate();p.data=applyEdit(p,output.edit);
 const own='Mi guion completo. Organiza tus cables. Elige el tuyo.';
 const accepted=await callEditor(p,[],[],own,env,async()=>stream({operation:'accept_script',scriptSource:'message',value:own,message:'Conservado.'}));
 const next=applyEdit(p,accepted.edit);assert.equal(next.scriptDraft,own);assert.equal(next.scriptVariants,undefined);
 assert.throws(()=>selectScriptVariant(p,2,crypto.randomUUID()),/CHAT_VARIANTS_STALE/);
 assert.throws(()=>selectScriptVariant(p,4),/CHAT_INVALID/);
 const r=normalizeScriptVariants(output.edit.variants);r.options[1].script=r.options[0].script;assert.throws(()=>normalizeScriptVariants(r),/CHAT_INVALID/);
});
let db,stub,originalFetch,providerCalls=0,providerStep=0;
before(async()=>{db=await database();originalFetch=globalThis.fetch;stub=mockSupabase(db);globalThis.fetch=(input,init)=>{if((String(input).startsWith('https://opencode.ai/')||input==='https://api.openai.com/v1/responses')){providerCalls++;return ++providerStep%2===1?stream(coordinator):stream(result(),SCRIPT_MODEL);}return stub.fetch(input,init);};});
after(async()=>{globalThis.fetch=originalFetch;await db.close();});
async function fixture(){const u=await user(db);stub.users.set(u.id,{...u,email_confirmed_at:new Date().toISOString()});const b=await call(db,'studio_write',[u.id,'save_brand',crypto.randomUUID(),JSON.stringify({name:'Cable',product:'Organizador de cables'})]);const d=project().data;d.brandId=b.id;const p=await call(db,'studio_write',[u.id,'create_project',crypto.randomUUID(),JSON.stringify(d)]);return {u,p};}
const ctx=(u,body)=>({env,request:new Request('https://app.test/api/studio-chat',{method:'POST',headers:{authorization:'Bearer '+u.id,'content-type':'application/json'},body:JSON.stringify(body)})});
test('persisted options survive reload; button selection costs zero model calls, replays once, and rejects stale choices',async()=>{
 const {u,p}=await fixture(),body={requestId:crypto.randomUUID(),projectId:p.id,expected:p.revision,message:'Crea un anuncio de 30 segundos'};
 const response=await postStudioChat(ctx(u,body));assert.equal(response.status,200,await response.clone().text());const record=(await response.json()).edit;
 const saved=(await call(db,'studio_read',[u.id,p.id])).project;assert.equal(saved.data.scriptVariants.options.length,3);assert.equal(saved.data.scriptDraft,'');
 assert.equal(record.result.usage.calls[1].scriptVariants.id,saved.data.scriptVariants.id);
 await db.query("insert into studio_production_workers(id) values('variants-test') on conflict(id) do update set last_seen_at=now()");
 await assert.rejects(call(db,'studio_production_start',[u.id,crypto.randomUUID(),p.id,saved.revision,true]),/PRODUCTION_SCRIPT/);
 const selection={requestId:crypto.randomUUID(),projectId:p.id,expected:saved.revision,message:'Usar variante 2',scriptChoice:{setId:saved.data.scriptVariants.id,index:2}},before=providerCalls;
 assert.equal((await postStudioChat(ctx(u,selection))).status,200);assert.equal(providerCalls,before);
 const selected=(await call(db,'studio_read',[u.id,p.id])).project;assert.equal(selected.data.scriptDraft,values[1]);assert.equal(selected.data.scriptVariants,undefined);
 assert.equal((await postStudioChat(ctx(u,selection))).status,200);assert.equal(providerCalls,before);
 assert.equal((await postStudioChat(ctx(u,{...selection,scriptChoice:{...selection.scriptChoice,index:3}}))).status,409);
 const stale=await postStudioChat(ctx(u,{...selection,requestId:crypto.randomUUID(),expected:selected.revision}));assert.equal(stale.status,409);assert.equal((await stale.json()).code,'CHAT_VARIANTS_STALE');
 const outsider=await user(db);stub.users.set(outsider.id,outsider);assert.equal((await postStudioChat(ctx(outsider,{...selection,requestId:crypto.randomUUID()}))).status,404);
 assert.equal((await db.query('select count(*)::int n from studio_productions where project_id=$1',[p.id])).rows[0].n,0);
});
test('variant cards use literal text and buttons pass the stable set identity',()=>{
 const old=globalThis.document;globalThis.document={createElement:tag=>({tag,children:[],append(...nodes){this.children.push(...nodes);},setAttribute(){}})};
 try{const variants={id:crypto.randomUUID(),options:titles.map((title,i)=>({title,angle:title,script:values[i]}))};let chosen;
 const root=scriptVariantCards(variants,{onChoose:(...x)=>chosen=x});assert.equal(root.children.length,3);root.children[1].children.at(-1).onclick();assert.deepEqual(chosen,[2,variants.id]);
 assert.equal(root.children[0].children[2].textContent,values[0]);assert.ok(scriptVariantCards(variants,{disabled:true}).children.every(c=>c.children.at(-1).disabled));
 }finally{globalThis.document=old;}
});
