// Local-only E2E: real Flash, existing media, isolated Auth/Postgres/Storage.
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join,extname} from 'node:path';
import {database} from './helpers/database.mjs';
import {mockSupabase} from './helpers/supabase-http.mjs';
import {nebulaProduction} from './helpers/nebula-production.mjs';
import {getStudio,postStudio} from '../src/studio.js';
import {getStudioChat,postStudioChat} from '../src/studio-chat.js';
import {getProduction,postProduction} from '../src/studio-production.js';
import {onRequestPost as productionEndpoint} from '../functions/api/studio-production-worker.js';
import {onRequestPost as renderEndpoint} from '../functions/api/studio-worker.js';
import {processProduction,productionApi} from '../workers/production-worker.mjs';
import {processRender,studioApi} from '../workers/studio-worker.mjs';
const fixtureRoot=process.env.STUDIO_FIXTURE_ROOT;if(!fixtureRoot)throw Error('STUDIO_FIXTURE_ROOT required');
const root=resolve(import.meta.dirname,'..'),output=process.env.STUDIO_PREVIEW_OUTPUT||join(fixtureRoot,'outputs/production-flow'),db=await database(),stub=mockSupabase(db),network=globalThis.fetch;
const port=Number(process.env.STUDIO_PREVIEW_PORT||4207),origin=`http://127.0.0.1:${port}`,env={SUPABASE_URL:'http://supabase.test',SUPABASE_SERVICE_ROLE_KEY:'test-only',GENERATION_ENABLED:'false',PRODUCTION_ENABLED:'true',REFERENCE_ANALYSIS_ENABLED:'true',PRODUCTION_WORKER_TOKEN:'fixture-production-worker-only-1234567890',STUDIO_WORKER_TOKEN:'fixture-render-worker-only-1234567890',REFERENCE_FLASH_KEY:execFileSync('security',['find-generic-password','-s','codex-opencode-api-key','-w'],{encoding:'utf8'}).trim()};
const f=await nebulaProduction(db,stub,fixtureRoot,env,network);stub.users.set('fixture-only',f.owner);await mkdir(output,{recursive:true});
globalThis.fetch=(input,options)=>String(input instanceof Request?input.url:input).startsWith('http://supabase.test')?stub.fetch(input,options):network(input,options);
const sdk=`export function createClient(){return {auth:{getSession:async()=>({data:{session:{access_token:'fixture-only',user:{id:'${f.owner.id}',email:'nebula@example.test'}}}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),signOut:async()=>({error:null})}}}`;
function bytes(req,res,data,mime){const match=req.headers.range?.match(/bytes=(\d+)-(\d*)/);if(match){const start=Number(match[1]),end=match[2]?Math.min(Number(match[2]),data.length-1):data.length-1;res.writeHead(206,{'content-type':mime,'content-range':`bytes ${start}-${end}/${data.length}`,'content-length':end-start+1});return res.end(data.subarray(start,end+1));}res.writeHead(200,{'content-type':mime,'content-length':data.length,'cache-control':'no-store'});res.end(data);}
const server=createServer(async(req,res)=>{try{
 const u=new URL(req.url,origin),json=(d,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(d).replaceAll('http://supabase.test/storage/v1',origin+'/__storage'));};
 if(u.pathname==='/__test__/info')return json({projectId:f.project.id,planCalls:f.planCalls()});
 if(u.pathname==='/__test__/sdk.js')return bytes(req,res,Buffer.from(sdk),'text/javascript');
 if(u.pathname==='/api/public-config')return json({enabled:true,supabaseUrl:'http://supabase.test',supabasePublishableKey:'fixture-only'});
 if(u.pathname.startsWith('/__storage/')){
  const upload=u.pathname.startsWith('/__storage/object/upload/sign/'),key=u.pathname.slice(upload?'/__storage/object/upload/sign/'.length:'/__storage/object/sign/'.length);
  if(upload&&req.method==='PUT'){const chunks=[];for await(const c of req)chunks.push(c);const data=Buffer.concat(chunks);stub.media.set(key,{size:data.length,contentType:'video/mp4',bytes:data});await writeFile(join(output,key.split('/').at(-1)),data);return json({ok:true});}
  const m=stub.media.get(key);if(!m)return json({},404);return bytes(req,res,m.bytes,m.contentType);
 }
 if(u.pathname==='/api/reference-analysis')return json({enabled:false,analyses:[]});
 const routes={'/api/studio':{GET:getStudio,POST:postStudio},'/api/studio-chat':{GET:getStudioChat,POST:postStudioChat},'/api/studio-production':{GET:getProduction,POST:postProduction},'/api/studio-production-worker':{POST:productionEndpoint},'/api/studio-worker':{POST:renderEndpoint}};
 if(routes[u.pathname]){const chunks=[];for await(const c of req)chunks.push(c);const request=new Request(u,{method:req.method,headers:req.headers,...(req.method==='POST'?{body:Buffer.concat(chunks)}:{})});const handler=routes[u.pathname][req.method];if(!handler)return json({},405);const r=await handler({request,env});if(r.headers.get('content-type')?.includes('text/event-stream')){res.writeHead(r.status,{'content-type':'text/event-stream','cache-control':'no-store'});for await(const chunk of r.body)res.write(chunk);return res.end();}return json(await r.json(),r.status);}
 const path=resolve(root,'.'+u.pathname+(u.pathname.endsWith('/')?'index.html':''));if(!path.startsWith(root+'/'))return json({},403);let data=await readFile(path);if(u.pathname==='/assets/auth-client.js')data=Buffer.from(data.toString().replace('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.4/+esm','/__test__/sdk.js'));
 return bytes(req,res,data,({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.jpg':'image/jpeg'})[extname(path)]||'application/octet-stream');
}catch(e){console.error('fixture_error',e.code||e.message);res.writeHead(500);res.end('{}');}});
await new Promise(r=>server.listen(port,'127.0.0.1',r));
const prod=productionApi({appUrl:origin,token:env.PRODUCTION_WORKER_TOKEN,workerId:'fixture-producer'}),render=studioApi({appUrl:origin,token:env.STUDIO_WORKER_TOKEN,workerId:'fixture-renderer'});
let producing=false,rendering=false;
setInterval(async()=>{if(producing)return;producing=true;try{const {job}=await prod('claim');if(job){const result=await processProduction(job,prod,f.providers,{pollMs:500});await writeFile(join(output,'pipeline-result.json'),JSON.stringify({jobId:job.id,...result,planCalls:f.planCalls()},null,2));const rows=await db.query('select status,stage,snapshot,steps,error_code from studio_productions where id=$1',[job.id]);await writeFile(join(output,'production.json'),JSON.stringify(rows.rows[0],null,2));console.log(JSON.stringify(result));}}catch(e){console.error('fixture_production_error',e.code||e.message);}finally{producing=false;}},1000);
setInterval(async()=>{if(rendering)return;rendering=true;try{const {job}=await render('claim');if(job)await processRender(job,render);}catch(e){console.error('fixture_render_error',e.code||e.message);}finally{rendering=false;}},1000);
console.log(`${origin}/estudio/?project=${f.project.id}`);
