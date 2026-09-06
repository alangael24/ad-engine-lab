import test from 'node:test';
import assert from 'node:assert/strict';
import {productionPanel} from '../assets/production-panel.js';
test('failed production refreshes the saved storyboard before a customer retries',async()=>{
 const originalDocument=globalThis.document,originalStorage=globalThis.sessionStorage,elements=[],storage=new Map();
 globalThis.document={createElement:tag=>{const e={tag,setAttribute(){},removeAttribute(){},append(){}};elements.push(e);return e;},querySelector:()=>({before(){}})};
 globalThis.sessionStorage={getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};
 let project={id:'project',revision:4,data:{scriptDraft:'Approved script'}},refreshes=0,request;
 try{
  const api=async(url,options)=>{if(options){request=options.body;return {};}return {enabled:true,productions:[{id:'failed-production',status:'failed',stage:'quality',error:'Review failed'}]};};
  const panel=productionPanel({api,task:fn=>fn(),getProject:()=>project,isDirty:()=>false,tell(){},refresh:async()=>{refreshes++;project={...project,revision:10};await panel.open(project);}});
  await panel.open(project);const button=elements.find(e=>e.tag==='button');assert.equal(button.textContent,'Reintentar');assert.equal(refreshes,1);
  await button.onclick();assert.equal(request.expected,10);assert.equal(refreshes,1);assert.equal(storage.size,0);panel.stop();
 }finally{globalThis.document=originalDocument;globalThis.sessionStorage=originalStorage;}
});
