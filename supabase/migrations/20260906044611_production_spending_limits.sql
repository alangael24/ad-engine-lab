begin;
-- Operator-owned estimates, in millionths of USD. Zero means paid work is disabled.
create table public.production_spend_policy (
 id boolean primary key default true check(id),
 project_limit bigint not null default 0 check(project_limit>=0),
 total_limit bigint not null default 0 check(total_limit>=0),
 rates jsonb not null default '{}'
);
insert into public.production_spend_policy(id) values(true);
create table public.production_spend_reservations (
 job_id uuid not null references public.studio_productions(id),
 step_key text not null,
 project_id uuid not null references public.studio_projects(id),
 kind text not null,
 units integer not null check(units>0),
 estimated_microusd bigint not null check(estimated_microusd>0),
 created_at timestamptz not null default now(),
 primary key(job_id,step_key)
);
alter table public.production_spend_policy enable row level security;
alter table public.production_spend_reservations enable row level security;
revoke all on public.production_spend_policy,public.production_spend_reservations from public,anon,authenticated;
grant all on public.production_spend_policy,public.production_spend_reservations to service_role;
create function public.reserve_production_spend(p_worker text,p_job uuid,p_lease uuid,p_key text,p_kind text,p_units integer default 1)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare j public.studio_productions; policy public.production_spend_policy; prior public.production_spend_reservations; amount bigint; total bigint; project_total bigint;
begin
 perform public.studio_production_work(p_worker,'heartbeat',p_job,p_lease,'{}');
 select * into j from public.studio_productions where id=p_job;
 if p_kind not in ('planning','image','narration','clip','quality','assembly') or p_units not between 1 and 120 or length(p_key) not between 1 and 100 then raise exception 'PRODUCTION_INVALID'; end if;
 -- One shared lock also enforces the account-wide ceiling under concurrency.
 select * into policy from public.production_spend_policy where id=true for update;
 select * into prior from public.production_spend_reservations where job_id=p_job and step_key=p_key;
 if found then
  if prior.kind<>p_kind or prior.units<>p_units then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  return to_jsonb(prior);
 end if;
 amount:=coalesce((policy.rates->>p_kind)::bigint,0)*p_units;
 if policy.project_limit<=0 or policy.total_limit<=0 or amount<=0 then raise exception 'PRODUCTION_BUDGET_DISABLED'; end if;
 select coalesce(sum(estimated_microusd),0),coalesce(sum(estimated_microusd) filter(where project_id=j.project_id),0) into total,project_total from public.production_spend_reservations;
 if total+amount>policy.total_limit or project_total+amount>policy.project_limit then raise exception 'PRODUCTION_BUDGET_EXCEEDED'; end if;
 insert into public.production_spend_reservations(job_id,step_key,project_id,kind,units,estimated_microusd)
 values(p_job,p_key,j.project_id,p_kind,p_units,amount) returning * into prior;
 -- Keep reservations after failures: an ambiguous provider response can still cost money.
 return to_jsonb(prior);
end $$;
revoke all on function public.reserve_production_spend(text,uuid,uuid,text,text,integer) from public,anon,authenticated;
grant execute on function public.reserve_production_spend(text,uuid,uuid,text,text,integer) to service_role;
-- A persistent drain switch prevents a claim racing the idle shutdown.
create table public.gpu_idle_control(id boolean primary key default true check(id),draining boolean not null default false,idle_since timestamptz);
insert into public.gpu_idle_control(id) values(true);
alter table public.gpu_idle_control enable row level security;
revoke all on public.gpu_idle_control from public,anon,authenticated;
grant all on public.gpu_idle_control to service_role;
alter function public.claim_generation(text) rename to claim_generation_before_idle_guard;
create function public.claim_generation(p_worker_id text) returns public.generation_jobs language plpgsql security invoker set search_path='' as $$
declare control public.gpu_idle_control;
begin
 select * into control from public.gpu_idle_control where id=true for update;
 if control.draining then return null; end if;
 return public.claim_generation_before_idle_guard(p_worker_id);
end $$;
create function public.gpu_idle_check(p_idle_seconds integer default 600) returns jsonb language plpgsql security invoker set search_path='' as $$
declare control public.gpu_idle_control;
begin
 if p_idle_seconds not between 300 and 86400 then raise exception 'INVALID_IDLE_TIMEOUT'; end if;
 select * into control from public.gpu_idle_control where id=true for update;
 -- Running jobs remain protected even when their lease is stale or outcome uncertain.
 if exists(select 1 from public.generation_jobs where status in ('running','queued')) then
  update public.gpu_idle_control set idle_since=null where id=true;
  return jsonb_build_object('stop',false,'reason','work_pending');
 end if;
 -- Avoid stopping between images, clip submissions, or automatic QA repairs.
 if exists(select 1 from public.studio_productions where status in ('queued','running')) then
  update public.gpu_idle_control set idle_since=null where id=true;
  return jsonb_build_object('stop',false,'reason','production_pending');
 end if;
 if control.idle_since is null then
  update public.gpu_idle_control set idle_since=now() where id=true;
  return jsonb_build_object('stop',false,'reason','grace');
 end if;
 if control.idle_since>now()-make_interval(secs=>p_idle_seconds) then return jsonb_build_object('stop',false,'reason','grace'); end if;
 update public.gpu_idle_control set draining=true where id=true;
 return jsonb_build_object('stop',true);
end $$;
revoke all on function public.claim_generation(text),public.gpu_idle_check(integer) from public,anon,authenticated;
grant execute on function public.claim_generation(text),public.gpu_idle_check(integer) to service_role;
commit;
