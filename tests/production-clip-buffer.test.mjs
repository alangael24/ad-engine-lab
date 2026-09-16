import test from 'node:test';
import assert from 'node:assert/strict';
import {runClipBuffer} from '../workers/production-clip-buffer.mjs';

const entries=n=>Array.from({length:n},(_,i)=>({key:`clip-${i}`}));
test('prepares two upcoming clips while the first runs, bounds admission, selects in order',async()=>{
 const events=[],versions=[],selected=[];let maxPending=0;
 await runClipBuffer(entries(8),{
  pollMs:0,
  prepare:async e=>{events.push(`prepare:${e.key}`);return {prompt:e.key};},
  submit:async(e,data)=>{
   assert.equal(data.prompt,e.key);events.push(`submit:${e.key}`);
   const v={id:e.key,status:'queued'};versions.push(v);
   maxPending=Math.max(maxPending,versions.filter(v=>!selected.includes(v.id)).length);
   return v;
  },
  inspect:async()=>{
   // A single simulated GPU can work while the coordinator prepares prompts.
   // Hold the first clip until two successors are queued: sequential code stalls here.
   if(versions.length>=3){const v=versions.find(v=>v.status!=='succeeded');if(v){v.status='succeeded';events.push(`finish:${v.id}`);}}
   return {versions};
  },
  select:async(e,v)=>{assert.equal(e.key,v.id);selected.push(v.id);events.push(`select:${v.id}`);}
 });
 assert.equal(maxPending,3);assert.deepEqual(selected,entries(8).map(e=>e.key));
 assert.ok(events.indexOf('prepare:clip-2')<events.indexOf('finish:clip-0'));
 assert.ok(events.indexOf('submit:clip-1')<events.indexOf('select:clip-0'));
});

test('completion out of order does not reorder scene selection',async()=>{
 const versions=[],order=[];let inspected=false;
 await runClipBuffer(entries(3),{pollMs:0,prepare:async()=>({}),submit:async e=>{
  const v={id:e.key,status:e.key==='clip-0'?'running':'succeeded'};versions.push(v);return v;
 },inspect:async()=>{
  if(versions.length===3){if(inspected)versions[0].status='succeeded';else inspected=true;}
  return {versions};
 },select:async e=>order.push(e.key)});
 assert.deepEqual(order,['clip-0','clip-1','clip-2']);
});

test('a known GPU failure stops further preparation and never selects a failed clip',async()=>{
 for(const status of ['failed','canceled']){
  let prepared=0,selected=0;
  await assert.rejects(runClipBuffer(entries(5),{prepare:async()=>{prepared++;},submit:async()=>({id:'v'}),inspect:async()=>({versions:[{id:'v',status}]}),select:async()=>selected++}),/PRODUCTION_CLIP_FAILED/);
  assert.equal(prepared,1);assert.equal(selected,0);
 }
});

test('failure observed after slow preparation prevents enqueueing the next clip',async()=>{
 let prepared=0,submitted=0;
 await assert.rejects(runClipBuffer(entries(3),{
  prepare:async()=>{prepared++;},submit:async()=>{submitted++;return {id:'v'};},
  inspect:async()=>({versions:[{id:'v',status:prepared===1?'running':'failed'}]}),select:async()=>assert.fail('No selection')
 }),/PRODUCTION_CLIP_FAILED/);
 assert.equal(prepared,2);assert.equal(submitted,1);
});

test('lease loss after preparation prevents submission; no asynchronous work remains',async()=>{
 let lost=false,submitted=0;
 await assert.rejects(runClipBuffer(entries(4),{
  check:()=>{if(lost)throw Error('LEASE_LOST');},prepare:async()=>{lost=true;},
  submit:async()=>submitted++,inspect:async()=>({versions:[]}),select:async()=>{}
 }),/LEASE_LOST/);assert.equal(submitted,0);
});

test('restart replays persisted preparations and submissions after lost selection acknowledgement',async()=>{
 const prompts=new Map(),versions=new Map(),selections=new Set();let calls=0,fail=true;
 const callbacks={pollMs:0,prepare:async e=>{
  if(!prompts.has(e.key)){calls++;prompts.set(e.key,{prompt:e.key});}return prompts.get(e.key);
 },submit:async e=>{
  if(!versions.has(e.key))versions.set(e.key,{id:e.key,status:'succeeded'});return versions.get(e.key);
 },inspect:async()=>({versions:[...versions.values()]}),select:async e=>{
  selections.add(e.key);if(fail){fail=false;throw Error('NETWORK_LOST');}
 }};
 await assert.rejects(runClipBuffer(entries(6),callbacks),/NETWORK_LOST/);
 assert.equal(calls,3);
 await runClipBuffer(entries(6),callbacks);
 assert.equal(calls,6);assert.equal(versions.size,6);assert.equal(selections.size,6);
});

test('empty or invalid windows never launch provider work',async()=>{
 const callbacks={prepare:()=>assert.fail(),submit:()=>assert.fail(),inspect:()=>assert.fail(),select:()=>assert.fail()};
 await runClipBuffer([],callbacks);
 for(const capacity of [0,4,1.5])await assert.rejects(runClipBuffer(entries(1),{...callbacks,capacity}),/PRODUCTION_INVALID/);
});
