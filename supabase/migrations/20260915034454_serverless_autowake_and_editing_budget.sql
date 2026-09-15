-- Editing is one bounded model session, not 120 planning operations.
alter table public.production_spend_policy add column allowed_user_ids uuid[];
-- This migration does not authorize paid work or reset historical reservations.
update public.production_spend_policy set rates=rates||jsonb_build_object('editing',2000000)
  where not rates ? 'editing';
create or replace function public.reserve_production_spend(p_worker text,p_job uuid,p_lease uuid,p_key text,p_kind text,p_units integer default 1)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare j public.studio_productions; policy public.production_spend_policy; prior public.production_spend_reservations; amount bigint; total bigint; project_total bigint;
begin
 perform public.studio_production_work(p_worker,'heartbeat',p_job,p_lease,'{}');
 select * into j from public.studio_productions where id=p_job;
 if p_kind not in ('planning','image','narration','clip','quality','assembly','editing') or p_units not between 1 and 120 or length(p_key) not between 1 and 100 then raise exception 'PRODUCTION_INVALID'; end if;
 -- One shared lock also enforces the account-wide ceiling under concurrency.
 select * into policy from public.production_spend_policy where id=true for update;
 if policy.allowed_user_ids is not null and not (j.user_id=any(policy.allowed_user_ids)) then raise exception 'PRODUCTION_BUDGET_DISABLED'; end if;
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

-- Idle shutdown and dispatch share the same lock. A crashed shutdown is resumed
-- before any new GPU job; expiry transfers cleanup ownership, not permission to run.
alter table public.generation_serverless_state
  add column idle_owner text,
  add column idle_token uuid,
  add column idle_lease_until timestamptz,
  add column idle_verified_at timestamptz;

alter function public.claim_serverless_generation(text,boolean) rename to claim_serverless_before_idle;
create function public.claim_serverless_generation(p_worker_id text,p_allow_new boolean default true)
returns public.generation_jobs language plpgsql security invoker set search_path='' as $$
declare j public.generation_jobs;
begin
  insert into public.generation_workers(id,last_seen_at) values('h3-serverless-dispatch-lock','-infinity') on conflict(id) do nothing;
  perform 1 from public.generation_workers where id='h3-serverless-dispatch-lock' for update;
  if exists(select 1 from public.generation_serverless_state where idle_token is not null) then return null; end if;
  j:=public.claim_serverless_before_idle(p_worker_id,p_allow_new);
  if j.id is not null then update public.generation_serverless_state set idle_verified_at=null where id=true; end if;
  return j;
end $$;
revoke all on function public.claim_serverless_before_idle(text,boolean) from public,anon,authenticated,service_role;
-- The invoker wrapper needs this helper; it stays restricted to the backend role.
grant execute on function public.claim_serverless_before_idle(text,boolean) to service_role;
revoke all on function public.claim_serverless_generation(text,boolean) from public,anon,authenticated;
grant execute on function public.claim_serverless_generation(text,boolean) to service_role;

create function public.serverless_idle_work(p_worker text,p_action text,p_token uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare s public.generation_serverless_state;
begin
  if p_worker is null or p_worker !~ '^[a-zA-Z0-9_-]{1,80}$' or p_action not in ('claim','heartbeat','complete') then raise exception 'INVALID_GENERATION'; end if;
  insert into public.generation_workers(id,last_seen_at) values('h3-serverless-dispatch-lock','-infinity') on conflict(id) do nothing;
  perform 1 from public.generation_workers where id='h3-serverless-dispatch-lock' for update;
  select * into s from public.generation_serverless_state where id=true for update;
  if p_action='claim' then
    if s.idle_token is not null and s.idle_lease_until>now() and s.idle_owner<>p_worker then return jsonb_build_object('stop',false,'reason','owned'); end if;
    if s.idle_token is null then
      if exists(select 1 from public.generation_jobs where status in ('queued','running'))
        or exists(select 1 from public.studio_productions where status in ('queued','running')) then
        return jsonb_build_object('stop',false,'reason','work_pending');
      end if;
      -- Avoid four provider reads every five seconds when already verified off.
      if s.idle_verified_at>now()-interval '60 seconds' then return jsonb_build_object('stop',false,'reason','recently_verified'); end if;
    end if;
    update public.generation_serverless_state set idle_owner=p_worker,
      idle_token=case when idle_owner=p_worker and idle_lease_until>now() then idle_token else gen_random_uuid() end,
      idle_lease_until=now()+interval '3 minutes' where id=true returning * into s;
    return jsonb_build_object('stop',true,'token',s.idle_token);
  end if;
  if s.idle_owner is distinct from p_worker or s.idle_token is distinct from p_token or p_token is null or s.idle_lease_until<=now() then raise exception 'LEASE_LOST'; end if;
  if p_action='complete' then
    update public.generation_serverless_state set idle_owner=null,idle_token=null,idle_lease_until=null,idle_verified_at=now() where id=true;
  else
    update public.generation_serverless_state set idle_lease_until=now()+interval '3 minutes' where id=true;
  end if;
  return jsonb_build_object('ok',true);
end $$;
revoke all on function public.serverless_idle_work(text,text,uuid) from public,anon,authenticated;
grant execute on function public.serverless_idle_work(text,text,uuid) to service_role;
