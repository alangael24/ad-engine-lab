// Local-only interaction fixture. No external providers, auth or purchases.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
const root=resolve(import.meta.dirname,'..'),brands=[],projects=[],edits=[],events=[];
const json=(res,data,code=200)=>{res.writeHead(code,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(data));};
const product=(name,url)=>({name,brand:name,description:'Producto de prueba.',url,images:[]});
createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://127.0.0.1:4215');let raw='';for await(const chunk of req)raw+=chunk;const body=raw?JSON.parse(raw):{};
 if(url.pathname==='/__stats')return json(res,{brands,projects,edits,events});
 if(url.pathname==='/assets/auth-client.js'){res.writeHead(200,{'content-type':'text/javascript','cache-control':'no-store'});return res.end(`export async function getAuthClient(){return {auth:{signOut:async()=>{}}}};export async function apiRequest(path,options={}){const r=await fetch(path,{method:options.method||'GET',headers:{'content-type':'application/json'},...(options.body?{body:JSON.stringify(options.body)}:{})});const d=await r.json();if(!r.ok)throw Error(d.error);return d;}`);}
 if(url.pathname==='/api/store-import'){
  events.push({action:'inspect',url:body.url});
  return json(res,{products:body.url.includes('/catalog')?[product('Producto A','https://tienda.example/products/a'),product('Producto B','https://tienda.example/products/b')]:[product('Nebula de prueba',body.url)]});
 }
 if(url.pathname==='/api/studio'){
  if(req.method==='POST'){
   events.push({action:body.action,id:body.id});let value;
   if(body.action==='save_brand'){value=brands.find(b=>b.id===body.id);if(!value){value={id:body.id,revision:1,data:body.data};brands.push(value);}}
   if(body.action==='create_project'){value=projects.find(p=>p.id===body.id);if(!value){value={id:body.id,title:body.data.title,revision:1,data:body.data,brand_snapshot:brands.find(b=>b.id===body.data.brandId).data};projects.push(value);}}
   return json(res,{value});
  }
  if(url.searchParams.has('project'))return json(res,{project:projects.find(p=>p.id===url.searchParams.get('project')),versions:[],renders:[],availability:{}});
  return json(res,{brands,projects,assets:[],availability:{},balance:{video_credits:0},email:'prueba@example.test'});
 }
 if(url.pathname==='/api/studio-chat'){
  if(req.method==='POST'){const edit={id:body.requestId,projectId:body.projectId,message:body.message,status:'succeeded',result:{operation:'chat',message:'Listo. Conservo tu idea y el producto elegido.'}};edits.push(edit);return json(res,{edit});}
  return json(res,{enabled:true,edits:edits.filter(e=>e.projectId===url.searchParams.get('project'))});
 }
 if(url.pathname==='/api/reference-analysis')return json(res,{enabled:false,analyses:[]});
 if(url.pathname==='/api/studio-production')return json(res,{enabled:false,productions:[]});
 const file=resolve(root,'.'+url.pathname+(url.pathname.endsWith('/')?'index.html':''));if(!file.startsWith(root+'/'))return json(res,{},403);
 const bytes=await readFile(file);res.writeHead(200,{'content-type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[extname(file)]||'application/octet-stream','cache-control':'no-store'});res.end(bytes);
}catch(e){console.error(e.message);json(res,{error:e.message},500);}}).listen(4215,'127.0.0.1',()=>console.log('Simple studio fixture: http://127.0.0.1:4215/estudio/'));
