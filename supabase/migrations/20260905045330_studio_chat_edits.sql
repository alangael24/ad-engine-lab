begin;
create table public.studio_chat_edits (
 id uuid primary key, user_id uuid not null references auth.users(id) on delete restrict,
 project_id uuid not null references public.studio_projects(id), request_payload jsonb not null,
 status text not null default 'running' check(status in ('running','succeeded','failed','uncertain')),
 before_data jsonb not null, applied_revision integer, operation text, undone_at timestamptz,
 result jsonb, created_at timestamptz not null default now()
);
create index studio_chat_owner on public.studio_chat_edits(user_id,created_at);
create index studio_chat_project on public.studio_chat_edits(project_id,created_at);
alter table public.studio_chat_edits enable row level security;
revoke all on public.studio_chat_edits from public,anon,authenticated;
grant all on public.studio_chat_edits to service_role;
create or replace function public.studio_write(p_user_id uuid,p_action text,p_id uuid,p_data jsonb,p_expected integer default null)
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
  if not coalesce((p.data->>'timingConfirmed')::boolean,false) then raise exception 'STUDIO_AUDIO_TIMING'; end if;
  if exists(select 1 from jsonb_array_elements(manifest) x where x ? 'narrationStart') then
   if exists(select 1 from jsonb_array_elements(manifest) x where not(x ? 'narrationStart') or (x->>'narrationStart')::numeric<0 or (x->>'narrationStart')::numeric>=a.duration_seconds or (x->>'narrationStart')::numeric+(x->>'end')::numeric-(x->>'start')::numeric>a.duration_seconds+0.75) then raise exception 'STUDIO_AUDIO_TIMING'; end if;
  elsif abs(a.duration_seconds-(manifest->-1->>'end')::numeric)>0.75 then raise exception 'STUDIO_AUDIO_TIMING'; end if;
  insert into public.studio_renders(user_id,project_id,project_revision,request_id,manifest)
   values(p_user_id,p.id,p.revision,req,jsonb_build_object('scenes',manifest,'aspectRatio',p.data->'aspectRatio','narration',jsonb_build_object('bucket',a.bucket,'path',a.storage_path),'voice',p.brand_snapshot->'voiceName')) returning * into r;
  return to_jsonb(r)-'manifest'-'lease_token'-'result_path';
 end if;
 raise exception 'STUDIO_INVALID';
end $$;


create function public.studio_chat_write(p_user uuid,p_action text,p_id uuid,p_project uuid,p_data jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.studio_projects; e public.studio_chat_edits; prior public.studio_chat_edits;
 answer jsonb; updated jsonb; render_result jsonb; render_error text; op text;
begin
 perform pg_advisory_xact_lock(hashtext('studio:'||p_user::text));
 select * into p from public.studio_projects where id=p_project and user_id=p_user for update;
 if not found then raise exception 'STUDIO_NOT_FOUND'; end if;
 select * into e from public.studio_chat_edits where id=p_id;
 if e.id is not null and (e.user_id<>p_user or e.project_id<>p_project) then raise exception 'STUDIO_NOT_FOUND'; end if;
 if p_action='reserve' then
  if e.id is not null then
   if e.request_payload<>p_data-'enabled' then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
   return to_jsonb(e)||jsonb_build_object('claimed',false);
  end if;
  if not coalesce((p_data->>'enabled')::boolean,false) then raise exception 'CHAT_OFFLINE'; end if;
  if p.revision is distinct from (p_data->>'expected')::integer then raise exception 'STUDIO_CONFLICT'; end if;
  update public.studio_chat_edits set status='uncertain' where user_id=p_user and status='running' and created_at<now()-interval '3 minutes';
  if exists(select 1 from public.studio_chat_edits where user_id=p_user and status='running') then raise exception 'CHAT_BUSY'; end if;
  if (select count(*) from public.studio_chat_edits where user_id=p_user and created_at>now()-interval '24 hours')>=30
   or (select count(*) from public.studio_chat_edits where created_at>now()-interval '24 hours')>=300 then raise exception 'CHAT_LIMIT'; end if;
  insert into public.studio_chat_edits(id,user_id,project_id,request_payload,before_data) values(p_id,p_user,p_project,p_data-'enabled',p.data) returning * into e;
  return to_jsonb(e)||jsonb_build_object('claimed',true);
 end if;
 if e.id is null then raise exception 'STUDIO_NOT_FOUND'; end if;
 if e.status<>'running' then return to_jsonb(e); end if;
 if p_action='fail' then
  update public.studio_chat_edits set status='failed',result=p_data where id=e.id returning * into e;return to_jsonb(e);
 end if;
 if p_action<>'complete' then raise exception 'CHAT_INVALID'; end if;
 if e.created_at<now()-interval '3 minutes' then
  update public.studio_chat_edits set status='uncertain' where id=e.id returning * into e;return to_jsonb(e);
 end if;
 if p.revision is distinct from (e.request_payload->>'expected')::integer or e.before_data<>p.data then raise exception 'STUDIO_CONFLICT'; end if;
 op:=p_data->'edit'->>'operation';
 if op='undo' then
  select * into prior from public.studio_chat_edits where project_id=p.id and user_id=p_user and status='succeeded' and applied_revision=p.revision and undone_at is null and operation not in ('undo','clarify','render') order by created_at desc limit 1;
  if not found then raise exception 'CHAT_NO_UNDO'; end if;
  updated:=public.studio_write(p_user,'save_project',p.id,prior.before_data,p.revision);
  update public.studio_chat_edits set undone_at=now() where id=prior.id;
 elsif p_data->'nextData' is not null and p_data->'nextData'<>'null'::jsonb then
  updated:=public.studio_write(p_user,'save_project',p.id,p_data->'nextData',p.revision);
 end if;
 if updated is not null then select * into p from public.studio_projects where id=p.id; end if;
 if op in ('remove_scene','move_scene','select_version','undo','render') then
  begin
   render_result:=public.studio_write(p_user,'render',p.id,jsonb_build_object('requestId',e.id),p.revision);
  exception when others then
   if sqlerrm in ('STUDIO_WORKER_OFFLINE','STUDIO_NOT_READY','STUDIO_NARRATION_REQUIRED','STUDIO_AUDIO_TIMING','STUDIO_RENDER_BUSY','STUDIO_CLIP_TOO_SHORT') then render_error:=sqlerrm; else raise; end if;
  end;
 end if;
 answer:=jsonb_build_object('message',p_data->'edit'->>'message','operation',op,'render',render_result,'renderError',render_error,'usage',p_data->'usage');
 update public.studio_chat_edits set status='succeeded',operation=op,applied_revision=case when updated is not null then p.revision else null end,result=answer where id=e.id returning * into e;
 return to_jsonb(e);
end $$;
revoke all on function public.studio_chat_write(uuid,text,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.studio_chat_write(uuid,text,uuid,uuid,jsonb) to service_role;
commit;
