begin;
create table public.studio_assets (
 id uuid primary key, user_id uuid not null references auth.users(id) on delete restrict,
 kind text not null check(kind in ('image','voice','narration','clip')),
 name text not null, bucket text not null, storage_path text not null unique,
 mime_type text not null, size_bytes integer not null check(size_bytes between 1 and 52428800),
 duration_seconds numeric, created_at timestamptz not null default now()
);
create index studio_assets_owner on public.studio_assets(user_id,created_at);
create table public.studio_brands (
 id uuid primary key, user_id uuid not null references auth.users(id) on delete restrict,
 data jsonb not null, revision integer not null default 1,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index studio_brands_owner on public.studio_brands(user_id,updated_at);
create table public.studio_projects (
 id uuid primary key, user_id uuid not null references auth.users(id) on delete restrict,
 brand_id uuid not null references public.studio_brands(id), brand_snapshot jsonb not null,
 data jsonb not null, revision integer not null default 1,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index studio_projects_owner on public.studio_projects(user_id,updated_at);
create index studio_projects_brand on public.studio_projects(brand_id);
create table public.studio_scene_versions (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete restrict,
 project_id uuid not null references public.studio_projects(id), scene_id uuid not null,
 version integer not null, request_id uuid not null, request_payload jsonb not null,
 snapshot jsonb not null, job_id uuid references public.generation_jobs(id), asset_id uuid references public.studio_assets(id),
 created_at timestamptz not null default now(), unique(user_id,request_id), unique(project_id,scene_id,version),
 check((job_id is null) <> (asset_id is null))
);
create index studio_versions_owner on public.studio_scene_versions(user_id,project_id);
create index studio_versions_job on public.studio_scene_versions(job_id);
create index studio_versions_asset on public.studio_scene_versions(asset_id);
create table public.studio_workers (id text primary key, last_seen_at timestamptz not null default now());
create table public.studio_renders (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete restrict,
 project_id uuid not null references public.studio_projects(id), project_revision integer not null,
 request_id uuid not null, manifest jsonb not null,
 status text not null default 'queued' check(status in ('queued','running','succeeded','failed')),
 worker_id text, lease_token uuid, lease_expires_at timestamptz, result_path text,
 error_code text, created_at timestamptz not null default now(), finished_at timestamptz,
 unique(user_id,request_id)
);
create index studio_renders_owner on public.studio_renders(user_id,project_id,created_at);
create index studio_renders_queue on public.studio_renders(created_at) where status in ('queued','running');
create unique index studio_renders_worker_active on public.studio_renders(worker_id) where status='running';

-- The browser uses authenticated server endpoints. Read-only RLS also protects direct reads.
do $$declare t text; begin
 foreach t in array array['studio_assets','studio_brands','studio_projects','studio_scene_versions','studio_renders','studio_workers'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant all on public.%I to service_role',t);
  if t <> 'studio_workers' then
   execute format('create policy own_records on public.%I for select to authenticated using ((select auth.uid())=user_id)',t);
  end if;
 end loop;
end $$;
grant select on public.studio_brands,public.studio_projects,public.studio_scene_versions to authenticated;
-- Storage paths and worker leases are deliberately server-only.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('studio-media','studio-media',false,52428800,array['audio/wav','audio/mpeg','video/mp4']) on conflict(id) do nothing;

create function public.studio_read(p_user_id uuid,p_project_id uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.studio_projects; result jsonb;
begin
 if p_project_id is not null then
  select * into p from public.studio_projects where id=p_project_id and user_id=p_user_id;
  if not found then raise exception 'STUDIO_NOT_FOUND'; end if;
  return jsonb_build_object('project',to_jsonb(p),'versions',coalesce((select jsonb_agg(to_jsonb(v)||jsonb_build_object('status',coalesce(j.status,'succeeded'))) from public.studio_scene_versions v left join public.generation_jobs j on j.id=v.job_id where v.project_id=p.id),'[]'::jsonb),
   'renders',coalesce((select jsonb_agg(to_jsonb(r)-'lease_token'-'worker_id'-'lease_expires_at'-'manifest'-'result_path' order by r.created_at desc) from (select * from public.studio_renders where project_id=p.id order by created_at desc limit 20) r),'[]'::jsonb));
 end if;
 return jsonb_build_object('brands',coalesce((select jsonb_agg(b order by b.updated_at desc) from public.studio_brands b where b.user_id=p_user_id),'[]'::jsonb),
  'projects',coalesce((select jsonb_agg(jsonb_build_object('id',proj.id,'title',proj.data->>'title','brand_id',proj.brand_id,'revision',proj.revision,'updated_at',proj.updated_at) order by proj.updated_at desc) from public.studio_projects proj where proj.user_id=p_user_id),'[]'::jsonb),
  'assets',coalesce((select jsonb_agg(to_jsonb(a)-'storage_path'-'bucket' order by a.created_at desc) from public.studio_assets a where a.user_id=p_user_id),'[]'::jsonb));
end $$;

create function public.studio_write(p_user_id uuid,p_action text,p_id uuid,p_data jsonb,p_expected integer default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare b public.studio_brands; p public.studio_projects; a public.studio_assets; v public.studio_scene_versions;
 j public.generation_jobs; r public.studio_renders; scene jsonb; s jsonb; scenes jsonb; snapshot jsonb;
 manifest jsonb:='[]'; req uuid; ref uuid; media_id uuid; num integer; duration integer;
begin
 -- Serializes account quotas and edits across browser tabs, including first creation.
 perform pg_advisory_xact_lock(hashtext('studio:'||p_user_id::text));
 if not exists(select 1 from auth.users where id=p_user_id) then raise exception 'UNAUTHORIZED'; end if;
 if p_action='register_asset' then
  if (select coalesce(sum(size_bytes),0) from public.studio_assets where user_id=p_user_id)+ (p_data->>'size_bytes')::integer > 524288000
   or (select count(*) from public.studio_assets where user_id=p_user_id)>=200 then raise exception 'STUDIO_STORAGE_LIMIT'; end if;
  insert into public.studio_assets(id,user_id,kind,name,bucket,storage_path,mime_type,size_bytes,duration_seconds)
  values(p_id,p_user_id,p_data->>'kind',p_data->>'name',p_data->>'bucket',p_data->>'storage_path',p_data->>'mime_type',(p_data->>'size_bytes')::integer,(p_data->>'duration_seconds')::numeric) returning * into a;
  if a.kind='image' then
   insert into public.generation_references(id,user_id,storage_path,mime_type,size_bytes) values(a.id,p_user_id,a.storage_path,a.mime_type,a.size_bytes);
  end if;
  return to_jsonb(a)-'storage_path'-'bucket';
 end if;
 if p_action='save_brand' then
  select * into b from public.studio_brands where id=p_id and user_id=p_user_id for update;
  if found and b.revision is distinct from p_expected then raise exception 'STUDIO_CONFLICT'; end if;
  if not found and p_expected is not null then raise exception 'STUDIO_NOT_FOUND'; end if;
  if b.id is null and (select count(*) from public.studio_brands where user_id=p_user_id)>=20 then raise exception 'STUDIO_LIMIT'; end if;
  for s in select jsonb_build_object('id',p_data->>'productAssetId','kind','image') union all select jsonb_build_object('id',p_data->>'voiceAssetId','kind','voice') loop
   if s->>'id' is not null and not exists(select 1 from public.studio_assets where id=(s->>'id')::uuid and user_id=p_user_id and kind=s->>'kind') then raise exception 'STUDIO_ASSET_NOT_FOUND'; end if;
  end loop;
  insert into public.studio_brands(id,user_id,data) values(p_id,p_user_id,p_data)
   on conflict(id) do update set data=excluded.data,revision=studio_brands.revision+1,updated_at=now() where studio_brands.user_id=p_user_id returning * into b;
  if b.id is null then raise exception 'STUDIO_NOT_FOUND'; end if; return to_jsonb(b);
 end if;
 if p_action='create_project' then
  select * into b from public.studio_brands where id=(p_data->>'brandId')::uuid and user_id=p_user_id;
  if not found then raise exception 'STUDIO_NOT_FOUND'; end if;
  select * into p from public.studio_projects where id=p_id and user_id=p_user_id;
  if found then return to_jsonb(p); end if;
  if (select count(*) from public.studio_projects where user_id=p_user_id)>=100 then raise exception 'STUDIO_LIMIT'; end if;
  insert into public.studio_projects(id,user_id,brand_id,brand_snapshot,data) values(p_id,p_user_id,b.id,b.data||jsonb_build_object('revision',b.revision),p_data) returning * into p;
  return to_jsonb(p);
 end if;
 select * into p from public.studio_projects where id=p_id and user_id=p_user_id for update;
 if not found then raise exception 'STUDIO_NOT_FOUND'; end if;
 -- Replays return the existing result even when the project has subsequently changed.
 if p_action='version' then
  req:=(p_data->>'requestId')::uuid;
  select * into v from public.studio_scene_versions where user_id=p_user_id and request_id=req;
  if found then
   if v.project_id<>p_id or v.request_payload<>p_data then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
   return to_jsonb(v);
  end if;
 elsif p_action='render' then
  req:=(p_data->>'requestId')::uuid;
  select * into r from public.studio_renders where user_id=p_user_id and request_id=req;
  if found then
   if r.project_id<>p_id or r.project_revision<>p_expected then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
   return to_jsonb(r)-'manifest'-'lease_token'-'result_path';
  end if;
 end if;
 if p.revision is distinct from p_expected then raise exception 'STUDIO_CONFLICT'; end if;
 if p_action='save_project' then
  media_id:=(p_data->>'narrationAssetId')::uuid;
  if media_id is not null and not exists(select 1 from public.studio_assets where id=media_id and user_id=p_user_id and kind='narration') then raise exception 'STUDIO_ASSET_NOT_FOUND'; end if;
  for scene in select value from jsonb_array_elements(p_data->'scenes') loop
   media_id:=(scene->>'imageAssetId')::uuid;
   if media_id is not null and not exists(select 1 from public.studio_assets where id=media_id and user_id=p_user_id and kind='image') then raise exception 'STUDIO_ASSET_NOT_FOUND'; end if;
   if scene->>'selectedVersionId' is not null and not exists(select 1 from public.studio_scene_versions where id=(scene->>'selectedVersionId')::uuid and project_id=p.id and scene_id=(scene->>'id')::uuid) then raise exception 'STUDIO_NOT_FOUND'; end if;
  end loop;
  update public.studio_projects set data=p_data,revision=revision+1,updated_at=now() where id=p.id returning * into p; return to_jsonb(p);
 elsif p_action='refresh_brand' then
  select * into b from public.studio_brands where id=p.brand_id;
  update public.studio_projects set brand_snapshot=b.data||jsonb_build_object('revision',b.revision),revision=revision+1,updated_at=now() where id=p.id returning * into p; return to_jsonb(p);
 elsif p_action='version' then
  select value into scene from jsonb_array_elements(p.data->'scenes') where value->>'id'=p_data->>'sceneId';
  if scene is null then raise exception 'STUDIO_NOT_FOUND'; end if;
  snapshot:=jsonb_build_object('brand',p.brand_snapshot,'scene',scene-'selectedVersionId','storyboard',p.data->'scenes','narrationAssetId',p.data->'narrationAssetId','referenceNotes',p.data->'referenceNotes','instruction',p_data->>'instruction','projectRevision',p.revision);
  select coalesce(max(version),0)+1 into num from public.studio_scene_versions where project_id=p.id and scene_id=(scene->>'id')::uuid;
  if num>30 then raise exception 'STUDIO_LIMIT'; end if;
  media_id:=(p_data->>'assetId')::uuid;
  if media_id is not null then
   select * into a from public.studio_assets where id=media_id and user_id=p_user_id and kind='clip';
   if not found then raise exception 'STUDIO_ASSET_NOT_FOUND'; end if;
   if a.duration_seconds < (scene->>'end')::numeric-(scene->>'start')::numeric-0.05 then raise exception 'STUDIO_CLIP_TOO_SHORT'; end if;
  else
   ref:=coalesce((scene->>'imageAssetId')::uuid,(p.brand_snapshot->>'productAssetId')::uuid);
   duration:=least(15,ceil(((scene->>'end')::numeric-(scene->>'start')::numeric)/5)::integer*5);
   select * into j from public.reserve_generation(p_user_id,req,p_data->>'prompt',duration,'720p',p.data->>'aspectRatio',ref);
  end if;
  insert into public.studio_scene_versions(user_id,project_id,scene_id,version,request_id,request_payload,snapshot,job_id,asset_id)
   values(p_user_id,p.id,(scene->>'id')::uuid,num,req,p_data,snapshot,j.id,media_id) returning * into v;
  return to_jsonb(v);
 elsif p_action='select_version' then
  select * into v from public.studio_scene_versions where id=(p_data->>'versionId')::uuid and project_id=p.id and user_id=p_user_id;
  if not found then raise exception 'STUDIO_NOT_FOUND'; end if;
  if v.job_id is not null and not exists(select 1 from public.generation_jobs where id=v.job_id and status='succeeded') then raise exception 'STUDIO_NOT_READY'; end if;
  if not exists(select 1 from jsonb_array_elements(p.data->'scenes') x where x->>'id'=v.scene_id::text) then raise exception 'STUDIO_NOT_FOUND'; end if;
  select jsonb_agg(case when x->>'id'=v.scene_id::text then x||jsonb_build_object('selectedVersionId',v.id) else x end order by ord) into scenes from jsonb_array_elements(p.data->'scenes') with ordinality as t(x,ord);
  update public.studio_projects set data=jsonb_set(data,'{scenes}',scenes),revision=revision+1,updated_at=now() where id=p.id returning * into p; return to_jsonb(p);
 elsif p_action='render' then
  if not exists(select 1 from public.studio_workers where last_seen_at>now()-interval '90 seconds') then raise exception 'STUDIO_WORKER_OFFLINE'; end if;
  if (select count(*) from public.studio_renders where user_id=p_user_id and status in ('queued','running'))>=2 then raise exception 'STUDIO_RENDER_BUSY'; end if;
  select * into a from public.studio_assets where id=(p.data->>'narrationAssetId')::uuid and user_id=p_user_id and kind='narration';
  if not found then raise exception 'STUDIO_NARRATION_REQUIRED'; end if;
  if jsonb_array_length(p.data->'scenes')<1 then raise exception 'STUDIO_NOT_READY'; end if;
  for scene in select value from jsonb_array_elements(p.data->'scenes') loop
   select * into v from public.studio_scene_versions where id=(scene->>'selectedVersionId')::uuid and project_id=p.id and scene_id=(scene->>'id')::uuid;
   if not found then raise exception 'STUDIO_NOT_READY'; end if;
   if v.job_id is not null then
    select * into j from public.generation_jobs where id=v.job_id and status='succeeded';
    if not found then raise exception 'STUDIO_NOT_READY'; end if;
    s:=jsonb_build_object('bucket','generation-results','path',j.result_path,'duration',j.duration_seconds);
   else
    select * into a from public.studio_assets where id=v.asset_id;
    s:=jsonb_build_object('bucket',a.bucket,'path',a.storage_path,'duration',a.duration_seconds);
   end if;
   if (s->>'duration')::numeric < (scene->>'end')::numeric-(scene->>'start')::numeric-0.05 then raise exception 'STUDIO_CLIP_TOO_SHORT'; end if;
   manifest:=manifest||jsonb_build_array(scene||jsonb_build_object('versionId',v.id,'media',s));
  end loop;
  select * into a from public.studio_assets where id=(p.data->>'narrationAssetId')::uuid;
  if abs(a.duration_seconds-(manifest->-1->>'end')::numeric)>0.75 then raise exception 'STUDIO_AUDIO_TIMING'; end if;
  insert into public.studio_renders(user_id,project_id,project_revision,request_id,manifest)
   values(p_user_id,p.id,p.revision,req,jsonb_build_object('scenes',manifest,'aspectRatio',p.data->'aspectRatio','narration',jsonb_build_object('bucket',a.bucket,'path',a.storage_path),'voice',p.brand_snapshot->'voiceName')) returning * into r;
  return to_jsonb(r)-'manifest'-'lease_token'-'result_path';
 end if;
 raise exception 'STUDIO_INVALID';
end $$;

create function public.studio_render_worker(p_worker text,p_action text,p_id uuid default null,p_lease uuid default null,p_success boolean default false)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.studio_renders;
begin
 if p_action='claim' then
  insert into public.studio_workers(id) values(p_worker) on conflict(id) do update set last_seen_at=now();
  perform 1 from public.studio_workers where id=p_worker for update;
  update public.studio_renders set status='failed',error_code='RENDER_EXPIRED',finished_at=now() where (status='running' and lease_expires_at<now()) or (status='queued' and created_at<now()-interval '30 minutes');
  select * into r from public.studio_renders where worker_id=p_worker and status='running' for update;
  if not found then
   select * into r from public.studio_renders where status='queued' order by created_at for update skip locked limit 1;
   if not found then return null; end if;
   update public.studio_renders set status='running',worker_id=p_worker,lease_token=gen_random_uuid(),lease_expires_at=now()+interval '3 minutes' where id=r.id returning * into r;
  end if;
  return to_jsonb(r);
 end if;
 select * into r from public.studio_renders where id=p_id and worker_id=p_worker and lease_token=p_lease for update;
 if not found then raise exception 'LEASE_LOST'; end if;
 if p_action='complete' and r.status in ('succeeded','failed') then return jsonb_build_object('status',r.status); end if;
 if r.status<>'running' or r.lease_expires_at<now() then raise exception 'LEASE_LOST'; end if;
 if p_action='heartbeat' then
  update public.studio_workers set last_seen_at=now() where id=p_worker;
  update public.studio_renders set lease_expires_at=now()+interval '3 minutes' where id=r.id;
  return jsonb_build_object('ok',true);
 elsif p_action='complete' then
  update public.studio_renders set status=case when p_success then 'succeeded' else 'failed' end,
   result_path=case when p_success then user_id::text||'/renders/'||id::text||'.mp4' else null end,
   error_code=case when p_success then null else 'RENDER_FAILED' end,finished_at=now() where id=r.id returning * into r;
  return jsonb_build_object('status',r.status);
 end if;
 raise exception 'STUDIO_INVALID';
end $$;
revoke all on function public.studio_read(uuid,uuid),public.studio_write(uuid,text,uuid,jsonb,integer),public.studio_render_worker(text,text,uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.studio_read(uuid,uuid),public.studio_write(uuid,text,uuid,jsonb,integer),public.studio_render_worker(text,text,uuid,uuid,boolean) to service_role;
commit;
