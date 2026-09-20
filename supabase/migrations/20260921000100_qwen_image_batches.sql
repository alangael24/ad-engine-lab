begin;
create table public.qwen_image_control(
 id boolean primary key default true check(id), enabled boolean not null default false,
 commercial_authorized boolean not null default false,
 owner text, token uuid, lease_until timestamptz, current_run uuid
);
insert into public.qwen_image_control(id) values(true);
create table public.qwen_image_runs(
 id uuid primary key default gen_random_uuid(), name text not null unique,
 phase text not null default 'creating' check(phase in ('creating','running','draining','closed','blocked')),
 pod_id text, image_digest text not null, hourly_usd numeric not null default .69,
 created_at timestamptz not null default now(), ready_at timestamptz, closed_at timestamptz,
 heartbeat_at timestamptz, last_job_at timestamptz, error text,
 deadline_at timestamptz not null default now()+interval '60 minutes',
 compute_usd numeric, storage_usd numeric,
 cost_basis text not null default 'Elapsed time × hourly rate; storage and settled provider invoice pending'
);
create table public.qwen_image_jobs(
 id uuid primary key default gen_random_uuid(), production_id uuid not null references public.studio_productions(id),
 step_key text not null, fingerprint text not null check(fingerprint ~ '^[a-f0-9]{64}$'),
 request jsonb not null, asset_id uuid not null default gen_random_uuid(),
 status text not null default 'queued' check(status in ('queued','running','succeeded','failed','uncertain')),
 run_id uuid references public.qwen_image_runs(id), claim_token uuid,
 created_at timestamptz not null default now(), started_at timestamptz, finished_at timestamptz,
 receipt jsonb, error text, active_usd numeric, allocated_compute_usd numeric,
 unique(production_id,step_key)
);
create index on public.qwen_image_jobs(status,created_at);
alter table public.qwen_image_control enable row level security;
alter table public.qwen_image_runs enable row level security;
alter table public.qwen_image_jobs enable row level security;
revoke all on public.qwen_image_control,public.qwen_image_runs,public.qwen_image_jobs from public,anon,authenticated;
grant all on public.qwen_image_control,public.qwen_image_runs,public.qwen_image_jobs to service_role;

