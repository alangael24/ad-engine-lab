// Local development only: real Flash/video-use, isolated test accounts/database/storage.
// Never deploy this authentication adapter.
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,extname,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {database,user,call} from './helpers/database.mjs';
import {mockSupabase} from './helpers/supabase-http.mjs';
import {getVideoEdit,postVideoEdit} from '../src/video-use.js';
import {getStudio,postStudio} from '../src/studio.js';
import {onRequestPost as workerRoute} from '../functions/api/video-edit-worker.js';
import {videoEditApi,processVideoEdit} from '../workers/video-use-worker.mjs';
const root=resolve(import.meta.dirname,'..'),port=Number(process.env.VIDEO_USE_PREVIEW_PORT||4240),origin=`http://127.0.0.1:${port}`,output=process.env.VIDEO_USE_PREVIEW_OUTPUT;
if(!output)throw Error('Set VIDEO_USE_PREVIEW_OUTPUT outside the repository');await mkdir(output,{recursive:true});
const db=await database();await db.exec(await readFile(resolve(root,'supabase/migrations/20260905202655_video_use_editor.sql'),'utf8'));const stub=mockSupabase(db),owner=await user(db,0,0),network=globalThis.fetch;
stub.users.set('fixture-only',owner);
const env={SUPABASE_URL:'http://supabase.test',SUPABASE_SERVICE_ROLE_KEY:'fixture-only',VIDEO_USE_ENABLED:'true',VIDEO_USE_WORKER_TOKEN:'fixture-video-use-worker-no-production-access',VIDEO_USE_WORKDIR:output,REFERENCE_FLASH_KEY:execFileSync('security',['find-generic-password','-s','codex-opencode-api-key','-w'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim()};
const secretFile=process.env.VIDEO_USE_SCRIBE_ENV;
if(secretFile){const content=await readFile(secretFile,'utf8');env.ELEVENLABS_API_KEY=content.split('\n').find(l=>l.startsWith('ELEVENLABS_API_KEY='))?.split('=').slice(1).join('=').trim().replace(/^['"]|['"]$/g,'');}
globalThis.fetch=async(input,opts={})=>{
 const request=input instanceof Request?input:new Request(input,opts);if(!request.url.startsWith('http://supabase.test'))return network(input,opts);
 if(request.url.includes('/storage/v1/object/')&&request.method==='POST'&&!request.url.includes('/sign/')){
  const bytes=Buffer.from(await request.clone().arrayBuffer()),response=await stub.fetch(request);const key=new URL(request.url).pathname.slice('/storage/v1/object/'.length);const m=stub.media.get(key);if(m)m.bytes=bytes;return response;
 }
 return stub.fetch(input,opts);
};
const sdk=`export function createClient(){return {auth:{getSession:async()=>({data:{session:{access_token:'fixture-only',user:{id:'${owner.id}',email:'editor@example.test'}}}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}}}`;
let sourceId=null;if(process.env.VIDEO_USE_TEST_SOURCE){const bytes=await readFile(process.env.VIDEO_USE_TEST_SOURCE);sourceId=crypto.randomUUID();const path=owner.id+'/source.mp4';await call(db,'studio_write',[owner.id,'register_asset',sourceId,{kind:'clip',name:'Material de prueba',bucket:'studio-media',storage_path:path,mime_type:'video/mp4',size_bytes:bytes.length,duration_seconds:5.167},null]);stub.media.set('studio-media/'+path,{size:bytes.length,contentType:'video/mp4',bytes});}
function bytes(req,res,data,type){const match=req.headers.range?.match(/bytes=(\d+)-(\d*)/);if(match){const start=Number(match[1]),end=match[2]?Math.min(Number(match[2]),data.length-1):data.length-1;res.writeHead(206,{'content-type':type,'content-range':`bytes ${start}-${end}/${data.length}`,'content-length':end-start+1});res.end(data.subarray(start,end+1));}else{res.writeHead(200,{'content-type':type,'cache-control':'no-store'});res.end(data);}}
const server=createServer(async(req,res)=>{try{
 const u=new URL(req.url,origin),json=(d,status=200)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(d).replaceAll('http://supabase.test/storage/v1',origin+'/__storage'));};
 if(u.pathname==='/__test__/info')return json({sourceId});
 if(u.pathname==='/__test__/sdk.js')return bytes(req,res,Buffer.from(sdk),'text/javascript');
 if(u.pathname==='/api/public-config')return json({enabled:true,supabaseUrl:'http://supabase.test',supabasePublishableKey:'fixture-only'});
 if(u.pathname.startsWith('/__storage/')){
  const upload=u.pathname.startsWith('/__storage/object/upload/sign/'),key=u.pathname.slice(upload?'/__storage/object/upload/sign/'.length:'/__storage/object/sign/'.length);
  if(upload&&req.method==='PUT'){const chunks=[];for await(const c of req)chunks.push(c);const data=Buffer.concat(chunks);stub.media.set(key,{bytes:data,size:data.length,contentType:'video/mp4'});return json({ok:true});}
  const m=stub.media.get(key);return m?bytes(req,res,m.bytes,m.contentType):json({},404);
 }
 const routes={'/api/video-edit':{GET:getVideoEdit,POST:postVideoEdit},'/api/video-edit-worker':{POST:workerRoute},'/api/studio':{GET:getStudio,POST:postStudio}};
 if(routes[u.pathname]){const chunks=[];for await(const c of req)chunks.push(c);const handler=routes[u.pathname][req.method];if(!handler)return json({},405);const r=await handler({env,request:new Request(u,{method:req.method,headers:req.headers,...(req.method==='POST'?{body:Buffer.concat(chunks)}:{})})});return json(await r.json(),r.status);}
 const p=resolve(root,'.'+u.pathname+(u.pathname.endsWith('/')?'index.html':''));if(!p.startsWith(root+'/')||!['/editor/','/productos/','/assets/'].some(prefix=>u.pathname.startsWith(prefix)))return json({},404);
 let data=await readFile(p);if(u.pathname==='/assets/auth-client.js')data=Buffer.from(data.toString().replace('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.4/+esm','/__test__/sdk.js'));
 return bytes(req,res,data,({'.html':'text/html','.js':'text/javascript','.css':'text/css'})[extname(p)]||'application/octet-stream');
}catch(e){console.error('preview_error',e.message);res.writeHead(500);res.end('{}');}});
await new Promise(r=>server.listen(port,'127.0.0.1',r));const api=videoEditApi({appUrl:origin,token:env.VIDEO_USE_WORKER_TOKEN,workerId:'preview-worker'});let working=false;
setInterval(async()=>{if(working)return;working=true;try{const {job}=await api('claim');if(job){const result=await processVideoEdit(job,api,{env,sandboxOptions:{python:process.env.VIDEO_USE_PYTHON}});await writeFile(join(output,job.id+'.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({job:job.id,status:result.status,error:result.error,usage:result.usage}));}}catch(e){console.error('preview_worker_error',e.message);}finally{working=false;}},1000);
console.log(origin+'/editor/');
