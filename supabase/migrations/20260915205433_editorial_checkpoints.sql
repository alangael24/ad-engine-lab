-- Paid substeps survive render/job/host retries. Private to service workers.
create table public.studio_editorial_checkpoints (
 user_id uuid not null references auth.users(id) on delete cascade,
 project_id uuid not null references public.studio_projects(id) on delete cascade,
 key text not null check (key ~ '^[a-f0-9]{64}$'),
 owner_render uuid not null references public.studio_renders(id) on delete cascade,
 owner_lease uuid not null,
 kind text not null default 'model' check(kind in ('model','artifact')),
 state text not null check (state in ('started','done','failed')),
 value jsonb not null default '{}'::jsonb check (octet_length(value::text)<=150000),
 updated_at timestamptz not null default now(),
 primary key(user_id,project_id,key)
);
alter table public.studio_editorial_checkpoints enable row level security;
revoke all on public.studio_editorial_checkpoints from public,anon,authenticated;
grant all on public.studio_editorial_checkpoints to service_role;
create function public.studio_editorial_checkpoint(p_worker text,p_id uuid,p_lease uuid,p_action text,p_key text,p_value jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare r public.studio_renders; c public.studio_editorial_checkpoints; inserted integer;
begin
 select * into r from public.studio_renders where id=p_id for update;
 if not found or r.worker_id is distinct from p_worker or r.lease_token is distinct from p_lease
 or r.status<>'running' or r.lease_expires_at<=now() then raise exception 'LEASE_LOST'; end if;
 if r.production_id is not null and not exists(select 1 from public.studio_productions p where p.id=r.production_id and p.status='running' and p.expected_revision=r.project_revision) then raise exception 'LEASE_LOST'; end if;
 if p_action='begin' then
  update public.studio_renders set editorial_started_at=coalesce(editorial_started_at,now()),quality_status=coalesce(quality_status,'pending') where id=r.id;
  return jsonb_build_object('ok',true);
 end if;
 if p_key is null or p_key !~ '^[a-f0-9]{64}$' then raise exception 'EDITORIAL_CHECKPOINT_INVALID'; end if;
 if p_action in ('claim','claim_artifact') then
  insert into public.studio_editorial_checkpoints(user_id,project_id,key,owner_render,owner_lease,state,kind)
  values(r.user_id,r.project_id,p_key,r.id,p_lease,'started',case when p_action='claim_artifact' then 'artifact' else 'model' end) on conflict do nothing;
  get diagnostics inserted=row_count;
  select * into c from public.studio_editorial_checkpoints where user_id=r.user_id and project_id=r.project_id and key=p_key;
  if c.kind<>(case when p_action='claim_artifact' then 'artifact' else 'model' end) then raise exception 'EDITORIAL_CHECKPOINT_INVALID'; end if;
  -- Artifact creation is deterministic/CPU-only. Unlike an in-flight model
  -- request, it can be reclaimed after its worker fails without another charge.
  if inserted=0 and c.kind='artifact' and c.state='started' and
   (c.owner_render=r.id and c.owner_lease=p_lease or not exists(select 1 from public.studio_renders old where old.id=c.owner_render and old.status='running' and old.lease_token=c.owner_lease and old.lease_expires_at>now())) then
   update public.studio_editorial_checkpoints set owner_render=r.id,owner_lease=p_lease,updated_at=now() where user_id=r.user_id and project_id=r.project_id and key=p_key returning * into c;
   inserted:=1;
  end if;
  return jsonb_build_object('claimed',inserted=1,'state',c.state,'value',c.value);
 elsif p_action='get' then
  select * into c from public.studio_editorial_checkpoints where user_id=r.user_id and project_id=r.project_id and key=p_key;
  if not found then return null; end if;
  return jsonb_build_object('state',c.state,'value',c.value);
 elsif p_action='save' then
  if coalesce(p_value->>'state','') not in ('started','done','failed') or jsonb_typeof(p_value->'value') is distinct from 'object' then raise exception 'EDITORIAL_CHECKPOINT_INVALID'; end if;
  select * into c from public.studio_editorial_checkpoints where user_id=r.user_id and project_id=r.project_id and key=p_key for update;
  if not found or c.owner_render<>r.id or c.owner_lease<>p_lease then raise exception 'LEASE_LOST'; end if;
  if c.state in ('done','failed') then
   if c.state=p_value->>'state' and c.value=p_value->'value' then return jsonb_build_object('state',c.state,'value',c.value); end if;
   raise exception 'IDEMPOTENCY_CONFLICT';
  end if;
  update public.studio_editorial_checkpoints set state=p_value->>'state',value=p_value->'value',updated_at=now() where user_id=r.user_id and project_id=r.project_id and key=p_key returning * into c;
  return jsonb_build_object('state',c.state,'value',c.value);
 end if;
 raise exception 'EDITORIAL_CHECKPOINT_INVALID';
end $$;
revoke all on function public.studio_editorial_checkpoint(text,uuid,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.studio_editorial_checkpoint(text,uuid,uuid,text,text,jsonb) to service_role;
