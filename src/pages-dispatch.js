// Routes are fixed at build time; no per-request regex compilation or cloning.
const methods={GET:'onRequestGet',POST:'onRequestPost',PUT:'onRequestPut',PATCH:'onRequestPatch',DELETE:'onRequestDelete',OPTIONS:'onRequestOptions',HEAD:'onRequestHead'};
export function pagesDispatcher(routes){
 return {fetch(request,env,ctx){
  const pathname=new URL(request.url).pathname.replace(/\/$/,''),path=pathname.toLowerCase();
  let mod=routes[path],params={};
  if(!mod&&path.startsWith('/api/generations/')){
   const id=pathname.slice('/api/generations/'.length);
   if(id&&!id.includes('/')){try{params.id=decodeURIComponent(id);mod=routes['/api/generations/[id]'];}catch{return new Response('Bad request',{status:400});}}
  }
  const handler=mod?.[methods[request.method]]||mod?.onRequest;
  if(!handler)return env.ASSETS.fetch(request);
  return handler({request,env,params,data:{},waitUntil:promise=>ctx.waitUntil(promise)});
 }};
}
