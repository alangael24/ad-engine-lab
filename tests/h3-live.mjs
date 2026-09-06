// Opt-in real GPU integration test. Isolated database/storage; no customer balances.
import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {database,user,balance} from './helpers/database.mjs';
import {mockSupabase} from './helpers/supabase-http.mjs';
import * as refs from '../functions/api/references.js';
import * as jobs from '../functions/api/generations/index.js';
import * as item from '../functions/api/generations/[id].js';
import * as worker from '../functions/api/worker.js';
import {H3Adapter} from '../workers/h3-adapter.mjs';
import {processJob} from '../workers/h3-worker.mjs';
if(!process.env.H3_LIVE_URL||!process.env.H3_TEST_IMAGE||!process.env.H3_TEST_OUTPUT)throw Error('Explicit H3 live test configuration required');
const out=resolve(process.env.H3_TEST_OUTPUT);await mkdir(out,{recursive:true});
try{await access(out+'/started.json');throw Error('Test already started; inspect saved job before restarting');}catch(e){if(e.code!=='ENOENT')throw e;}
const db=await database(),stub=mockSupabase(db),network=globalThis.fetch;
globalThis.fetch=async(input,opts)=>{
 const req=new Request(input,opts),url=new URL(req.url);
 if(url.origin!=='http://supabase.test')return network(req);
 const sign='/storage/v1/object/sign/',upload='/storage/v1/object/upload/sign/',object='/storage/v1/object/';
 if(req.method==='GET'&&url.pathname.startsWith(sign)){
  const m=stub.media.get(url.pathname.slice(sign.length));return new Response(m?.bytes||null,{status:m?200:404,headers:{'content-type':m?.contentType||'application/octet-stream'}});
 }
 const isUpload=req.method==='PUT'&&url.pathname.startsWith(upload)||req.method==='POST'&&url.pathname.startsWith(object)&&!url.pathname.startsWith(sign)&&!url.pathname.startsWith(upload);
 const bytes=isUpload?Buffer.from(await req.clone().arrayBuffer()):null;
 const r=await stub.fetch(req);
 if(bytes){const key=url.pathname.slice(url.pathname.startsWith(upload)?upload.length:object.length);stub.media.get(key).bytes=bytes;}
 return r;
};
const env={SUPABASE_URL:'http://supabase.test',SUPABASE_SERVICE_ROLE_KEY:'test-server-key',GENERATION_ENABLED:'true',GENERATION_WORKER_TOKEN:'isolated-h3-test-only-worker-1234567890'};
const u=await user(db);stub.users.set('h3-tester',u);
function ctx(body,token='h3-tester'){return {env,request:new Request('https://app.test/api/generations',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body)})};}
const api=async(action,body={})=>{const r=await worker.onRequestPost(ctx({action,workerId:'real-h3-isolated',...body},env.GENERATION_WORKER_TOKEN));const d=await r.json();if(!r.ok)throw Object.assign(Error(d.code),{code:d.code});return d;};
const h3=new H3Adapter(process.env.H3_LIVE_URL);await h3.ready();await api('claim');
const refResponse=await refs.onRequestPost({env,request:new Request('https://app.test/api/references',{method:'POST',headers:{authorization:'Bearer h3-tester','content-type':'image/png'},body:await readFile(process.env.H3_TEST_IMAGE)})});
assert.equal(refResponse.status,201);const {referenceId}=await refResponse.json();
const requestId=crypto.randomUUID();const body={requestId,referenceId,prompt:'[Shot 1] Animate the supplied chrome showerhead as one continuous shot. Gentle camera push in, natural fine water streams flowing down. Preserve the complete tall cylinder, circular disc and wall connection. Rigid product, no new objects, no people, no text, no changing parts. No speech or music.',durationSeconds:5,resolution:'720p',aspectRatio:'9:16'};
const r=await jobs.onRequestPost(ctx(body));assert.equal(r.status,202);const {job}=await r.json();const claimed=(await api('claim')).job;
await writeFile(out+'/started.json',JSON.stringify({jobId:job.id,started:new Date().toISOString(),configuration:body},null,2));
const start=Date.now();await processJob(claimed,api,h3);
const status=(await db.query('select status,provider_prompt_id from generation_jobs where id=$1',[job.id])).rows[0];assert.equal(status.status,'succeeded');
const finished=await item.onRequestGet({env,params:{id:job.id},request:new Request('https://app.test/api/generations/'+job.id,{headers:{authorization:'Bearer h3-tester'}})});
const payload=await finished.json();const video=await fetch(payload.resultUrl);assert.equal(video.status,200);await writeFile(out+'/h3-tool-test.mp4',Buffer.from(await video.arrayBuffer()));
assert.equal(await balance(db,u),11);assert.equal((await jobs.onRequestPost(ctx(body))).status,202);assert.equal(await balance(db,u),11);
await writeFile(out+'/result.json',JSON.stringify({jobId:job.id,status:status.status,promptId:status.provider_prompt_id,seconds:(Date.now()-start)/1000,balanceBefore:12,balanceAfter:11,duplicateRequestChargedAgain:false,environment:'isolated DB/storage; real H3 GPU'},null,2));
console.log('H3 live integration passed',out);globalThis.fetch=network;await db.close();
