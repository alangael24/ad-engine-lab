import {prepareSceneVideoPrompt,previousVideoRequest} from './h3-prompts.js';
import {json} from './backend.js';
import {authContext,readJson,readBounded,rpc,imageType,generationAvailability,ApiError,apiError,UUID} from './generations.js';
import {brandData,projectData,scenePrompt,fail} from '../assets/studio-model.js';
export const ERRORS={H3_PROMPT_OFFLINE:[503,'La dirección del clip no está disponible. Tu anuncio sigue guardado.'],H3_PROMPT_PROVIDER:[503,'No pudimos preparar esta toma. No se inició la generación.'],H3_PROMPT_INVALID:[422,'La dirección de esta toma necesita otro intento. No se inició la generación.'],STUDIO_INVALID:[400,'Revisa los campos del anuncio.'],STUDIO_NOT_FOUND:[404,'No encontramos ese elemento en tu cuenta.'],STUDIO_ASSET_NOT_FOUND:[404,'Ese archivo no pertenece a tu cuenta o no tiene el formato requerido.'],STUDIO_CONFLICT:[409,'Este anuncio cambió en otra ventana. Recarga antes de guardar para conservar ambas ediciones.'],STUDIO_TIMELINE:[400,'Las escenas deben seguirse sin huecos ni solapamientos, durar entre 0.5 y 15 segundos y sumar hasta 120 segundos.'],STUDIO_LONG_SCENE:[400,'Divide las frases largas para que cada escena dure hasta 15 segundos.'],STUDIO_STORAGE_LIMIT:[429,'Tu biblioteca alcanzó 200 archivos o 500 MB.'],STUDIO_LIMIT:[429,'Alcanzaste el límite de marcas, anuncios o versiones de esta prueba.'],STUDIO_CLIP_TOO_SHORT:[400,'El clip es más corto que la escena. Usa otro clip o ajusta sus tiempos.'],STUDIO_NOT_READY:[409,'Elige una versión terminada para cada escena.'],STUDIO_NARRATION_REQUIRED:[400,'Sube la narración completa del anuncio.'],STUDIO_AUDIO_TIMING:[400,'La duración del anuncio debe coincidir con la narración, con hasta 0.75 s de margen.'],STUDIO_WORKER_OFFLINE:[503,'El montaje no está disponible ahora. Tu anuncio quedó guardado.'],STUDIO_RENDER_BUSY:[429,'Ya tienes dos montajes pendientes. Espera a que termine uno.'],STUDIO_UPLOAD:[400,'Usa imagen JPG/PNG/WebP de hasta 6 MB, voz WAV/MP3 de hasta 20 MB o clip MP4 de hasta 50 MB.']};
export function studioError(error){const code=Object.keys(ERRORS).find(c=>c===error?.code||c===error?.message);return code?json({error:ERRORS[code][1],code},ERRORS[code][0]):apiError(error);}
export async function own(db,table,userId,id){if(!UUID.test(id||''))fail('STUDIO_NOT_FOUND');const {data,error}=await db.from(table).select('*').eq('id',id).eq('user_id',userId).maybeSingle();if(error)throw error;if(!data)fail('STUDIO_NOT_FOUND');return data;}
export async function signed(db,bucket,path,download=false){const {data,error}=await db.storage.from(bucket).createSignedUrl(path,900,download?{download:true}:{});if(error)throw error;return data.signedUrl;}
export async function studioAvailability(db,env){const r=await db.from('studio_workers').select('id').gt('last_seen_at',new Date(Date.now()-90000).toISOString()).limit(1);return {generation:await generationAvailability(db,env),assembly:!r.error&&r.data?.length>0,voiceSynthesis:false};}
export async function uploadAsset(context,db,user,url){
 const kind=url.searchParams.get('kind'),name=decodeURIComponent(context.request.headers.get('x-file-name')||'Archivo').slice(0,180);
 if(!['image','voice','narration','clip'].includes(kind))fail('STUDIO_UPLOAD');
 const max=kind==='image'?6291456:kind==='clip'?52428800:20971520;
 const bytes=await readBounded(context.request,max);let mime,ext;const text=new TextDecoder();
 if(kind==='image'){[mime,ext]=imageType(bytes);}else if(kind==='clip'){
  if(text.decode(bytes.slice(4,8))!=='ftyp')fail('STUDIO_UPLOAD');mime='video/mp4';ext='mp4';
 }else if(text.decode(bytes.slice(0,4))==='RIFF'&&text.decode(bytes.slice(8,12))==='WAVE'){mime='audio/wav';ext='wav';}
 else if(text.decode(bytes.slice(0,3))==='ID3'||(bytes[0]===255&&(bytes[1]&224)===224)){mime='audio/mpeg';ext='mp3';}else fail('STUDIO_UPLOAD');
 const duration=kind==='image'?null:Number(context.request.headers.get('x-duration'));
 if(kind!=='image'&&(!Number.isFinite(duration)||duration<=0||duration>180))fail('STUDIO_UPLOAD');
 const id=crypto.randomUUID(),bucket=kind==='image'?'generation-references':'studio-media',path=`${user.id}/${id}.${ext}`;
 const up=await db.storage.from(bucket).upload(path,bytes,{contentType:mime,upsert:false});if(up.error)throw up.error;
 try{return await rpc(db,'studio_write',{p_user_id:user.id,p_action:'register_asset',p_id:id,p_data:{kind,name,bucket,storage_path:path,mime_type:mime,size_bytes:bytes.length,duration_seconds:duration}});}
 catch(error){await db.storage.from(bucket).remove([path]);throw error;}
}
export async function getStudio(context){try{
 const {db,user}=await authContext(context),url=new URL(context.request.url);
 if(url.searchParams.has('asset')){const a=await own(db,'studio_assets',user.id,url.searchParams.get('asset'));return json({url:await signed(db,a.bucket,a.storage_path)});}
 if(url.searchParams.has('version')){const v=await own(db,'studio_scene_versions',user.id,url.searchParams.get('version'));if(v.asset_id){const a=await own(db,'studio_assets',user.id,v.asset_id);return json({url:await signed(db,a.bucket,a.storage_path)});}const j=await own(db,'generation_jobs',user.id,v.job_id);if(j.status!=='succeeded')fail('STUDIO_NOT_READY');return json({url:await signed(db,'generation-results',j.result_path)});}
 if(url.searchParams.has('render')){const r=await own(db,'studio_renders',user.id,url.searchParams.get('render'));if(r.status!=='succeeded'||r.quality_status&&r.quality_status!=='passed')fail('STUDIO_NOT_READY');return json({url:await signed(db,'studio-media',r.result_path,url.searchParams.has('download'))});}
 const project=url.searchParams.get('project');if(project&&!UUID.test(project))fail('STUDIO_NOT_FOUND');
 const data=await rpc(db,'studio_read',{p_user_id:user.id,p_project_id:project||null});
 for(const r of data.renders||[])if(r.quality_status&&r.quality_status!=='passed')r.status=r.quality_status==='rejected'?'quality_failed':'reviewing';
 const [availability,balance]=await Promise.all([studioAvailability(db,context.env),db.from('credit_balances').select('video_credits,image_credits').eq('user_id',user.id).maybeSingle()]);
 if(balance.error)throw balance.error;
 return json({...data,availability,balance:balance.data||{video_credits:0,image_credits:0},email:user.email});
 }catch(error){return studioError(error);}}
