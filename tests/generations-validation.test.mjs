import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateGeneration, readJson, imageType, publicJob } from '../src/generations.js';
import { verifyWorker } from '../functions/api/worker.js';
const input=()=>({requestId:crypto.randomUUID(),prompt:'Presenta mi producto',durationSeconds:5,resolution:'720p',aspectRatio:'9:16'});
test('generation request accepts natural language and optional reference, rejects unpriced settings',()=>{
  assert.equal(validateGeneration(input()).p_duration,5);
  for(const change of [{durationSeconds:100},{durationSeconds:'5'},{resolution:'4K'},{aspectRatio:'auto'},{requestId:'x'},{prompt:'short'},{referenceId:'https://internal/'},null]) {
    assert.throws(()=>validateGeneration(change===null ? null : {...input(),...change}),/INVALID_GENERATION/);
  }
});
test('bounded body rejects malformed or oversized data before parsing',async()=>{
  await assert.rejects(readJson(new Request('https://local.test',{method:'POST',headers:{'content-type':'application/json'},body:'{'})),/INVALID_GENERATION/);
  await assert.rejects(readJson(new Request('https://local.test',{method:'POST',headers:{'content-type':'application/json'},body:' '.repeat(12001)})),/INVALID_GENERATION/);
});
test('image magic is checked, SVG and HTML rejected',()=>{
  assert.deepEqual(imageType(new Uint8Array([137,80,78,71,13,10,26,10])),['image/png','png']);
  assert.throws(()=>imageType(new TextEncoder().encode('<svg onload=alert(1)>')),/INVALID_REFERENCE/);
});
test('worker auth requires a strong configured secret, never a browser token',async()=>{
  const secret='a'.repeat(40), req=token=>new Request('https://local.test',{headers:{authorization:`Bearer ${token}`}});
  await verifyWorker(req(secret),secret);
  await assert.rejects(verifyWorker(req('wrong'),secret),/UNAUTHORIZED/);
  await assert.rejects(verifyWorker(req(secret),null),/UNAUTHORIZED/);
});
test('customer job DTO never exposes internal lease, worker or storage credentials',()=>{
  const job=publicJob({id:crypto.randomUUID(),status:'running',lease_token:'secret',worker_id:'secret',result_path:'private'});
  assert.equal(job.lease_token,undefined); assert.equal(job.worker_id,undefined); assert.equal(job.result_path,undefined);
});
