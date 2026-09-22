import test from 'node:test';
import assert from 'node:assert/strict';
import {GIFT_RELATIONSHIPS,GIFT_OCCASIONS} from '../assets/gift-model.js';
import {giftMemoryOptions,giftDedicationGuide,mountGiftMemoryGuide} from '../assets/gift-memory-guide.js';

test('all offered relationships and occasions provide bounded, usable recall and dedication guidance',()=>{
 for(const relationship of ['',...Object.keys(GIFT_RELATIONSHIPS)])for(const occasion of Object.keys(GIFT_OCCASIONS)){
  const context={relationship,occasion},options=giftMemoryOptions(context);
  assert.ok(options.length>=3&&options.length<=5);
  assert.equal(new Set(options.map(x=>x.id)).size,options.length);
  for(const option of options)for(const key of ['label','question','hint','example'])assert.ok(option[key]?.trim(),`${relationship}/${occasion}/${key}`);
  assert.ok(giftDedicationGuide(context).example);
  if(['memorial','pregnancy','reunion'].includes(occasion))assert.ok(!options.some(x=>x.id==='date'));
  if(relationship!=='partner')assert.ok(!options.some(x=>x.id==='date'));
 }
 assert.notDeepEqual(giftMemoryOptions({relationship:'family'}),giftMemoryOptions({relationship:'other'}));
});

test('changing the selected suggestion or relationship preserves the customer anecdote',()=>{
 const element=()=>({children:[],attrs:{},append(...items){this.children.push(...items);},replaceChildren(){this.children=[];},setAttribute(k,v){this.attrs[k]=v;}});
 const previous=globalThis.document;globalThis.document={createElement:element};
 try{
  const container=element(),input={value:'Mi recuerdo verdadero',focus(){}},question={},hint={};
  mountGiftMemoryGuide(container,{context:{relationship:'friend'},input,question,hint});
  const chips=container.children[1];chips.children[0].onclick();chips.children[1].onclick();
  assert.equal(input.value,'Mi recuerdo verdadero');assert.match(input.placeholder,/Ejemplo:/);
  assert.equal(chips.children[0].attrs['aria-pressed'],'false');assert.equal(chips.children[1].attrs['aria-pressed'],'true');
  mountGiftMemoryGuide(container,{context:{relationship:'family',occasion:'memorial'},input,question,hint,second:true});
  container.children[1].children[0].onclick();assert.equal(input.value,'Mi recuerdo verdadero');assert.ok(hint.textContent);
 }finally{globalThis.document=previous;}
});
