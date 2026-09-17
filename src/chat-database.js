// Request-scoped transport for the small Auth/PostgREST surface used by chat.
// No session storage, refresh timers, realtime clients, shared user state or retries.
import {getBearerToken} from './backend.js';
import {ApiError} from './generations.js';
const tables=new Set(['studio_projects','studio_chat_edits','studio_renders','credit_balances']);
const procedures=new Set(['studio_read','studio_chat_write']);
const identifier=value=>{if(!/^[a-z_][a-z0-9_]*$/.test(value))throw Error('CHAT_DB_QUERY');return value;};
export function chatDatabase(env,fetchImpl=fetch){
 const base=new URL(env.SUPABASE_URL),key=env.SUPABASE_SERVICE_ROLE_KEY;
 if(!key||base.username||base.password||base.search||base.hash||base.pathname!=='/'||!(base.protocol==='https:'||(base.protocol==='http:'&&['supabase.test','localhost','127.0.0.1'].includes(base.hostname))))throw Error('CHAT_DB_CONFIG');
 async function request(path,{body,token=key}={}){
  const response=await fetchImpl(new URL(path,base).href,{method:body===undefined?'GET':'POST',headers:{apikey:key,authorization:`Bearer ${token}`,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'manual'});
  if(response.status>=300&&response.status<400){await response.body?.cancel();throw Error('CHAT_DB_REDIRECT');}
  const data=await response.json();
  return response.ok?{data,error:null}:{data:null,error:{code:data?.code||'CHAT_DB_UNAVAILABLE',message:data?.message||data?.msg||'Database request failed'}};
 }
 return {
  async user(token){const r=await request('/auth/v1/user',{token});return r.error?null:r.data;},
  rpc(name,args){if(!procedures.has(name))throw Error('CHAT_DB_QUERY');return request('/rest/v1/rpc/'+name,{body:args});},
  from(table){
   if(!tables.has(table))throw Error('CHAT_DB_QUERY');
   const params=new URLSearchParams();let single=false,pending;
   const query={
    select(columns){if(columns!=='*')columns.split(',').forEach(identifier);params.set('select',columns);return query;},
    eq(column,value){params.append(identifier(column),'eq.'+value);return query;},
    order(column,{ascending=true}={}){params.set('order',identifier(column)+(ascending?'.asc':'.desc'));return query;},
    limit(count){if(!Number.isInteger(count)||count<1||count>100)throw Error('CHAT_DB_QUERY');params.set('limit',String(count));return query;},
    maybeSingle(){single=true;return query;},
    then(resolve,reject){
     pending??=request('/rest/v1/'+table+'?'+params).then(r=>{
      if(r.error)return r;
      if(!Array.isArray(r.data))throw Error('CHAT_DB_RESPONSE');
      if(!single)return r;
      if(r.data.length>1)return {data:null,error:{code:'PGRST116',message:'Multiple rows returned'}};
      return {data:r.data[0]??null,error:null};
     });
     return pending.then(resolve,reject);
    }
   };return query;
  }
 };
}
export async function chatAuthContext(context){
 const token=getBearerToken(context.request);
 if(!token)throw new ApiError('UNAUTHORIZED');
 const db=chatDatabase(context.env),user=await db.user(token);
 if(!user?.id)throw new ApiError('UNAUTHORIZED');
 return {db,user};
}
