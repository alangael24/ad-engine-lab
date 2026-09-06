// Isolated visual fixture. Never deploy this server or use it for real auth/payments.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
const root = resolve(import.meta.dirname, '../dist');
let signedIn = false, email = '', checkoutAttempts = 0;
const session = () => signedIn ? { access_token:'fixture-only', user:{ id:'fixture-user', email } } : null;
const sdk = `export function createClient(){let changed;return {auth:{
getSession:async()=>({data:{session:await(await fetch('/__test__/session')).json()}}),
onAuthStateChange:callback=>{changed=callback;return {data:{subscription:{unsubscribe(){}}}}},
signInWithOtp:async args=>{const r=await fetch('/__test__/signup',{method:'POST',body:JSON.stringify(args)});if(!r.ok)return {error:{}};const s=await(await fetch('/__test__/session')).json();changed?.('SIGNED_IN',s);return {error:null}},
signOut:async()=>{await fetch('/__test__/reset',{method:'POST'});changed?.('SIGNED_OUT',null)}
}}}`;
createServer(async(req,res)=>{
  const url = new URL(req.url,'http://localhost');
  const json = (data,status=200)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(data));};
  if(url.pathname==='/__test__/session') return json(session());
  if(url.pathname==='/__test__/reset'){signedIn=false;email='';checkoutAttempts=0;return json({ok:true});}
  if(url.pathname==='/__test__/signup'){
    let body='';for await(const chunk of req)body+=chunk;const args=JSON.parse(body);
    if(args.options?.shouldCreateUser!==true)return json({error:'Must allow account creation'},400);
    signedIn=true;email=args.email;return json({ok:true});
  }
  if(url.pathname==='/__test__/stats') return json({signedIn,email,checkoutAttempts});
  if(url.pathname==='/__test__/sdk.js'){res.writeHead(200,{'content-type':'text/javascript'});return res.end(sdk);}
  if(url.pathname==='/api/public-config')return json({enabled:true,supabaseUrl:'http://fixture.invalid',supabasePublishableKey:'test-only-not-a-key'});
  if(url.pathname==='/api/account')return signedIn?json({email,hasPack:false,balance:{video_credits:0,image_credits:0}}):json({code:'UNAUTHORIZED'},401);
  if(url.pathname==='/api/checkout'){checkoutAttempts++;return json({error:'Pago simulado: no se abrió Stripe ni se realizó ningún cobro.'},503);}
  try{
    const file=resolve(root,'.'+url.pathname+(url.pathname.endsWith('/')?'index.html':''));
    if(!file.startsWith(root+'/'))return json({},403);
    let content=await readFile(file);
    if(url.pathname==='/assets/auth-client.js')content=Buffer.from(content.toString().replace('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.4/+esm','/__test__/sdk.js'));
    res.writeHead(200,{'content-type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.mp4':'video/mp4'})[extname(file)]||'application/octet-stream','cache-control':'no-store'});res.end(content);
  }catch{json({},404);}
}).listen(4174,'127.0.0.1',()=>console.log('Isolated onboarding fixture: http://127.0.0.1:4174/cuenta/'));