create function public.qwen_image_work(p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path='' as $$
declare c public.qwen_image_control; r public.qwen_image_runs; q public.qwen_image_jobs;
 n integer; total numeric; active numeric; budget numeric;
begin
 select * into c from public.qwen_image_control where id for update;
 if p_action='enqueue' then
  if not c.enabled or not c.commercial_authorized then raise exception 'QWEN_DISABLED'; end if;
  select * into q from public.qwen_image_jobs where production_id=(p_data->>'productionId')::uuid and step_key=p_data->>'key';
  if found then
   if q.fingerprint<>p_data->>'fingerprint' then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
   return to_jsonb(q);
  end if;
  if not exists(select 1 from public.production_spend_reservations where job_id=(p_data->>'productionId')::uuid and step_key=p_data->>'key' and kind='image') then raise exception 'QWEN_RESERVATION_REQUIRED'; end if;
  insert into public.qwen_image_jobs(production_id,step_key,fingerprint,request)
   values((p_data->>'productionId')::uuid,p_data->>'key',p_data->>'fingerprint',p_data->'request') returning * into q;
  return to_jsonb(q);
 end if;
 if p_action='acquire' then
  if c.lease_until>now() then return '{"busy":true}'::jsonb; end if;
  update public.qwen_image_control set owner=p_data->>'owner',token=gen_random_uuid(),lease_until=now()+interval '110 seconds' where id returning * into c;
 elsif p_action in ('begin','attach','drain','close','release','block') then
  if c.token is distinct from (p_data->>'token')::uuid or c.owner is distinct from p_data->>'owner' or c.lease_until<=now() then raise exception 'LEASE_LOST'; end if;
 end if;
 select * into r from public.qwen_image_runs where id=c.current_run for update;
 if p_action='begin' then
  if not c.enabled or not c.commercial_authorized or (r.id is not null and r.phase<>'closed') then raise exception 'QWEN_BUSY'; end if;
  if not exists(select 1 from public.qwen_image_jobs x join public.studio_productions p on p.id=x.production_id where x.status='queued' and p.status='running' and p.stage in ('images','repair')) then raise exception 'QWEN_EMPTY'; end if;
  insert into public.qwen_image_runs(name,image_digest,hourly_usd) values('cr-qwen-'||gen_random_uuid(),p_data->>'image', (p_data->>'hourlyUsd')::numeric) returning * into r;
  update public.qwen_image_control set current_run=r.id where id;
  update public.qwen_image_jobs set run_id=r.id where id=(select x.id from public.qwen_image_jobs x join public.studio_productions p on p.id=x.production_id where x.status='queued' and p.status='running' and p.stage in ('images','repair') order by x.created_at limit 1);
 elsif p_action='attach' then
  if r.pod_id is not null and r.pod_id<>p_data->>'podId' then raise exception 'QWEN_POD_CONFLICT'; end if;
  update public.qwen_image_runs set pod_id=p_data->>'podId' where id=r.id returning * into r;
 elsif p_action='block' then
  update public.qwen_image_runs set phase='blocked',error=p_data->>'reason' where id=r.id returning * into r;
 elsif p_action='drain' then
  update public.qwen_image_runs set phase='draining',error=p_data->>'reason' where id=r.id returning * into r;
 elsif p_action='close' then
  if r.phase not in ('draining','closed') then raise exception 'QWEN_NOT_DRAINING'; end if;
  if r.closed_at is null then
   total:=greatest(0,extract(epoch from now()-r.created_at))*r.hourly_usd/3600;
   update public.qwen_image_runs set phase='closed',closed_at=now(),compute_usd=total where id=r.id returning * into r;
   update public.qwen_image_jobs set status='uncertain',error='QWEN_RUN_ENDED' where run_id=r.id and status in ('running','queued');
   select count(*),coalesce(sum(active_usd),0) into n,active from public.qwen_image_jobs where run_id=r.id;
   if n>0 then
    update public.qwen_image_jobs set allocated_compute_usd=coalesce(active_usd,0)+greatest(0,total-active)/n where run_id=r.id;
    -- The controller reconciles whole-session overhead after confirmed deletion.
    -- Do not lose it merely because a production lease has finished.
    update public.production_spend_reservations s set measured_microusd=greatest(coalesce(s.measured_microusd,0),ceil(qi.allocated_compute_usd*1000000)::bigint)
     from public.qwen_image_jobs qi where qi.run_id=r.id and s.job_id=qi.production_id and s.step_key=qi.step_key;
   end if;
  end if;
 elsif p_action='release' then
  update public.qwen_image_control set owner=null,token=null,lease_until=null where id;
  return '{"ok":true}'::jsonb;
 elsif p_action in ('progress','claim','finish','fail') then
  if r.id is distinct from (p_data->>'runId')::uuid or r.phase not in ('creating','running') then raise exception 'QWEN_RUN_CLOSED'; end if;
  update public.qwen_image_runs set heartbeat_at=now() where id=r.id;
  if p_action='progress' then
   if p_data->>'ready'='true' then update public.qwen_image_runs set ready_at=coalesce(ready_at,now()),phase='running',last_job_at=coalesce(last_job_at,now()) where id=r.id; end if;
   if p_data->>'error' is not null then update public.qwen_image_runs set phase='blocked',error=p_data->>'error' where id=r.id; end if;
   return '{"ok":true}'::jsonb;
  end if;
  if p_action='claim' then
   if not c.enabled or r.phase<>'running' or r.deadline_at<=now() then return 'null'::jsonb; end if;
   -- At most one GPU operation. A lost claim response returns the same job.
   select * into q from public.qwen_image_jobs where run_id=r.id and status='running' order by created_at limit 1 for update;
   if not found then
    select x.* into q from public.qwen_image_jobs x join public.studio_productions p on p.id=x.production_id
     where x.status='queued' and p.status='running' and p.stage in ('images','repair') order by x.created_at limit 1 for update of x skip locked;
    if not found then return 'null'::jsonb; end if;
    update public.qwen_image_jobs set status='running',run_id=r.id,claim_token=gen_random_uuid(),started_at=now() where id=q.id returning * into q;
   end if;
   update public.qwen_image_runs set last_job_at=now() where id=r.id;
   return to_jsonb(q);
  end if;
  select * into q from public.qwen_image_jobs where id=(p_data->>'id')::uuid and run_id=r.id for update;
  if q.id is null or q.claim_token is distinct from (p_data->>'claimToken')::uuid then raise exception 'LEASE_LOST'; end if;
  if q.status in ('succeeded','failed') then return to_jsonb(q); end if;
  if q.status<>'running' then raise exception 'QWEN_UNCERTAIN'; end if;
  active:=greatest(0,extract(epoch from now()-q.started_at))*r.hourly_usd/3600;
  update public.qwen_image_jobs set status=case when p_action='finish' then 'succeeded' else 'failed' end,finished_at=now(),receipt=p_data->'receipt',error=p_data->>'error',active_usd=active where id=q.id returning * into q;
  update public.qwen_image_runs set last_job_at=now() where id=r.id;
  return to_jsonb(q);
 end if;
 select count(*) into n from public.qwen_image_jobs x join public.studio_productions p on p.id=x.production_id where x.status='queued' and p.status='running' and p.stage in ('images','repair');
 select coalesce(sum(s.estimated_microusd),0)/1000000.0 into budget from public.production_spend_reservations s join public.qwen_image_jobs x on x.production_id=s.job_id and x.step_key=s.step_key
 where x.run_id=r.id or (x.status='queued' and exists(select 1 from public.studio_productions p where p.id=x.production_id and p.status='running' and p.stage in ('images','repair')));
 return jsonb_build_object('token',c.token,'enabled',c.enabled and c.commercial_authorized,'run',to_jsonb(r),'pending',n,'budgetUsd',budget,
  'running',exists(select 1 from public.qwen_image_jobs where run_id=r.id and status='running'),
  'holding',exists(select 1 from public.qwen_image_jobs x join public.studio_productions p on p.id=x.production_id where x.run_id=r.id and p.status='running' and p.stage in ('images','repair') and p.updated_at>now()-interval '3 minutes'));
end $$;
revoke all on function public.qwen_image_work(text,jsonb) from public,anon,authenticated;
grant execute on function public.qwen_image_work(text,jsonb) to service_role;
commit;
