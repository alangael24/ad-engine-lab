alter table public.production_spend_reservations add column measured_microusd bigint check(measured_microusd>=0);
-- Admission keeps unknown charges reserved; confirmed use replaces its estimate.
create function public.account_production_spend(p_worker text,p_job uuid,p_lease uuid,p_key text,p_action text,p_amount bigint)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare j public.studio_productions; r public.production_spend_reservations; policy public.production_spend_policy; total bigint; subtotal bigint; prior bigint;
begin
 perform public.studio_production_work(p_worker,'heartbeat',p_job,p_lease,'{}');
 if p_action is null or p_action not in ('reserve','settle') or p_amount is null or p_amount<0 or p_amount>100000000 or p_key is null then raise exception 'PRODUCTION_INVALID'; end if;
 select * into j from public.studio_productions where id=p_job;
 select * into policy from public.production_spend_policy where id=true for update;
 select * into r from public.production_spend_reservations where job_id=p_job and step_key=p_key for update;
 if not found then raise exception 'PRODUCTION_INVALID'; end if;
 prior:=coalesce(r.measured_microusd,r.estimated_microusd);
 if p_action='reserve' then
  if p_amount<coalesce(r.measured_microusd,0) then raise exception 'PRODUCTION_INVALID'; end if;
  if policy.project_limit<=0 or policy.total_limit<=0 or (policy.allowed_user_ids is not null and not(j.user_id=any(policy.allowed_user_ids))) then raise exception 'PRODUCTION_BUDGET_DISABLED'; end if;
  select coalesce(sum(coalesce(measured_microusd,estimated_microusd)),0),coalesce(sum(coalesce(measured_microusd,estimated_microusd)) filter(where project_id=j.project_id),0) into total,subtotal from public.production_spend_reservations;
  if total-prior+p_amount>policy.total_limit or subtotal-prior+p_amount>policy.project_limit then raise exception 'PRODUCTION_BUDGET_EXCEEDED'; end if;
  update public.production_spend_reservations set estimated_microusd=greatest(1,p_amount),measured_microusd=null where job_id=p_job and step_key=p_key returning * into r;
 else
  -- Record a real overrun even if it exhausted the ceiling; future admission stops.
  if r.measured_microusd is not null and p_amount<r.measured_microusd then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  update public.production_spend_reservations set measured_microusd=p_amount where job_id=p_job and step_key=p_key returning * into r;
 end if;
 return to_jsonb(r);
end $$;
revoke all on function public.account_production_spend(text,uuid,uuid,text,text,bigint) from public,anon,authenticated;
grant execute on function public.account_production_spend(text,uuid,uuid,text,text,bigint) to service_role;

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
 select coalesce(sum(coalesce(measured_microusd,estimated_microusd)),0),coalesce(sum(coalesce(measured_microusd,estimated_microusd)) filter(where project_id=j.project_id),0) into total,project_total from public.production_spend_reservations;
 if total+amount>policy.total_limit or project_total+amount>policy.project_limit then raise exception 'PRODUCTION_BUDGET_EXCEEDED'; end if;
 insert into public.production_spend_reservations(job_id,step_key,project_id,kind,units,estimated_microusd)
 values(p_job,p_key,j.project_id,p_kind,p_units,amount) returning * into prior;
 -- Keep reservations after failures: an ambiguous provider response can still cost money.
 return to_jsonb(prior);
end $$;
revoke all on function public.reserve_production_spend(text,uuid,uuid,text,text,integer) from public,anon,authenticated;
grant execute on function public.reserve_production_spend(text,uuid,uuid,text,text,integer) to service_role;


-- Preserve exact-input audio checkpoints across explicit retries, including an
-- ambiguous started TTS request. Never silently resynthesize that request.
alter function public.studio_production_start(uuid,uuid,uuid,integer,boolean) rename to studio_production_start_before_voice_recovery;
create function public.studio_production_start(p_user uuid,p_id uuid,p_project uuid,p_expected integer,p_enabled boolean)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb; previous public.studio_productions; checkpoints jsonb; existed boolean;
begin
 perform pg_advisory_xact_lock(hashtext('studio:'||p_user::text));
 existed:=exists(select 1 from public.studio_productions where id=p_id);
 result:=public.studio_production_start_before_voice_recovery(p_user,p_id,p_project,p_expected,p_enabled);
 if existed then return result; end if;
 select * into previous from public.studio_productions where project_id=p_project and user_id=p_user and id<>p_id and status in ('failed','uncertain')
   and expected_revision=p_expected and snapshot->'data'=result->'snapshot'->'data' and snapshot->'brand_snapshot'=result->'snapshot'->'brand_snapshot'
   order by created_at desc limit 1;
 if found then
  select coalesce(jsonb_object_agg(key,value),'{}') into checkpoints from jsonb_each(previous.steps) where key ~ '^voice-[a-f0-9]{32}$';
  update public.studio_productions set steps=steps||checkpoints where id=p_id returning to_jsonb(studio_productions) into result;
 end if;
 return result;
end $$;
revoke all on function public.studio_production_start_before_voice_recovery(uuid,uuid,uuid,integer,boolean),public.studio_production_start(uuid,uuid,uuid,integer,boolean) from public,anon,authenticated;
grant execute on function public.studio_production_start_before_voice_recovery(uuid,uuid,uuid,integer,boolean),public.studio_production_start(uuid,uuid,uuid,integer,boolean) to service_role;
-- Reconcile already recorded usage; historical unknown attempts keep estimates.
update public.production_spend_reservations r set measured_microusd=ceil((j.steps->r.step_key->'result'->'providerUsage'->>'cost')::numeric*1000000)
 from public.studio_productions j where r.job_id=j.id and j.steps->r.step_key->>'status'='done'
 and jsonb_typeof(j.steps->r.step_key->'result'->'providerUsage'->'cost')='number';
