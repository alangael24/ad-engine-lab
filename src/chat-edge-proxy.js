// This route deliberately does not parse the request, project or SSE response.
// Credentials go only to our pinned, authenticated runtime over HTTPS, with no
// redirects. They are request-scoped there and never returned to the browser.
const RUNTIME='https://creativerush-production.onrender.com';
const unavailable=()=>Response.json({code:'CHAT_OFFLINE',error:'El asistente no está disponible ahora.'},{status:503,headers:{'cache-control':'no-store'}});
export async function proxyStudioChat(context,request=fetch){
 const {env}=context,r=context.request;
 if(env.CHAT_RUNTIME_URL?.replace(/\/$/,'')!==RUNTIME||String(env.CHAT_RUNTIME_TOKEN||'').length<32||!env.SUPABASE_SERVICE_ROLE_KEY||env.SUPABASE_URL?.replace(/\/$/,'')!=='https://ozkewphfxaohtihxmgoo.supabase.co')return unavailable();
 if(!['GET','POST'].includes(r.method))return new Response(null,{status:405});
 const headers=new Headers({'x-chat-runtime-token':env.CHAT_RUNTIME_TOKEN,'x-chat-database-key':env.SUPABASE_SERVICE_ROLE_KEY,'x-chat-production-enabled':env.PRODUCTION_ENABLED==='true'?'true':'false','x-chat-reference-enabled':env.REFERENCE_ANALYSIS_ENABLED==='true'?'true':'false','x-chat-production-users':env.PRODUCTION_ALLOWED_USERS||''});
 for(const name of ['authorization','accept','content-type']){const value=r.headers.get(name);if(value)headers.set(name,value);}
 try{
  const response=await request(RUNTIME+'/internal/studio-chat'+new URL(r.url).search,{method:r.method,headers,...(r.method==='POST'?{body:r.body,duplex:'half'}:{}),redirect:'manual'});
  if(response.status>=300&&response.status<400){await response.body?.cancel();return unavailable();}
  // Allowlist public headers: internal transport headers can never leak back.
  const publicHeaders=new Headers({'cache-control':'no-store, no-transform','x-content-type-options':'nosniff'});
  for(const name of ['content-type','retry-after']){const value=response.headers.get(name);if(value)publicHeaders.set(name,value);}
  return new Response(response.body,{status:response.status,headers:publicHeaders});
 }catch{return unavailable();} // No retry/fallback after a possibly accepted request.
}
