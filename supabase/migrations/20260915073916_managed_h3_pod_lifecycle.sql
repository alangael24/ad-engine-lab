begin;
create table public.h3_pod_control (
 id boolean primary key default true check(id), enabled boolean not null default false,
 total_limit_microusd bigint not null default 0 check(total_limit_microusd>=0),
 run_limit_microusd bigint not null default 500000 check(run_limit_microusd between 100000 and 2000000),
 owner text, token uuid, lease_until timestamptz, current_run uuid
);
insert into public.h3_pod_control(id) values(true);
create table public.h3_pod_runs (
 id uuid primary key, name text unique not null, pod_id text unique,
 phase text not null check(phase in ('creating','preparing','running','draining','closed','blocked')),
 created_at timestamptz not null default now(), ready_at timestamptz, idle_since timestamptz,
 deadline_at timestamptz not null, closed_at timestamptz,
 reserved_microusd bigint not null, estimated_microusd bigint, reason text,
 worker_prefix text not null
);
alter table public.h3_pod_control enable row level security;
alter table public.h3_pod_runs enable row level security;
revoke all on public.h3_pod_control,public.h3_pod_runs from public,anon,authenticated;
grant all on public.h3_pod_control,public.h3_pod_runs to service_role;
create function public.h3_pod_work(p_owner text,p_action text,p_token uuid default null,p_data jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.h3_pod_control; r public.h3_pod_runs; pending boolean; running boolean; amount bigint; rid uuid;
begin
 if length(p_owner) not between 1 and 80 then raise exception 'INVALID_CONTROLLER'; end if;
 select * into c from public.h3_pod_control where id for update;
 if p_action='acquire' then
  if c.lease_until>now() then return jsonb_build_object('busy',true); end if;
  update public.h3_pod_control set owner=p_owner,token=gen_random_uuid(),lease_until=now()+interval '90 seconds' where id returning * into c;
 elsif c.owner is distinct from p_owner or c.token is distinct from p_token or c.lease_until<=now() then raise exception 'LEASE_LOST';
 end if;
 select * into r from public.h3_pod_runs where id=c.current_run;
 select exists(select 1 from public.generation_jobs where status='queued'),exists(select 1 from public.generation_jobs where status='running') into pending,running;
 if p_action='begin' then
  if not c.enabled or not pending or running or (r.id is not null and r.phase<>'closed') then raise exception 'POD_NOT_ADMITTED'; end if;
  select coalesce(sum(coalesce(estimated_microusd,reserved_microusd)),0) into amount from public.h3_pod_runs;
  if c.total_limit_microusd<=0 or amount+c.run_limit_microusd>c.total_limit_microusd then raise exception 'POD_BUDGET_EXCEEDED'; end if;
  rid:=gen_random_uuid();
  insert into public.h3_pod_runs(id,name,phase,deadline_at,reserved_microusd,worker_prefix)
   values(rid,'cr-h3-'||rid,'creating',now()+interval '40 minutes',c.run_limit_microusd,'pod_'||replace(rid::text,'-','')) returning * into r;
  update public.h3_pod_control set current_run=rid where id;
  update public.gpu_idle_control set draining=true,idle_since=null where id;
 elsif p_action='attach' then
  if r.id is null or r.phase not in ('creating','preparing','running','blocked') or (p_data->>'podId')!~'^[a-zA-Z0-9]{8,40}$' then raise exception 'INVALID_POD'; end if;
  if r.pod_id is not null and r.pod_id<>p_data->>'podId' then raise exception 'POD_CONFLICT'; end if;
  update public.h3_pod_runs set pod_id=p_data->>'podId',phase=case when phase='blocked' then 'draining' when phase='running' then phase else 'preparing' end where id=r.id returning * into r;
 elsif p_action='drain' then
  perform 1 from public.gpu_idle_control where id for update;
  if r.phase<>'draining' and p_data->>'reason'='idle' and exists(select 1 from public.generation_jobs where status in ('queued','running')) then raise exception 'POD_BUSY'; end if;
  update public.gpu_idle_control set draining=true where id;
  update public.h3_pod_runs set phase='draining',reason=left(p_data->>'reason',100) where id=r.id returning * into r;
  if coalesce(p_data->>'reason','')<>'idle' then update public.h3_pod_control set enabled=false where id; end if;
 elsif p_action='block' then
  update public.gpu_idle_control set draining=true where id;
  update public.h3_pod_control set enabled=false where id;
  update public.h3_pod_runs set phase='blocked',reason=left(p_data->>'reason',100) where id=r.id returning * into r;
 elsif p_action='close' then
  if r.phase<>'draining' or r.pod_id is null then raise exception 'POD_SHUTDOWN_UNCONFIRMED'; end if;
  update public.h3_pod_runs set phase='closed',closed_at=now(),estimated_microusd=ceil(extract(epoch from now()-created_at)*730000/3600)::bigint where id=r.id returning * into r;
 elsif p_action not in ('acquire','release','heartbeat') then raise exception 'INVALID_ACTION'; end if;
 if r.phase='running' then
  update public.h3_pod_runs set idle_since=case when pending or running then null else coalesce(idle_since,now()) end where id=r.id returning * into r;
 end if;
 if p_action='release' then update public.h3_pod_control set lease_until=now() where id;
 else update public.h3_pod_control set lease_until=now()+interval '90 seconds' where id; end if;
 select coalesce(sum(coalesce(estimated_microusd,reserved_microusd)),0) into amount from public.h3_pod_runs;
 if c.enabled and (c.total_limit_microusd>=amount+c.run_limit_microusd or r.phase in ('creating','preparing','running')) and (r.id is null or r.phase not in ('blocked','draining')) then
  insert into public.generation_workers(id) values('managed-h3-controller') on conflict(id) do update set last_seen_at=now();
 end if;
 return jsonb_build_object('token',c.token,'enabled',c.enabled,'run',to_jsonb(r),'pending',pending,'running',running);
end $$;
create function public.h3_pod_ready(p_run uuid,p_worker text) returns void language plpgsql security invoker set search_path='' as $$
declare c public.h3_pod_control; r public.h3_pod_runs;
begin
 select * into c from public.h3_pod_control where id for update;
 select * into r from public.h3_pod_runs where id=p_run;
 if c.current_run is distinct from p_run or r.phase not in ('creating','preparing','running') or p_worker is distinct from r.worker_prefix or r.deadline_at<=now() then raise exception 'POD_NOT_ADMITTED'; end if;
 update public.h3_pod_runs set phase='running',ready_at=coalesce(ready_at,now()) where id=r.id;
 update public.gpu_idle_control set draining=false,idle_since=null where id;
end $$;
revoke all on function public.h3_pod_work(text,text,uuid,jsonb),public.h3_pod_ready(uuid,text) from public,anon,authenticated;
grant execute on function public.h3_pod_work(text,text,uuid,jsonb),public.h3_pod_ready(uuid,text) to service_role;
-- Fence the GPU worker against a stale/deleted run or impending hard deadline.
create or replace function public.claim_generation(p_worker_id text) returns public.generation_jobs language plpgsql security invoker set search_path='' as $$
declare control public.gpu_idle_control; c public.h3_pod_control; r public.h3_pod_runs;
begin
 select * into control from public.gpu_idle_control where id for update;
 if control.draining then return null; end if;
 select * into c from public.h3_pod_control where id;
 if c.current_run is not null then
  select * into r from public.h3_pod_runs where id=c.current_run;
  if r.phase<>'running' or not c.enabled or p_worker_id not like r.worker_prefix||'_%' or r.deadline_at<=now()+interval '3 minutes' then return null; end if;
 end if;
 return public.claim_generation_before_idle_guard(p_worker_id);
end $$;
commit;
