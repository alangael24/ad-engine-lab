// LOCAL-ONLY fixture: isolated PostgreSQL, fake Auth, real API and local media. Never deploy.
import {execFileSync} from 'node:child_process';
import {getStudioChat,postStudioChat} from '../src/studio-chat.js';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,extname,join} from 'node:path';
import {database,user,call} from './helpers/database.mjs';
import {mockSupabase} from './helpers/supabase-http.mjs';
import {getStudio,postStudio} from '../src/studio.js';
import {onRequestPost as worker} from '../functions/api/studio-worker.js';
import {probe} from '../workers/studio-renderer.mjs';
const root=resolve(import.meta.dirname,'../dist'),fixtureRoot=process.env.STUDIO_FIXTURE_ROOT;
if(!fixtureRoot)throw Error('STUDIO_FIXTURE_ROOT required; this is not a production server');
const port=4199,origin=`http://127.0.0.1:${port}`,db=await database(),owner=await user(db),stub=mockSupabase(db);stub.users.set('fixture-only',owner);const networkFetch=globalThis.fetch;globalThis.fetch=(url,options)=>String(url).includes('opencode.ai')?networkFetch(url,options):stub.fetch(url,options);
const env={SUPABASE_URL:'http://supabase.test',SUPABASE_SERVICE_ROLE_KEY:'local-fixture-not-real',GENERATION_ENABLED:'false',STUDIO_WORKER_TOKEN:'local-studio-render-fixture-only-1234567890'};
env.REFERENCE_ANALYSIS_ENABLED='true';env.REFERENCE_FLASH_KEY=execFileSync('security',['find-generic-password','-s','codex-opencode-api-key','-w'],{encoding:'utf8'}).trim();
const write=(action,id,data,expected=null)=>call(db,'studio_write',[owner.id,action,id,JSON.stringify(data),expected]);
async function asset(kind,path){const bytes=await readFile(path),id=crypto.randomUUID(),bucket=kind==='image'?'generation-references':'studio-media';const mime=kind==='image'?'image/jpeg':kind==='clip'?'video/mp4':'audio/wav',duration=kind==='image'?null:Number((await probe(path)).format.duration),key=`${owner.id}/${id}${extname(path)}`;
 stub.media.set(`${bucket}/${key}`,{size:bytes.length,contentType:mime,bytes});return write('register_asset',id,{kind,name:path.split('/').at(-1),bucket,storage_path:key,mime_type:mime,size_bytes:bytes.length,duration_seconds:duration});}
