import test from 'node:test';
import assert from 'node:assert/strict';
import {chatDatabase,chatAuthContext} from '../src/chat-database.js';
const env={SUPABASE_URL:'https://database.test',SUPABASE_SERVICE_ROLE_KEY:'server-only'};
test('chat transport isolates user validation from privileged RPCs across concurrent requests',async()=>{
 const seen=[];
 const db=chatDatabase(env,async(url,options)=>{seen.push({url,options});return Response.json(url.includes('/auth/')?{id:options.headers.authorization}:[]);});
 const users=await Promise.all([db.user('alice'),db.user('bob')]);
 assert.deepEqual(users.map(u=>u.id),['Bearer alice','Bearer bob']);
 await db.rpc('studio_read',{p_user_id:'alice',p_project_id:'project'});
 assert.equal(seen[2].options.headers.authorization,'Bearer server-only');
 assert.ok(seen.every(x=>x.options.redirect==='error'&&x.options.headers.apikey==='server-only'));
 assert.throws(()=>db.rpc('unapproved',{}));assert.throws(()=>db.from('auth.users'));
});
test('chat reads preserve owner filters and zero/one/multiple-row semantics',async()=>{
 let rows=[],captured;
 const db=chatDatabase(env,async(url)=>{captured=new URL(url);return Response.json(rows);});
 const read=()=>db.from('studio_projects').select('id').eq('id','project').eq('user_id','alice').maybeSingle();
 assert.deepEqual(await read(),{data:null,error:null});
 rows=[{id:'project'}];assert.deepEqual((await read()).data,rows[0]);
 assert.equal(captured.searchParams.get('user_id'),'eq.alice');
 rows.push({id:'other'});assert.equal((await read()).error.code,'PGRST116');
});
test('chat transport never retries writes, redirects or failed authorization',async()=>{
 let count=0;
 const db=chatDatabase(env,async()=>{count++;return Response.json({message:'STUDIO_CONFLICT',code:'P0001'},{status:400});});
 assert.equal((await db.rpc('studio_chat_write',{})).error.message,'STUDIO_CONFLICT');assert.equal(count,1);
 assert.equal(await db.user('invalid'),null);assert.equal(count,2);
 await assert.rejects(chatAuthContext({env,request:new Request('https://app.test')}),/UNAUTHORIZED/);
 assert.equal(count,2);
 for(const url of ['http://database.test','https://user:password@database.test','https://database.test/other'])assert.throws(()=>chatDatabase({...env,SUPABASE_URL:url}));
});
