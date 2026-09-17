begin;
-- Delivered-video seconds are a separate entitlement from legacy clip/image credits.
alter table public.credit_balances add column video_seconds integer not null default 0 check(video_seconds>=0), add column seconds_plan boolean not null default false;
alter table public.purchases add column video_seconds integer not null default 0 check(video_seconds>=0);
alter table public.purchases drop constraint purchases_plan_code_check;
alter table public.purchases add constraint purchases_plan_code_check check(plan_code in ('esencial','pro','minute_1','minute_3','minute_8'));

create table public.video_seconds_reservations (
 production_id uuid primary key references public.studio_productions(id) deferrable initially deferred,
 user_id uuid not null references auth.users(id), project_id uuid not null references public.studio_projects(id),
 reserved_seconds integer not null check(reserved_seconds between 0 and 60),
 included_seconds integer not null default 0 check(included_seconds between 0 and 60),
 duration_seconds integer check(duration_seconds between 1 and 60),
 status text not null default 'held' check(status in ('held','settled','released')),
 render_id uuid references public.studio_renders(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index video_seconds_reservations_owner_idx on public.video_seconds_reservations(user_id,status);
create index video_seconds_reservations_project_idx on public.video_seconds_reservations(project_id);
create table public.video_seconds_ledger (
 id bigint generated always as identity primary key,
 user_id uuid not null references auth.users(id),
 checkout_session_id text references public.purchases(checkout_session_id),
 production_id uuid references public.video_seconds_reservations(production_id) deferrable initially deferred,
 delta integer not null check(delta<>0), reason text not null,
 external_id text not null unique, created_at timestamptz not null default now()
);
create index video_seconds_ledger_owner_idx on public.video_seconds_ledger(user_id,created_at);
alter table public.video_seconds_reservations enable row level security;
alter table public.video_seconds_ledger enable row level security;
revoke all on public.video_seconds_reservations,public.video_seconds_ledger from public,anon,authenticated;
grant all on public.video_seconds_reservations,public.video_seconds_ledger to service_role;
grant usage,select on sequence public.video_seconds_ledger_id_seq to service_role;

create function public.apply_video_seconds_purchase(p_event_id text,p_checkout_session_id text,p_payment_link_id text,p_email text,p_stripe_customer_id text,p_plan_code text,p_amount_total bigint,p_currency text,p_payment_status text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid; seconds integer; expected_amount integer; inserted text; prior public.purchases;
begin
 seconds:=case p_plan_code when 'minute_1' then 60 when 'minute_3' then 180 when 'minute_8' then 480 end;
 expected_amount:=case p_plan_code when 'minute_1' then 50000 when 'minute_3' then 100000 when 'minute_8' then 200000 end;
 if seconds is null or p_amount_total is distinct from expected_amount or p_currency is distinct from 'mxn' or p_payment_status is distinct from 'paid' then raise exception 'INVALID_PURCHASE'; end if;
 select id into uid from auth.users where lower(email)=lower(trim(p_email)) order by created_at limit 1;
 if uid is null then raise exception 'ACCOUNT_NOT_READY'; end if;
 perform pg_advisory_xact_lock(hashtext('purchase:'||p_checkout_session_id));
 select * into prior from public.purchases where checkout_session_id=p_checkout_session_id;
 if found then
  if prior.user_id<>uid or prior.plan_code<>p_plan_code or prior.video_seconds<>seconds or prior.amount_total<>p_amount_total or prior.stripe_payment_link_id<>p_payment_link_id then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  return jsonb_build_object('applied',false);
 end if;
 insert into public.customer_accounts(user_id,email,stripe_customer_id) values(uid,lower(trim(p_email)),nullif(p_stripe_customer_id,''))
 on conflict on constraint customer_accounts_pkey do update set stripe_customer_id=coalesce(excluded.stripe_customer_id,public.customer_accounts.stripe_customer_id);
 insert into public.credit_balances(user_id) values(uid) on conflict(user_id) do nothing;
 insert into public.purchases(checkout_session_id,stripe_event_id,stripe_payment_link_id,user_id,email,plan_code,amount_total,currency,payment_status,video_credits,image_credits,video_seconds,course_access)
 values(p_checkout_session_id,p_event_id,p_payment_link_id,uid,lower(trim(p_email)),p_plan_code,p_amount_total,'mxn','paid',0,0,seconds,false);
 update public.credit_balances set video_seconds=video_seconds+seconds,seconds_plan=true,updated_at=now() where user_id=uid;
 insert into public.video_seconds_ledger(user_id,checkout_session_id,delta,reason,external_id) values(uid,p_checkout_session_id,seconds,'purchase',p_checkout_session_id);
 return jsonb_build_object('applied',true,'videoSeconds',seconds);
end $$;
revoke all on function public.apply_video_seconds_purchase(text,text,text,text,text,text,bigint,text,text) from public,anon,authenticated;
grant execute on function public.apply_video_seconds_purchase(text,text,text,text,text,text,bigint,text,text) to service_role;

create function public.production_uses_seconds(p_id uuid) returns boolean language sql security invoker set search_path='' as $$
 select exists(select 1 from public.video_seconds_reservations where production_id=p_id and status='held')
$$;
revoke all on function public.production_uses_seconds(uuid) from public,anon,authenticated;
grant execute on function public.production_uses_seconds(uuid) to service_role;

-- Keep all existing recovery/quality wrappers. Only replace the legacy credit guards.
do $$ declare definition text; changed text; f regprocedure; begin
 f:='public.studio_production_start_before_voice_recovery(uuid,uuid,uuid,integer,boolean)'::regprocedure;
 definition:=pg_get_functiondef(f);
 changed:=replace(definition,'select * into b from public.credit_balances where user_id=p_user for update;', 'if public.production_uses_seconds(p_id) then return result; end if; select * into b from public.credit_balances where user_id=p_user for update;');
 if changed=definition then raise exception 'SECONDS_START_GUARD_NOT_FOUND'; end if; execute changed;
 f:=coalesce(to_regprocedure('public.studio_production_work_before_gpu_wait(text,text,uuid,uuid,jsonb)'),to_regprocedure('public.studio_production_work(text,text,uuid,uuid,jsonb)'));
 definition:=pg_get_functiondef(f);
 changed:=replace(definition, 'if p_action=''write'' and p_data->>''action''=''version''', 'if not public.production_uses_seconds(p_id) and p_action=''write'' and p_data->>''action''=''version''');
 changed:=replace(changed, 'if p_action=''begin_step'' and p_data->>''key'' ~', 'if not public.production_uses_seconds(p_id) and p_action=''begin_step'' and p_data->>''key'' ~');
 if changed=definition then raise exception 'SECONDS_WORK_GUARD_NOT_FOUND'; end if; execute changed;
end $$;

alter function public.studio_production_start(uuid,uuid,uuid,integer,boolean) rename to studio_production_start_before_seconds;
create function public.studio_production_start(p_user uuid,p_id uuid,p_project uuid,p_expected integer,p_enabled boolean)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare b public.credit_balances; p public.studio_projects; result jsonb; hold integer; included integer:=0; prior public.video_seconds_reservations;
begin
 perform pg_advisory_xact_lock(hashtext('studio:'||p_user::text));
 if exists(select 1 from public.studio_productions where id=p_id) then return public.studio_production_start_before_seconds(p_user,p_id,p_project,p_expected,p_enabled); end if;
 select * into p from public.studio_projects where id=p_project and user_id=p_user for update;
 if not found then raise exception 'STUDIO_NOT_FOUND'; end if;
 select * into b from public.credit_balances where user_id=p_user for update;
 if b.seconds_plan then
  -- Caption/trim edits reusing the paid script and all source clips keep their
  -- duration entitlement. New media or a new script reserves a new delivery.
  if p.data->'editing'->>'scoped'='true' then
   select * into prior from public.video_seconds_reservations where project_id=p_project and user_id=p_user and status='settled' and render_id::text=p.data->'editing'->>'baseRenderId';
   if found and exists(select 1 from public.studio_productions original join public.studio_renders rendered on rendered.id=prior.render_id where original.id=prior.production_id and original.snapshot->'data'->>'scriptDraft'=p.data->>'scriptDraft'
    and jsonb_array_length(p.data->'scenes')>0
    and not exists(select 1 from jsonb_array_elements(p.data->'scenes') scene where not exists(select 1 from jsonb_array_elements(coalesce(rendered.manifest->'originalScenes',rendered.manifest->'scenes')) base where base->>'id'=scene->>'id' and coalesce(base->>'versionId',base->>'selectedVersionId')=scene->>'selectedVersionId' and base->>'text'=scene->>'text')))
   then included:=prior.duration_seconds; end if;
  end if;
  hold:=least(60-included,b.video_seconds);
  if hold+included<=0 then raise exception 'INSUFFICIENT_VIDEO_SECONDS'; end if;
  insert into public.video_seconds_reservations(production_id,user_id,project_id,reserved_seconds,included_seconds) values(p_id,p_user,p_project,hold,included);
  update public.credit_balances set video_seconds=video_seconds-hold,updated_at=now() where user_id=p_user;
  if hold>0 then insert into public.video_seconds_ledger(user_id,production_id,delta,reason,external_id) values(p_user,p_id,-hold,'reserved',p_id||':reserve'); end if;
 end if;
 result:=public.studio_production_start_before_seconds(p_user,p_id,p_project,p_expected,p_enabled);
 return result;
end $$;
revoke all on function public.studio_production_start_before_seconds(uuid,uuid,uuid,integer,boolean),public.studio_production_start(uuid,uuid,uuid,integer,boolean) from public,anon,authenticated;
grant execute on function public.studio_production_start_before_seconds(uuid,uuid,uuid,integer,boolean),public.studio_production_start(uuid,uuid,uuid,integer,boolean) to service_role;

-- All debits/credits below run in the same transaction as the fenced step.
create function public.adjust_video_seconds(p_id uuid,p_duration numeric,p_action text) returns void language plpgsql security invoker set search_path='' as $$
declare r public.video_seconds_reservations; seconds integer; needed integer; delta integer;
begin
 select * into r from public.video_seconds_reservations where production_id=p_id for update;
 if not found or r.status<>'held' then return; end if;
 if p_action='release' then
  delta:=r.reserved_seconds;
  update public.video_seconds_reservations set status='released',updated_at=now() where production_id=p_id;
 else
  if p_action not in ('resize','settle') then raise exception 'PRODUCTION_INVALID'; end if;
  if p_duration is null or p_duration<=0 or p_duration>60 then raise exception 'VIDEO_DURATION_LIMIT'; end if;
  seconds:=ceil(p_duration); needed:=greatest(0,seconds-r.included_seconds); delta:=r.reserved_seconds-needed;
  if delta<0 and not exists(select 1 from public.credit_balances where user_id=r.user_id and video_seconds>=-delta for update) then raise exception 'INSUFFICIENT_VIDEO_SECONDS'; end if;
  update public.video_seconds_reservations set reserved_seconds=needed,duration_seconds=seconds,status=case when p_action='settle' then 'settled' else 'held' end,updated_at=now() where production_id=p_id;
 end if;
 if delta<>0 then
  update public.credit_balances set video_seconds=video_seconds+delta,updated_at=now() where user_id=r.user_id;
  insert into public.video_seconds_ledger(user_id,production_id,delta,reason,external_id) values(r.user_id,p_id,delta,p_action,p_id||':'||p_action||':'||gen_random_uuid());
 end if;
end $$;
revoke all on function public.adjust_video_seconds(uuid,numeric,text) from public,anon,authenticated;
grant execute on function public.adjust_video_seconds(uuid,numeric,text) to service_role;

alter function public.studio_production_work(text,text,uuid,uuid,jsonb) rename to studio_production_work_before_seconds;
create function public.studio_production_work(p_worker text,p_action text,p_id uuid default null,p_lease uuid default null,p_data jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb; duration numeric; old_context text;
begin
 if public.production_uses_seconds(p_id) then
  -- Never trust a browser duration or a caller-selected production without a lease.
  if p_action<>'fail' then perform public.studio_production_work_before_seconds(p_worker,'heartbeat',p_id,p_lease,'{}'); end if;
  if p_action='begin_step' and p_data->>'key' ~ '^(image-|repair-image-|source-|repair-source-)' then
   select max((s->>'end')::numeric) into duration from public.studio_productions j cross join lateral jsonb_array_elements(j.steps->'timing'->'result') s where j.id=p_id;
   perform public.adjust_video_seconds(p_id,duration,'resize');
  end if;
  if p_action='finish_step' and p_data->>'key'='timing' then
   select max((s->>'end')::numeric) into duration from jsonb_array_elements(p_data->'result') s;
   perform public.adjust_video_seconds(p_id,duration,'resize');
  end if;
  if p_action='write' and p_data->>'action'='version' then
   old_context:=current_setting('app.seconds_production',true);
   perform set_config('app.seconds_production',p_id::text,true);
  end if;
 end if;
 result:=public.studio_production_work_before_seconds(p_worker,p_action,p_id,p_lease,p_data);
 if old_context is not null or current_setting('app.seconds_production',true)=p_id::text then perform set_config('app.seconds_production',coalesce(old_context,''),true); end if;
 if p_action='complete' and public.production_uses_seconds(p_id) then
  -- The final manifest is validated by the renderer and the quality gate.
  select max((s->>'end')::numeric) into duration from public.studio_renders r cross join lateral jsonb_array_elements(r.manifest->'scenes') s where r.id=(p_data->>'renderId')::uuid and r.production_id=p_id;
  perform public.adjust_video_seconds(p_id,duration,'settle');
  update public.video_seconds_reservations set render_id=(p_data->>'renderId')::uuid where production_id=p_id;
 elsif p_action='fail' then perform public.adjust_video_seconds(p_id,null,'release'); end if;
 return result;
end $$;
revoke all on function public.studio_production_work_before_seconds(text,text,uuid,uuid,jsonb),public.studio_production_work(text,text,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.studio_production_work_before_seconds(text,text,uuid,uuid,jsonb),public.studio_production_work(text,text,uuid,uuid,jsonb) to service_role;

alter table public.generation_jobs add column seconds_production_id uuid references public.video_seconds_reservations(production_id);
do $$ declare c record; n integer:=0; begin
 for c in select conname from pg_constraint where conrelid='public.generation_jobs'::regclass and contype='c' and pg_get_constraintdef(oid) like '%credit_cost = (duration_seconds / 5)%' loop
  execute format('alter table public.generation_jobs drop constraint %I',c.conname); n:=n+1;
 end loop;
 if n<>1 then raise exception 'SECONDS_GENERATION_CONSTRAINT_NOT_FOUND'; end if;
end $$;
alter table public.generation_jobs add constraint generation_jobs_credit_cost_check check((seconds_production_id is null and credit_cost=duration_seconds/5) or (seconds_production_id is not null and credit_cost=0));
create or replace function public.reserve_generation(
  p_user_id uuid, p_request_id uuid, p_prompt text, p_duration integer,
  p_resolution text, p_ratio text, p_reference_id uuid default null
) returns public.generation_jobs
language plpgsql security invoker set search_path = '' as $$
declare j public.generation_jobs; b public.credit_balances; cost integer; sponsor uuid;
begin
  -- Lock the balance first: concurrent tabs cannot overdraw or enqueue twice.
  select * into b from public.credit_balances where user_id = p_user_id for update;
  if not found then raise exception 'ACCOUNT_NOT_READY'; end if;
  select * into j from public.generation_jobs where user_id = p_user_id and request_id = p_request_id;
  if found then
    if j.prompt <> p_prompt or j.duration_seconds <> p_duration or j.resolution <> p_resolution
      or j.aspect_ratio <> p_ratio or j.reference_id is distinct from p_reference_id then
      raise exception 'IDEMPOTENCY_CONFLICT';
    end if;
    return j;
  end if;
  if p_prompt is null or length(p_prompt) not between 8 and 1600
    or p_duration is null or p_duration not in (5,10,15)
    or p_resolution is null or p_resolution not in ('480p','720p')
    or p_ratio is null or p_ratio not in ('9:16','16:9','1:1') then
    raise exception 'INVALID_GENERATION';
  end if;
  if not exists (select 1 from public.generation_workers where last_seen_at > now() - interval '90 seconds') then
    raise exception 'WORKER_OFFLINE';
  end if;
  if p_reference_id is not null and not exists (
    select 1 from public.generation_references where id = p_reference_id and user_id = p_user_id
  ) then raise exception 'REFERENCE_NOT_FOUND'; end if;
  if (select count(*) from public.generation_jobs where user_id = p_user_id and status in ('queued','running')) >= 3 then
    raise exception 'TOO_MANY_ACTIVE_JOBS';
  end if;
  sponsor:=nullif(current_setting('app.seconds_production',true),'')::uuid;
  if sponsor is not null and not exists(select 1 from public.studio_productions p join public.video_seconds_reservations r on r.production_id=p.id where p.id=sponsor and p.user_id=p_user_id and p.status='running' and r.status='held') then raise exception 'PRODUCTION_INVALID'; end if;
  cost := case when sponsor is null then p_duration / 5 else 0 end;
  if b.video_credits < cost then raise exception 'INSUFFICIENT_CREDITS'; end if;
  insert into public.generation_jobs(user_id, request_id, prompt, duration_seconds, resolution, aspect_ratio, reference_id, credit_cost, seconds_production_id)
    values(p_user_id, p_request_id, p_prompt, p_duration, p_resolution, p_ratio, p_reference_id, cost, sponsor) returning * into j;
  update public.credit_balances set video_credits = video_credits - cost, updated_at = now() where user_id = p_user_id;
  if cost>0 then insert into public.credit_ledger(user_id, credit_type, delta, reason, external_id)
    values(p_user_id, 'video', -cost, 'generation_reserved', 'generation:' || j.id || ':reserve'); end if;
  return j;
end;
$$;

-- Sponsored clips never mint legacy credits on a failed GPU attempt.
do $$ declare definition text; changed text; begin
 definition:=pg_get_functiondef('public.refund_generation(uuid,text,text)'::regprocedure);
 changed:=replace(definition,'insert into public.credit_ledger(user_id, credit_type, delta, reason, external_id)', 'if j.credit_cost>0 then insert into public.credit_ledger(user_id, credit_type, delta, reason, external_id)');
 changed:=replace(changed,$needle$'generation:' || j.id || ':refund');$needle$,$replacement$'generation:' || j.id || ':refund'); end if;$replacement$);
 if changed=definition then raise exception 'SECONDS_REFUND_GUARD_NOT_FOUND'; end if; execute changed;
end $$;
-- Includes expiry paths where the coordinator marks a job failed during claim.
create function public.release_failed_video_seconds() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.status in ('failed','uncertain') and old.status is distinct from new.status then perform public.adjust_video_seconds(new.id,null,'release'); end if;
 return new;
end $$;
revoke all on function public.release_failed_video_seconds() from public,anon,authenticated;
create trigger release_failed_video_seconds after update of status on public.studio_productions for each row execute function public.release_failed_video_seconds();
-- Purchased time, not the former five-run pilot limit, bounds paid deliveries.
do $$ declare definition text; changed text; begin
 definition:=pg_get_functiondef('public.studio_production_start_before_credits(uuid,uuid,uuid,integer,boolean)'::regprocedure);
 changed:=replace(definition,'if (select count(*) from public.studio_productions where user_id=p_user and created_at>', 'if not public.production_uses_seconds(p_id) and (select count(*) from public.studio_productions where user_id=p_user and created_at>');
 if changed=definition then raise exception 'SECONDS_PILOT_LIMIT_NOT_FOUND'; end if; execute changed;
end $$;

-- Paid accounts may enter the former identity-only pilot. Monetary ceilings and
-- the global production kill switch remain unchanged.
do $$ declare f regprocedure; definition text; changed text; begin
 foreach f in array array['public.reserve_production_spend(text,uuid,uuid,text,text,integer)'::regprocedure,'public.account_production_spend(text,uuid,uuid,text,text,bigint)'::regprocedure] loop
  definition:=pg_get_functiondef(f);
  changed:=replace(definition,'policy.allowed_user_ids is not null and not', 'not public.production_uses_seconds(p_job) and policy.allowed_user_ids is not null and not');
  if changed=definition then raise exception 'SECONDS_SPEND_ACCESS_NOT_FOUND'; end if; execute changed;
 end loop;
end $$;
commit;
