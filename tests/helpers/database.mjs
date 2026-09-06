import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
export async function database() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key, email text, created_at timestamptz default now());
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated, service_role;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
  `);
  for (const file of ['202608250001_accounts_and_credits.sql','20260830011058_saas_generation_jobs.sql','20260904230633_brand_storyboard_versions.sql','20260905015812_studio_reference_analysis.sql','20260905045330_studio_chat_edits.sql','20260905071152_studio_production_pipeline.sql','20260905095537_chat_revision_followups.sql','20260906002544_production_quality_gate.sql']) {
    await db.exec(await readFile(new URL(`../../supabase/migrations/${file}`, import.meta.url),'utf8'));
  }
  return db;
}
export async function user(db, credits = 12, images = 20) {
  const id=crypto.randomUUID(), email=`${id}@example.test`;
  await db.query('insert into auth.users(id,email) values($1,$2)',[id,email]);
  await db.query('select * from public.apply_saas_purchase($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
    [`evt_${id}`,`cs_${id}`,'plink_test',email,null,'esencial',99900,'mxn','paid',credits,images,false]);
  return { id,email };
}
export async function ready(db,id='test-worker') { await db.query("insert into public.generation_workers(id) values($1) on conflict(id) do update set last_seen_at=now()",[id]); return id; }
export async function call(db,name,args=[]) {
  const {rows}=await db.query(`select to_jsonb(public.${name}(${args.map((_,i)=>`$${i+1}`).join(',')})) as value`,args);
  return rows[0]?.value;
}
export const reserve = (db,u,overrides={}) => call(db,'reserve_generation',[
  u.id, overrides.requestId || crypto.randomUUID(), overrides.prompt || 'Un anuncio para mi producto',
  overrides.duration || 5, overrides.resolution || '720p', overrides.ratio || '9:16', overrides.referenceId || null,
]);
export async function balance(db,u) { return (await db.query('select video_credits from public.credit_balances where user_id=$1',[u.id])).rows[0].video_credits; }
