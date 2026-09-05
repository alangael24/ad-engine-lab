import {json} from './backend.js';
import {authContext,readJson,rpc,UUID} from './generations.js';
import {own,studioError} from './studio.js';
export const PRODUCTION_ERRORS={
 PRODUCTION_OFFLINE:[503,'La producción automática está temporalmente sin conexión. Tu guion sigue guardado.'],
 PRODUCTION_SCRIPT:[400,'Prepara y guarda el guion antes de producir el video.'],
 PRODUCTION_PRODUCT:[400,'Añade una foto del producto para conservar su apariencia.'],
 PRODUCTION_BUSY:[409,'Ya hay una producción en curso. Puedes consultar su avance.'],
 PRODUCTION_LIMIT:[429,'Alcanzaste el límite de producciones de esta prueba.'],
 PRODUCTION_INVALID:[400,'No se pudo validar la producción.'],
 PRODUCTION_PLAN:[422,'La dirección de escenas necesita revisión.'],
 PRODUCTION_SCRIPT_CHANGED:[422,'La dirección no conservó el guion aprobado.'],
 PRODUCTION_TIMING:[422,'No pudimos alinear la narración con el guion con suficiente precisión.'],
 PRODUCTION_UNCERTAIN:[409,'Una generación quedó sin confirmación. Conservamos el avance y no repetimos el cargo automáticamente.'],
 PRODUCTION_PROVIDER:[503,'No se completó una generación. Conservamos los pasos terminados.'],
};
export function productionError(e){const code=Object.keys(PRODUCTION_ERRORS).find(c=>c===e.code||c===e.message);return code?json({code,error:PRODUCTION_ERRORS[code][1]},PRODUCTION_ERRORS[code][0]):studioError(e);}
export function publicProduction(j){return {id:j.id,projectId:j.project_id,status:j.status,stage:j.stage,error:j.error_code?PRODUCTION_ERRORS[j.error_code]?.[1]||'La producción se detuvo; tu avance está guardado.':null,completedSteps:Object.values(j.steps||{}).filter(s=>s.status==='done').length,renderId:j.steps?.render?.result?.id||null,createdAt:j.created_at};}
export async function productionAvailable(db,env){if(env.PRODUCTION_ENABLED!=='true')return false;const q=await db.from('studio_production_workers').select('id').gt('last_seen_at',new Date(Date.now()-90000).toISOString()).limit(1);return !q.error&&q.data?.length>0;}
export async function getProduction(context){try{
 const {db,user}=await authContext(context),id=new URL(context.request.url).searchParams.get('project');await own(db,'studio_projects',user.id,id);
 const q=await db.from('studio_productions').select('*').eq('project_id',id).eq('user_id',user.id).order('created_at',{ascending:false}).limit(10);if(q.error)throw q.error;
 return json({enabled:await productionAvailable(db,context.env),productions:q.data.map(publicProduction)});
}catch(e){return productionError(e);}}
export async function postProduction(context){try{
 const {db,user}=await authContext(context),b=await readJson(context.request,2000);
 if(!UUID.test(b.requestId||'')||!UUID.test(b.projectId||'')||!Number.isInteger(b.expected)||b.expected<1)throw Error('PRODUCTION_INVALID');
 const j=await rpc(db,'studio_production_start',{p_user:user.id,p_id:b.requestId,p_project:b.projectId,p_expected:b.expected,p_enabled:context.env.PRODUCTION_ENABLED==='true'});
 return json({production:publicProduction(j)},202);
}catch(e){return productionError(e);}}
