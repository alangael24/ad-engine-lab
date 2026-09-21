// Trusted local operator only. Never ship this script or its credentials to browsers.
import {createClient} from '@supabase/supabase-js';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const [action,id,input,note]=process.argv.slice(2);
if(!['list','export','script','start','deliver','cancel'].includes(action)||action!=='list'&&!/^[a-f0-9-]{36}$/i.test(id||''))throw Error('Usage: gift-operator.mjs list | export ORDER DIR | script ORDER SCRIPT.txt | start ORDER | deliver ORDER VIDEO.mp4 REVIEW.txt | cancel ORDER');
if(!process.env.SUPABASE_URL||!process.env.SUPABASE_SERVICE_ROLE_KEY)throw Error('Missing operator credentials');
const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const check=r=>{if(r.error)throw r.error;return r.data;};
if(action==='list'){console.log(JSON.stringify(check(await db.from('gift_orders').select('id,status,target_seconds,created_at').order('created_at',{ascending:false}).limit(100)),null,2));process.exit(0);}
const order=check(await db.from('gift_orders').select('*').eq('id',id).single());
async function op(kind,data={}){return check(await db.rpc('gift_order_operator',{p_id:id,p_action:kind,p_expected:order.revision,p_data:data}));}
if(action==='export'){
 const dir=resolve(input);await mkdir(dir,{recursive:true});await writeFile(join(dir,'order.json'),JSON.stringify(order,null,2));
 const refs=order.brief.creativeMemory?.characterAssetIds||[];
 for(const assetId of refs){const a=check(await db.from('studio_assets').select('*').eq('id',assetId).eq('user_id',order.user_id).single());const media=check(await db.storage.from(a.bucket).download(a.storage_path));await writeFile(join(dir,assetId+({ 'image/jpeg':'.jpg','image/png':'.png','image/webp':'.webp'}[a.mime_type]||'.bin')),Buffer.from(await media.arrayBuffer()));}
 console.log('Exported brief and '+refs.length+' references to '+dir);
}else if(action==='script'){const out=await op('script',{script:await readFile(input,'utf8')});console.log(JSON.stringify({id:out.id,status:out.status,revision:out.revision}));}
else if(action==='start'||action==='cancel'){const out=await op(action);console.log(JSON.stringify({id:out.id,status:out.status}));}
else if(action==='deliver'){
 if(!note)throw Error('A review note file is required');
 const bytes=await readFile(input),reviewNote=(await readFile(note,'utf8')).trim();if(!reviewNote||reviewNote.length>2000)throw Error('Review note must be 1–2000 characters');
 const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_format','-show_streams','-of','json',resolve(input)],{encoding:'utf8'}));
 const duration=Number(probe.format?.duration);
 if(!probe.format?.format_name?.includes('mp4')||!probe.streams.some(s=>s.codec_type==='video')||!probe.streams.some(s=>s.codec_type==='audio')||!Number.isFinite(duration)||duration<=0||Math.ceil(duration)>order.target_seconds)throw Error('Expected playable MP4 with video/audio within purchased duration');
 if(bytes.length>50*1024*1024)throw Error('Compress the final MP4 below 50 MiB');
 const hex=createHash('sha256').update(id).update(bytes).digest('hex');const assetId=`${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-8${hex.slice(17,20)}-${hex.slice(20,32)}`;
 if(order.status==='ready'){if(order.asset_id!==assetId)throw Error('A different movie has already been delivered');console.log('Already delivered '+id);process.exit(0);}
 if(order.status!=='producing')throw Error('Order must be approved and started first');
 const bucket='studio-media',storage_path=`${order.user_id}/${assetId}.mp4`;
 const existing=check(await db.from('studio_assets').select('id').eq('id',assetId).eq('user_id',order.user_id).maybeSingle());
 if(!existing){check(await db.storage.from(bucket).upload(storage_path,bytes,{contentType:'video/mp4',upsert:true}));check(await db.rpc('studio_write',{p_user_id:order.user_id,p_action:'register_asset',p_id:assetId,p_data:{kind:'clip',name:'Mi película.mp4',bucket,storage_path,mime_type:'video/mp4',size_bytes:bytes.length,duration_seconds:duration},p_expected:null}));}
 const out=await op('deliver',{assetId,reviewNote});console.log(JSON.stringify({id:out.id,status:out.status,seconds:out.delivered_seconds}));
}
