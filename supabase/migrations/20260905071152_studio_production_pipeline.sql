begin;
create table public.studio_productions (
 id uuid primary key, user_id uuid not null references auth.users(id),
 project_id uuid not null references public.studio_projects(id),
 initial_revision integer not null, expected_revision integer not null,
 snapshot jsonb not null, steps jsonb not null default '{}',
 status text not null default 'queued' check(status in ('queued','running','succeeded','failed','uncertain')),
 stage text not null default 'queued', error_code text,
 worker_id text, lease_token uuid, lease_expires_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index studio_production_owner on public.studio_productions(user_id,created_at);
create index studio_production_project on public.studio_productions(project_id,created_at);
create index studio_production_queue on public.studio_productions(status,created_at);
create unique index studio_production_active on public.studio_productions(project_id) where status in ('queued','running');
create table public.studio_production_workers(id text primary key,last_seen_at timestamptz not null default now());
alter table public.studio_productions enable row level security;
alter table public.studio_production_workers enable row level security;
revoke all on public.studio_productions,public.studio_production_workers from public,anon,authenticated;
grant all on public.studio_productions,public.studio_production_workers to service_role;

create function public.studio_production_start(p_user uuid,p_id uuid,p_project uuid,p_expected integer,p_enabled boolean)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.studio_projects; j public.studio_productions;
begin
 perform pg_advisory_xact_lock(hashtext('studio:'||p_user::text));
 select * into p from public.studio_projects where id=p_project and user_id=p_user for update;
 if not found then raise exception 'STUDIO_NOT_FOUND'; end if;
 select * into j from public.studio_productions where id=p_id;
 if found then
  if j.user_id<>p_user or j.project_id<>p_project or j.initial_revision<>p_expected then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  return to_jsonb(j);
 end if;
 if not p_enabled or not exists(select 1 from public.studio_production_workers where last_seen_at>now()-interval '90 seconds') then raise exception 'PRODUCTION_OFFLINE'; end if;
 if p.revision is distinct from p_expected then raise exception 'STUDIO_CONFLICT'; end if;
 if length(trim(coalesce(p.data->>'scriptDraft','')))=0 or length(p.data->>'scriptDraft')>3000 then raise exception 'PRODUCTION_SCRIPT'; end if;
 if p.brand_snapshot->>'productAssetId' is null then raise exception 'PRODUCTION_PRODUCT'; end if;
 if exists(select 1 from public.studio_productions where user_id=p_user and status in ('queued','running')) then raise exception 'PRODUCTION_BUSY'; end if;
 if (select count(*) from public.studio_productions where user_id=p_user and created_at>now()-interval '24 hours')>=5 then raise exception 'PRODUCTION_LIMIT'; end if;
 if exists(select 1 from public.studio_chat_edits where project_id=p_project and status='running' and created_at>now()-interval '3 minutes') then raise exception 'PRODUCTION_BUSY'; end if;
 insert into public.studio_productions(id,user_id,project_id,initial_revision,expected_revision,snapshot)
 values(p_id,p_user,p_project,p.revision,p.revision,to_jsonb(p)) returning * into j;
 return to_jsonb(j);
end $$;

create function public.studio_production_work(p_worker text,p_action text,p_id uuid default null,p_lease uuid default null,p_data jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare j public.studio_productions; p public.studio_projects; k text; previous jsonb; result jsonb;
begin
 if p_action='claim' then
  insert into public.studio_production_workers(id) values(p_worker) on conflict(id) do update set last_seen_at=now();
  select * into j from public.studio_productions where status='queued' or (status='running' and lease_expires_at<now()) order by created_at for update skip locked limit 1;
  if not found then return null; end if;
  update public.studio_productions set status='running',worker_id=p_worker,lease_token=gen_random_uuid(),lease_expires_at=now()+interval '120 seconds',updated_at=now() where id=j.id returning * into j;
  return to_jsonb(j);
 end if;
 select * into j from public.studio_productions where id=p_id;
 if not found then raise exception 'LEASE_LOST'; end if;
 perform pg_advisory_xact_lock(hashtext('studio:'||j.user_id::text));
 select * into j from public.studio_productions where id=p_id for update;
 if j.worker_id is distinct from p_worker or j.lease_token is distinct from p_lease or j.status<>'running' or j.lease_expires_at<=now() then raise exception 'LEASE_LOST'; end if;
 if p_action='fail' then
  update public.studio_productions set status=case when p_data->>'code'='PRODUCTION_UNCERTAIN' then 'uncertain' else 'failed' end,error_code=p_data->>'code',lease_expires_at=null,updated_at=now() where id=j.id returning * into j;
  return to_jsonb(j);
 end if;
 select * into p from public.studio_projects where id=j.project_id and user_id=j.user_id for update;
 if p.revision<>j.expected_revision then raise exception 'STUDIO_CONFLICT'; end if;
 update public.studio_production_workers set last_seen_at=now() where id=p_worker;
 update public.studio_productions set lease_expires_at=now()+interval '120 seconds',updated_at=now() where id=j.id;
 if p_action='heartbeat' then return to_jsonb(j); end if;
 if p_action='inspect' then return public.studio_read(j.user_id,j.project_id); end if;
 k:=p_data->>'key';
 if k is null or k !~ '^[a-z0-9_-]{1,80}$' then raise exception 'PRODUCTION_INVALID'; end if;
 previous:=j.steps->k;
 if p_action='begin_step' then
  if previous->>'status'='done' then return previous; end if;
  if previous is not null then raise exception 'PRODUCTION_UNCERTAIN'; end if;
  result:=jsonb_build_object('status','started');
 elsif p_action='finish_step' then
  if previous->>'status'='done' then
   if previous->'result' is distinct from p_data->'result' then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
   return previous;
  end if;
  if previous->>'status' is distinct from 'started' then raise exception 'PRODUCTION_INVALID'; end if;
  result:=jsonb_build_object('status','done','result',p_data->'result');
 elsif p_action='write' then
  if previous->>'status'='done' then return previous; end if;
  if p_data->>'action' not in ('register_asset','save_project','version','select_version','render') then raise exception 'PRODUCTION_INVALID'; end if;
  result:=public.studio_write(j.user_id,p_data->>'action',case when p_data->>'action'='register_asset' then (p_data->>'assetId')::uuid else j.project_id end,p_data->'data',j.expected_revision);
  select revision into j.expected_revision from public.studio_projects where id=j.project_id;
  update public.studio_productions set expected_revision=j.expected_revision where id=j.id;
  result:=jsonb_build_object('status','done','result',result);
 elsif p_action='complete' then
  if not exists(select 1 from public.studio_renders where id=(p_data->>'renderId')::uuid and project_id=j.project_id and project_revision=j.expected_revision and status='succeeded') then raise exception 'STUDIO_NOT_READY'; end if;
  update public.studio_productions set status='succeeded',stage='completed',lease_expires_at=null where id=j.id returning * into j;
  return to_jsonb(j);
 else raise exception 'PRODUCTION_INVALID'; end if;
 update public.studio_productions set steps=jsonb_set(steps,array[k],result),stage=coalesce(p_data->>'stage',stage),updated_at=now() where id=j.id;
 return result;
end $$;
revoke all on function public.studio_production_start(uuid,uuid,uuid,integer,boolean),public.studio_production_work(text,text,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.studio_production_start(uuid,uuid,uuid,integer,boolean),public.studio_production_work(text,text,uuid,uuid,jsonb) to service_role;
-- Keep production approval and chat history in one transaction.
alter function public.studio_chat_write(uuid,text,uuid,uuid,jsonb) rename to studio_chat_write_before_production;
create function public.studio_chat_write(p_user uuid,p_action text,p_id uuid,p_project uuid,p_data jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare e jsonb; j jsonb;
begin
 perform pg_advisory_xact_lock(hashtext('studio:'||p_user::text));
 if p_action='reserve' and not exists(select 1 from public.studio_chat_edits where id=p_id) and exists(select 1 from public.studio_productions where project_id=p_project and user_id=p_user and status in ('queued','running')) then raise exception 'PRODUCTION_BUSY'; end if;
 e:=public.studio_chat_write_before_production(p_user,p_action,p_id,p_project,p_data);
 if p_action='complete' and e->>'status'='succeeded' and e->>'operation'='produce' then
  j:=public.studio_production_start(p_user,p_id,p_project,(e->'request_payload'->>'expected')::integer,coalesce((p_data->>'productionEnabled')::boolean,false));
  update public.studio_chat_edits set result=result||jsonb_build_object('productionId',j->>'id','message','Producción iniciada. Puedes consultar el avance y volver cuando esté lista.') where id=p_id returning to_jsonb(studio_chat_edits) into e;
 end if;
 return e;
end $$;
revoke all on function public.studio_chat_write(uuid,text,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.studio_chat_write(uuid,text,uuid,uuid,jsonb) to service_role;
commit;
