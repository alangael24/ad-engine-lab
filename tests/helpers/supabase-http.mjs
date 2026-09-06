// Test-only transport: real supabase-js requests execute against isolated PostgreSQL.
// This module is never imported by production code or the static build.
const tables = new Set(['generation_jobs','generation_workers','generation_references','credit_balances','purchases','studio_assets','studio_brands','studio_projects','studio_scene_versions','studio_renders','studio_workers','studio_reference_analyses','studio_chat_edits','studio_productions','studio_production_workers','video_edit_sessions','video_edit_jobs','video_edit_workers']);
const functions = new Set(['reserve_generation','register_generation_reference','claim_generation','heartbeat_generation','finish_generation','cancel_generation','sweep_generations','apply_saas_purchase','studio_read','studio_write','studio_render_worker','studio_reference_write','studio_chat_write','studio_production_start','studio_production_work','video_edit_write','video_edit_work']);
const safe = name => { if (!/^[a-z_]+$/.test(name)) throw Error('Invalid test identifier'); return `"${name}"`; };
export function mockSupabase(db) {
  const users = new Map(), media = new Map(), invites = [];
  const respond=(data,status=200,headers={})=>new Response(data==null ? null : JSON.stringify(data),{status,headers:{'content-type':'application/json',...headers}});
  async function fetchMock(input, options={}) {
    const request=input instanceof Request ? input : new Request(input,options);
    const url=new URL(request.url);
    if (url.origin!=='http://supabase.test') throw Error(`Unexpected network request in test: ${url.origin}`);
    const path=url.pathname;
    if (path==='/auth/v1/user') {
      const u=users.get(request.headers.get('authorization')?.replace('Bearer ',''));
      return u ? respond(u) : respond({message:'Invalid token'},401);
    }
    if (path==='/auth/v1/invite') {
      const body=await request.json(); invites.push({email:body.email,redirectTo:url.searchParams.get('redirect_to')});
      const found=await db.query('select id,email from auth.users where email=$1',[body.email]);
      if(found.rows.length) return respond({msg:'User already registered'},422);
      const u={id:crypto.randomUUID(),email:body.email}; await db.query('insert into auth.users(id,email) values($1,$2)',[u.id,u.email]);
      return respond(u);
    }
    if(path.startsWith('/rest/v1/rpc/')) {
      const name=path.split('/').at(-1); if(!functions.has(name)) throw Error('Unexpected RPC');
      const args=await request.json();
      const expr=`public.${safe(name)}(${Object.keys(args).map((key,i)=>`${safe(key)} => $${i+1}`).join(',')})`;
      try {
        const result=await db.query(name==='apply_saas_purchase' ? `select * from ${expr}` : `select to_jsonb(${expr}) as value`,Object.values(args));
        return respond(name==='apply_saas_purchase' ? result.rows : result.rows[0].value);
      } catch(error) {return respond({message:error.message,code:error.code},400);}
    }
    if(path.startsWith('/rest/v1/')) {
      const name=path.split('/').at(-1); if(!tables.has(name)) throw Error('Unexpected table');
      if(request.method==='POST') {
        const body=await request.json(); const keys=Object.keys(body);
        await db.query(`insert into public.${safe(name)}(${keys.map(safe).join(',')}) values(${keys.map((_,i)=>`$${i+1}`).join(',')})`,Object.values(body));
        return respond(null,201);
      }
      const args=[],conditions=[];
      for (const [key,value] of url.searchParams) {
        if(['select','order','limit'].includes(key)) continue;
        if(value==='not.is.null'){conditions.push(`${safe(key)} is not null`);continue;}
        const dot=value.indexOf('.'),op=value.slice(0,dot),rhs=value.slice(dot+1);
        if(!['eq','gt'].includes(op)) throw Error(`Unexpected filter ${op}`);
        args.push(rhs);conditions.push(`${safe(key)} ${op==='eq'?'=':'>'} $${args.length}`);
      }
      const columns=(url.searchParams.get('select') || '*').split(',').map(x=>x==='*'?'*':safe(x));
      let query=`select ${columns.join(',')} from public.${safe(name)}${conditions.length?' where '+conditions.join(' and '):''}`;
      if(url.searchParams.get('order')){const [col,direction]=url.searchParams.get('order').split('.'); query+=` order by ${safe(col)} ${direction==='desc'?'desc':'asc'}`;}
      if(url.searchParams.get('limit')){args.push(Number(url.searchParams.get('limit')));query+=` limit $${args.length}`;}
      const result=await db.query(query,args); const singular=request.headers.get('accept')?.includes('vnd.pgrst.object');
      if(singular && result.rows.length!==1) return respond({message:'JSON object requested, multiple (or no) rows returned',code:'PGRST116'},406);
      return respond(request.method==='HEAD'?null:singular?result.rows[0]:result.rows,200,{'content-range':`0-${Math.max(result.rows.length-1,0)}/${result.rows.length}`});
    }
    if(path.startsWith('/storage/v1/object/upload/sign/')) {
      const key=path.slice('/storage/v1/object/upload/sign/'.length);
      if(request.method==='POST') return respond({url:`/object/upload/sign/${key}?token=test-signed`});
      const blob=await request.blob(); media.set(key,{size:blob.size,contentType:blob.type}); return respond({Key:key});
    }
    if(path.startsWith('/storage/v1/object/info/')) {
      const key=path.slice('/storage/v1/object/info/'.length); return media.has(key)?respond(media.get(key)):respond({message:'Not found'},404);
    }
    if(path.startsWith('/storage/v1/object/sign/')) {
      const key=path.slice('/storage/v1/object/sign/'.length); return respond({signedURL:`/object/sign/${key}?token=test-private`});
    }
    if(path.startsWith('/storage/v1/object/') && request.method==='POST') {
      const key=path.slice('/storage/v1/object/'.length);const blob=await request.blob();media.set(key,{size:blob.size,contentType:blob.type});return respond({Key:key});
    }
    if(path.startsWith('/storage/v1/object/') && request.method==='DELETE') {
      const bucket=path.split('/').at(-1);for(const key of (await request.json()).prefixes)media.delete(`${bucket}/${key}`);return respond([]);
    }
    throw Error(`Unhandled test request ${request.method} ${path}`);
  }
  return {fetch:fetchMock,users,media,invites};
}
