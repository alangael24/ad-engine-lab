import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {productProfile,productPath,CONTINUITY_PRODUCT,SALES_PRODUCT} from '../assets/product-profiles.js';
import {projectData} from '../assets/studio-model.js';
import {applyEdit} from '../assets/chat-model.js';
import {LEGACY_SCRIPT_SYSTEM,writeScriptChanges} from '../src/script-writer.js';
import {SALES_COPY_SYSTEM,commercialDirection} from '../src/sales-copy.js';
import {SCRIPT_MODEL} from '../assets/model-routing.js';
const data=()=>({title:'Prueba',brandId:null,referenceUrl:'',referenceNotes:'',aspectRatio:'9:16',scenes:[],scriptDraft:'¿Dónde está el cable? Encuéntralo en tu mesa.'});
const response=value=>new Response('data: '+JSON.stringify({model:SCRIPT_MODEL,choices:[{delta:{tool_calls:[{index:0,function:{name:'write_script',arguments:JSON.stringify({value})}}]},finish_reason:'tool_calls'}],usage:{prompt_tokens:30,completion_tokens:20}})+'\n\ndata: [DONE]\n\n');
test('original projects keep the frozen writer, model and no sales direction',async()=>{
 const baseline=JSON.parse(await readFile(new URL('./fixtures/continuity-script-baseline.json',import.meta.url)));
 assert.equal(createHash('sha256').update(LEGACY_SCRIPT_SYSTEM).digest('hex'),baseline.scriptSystemSha256);
 assert.equal(SCRIPT_MODEL,baseline.model);assert.equal(productProfile(data()),CONTINUITY_PRODUCT);
 assert.equal(commercialDirection({data:data()}),'');assert.equal(productPath(data()),'/estudio/');
 assert.ok(!Object.hasOwn(projectData(data()),'productProfile'));
});
test('sales identity survives normalization and chat edits; invalid product ids fail closed',()=>{
 const d=projectData({...data(),productProfile:SALES_PRODUCT});
 assert.equal(projectData(d).productProfile,SALES_PRODUCT);assert.equal(productPath(d),'/anuncios-lab/');
 const changed=applyEdit({data:d},{operation:'draft_script',value:'¿Otra vez en el suelo? Sujeta tus cables aquí.'});
 assert.equal(changed.productProfile,SALES_PRODUCT);assert.equal(productProfile(data()),CONTINUITY_PRODUCT);
 assert.throws(()=>projectData({...data(),productProfile:'sales-typo'}),/STUDIO_INVALID/);
});
test('same inputs use one writer call with identical settings; only the sales system changes',async()=>{
 const seen=[];
 for(const profile of [undefined,SALES_PRODUCT]){
  const d=data();if(profile)d.productProfile=profile;
  const change={operation:'draft_script',value:'Escribe 90 palabras'};
  const usage=await writeScriptChanges(change,{project:{id:'same',brand_snapshot:{product:'Organizador de cables'},data:d},history:[],message:'Haz el guion',env:{REFERENCE_FLASH_KEY:'fixture'},request:async(u,init)=>{seen.push(JSON.parse(init.body));return response('Tus cables, donde los necesitas.');}});
  assert.equal(change.value,'Tus cables, donde los necesitas.');assert.equal(usage.length,1);
 }
 assert.equal(seen[0].messages[0].content,LEGACY_SCRIPT_SYSTEM);assert.equal(seen[1].messages[0].content,SALES_COPY_SYSTEM);
 for(const key of ['model','reasoning_effort','max_tokens','tool_choice','tools'])assert.deepEqual(seen[0][key],seen[1][key]);
});
test('sales hook rewrite explicitly preserves the rest of scene one and other scenes',async()=>{
 const first={id:crypto.randomUUID(),text:'Hook viejo. Explicación que debe conservarse.',visual:'Mesa y cables',start:0,end:5};
 const second={id:crypto.randomUUID(),text:'Consulta las medidas.',visual:'Organizador de cuatro ranuras',start:5,end:8};
 const project={id:'same',brand_snapshot:{},data:projectData({...data(),productProfile:SALES_PRODUCT,scenes:[first,second]})};
 const change={operation:'set_hook',value:'Cambia solo el hook'};
 await writeScriptChanges(change,{project,history:[],message:'Otro hook',env:{REFERENCE_FLASH_KEY:'fixture'},request:async(u,init)=>{
  const b=JSON.parse(init.body);assert.match(b.messages[0].content,/narración completa que debe quedar en la primera escena/);
  assert.match(b.messages[1].content,/Explicación que debe conservarse/);return response('Hook nuevo. Explicación que debe conservarse.');
 }});
 const updated=applyEdit(project,change);assert.equal(updated.scenes[0].text,'Hook nuevo. Explicación que debe conservarse.');assert.equal(updated.scenes[1].text,second.text);assert.equal(updated.productProfile,SALES_PRODUCT);
});
test('sales writer provider failure does not fall back or produce media',async()=>{
 let count=0;await assert.rejects(writeScriptChanges({operation:'draft_script',value:'Idea'},{project:{id:'p',data:{...data(),productProfile:SALES_PRODUCT}},history:[],message:'Idea',env:{REFERENCE_FLASH_KEY:'fixture'},request:async()=>{count++;return new Response('',{status:503});}}),/CHAT_PROVIDER/);assert.equal(count,1);
});
