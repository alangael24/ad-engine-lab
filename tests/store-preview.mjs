// Local-only integration fixture: isolated DB/Auth, optional real providers supplied by env.
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {database,user,call} from './helpers/database.mjs';
import {mockSupabase} from './helpers/supabase-http.mjs';
import {postStoreImport} from '../src/store-import.js';
import {getStudio,postStudio} from '../src/studio.js';
import {getReferenceAnalysis,postReferenceAnalysis} from '../src/reference-analysis.js';
const taskRoot=process.env.REFERENCE_FIXTURE_ROOT;if(!taskRoot)throw Error('REFERENCE_FIXTURE_ROOT required');
const root=resolve(import.meta.dirname,'..'),db=await database(),owner=await user(db),stub=mockSupabase(db),realFetch=globalThis.fetch;
stub.users.set('reference-test',owner);
const live=process.env.REFERENCE_LIVE_TEST==='true';
globalThis.fetch=async(input,opts)=>{const url=typeof input==='string'?input:input.url;if(url.startsWith('http://supabase.test/'))return stub.fetch(input,opts);if(process.env.STORE_LIVE_TEST==='true'&&url.startsWith('https://'))return realFetch(input,opts);if(live&&(url.startsWith('https://opencode.ai/zen/go/v1/')||url==='https://api.elevenlabs.io/v1/speech-to-text'))return realFetch(input,opts);throw Error('Unexpected fixture network request');};
const env={SUPABASE_URL:'http://supabase.test',SUPABASE_SERVICE_ROLE_KEY:'local-only-fixture',GENERATION_ENABLED:'false',REFERENCE_ANALYSIS_ENABLED:'true',REFERENCE_FLASH_KEY:process.env.REFERENCE_FLASH_KEY,REFERENCE_SCRIBE_KEY:process.env.REFERENCE_SCRIBE_KEY};
const brandId=crypto.randomUUID();await call(db,'studio_write',[owner.id,'save_brand',brandId,JSON.stringify({name:'Nebula',product:'Filtro de ducha',appearance:'Cromo, cilindro alto sobre disco redondo',claims:'Diseñado para ayudar a reducir el cloro libre.',avoid:'No prometer regenerar cabello.',voiceName:'Voz de anuncios'})]);
const project=await call(db,'studio_write',[owner.id,'create_project',crypto.randomUUID(),JSON.stringify({title:'Nebula · Prueba de referencia',brandId,referenceUrl:'',referenceNotes:'Dirección anterior',aspectRatio:'9:16',scenes:[],narrationAssetId:null,timingConfirmed:false})]);
const dir=resolve(taskRoot,'work/flash-integration/live');await mkdir(dir,{recursive:true});
const sdk=`export function createClient(){return {auth:{getSession:async()=>({data:{session:{access_token:'reference-test'}}}),signOut:async()=>({})}}}`;
const origin='http://127.0.0.1:4198';
createServer(async(req,res)=>{try{const url=new URL(req.url,origin);let response;
 if(url.pathname==='/__test__/sdk.js')response=new Response(sdk,{headers:{'content-type':'text/javascript'}});
 else if(url.pathname==='/__test__/info')response=Response.json({projectId:project.id});
 else if(url.pathname==='/api/public-config')response=Response.json({enabled:true,supabaseUrl:'http://supabase.test',supabasePublishableKey:'fixture'});
 else if(['/api/studio','/api/reference-analysis','/api/store-import'].includes(url.pathname)){
  const chunks=[];for await(const c of req)chunks.push(c);const body=Buffer.concat(chunks);
  const request=new Request(url,{method:req.method,headers:req.headers,...(req.method==='POST'?{body}:{})});
  const context={env,request};response=await(url.pathname==='/api/store-import'?postStoreImport(context):url.pathname==='/api/studio'?(req.method==='GET'?getStudio(context):postStudio(context)):(req.method==='GET'?getReferenceAnalysis(context):postReferenceAnalysis(context)));
  if(url.pathname==='/api/reference-analysis'&&req.method==='POST'){const input=JSON.parse(body.toString());await writeFile(resolve(dir,(input.action==='adopt'?'adopt':input.source.sha256)+'.json'),await response.clone().text());}
 }else{
  const path=resolve(root,'.'+url.pathname+(url.pathname.endsWith('/')?'index.html':''));
  if(!path.startsWith(root+'/assets/')&&!path.startsWith(root+'/estudio/')){response=new Response('Not found',{status:404});}
  else{let bytes=await readFile(path);if(url.pathname==='/assets/auth-client.js')bytes=Buffer.from(bytes.toString().replace('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.4/+esm','/__test__/sdk.js'));response=new Response(bytes,{headers:{'content-type':{'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'}[extname(path)]||'application/octet-stream'}});}
 }
 res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
}catch(e){console.error('reference_fixture_error',e.code||e.name);res.writeHead(500);res.end('{}');}}).listen(4198,'127.0.0.1',()=>console.log(origin+'/estudio/?project='+project.id));
