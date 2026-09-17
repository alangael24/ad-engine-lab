import test from 'node:test';
import assert from 'node:assert/strict';
import {chatRequest,callEditor} from '../src/studio-chat.js';
import {providedScript} from '../src/provided-script.js';
import {applyEdit,editFollowup,CHAT_MODEL} from '../assets/chat-model.js';
import {SCRIPT_MODEL} from '../assets/model-routing.js';
import {ideaIntent,salesIdeaIntent} from '../assets/idea-intent.js';
const script='¿Otra vez buscando el cargador?\nLuma lo mantiene en tu mesa.\nCuesta $24, no $40. Entra a luma.example.com y elige el tuyo.';
const project=(more={})=>({id:crypto.randomUUID(),revision:1,brand_snapshot:{product:'Organizador de cables'},data:{productProfile:'ads-sales-v1',title:'Prueba',idea:script,scriptDraft:'',brandId:null,referenceUrl:'',referenceNotes:'',aspectRatio:'9:16',scenes:[],...more}});
const env={REFERENCE_FLASH_KEY:'fixture',PRODUCTION_ENABLED:'true'};
const stream=(raw,model=CHAT_MODEL)=>new Response('data: '+JSON.stringify({model,choices:[{delta:{tool_calls:[{index:0,function:{name:model===CHAT_MODEL?'edit_project':'write_script',arguments:JSON.stringify(raw)}}]},finish_reason:'tool_calls'}],usage:{prompt_tokens:30,completion_tokens:20}})+'\n\ndata: [DONE]\n\n');
const accept=(value=script,scriptSource='message')=>({operation:'accept_script',value,scriptSource,message:'Conservado.'});

test('only the ads chat before scenes offers literal script intake; other products stay unchanged',()=>{
 for(const [data,expected] of [[{},true],[{productProfile:undefined},false],[{productProfile:'creator-v1'},false],[{scenes:[{id:crypto.randomUUID(),text:'X'}]},false]]){
  const req=chatRequest(project(data),[],[],script,true);
  assert.equal(req.tools[0].function.parameters.properties.operation.enum.includes('accept_script'),expected);
  assert.equal(req.messages[0].content.includes('ENTRADA DEL CLIENTE EN ANUNCIOS'),expected);
 }
 assert.equal(chatRequest(project(),[],[],script).tools[0].function.parameters.properties.changes.items.properties.operation.enum.includes('accept_script'),false);
});
test('pasted script bypasses the writer, survives persistence normalization, and cannot start media',async()=>{
 let count=0;const p=project(),deltas=[];
 const result=await callEditor(p,[],[],script,env,async()=>{count++;return stream(accept());},d=>deltas.push(d));
 const next=applyEdit(p,result.edit);
 assert.equal(count,1);assert.equal(next.scriptDraft,script);assert.equal(result.usage.inputMode,'provided_script');
 assert.equal(editFollowup(p,result.edit,next),null);assert.equal(next.scenes.length,0);
 assert.equal(deltas.filter(d=>d.field==='script').map(d=>d.text).join(''),script);
 assert.equal(p.data.scriptDraft,'');
});
test('explicit label may be omitted, but dropped hook, CTA, rewritten copy and invented source are rejected',()=>{
 const p=project();
 assert.equal(providedScript(accept(),{project:p,message:'Este es mi guion:\n\n'+script}).edit.value,script);
 assert.equal(providedScript(accept(),{project:p,message:'Usa esto tal cual:\n'+script}).edit.value,script);
 for(const raw of [accept(script.replace('$24','$25')),accept(script.split('\n').slice(1).join('\n')),accept(script.split('\n').slice(0,-1).join('\n')),accept(script,'history')]){
  assert.throws(()=>providedScript(raw,{project:p,message:script}),/CHAT_INVALID/);
 }
 assert.throws(()=>providedScript(accept(),{project:project({productProfile:'creator-v1'}),message:script}),/CHAT_INVALID/);
 assert.throws(()=>providedScript(accept(),{project:project({scenes:[{}]}),message:script}),/CHAT_INVALID/);
});
test('long original project input is preserved even when current request only refers to it',async()=>{
 const long=('Una frase que no debe perderse.\n').repeat(75)+script,p=project({idea:long});
 assert.ok(long.length>2000&&long.length<3000);
 const result=await callEditor(p,[],[],'Usa mi guion anterior tal cual',env,async()=>stream(accept(long,'idea')));
 assert.equal(applyEdit(p,result.edit).scriptDraft,long);
});
test('literal verification failure never invokes the writer or overwrites an existing draft',async()=>{
 const p=project({scriptDraft:'Borrador aprobado.'});let count=0;
 await assert.rejects(callEditor(p,[],[],script,env,async()=>{count++;return stream(accept(script+' Compra hoy.'));}),/CHAT_INVALID/);
 assert.equal(count,1);assert.equal(p.data.scriptDraft,'Borrador aprobado.');
});
test('explicit rewriting still uses the sales writer, while ambiguity does not mutate the project',async()=>{
 for(const message of ['Mejora este guion: '+script]){
  const p=project({idea:message});let count=0;
  const result=await callEditor(p,[],[],message,env,async()=>{
   count++;return count===1?stream({operation:'draft_script',scriptMode:'revision',value:'Redacta la propuesta solicitada',message:'Aquí está la propuesta.'}):stream({salesPlan:{angle:'Mesa ordenada',insights:[{kind:'mechanism',text:'Organiza cables',basis:'source',sourceIds:['brand:product']}]},value:'Tu cargador, en su lugar.'},SCRIPT_MODEL);
  });
  assert.equal(count,2);assert.equal(result.edit.value,'Tu cargador, en su lugar.');assert.equal(result.usage.calls.length,2);
 }
 const p=project();let count=0;
 const result=await callEditor(p,[],[],'Luma $24, cables. Close-up, luego oferta.',env,async()=>{count++;return stream({operation:'clarify',value:null,message:'¿Quieres usar esas frases literalmente o que escriba el guion?'});});
 assert.equal(count,1);assert.equal(applyEdit(p,result.edit),null);
});
test('sales CTA domain remains part of a pasted script; URL imports and legacy routing survive',()=>{
 assert.equal(salesIdeaIntent(script).kind,'idea');assert.equal(ideaIntent(script).kind,'store');
 for(const text of ['luma.example.com','Haz un anuncio para https://luma.example.com'])assert.equal(salesIdeaIntent(text).kind,'store');
 assert.equal(salesIdeaIntent('Usa https://www.tiktok.com/@example/video/123 como referencia').kind,'reference');
});