const edit=join(fixtureRoot,'outputs/prueba-producto-nebula/edit'),work=join(fixtureRoot,'work/prueba-producto-nebula/edit');
const photo=await asset('image',join(work,'references/nebula-producto-real.jpg')),voice=await asset('voice',join(edit,'audio/nebula-voz-clonada-v1.wav')),audio=await asset('narration',join(edit,'audio/nebula-voz-clonada-v1.wav'));
const b=await write('save_brand',crypto.randomUUID(),{name:'Nebula',product:'Filtro preinstalado en la regadera, antes del contacto del agua con el cabello.',appearance:'Cilindro cromado sobre regadera redonda. CGI científico azul grisáceo, fondo azul oscuro.',benefits:'Ayuda a reducir el cloro libre del agua de ducha.',claims:'Diseñado para ayudar a reducir el cloro libre.',avoid:'No prometer detener la caída ni regenerar cabello. Conservar la geometría real del producto.',voiceName:'Nebula · voz de anuncios',voiceNotes:'Masculina explicativa, español, ritmo natural.',productAssetId:photo.id,voiceAssetId:voice.id});
let p=await write('create_project',crypto.randomUUID(),{title:'Nebula · El agua antes del shampoo',brandId:b.id,referenceUrl:'https://www.tiktok.com/@curiosidadesn3t/video/7656995597454560545',referenceNotes:'Explicación microscópica, acercamiento al cabello y recorrido del agua; estilo azul grisáceo.',aspectRatio:'9:16',narrationAssetId:null,scenes:[]});
const config=JSON.parse(await readFile(join(work,'production.json'),'utf8'));
const phrases=['¿Todo el cabello que ves en el cepillo salió desde la raíz?','No siempre. Una hebra también puede quebrarse.','Si nos acercamos, su superficie está cubierta por pequeñas escamas: la cutícula.','Y antes del shampoo, esa superficie ya estuvo en contacto con el agua de tu ducha.','Por eso Nebula coloca el filtro antes del contacto.','El agua entra, atraviesa su filtro preinstalado y después sale por la regadera.','Su filtro está diseñado para ayudar a reducir el cloro libre.','Se instala directamente en tu ducha.','Tu shampoo sigue siendo el mismo.','Lo que cambias es por dónde pasa el agua.','Conoce Nebula.'];
const scenes=config.scenes.map((s,i)=>({id:crypto.randomUUID(),text:phrases[i],visual:s.action+' '+s.camera,start:s.start,end:s.end,imageAssetId:null,selectedVersionId:null}));
p=await write('save_project',p.id,{...p.data,narrationAssetId:audio.id,scenes,timingConfirmed:true},p.revision);
for(const [i,s] of scenes.entries()){const file=join(work,'assembly',`${String(i+1).padStart(2,'0')}.mp4`),clip=await asset('clip',file),v=await write('version',p.id,{sceneId:s.id,assetId:clip.id,requestId:crypto.randomUUID(),instruction:i===6?'Toma corregida: tramo limpio':'Clip aprobado de Nebula',prompt:'Imported approved video'},p.revision);p=await write('select_version',p.id,{versionId:v.id},p.revision);}
// Retained alternate for exercising a one-scene version change and restore.
const alt=await asset('clip',join(edit,'clips/07.mp4'));await write('version',p.id,{sceneId:scenes[6].id,assetId:alt.id,requestId:crypto.randomUUID(),instruction:'Versión previa, antes de corregir el fondo',prompt:'Imported previous version'},p.revision);
let signedIn=true;
const sdk=`export function createClient(){return {auth:{getSession:async()=>({data:{session:{access_token:'fixture-only',user:{id:'${owner.id}',email:'nebula@example.test'}}}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),signOut:async()=>({error:null})}}}`;
function sendBytes(req,res,bytes,mime){const match=req.headers.range?.match(/bytes=(\d+)-(\d*)/);if(match){const start=Number(match[1]),end=match[2]?Math.min(Number(match[2]),bytes.length-1):bytes.length-1;if(start> end){res.writeHead(416);return res.end();}res.writeHead(206,{'content-type':mime,'content-range':`bytes ${start}-${end}/${bytes.length}`,'accept-ranges':'bytes','content-length':end-start+1});return res.end(bytes.subarray(start,end+1));}res.writeHead(200,{'content-type':mime,'content-length':bytes.length,'accept-ranges':'bytes','cache-control':'no-store'});res.end(bytes);}
const server=createServer(async(req,res)=>{try{const url=new URL(req.url,origin),json=(data,status=200)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(data).replaceAll('http://supabase.test/storage/v1',origin+'/__storage'));};
 if(url.pathname==='/__test__/sdk.js'){res.writeHead(200,{'content-type':'text/javascript'});return res.end(sdk);}
 if(url.pathname==='/__test__/info')return json({projectId:p.id,ownerId:owner.id,brandId:b.id});
 if(url.pathname==='/api/public-config')return json({enabled:true,supabaseUrl:'http://supabase.test',supabasePublishableKey:'fixture-only'});
 if(url.pathname.startsWith('/__storage/')){
  const upload=url.pathname.startsWith('/__storage/object/upload/sign/'),key=url.pathname.slice(upload?'/__storage/object/upload/sign/'.length:'/__storage/object/sign/'.length);
  if(upload&&req.method==='PUT'){const chunks=[];for await(const c of req)chunks.push(c);const bytes=Buffer.concat(chunks);stub.media.set(key,{size:bytes.length,contentType:'video/mp4',bytes});await mkdir(join(fixtureRoot,'outputs/chat-editor/renders'),{recursive:true});await writeFile(join(fixtureRoot,'outputs/chat-editor/renders',key.split('/').at(-1)),bytes);return json({ok:true});}
  const m=stub.media.get(key);if(!m)return json({error:'Missing fixture media'},404);return sendBytes(req,res,m.bytes||Buffer.alloc(m.size),m.contentType);
 }
 if(url.pathname==='/api/reference-analysis')return json({enabled:false,analyses:[]});
 if(url.pathname==='/api/studio-chat'||url.pathname==='/api/studio'||url.pathname==='/api/studio-worker'){
  const chunks=[];for await(const c of req)chunks.push(c);const method=req.method,request=new Request(url,{method,headers:req.headers,...(!['GET','HEAD'].includes(method)?{body:Buffer.concat(chunks)}:{})});const context={env,request};
  const r=await(url.pathname==='/api/studio-chat'?(method==='GET'?getStudioChat(context):postStudioChat(context)):url.pathname==='/api/studio-worker'?worker(context):method==='GET'?getStudio(context):postStudio(context));return json(await r.json(),r.status);
 }
 const file=resolve(root,'.'+url.pathname+(url.pathname.endsWith('/')?'index.html':''));if(!file.startsWith(root+'/'))return json({},403);let content=await readFile(file);
 if(url.pathname==='/assets/auth-client.js')content=Buffer.from(content.toString().replace('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.4/+esm','/__test__/sdk.js'));
 return sendBytes(req,res,content,({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.mp4':'video/mp4'})[extname(file)]||'application/octet-stream');
 }catch(e){console.error('fixture_error',e.message);res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:'Fixture failure'}));}});
server.listen(port,'127.0.0.1',()=>console.log(`Local studio with private Nebula fixture: ${origin}/estudio/?project=${p.id}`));