export async function postStudio(context){try{
 const {db,user}=await authContext(context),url=new URL(context.request.url);
 if(url.searchParams.get('upload')==='1')return json({asset:await uploadAsset(context,db,user,url)},201);
 const body=await readJson(context.request,64000);if(!UUID.test(body.id||''))fail();
 let data=body.data||{};
 if(body.action==='save_brand')data=brandData(data);
 else if(['create_project','save_project'].includes(body.action)){
  data=projectData(data);if(body.action==='create_project'&&(data.scenes.length||data.narrationAssetId||data.referenceAnalysisId))fail();
  if(data.referenceAnalysisId){const a=await own(db,'studio_reference_analyses',user.id,data.referenceAnalysisId);if(a.project_id!==body.id||a.status!=='succeeded'||!a.adopted_at)fail('STUDIO_NOT_FOUND');}
 }else if(body.action==='version'){
  if(!UUID.test(data.requestId||'')||!UUID.test(data.sceneId||'')||(data.assetId&&!UUID.test(data.assetId))||typeof data.instruction!=='string'||data.instruction.length>180)fail();
  // A lost response may be retried after the ad changes: use its immutable original context.
  const previous=await previousVideoRequest(db,user.id,body.id,data);
  if(previous)data=previous;
  else{
   if(!data.assetId&&!await generationAvailability(db,context.env))throw new ApiError('WORKER_OFFLINE');
   const p=await own(db,'studio_projects',user.id,body.id);
   if(body.expected!==p.revision)fail('STUDIO_CONFLICT');
   const prompt=data.assetId?scenePrompt(p,data.sceneId,data.instruction):await prepareSceneVideoPrompt(db,user.id,p,data.sceneId,data.instruction,context.env);
   data={requestId:data.requestId,sceneId:data.sceneId,assetId:data.assetId||null,instruction:data.instruction,prompt};
  }
 }else if(body.action==='select_version'){if(!UUID.test(data.versionId||''))fail();data={versionId:data.versionId};}
 else if(body.action==='render'){
  if(!UUID.test(data.requestId||''))fail();const p=await own(db,'studio_projects',user.id,body.id);if(!p.data.timingConfirmed)fail('STUDIO_AUDIO_TIMING');data={requestId:data.requestId};
 }else if(body.action==='refresh_brand')data={};else fail();
 if(body.expected!=null&&(!Number.isInteger(body.expected)||body.expected<1))fail();
 const value=await rpc(db,'studio_write',{p_user_id:user.id,p_action:body.action,p_id:body.id,p_data:data,p_expected:body.expected??null});
 return json({value},['version','render'].includes(body.action)?202:200);
 }catch(error){return studioError(error);}}
