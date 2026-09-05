// Private local test data is injected via an explicit path; never bundled/deployed.
import {readFile} from 'node:fs/promises';
import {join,extname} from 'node:path';
import {user,call} from './database.mjs';
import {probe} from '../../workers/studio-renderer.mjs';
import {callDirector} from '../../workers/production-providers.mjs';
import {alignmentFromWords,compact} from '../../assets/production-model.js';
export async function nebulaProduction(db,stub,root,env,fetchImpl=fetch){
 const owner=await user(db),write=(action,id,data,expected=null)=>call(db,'studio_write',[owner.id,action,id,JSON.stringify(data),expected]);
 const edit=join(root,'outputs/prueba-producto-nebula/edit'),work=join(root,'work/prueba-producto-nebula/edit');
 async function asset(kind,path){const bytes=await readFile(path),id=crypto.randomUUID(),bucket=kind==='image'?'generation-references':'studio-media',mime=kind==='image'?(extname(path)==='.png'?'image/png':'image/jpeg'):kind==='clip'?'video/mp4':'audio/wav',duration=kind==='image'?null:Number((await probe(path)).format.duration),key=`${owner.id}/${id}${extname(path)}`;
  stub.media.set(`${bucket}/${key}`,{size:bytes.length,contentType:mime,bytes});return write('register_asset',id,{kind,name:path.split('/').at(-1),bucket,storage_path:key,mime_type:mime,size_bytes:bytes.length,duration_seconds:duration});}
 const product=await asset('image',join(work,'references/nebula-producto-real.jpg')),voice=await asset('narration',join(edit,'audio/nebula-voz-clonada-v1.wav'));
 const transcript=JSON.parse(await readFile(join(work,'transcripts/nebula-voz-clonada-v1.json'),'utf8')),config=JSON.parse(await readFile(join(work,'production.json'),'utf8'));
 const script=transcript.text.trim(),anchors=['¿Todo','No siempre.','Si nos acercamos,','Y antes del','Por eso Nebula','El agua entra,','Su filtro está','Se instala','Tu champú','lo que cambias','Conoce Nebula'];
 const positions=anchors.map(t=>script.indexOf(t));if(positions.some((p,i)=>p<0||i>0&&p<=positions[i-1]))throw Error('Fixture transcript changed');
 const catalog=[];
 for(const [i,s] of config.scenes.entries()){
  const image=await asset('image',join(edit,'images',s.image+'.png'));
  const clip=await asset('clip',i===6?join(work,'assembly','07.mp4'):join(edit,'clips',String(i+1).padStart(2,'0')+'.mp4'));
  catalog.push({sourceKey:'media-'+String(i+1).padStart(2,'0'),text:script.slice(positions[i],positions[i+1]??script.length).trim(),visual:s.action+' '+s.camera,continuity:s.constraints,imageAssetId:image.id,clipAssetId:clip.id,duration:clip.duration_seconds});
 }
 const brand=await write('save_brand',crypto.randomUUID(),{name:'Nebula',product:'Regadera con filtro preinstalado antes del contacto del agua con el cabello.',appearance:'Cilindro cromado alto sobre disco redondo conectado al brazo de pared.',benefits:'Ayuda a reducir el cloro libre.',claims:'Diseñado para ayudar a reducir el cloro libre.',avoid:'No prometer detener caída ni regenerar cabello. Conservar todas las partes del producto.',productAssetId:product.id});
 const project=await write('create_project',crypto.randomUUID(),{title:'Nebula · Producción automática con material existente',brandId:brand.id,idea:'Quiero un anuncio explicativo como la referencia, con el producto consistente.',creative:{format:'explainer',look:'3d'},referenceUrl:'',referenceNotes:'CGI azul grisáceo. Ir de cabello y cutícula al agua y al filtro; finalizar con el producto.',aspectRatio:'9:16',scriptDraft:script,narrationAssetId:null,timingConfirmed:false,scenes:[]});
 const choose=s=>{const c=catalog.find(c=>c.sourceKey===s.sourceKey);if(!c||compact(c.text)!==compact(s.text))throw Error('PRODUCTION_PLAN');return c;};
 let planCalls=0;const providers={
  async ready(){},
  async plan(p){planCalls++;const result=await callDirector(p,env,{fetchImpl,catalog:[...catalog].reverse().map(({sourceKey,text,visual,continuity,duration})=>({sourceKey,text,visual,continuity,duration}))});for(const s of result.scenes)choose(s);return result;},
  async speech(p){if(compact(p.data.scriptDraft)!==compact(script))throw Error('PRODUCTION_TIMING');return {assetId:voice.id,duration:voice.duration_seconds,alignment:alignmentFromWords(transcript.words)};},
  async image({plan,index}){return {assetId:choose(plan.scenes[index]).imageAssetId};},
  async clip({scene}){return {assetId:choose(scene).clipAssetId};},
 };
 return {owner,project,providers,catalog,voice,script,planCalls:()=>planCalls};
}
