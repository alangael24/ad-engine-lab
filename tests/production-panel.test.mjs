import test from 'node:test';
import assert from 'node:assert/strict';
import {productionPanel} from '../assets/production-panel.js';
test('failed production refreshes the saved storyboard before a customer retries',async()=>{
 const originalDocument=globalThis.document,originalStorage=globalThis.sessionStorage,elements=[],storage=new Map();
 globalThis.document={createElement:tag=>{const e={tag,setAttribute(){},removeAttribute(){},append(){}};elements.push(e);return e;},querySelector:()=>({before(){}})};
 globalThis.sessionStorage={getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};
 let project={id:'project',revision:4,data:{scriptDraft:'Approved script'}},refreshes=0,request;
 try{
  const api=async(url,options)=>{if(options){request=options.body;return {};}if(url.includes('render='))return {url:'https://media.test/approved.mp4'};return {enabled:true,productions:[{id:'failed-production',status:'failed',stage:'quality',error:'Review failed'}]};};
  const panel=productionPanel({api,task:fn=>fn(),getProject:()=>project,isDirty:()=>false,tell(){},getRenders:()=>[{id:'unreviewed',project_revision:10,status:'reviewing'},{id:'approved',project_revision:9,status:'succeeded'}],refresh:async()=>{refreshes++;project={...project,revision:10};await panel.open(project);}});
  await panel.open(project);const button=elements.find(e=>e.tag==='button');assert.equal(button.textContent,'Reintentar');assert.equal(refreshes,1);assert.equal(elements.find(e=>e.tag==='video').src,'https://media.test/approved.mp4');assert.equal(elements.find(e=>e.tag==='a').hidden,false);
  await button.onclick();assert.equal(request.expected,10);assert.equal(refreshes,1);assert.equal(storage.size,0);panel.stop();
 }finally{globalThis.document=originalDocument;globalThis.sessionStorage=originalStorage;}
});
