create table public.studio_reference_analyses (
 id uuid primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 project_id uuid not null references public.studio_projects(id) on delete cascade,
 payload_hash text not null check(payload_hash ~ '^[a-f0-9]{64}$'),
 source jsonb not null,
 status text not null default 'running' check(status in ('running','succeeded','invalid','uncertain')),
 transcript jsonb, result jsonb, usage jsonb,
 created_at timestamptz not null default now(), started_at timestamptz not null default now(),
 finished_at timestamptz, adopted_at timestamptz
);
create index studio_reference_owner_created on public.studio_reference_analyses(user_id,created_at desc);
create index studio_reference_project_created on public.studio_reference_analyses(project_id,created_at desc);
alter table public.studio_reference_analyses enable row level security;
create policy own_reference_analysis on public.studio_reference_analyses for select to authenticated using ((select auth.uid())=user_id);
revoke all on public.studio_reference_analyses from public,anon,authenticated;
grant all on public.studio_reference_analyses to service_role;

-- Invoker, reserved to the authenticated server. Browser roles cannot call it.
create function public.studio_reference_write(p_user uuid,p_action text,p_id uuid,p_project uuid,p_data jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare a public.studio_reference_analyses; p public.studio_projects;
begin
 select * into p from public.studio_projects where id=p_project and user_id=p_user;
 if not found then raise exception 'STUDIO_NOT_FOUND'; end if;
 perform pg_catalog.pg_advisory_xact_lock(850050124);
 select * into a from public.studio_reference_analyses where id=p_id for update;
 if found and (a.user_id<>p_user or a.project_id<>p_project) then raise exception 'STUDIO_NOT_FOUND'; end if;
 if p_action='reserve' then
  if a.id is not null then
   if a.payload_hash is distinct from p_data->>'hash' then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
   return to_jsonb(a)||'{"claimed":false}'::jsonb;
  end if;
  if (p_data->>'enabled')::boolean is not true then raise exception 'REFERENCE_OFFLINE'; end if;
  if exists(select 1 from public.studio_reference_analyses where user_id=p_user and status='running' and started_at>now()-interval '4 minutes') then raise exception 'REFERENCE_BUSY'; end if;
  if (select count(*) from public.studio_reference_analyses where user_id=p_user and created_at>now()-interval '24 hours')>=5 then raise exception 'REFERENCE_LIMIT'; end if;
  if (select count(*) from public.studio_reference_analyses where created_at>now()-interval '24 hours')>=100 then raise exception 'REFERENCE_BUSY'; end if;
  insert into public.studio_reference_analyses(id,user_id,project_id,payload_hash,source)
   values(p_id,p_user,p_project,p_data->>'hash',p_data->'source') returning * into a;
  return to_jsonb(a)||'{"claimed":true}'::jsonb;
 end if;
 if a.id is null then raise exception 'STUDIO_NOT_FOUND'; end if;
 if p_action='adopt' then
  if a.status<>'succeeded' or a.result is null then raise exception 'REFERENCE_NOT_READY'; end if;
  if length(trim(p_data->>'notes')) not between 1 and 1200 then raise exception 'REFERENCE_INVALID'; end if;
  select * into p from public.studio_projects where id=p_project and user_id=p_user for update;
  if p.revision is distinct from (p_data->>'expected')::integer then raise exception 'STUDIO_CONFLICT'; end if;
  update public.studio_projects set data=jsonb_set(jsonb_set(data,'{referenceNotes}',p_data->'notes'),'{referenceAnalysisId}',to_jsonb(a.id)),revision=revision+1,updated_at=now() where id=p.id returning * into p;
  update public.studio_reference_analyses set adopted_at=now() where id=a.id;
  return to_jsonb(p);
 end if;
 if a.status<>'running' or a.started_at<now()-interval '4 minutes' then raise exception 'REFERENCE_NOT_READY'; end if;
 if p_action='transcript' then
  update public.studio_reference_analyses set transcript=p_data->'transcript' where id=a.id returning * into a;
 elsif p_action='complete' then
  if a.transcript is null or jsonb_typeof(p_data->'result')<>'object' or not(p_data->'result' ? 'version') then raise exception 'REFERENCE_OUTPUT_INVALID'; end if;
  update public.studio_reference_analyses set status='succeeded',result=p_data->'result',usage=p_data->'usage',finished_at=now() where id=a.id returning * into a;
 elsif p_action='fail' then
  if p_data->>'status' not in ('invalid','uncertain') then raise exception 'REFERENCE_INVALID'; end if;
  update public.studio_reference_analyses set status=p_data->>'status',finished_at=now() where id=a.id returning * into a;
 else raise exception 'REFERENCE_INVALID';
 end if;
 return to_jsonb(a);
end $$;
revoke all on function public.studio_reference_write(uuid,text,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.studio_reference_write(uuid,text,uuid,uuid,jsonb) to service_role;
