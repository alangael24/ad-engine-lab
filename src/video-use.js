import {authContext,readJson,rpc,UUID} from './generations.js';
import {json} from './backend.js';
import {own,signed,studioError} from './studio.js';
const errors={VIDEO_EDIT_OFFLINE:[503,'El editor está temporalmente sin conexión.'],VIDEO_EDIT_BUSY:[409,'Tu edición sigue en curso.'],VIDEO_EDIT_LIMIT:[429,'Alcanzaste el límite de ediciones de esta prueba.'],VIDEO_EDIT_INVALID:[400,'Revisa el material y la petición.'],VIDEO_EDIT_APPROVAL:[409,'Revisa la propuesta antes de editar.']};
export function videoEditError(e){const c=Object.keys(errors).find(k=>k===e.code||k===e.message);return c?json({code:c,error:errors[c][1]},errors[c][0]):studioError(e);}
export async function getVideoEdit(context){try{
 const {db,user}=await authContext(context),id=new URL(context.request.url).searchParams.get('session');
 const workers=await db.from('video_edit_workers').select('id').gt('last_seen_at',new Date(Date.now()-90000).toISOString()).limit(1);
 const enabled=context.env.VIDEO_USE_ENABLED==='true'&&!workers.error&&workers.data?.length>0;
 if(!id){const rows=await db.from('video_edit_sessions').select('id,status,created_at').eq('user_id',user.id).order('created_at',{ascending:false}).limit(30);if(rows.error)throw rows.error;return json({enabled,sessions:rows.data});}
 const s=await own(db,'video_edit_sessions',user.id,id);
 const url=s.result?.jobId?await signed(db,'studio-media',`${user.id}/video-edit/${s.result.jobId}.mp4`):null;
 return json({enabled,session:{id:s.id,revision:s.revision,status:s.status,history:s.history,strategy:s.strategy,outputId:s.result?.jobId||null,url}});
}catch(e){return videoEditError(e);}}
export async function postVideoEdit(context){try{
 const {db,user}=await authContext(context),b=await readJson(context.request,10000);
 if(context.env.VIDEO_USE_ENABLED!=='true')throw Error('VIDEO_EDIT_OFFLINE');
 if(!UUID.test(b.requestId||'')||!UUID.test(b.sessionId||'')||!['create','message','approve'].includes(b.action)||typeof b.message!=='string'||b.message.length>3000)throw Error('VIDEO_EDIT_INVALID');
 if(b.action==='create'&&(!Array.isArray(b.sources)||b.sources.length>8||!b.sources.length||b.sources.some(s=>!UUID.test(s.id||'')||typeof s.reference!=='boolean')))throw Error('VIDEO_EDIT_INVALID');
 if(b.action!=='create'&&(!Number.isInteger(b.expected)||b.expected<1))throw Error('VIDEO_EDIT_INVALID');
 const data={sessionId:b.sessionId,message:b.message,...(b.action==='create'?{sources:b.sources.map(s=>({id:s.id,reference:s.reference}))}:{expected:b.expected}),action:b.action};
 return json(await rpc(db,'video_edit_write',{p_user:user.id,p_action:b.action,p_id:b.requestId,p_data:data}),202);
}catch(e){return videoEditError(e);}}
