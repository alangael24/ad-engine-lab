begin;
alter table public.purchases drop constraint purchases_plan_code_check;
alter table public.purchases add constraint purchases_plan_code_check check(plan_code in ('esencial','pro','minute_1','minute_3','minute_8','gift_60','gift_120'));
alter table public.video_seconds_reservations
 add column max_duration_seconds integer not null default 60 check(max_duration_seconds in (60,120)),
 drop constraint video_seconds_reservations_reserved_seconds_check,
 drop constraint video_seconds_reservations_included_seconds_check,
 drop constraint video_seconds_reservations_duration_seconds_check,
 add check(reserved_seconds between 0 and 120),
 add check(included_seconds between 0 and 120),
 add check(duration_seconds between 1 and max_duration_seconds);
create or replace function public.apply_video_seconds_purchase(p_event_id text,p_checkout_session_id text,p_payment_link_id text,p_email text,p_stripe_customer_id text,p_plan_code text,p_amount_total bigint,p_currency text,p_payment_status text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid; seconds integer; expected_amount integer; inserted text; prior public.purchases;
begin
 seconds:=case p_plan_code when 'minute_1' then 60 when 'minute_3' then 180 when 'minute_8' then 480 when 'gift_60' then 60 when 'gift_120' then 120 end;
 expected_amount:=case p_plan_code when 'minute_1' then 50000 when 'minute_3' then 100000 when 'minute_8' then 200000 when 'gift_60' then 29900 when 'gift_120' then 49900 end;
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
create or replace function public.studio_production_start(p_user uuid,p_id uuid,p_project uuid,p_expected integer,p_enabled boolean)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare b public.credit_balances; p public.studio_projects; result jsonb; hold integer; duration_limit integer:=60; included integer:=0; prior public.video_seconds_reservations;
begin
 perform pg_advisory_xact_lock(hashtext('studio:'||p_user::text));
 if exists(select 1 from public.studio_productions where id=p_id) then return public.studio_production_start_before_seconds(p_user,p_id,p_project,p_expected,p_enabled); end if;
 select * into p from public.studio_projects where id=p_project and user_id=p_user for update;
 if not found then raise exception 'STUDIO_NOT_FOUND'; end if;
 select * into b from public.credit_balances where user_id=p_user for update;
 if b.seconds_plan then
  -- Freeze the delivery ceiling at reservation time; ads retain their 60s limit.
  if p.data->>'productProfile'='creator-v1' and coalesce((p.data->'creatorBrief'->>'targetDuration')::integer,60)>60 then duration_limit:=120; end if;
  -- Caption/trim edits reusing the paid script and all source clips keep their
  -- duration entitlement. New media or a new script reserves a new delivery.
  if p.data->'editing'->>'scoped'='true' then
   select * into prior from public.video_seconds_reservations where project_id=p_project and user_id=p_user and status='settled' and render_id::text=p.data->'editing'->>'baseRenderId';
   if found and exists(select 1 from public.studio_productions original join public.studio_renders rendered on rendered.id=prior.render_id where original.id=prior.production_id and original.snapshot->'data'->>'scriptDraft'=p.data->>'scriptDraft'
    and jsonb_array_length(p.data->'scenes')>0
    and not exists(select 1 from jsonb_array_elements(p.data->'scenes') scene where not exists(select 1 from jsonb_array_elements(coalesce(rendered.manifest->'originalScenes',rendered.manifest->'scenes')) base where base->>'id'=scene->>'id' and coalesce(base->>'versionId',base->>'selectedVersionId')=scene->>'selectedVersionId' and base->>'text'=scene->>'text')))
   then included:=prior.duration_seconds; end if;
  end if;
  hold:=least(greatest(0,duration_limit-included),b.video_seconds);
  if hold+included<=0 then raise exception 'INSUFFICIENT_VIDEO_SECONDS'; end if;
  insert into public.video_seconds_reservations(production_id,user_id,project_id,reserved_seconds,included_seconds,max_duration_seconds) values(p_id,p_user,p_project,hold,included,duration_limit);
  update public.credit_balances set video_seconds=video_seconds-hold,updated_at=now() where user_id=p_user;
  if hold>0 then insert into public.video_seconds_ledger(user_id,production_id,delta,reason,external_id) values(p_user,p_id,-hold,'reserved',p_id||':reserve'); end if;
 end if;
 result:=public.studio_production_start_before_seconds(p_user,p_id,p_project,p_expected,p_enabled);
 return result;
end $$;
create or replace function public.adjust_video_seconds(p_id uuid,p_duration numeric,p_action text) returns void language plpgsql security invoker set search_path='' as $$
declare r public.video_seconds_reservations; seconds integer; needed integer; delta integer;
begin
 select * into r from public.video_seconds_reservations where production_id=p_id for update;
 if not found or r.status<>'held' then return; end if;
 if p_action='release' then
  delta:=r.reserved_seconds;
  update public.video_seconds_reservations set status='released',updated_at=now() where production_id=p_id;
 else
  if p_action not in ('resize','settle') then raise exception 'PRODUCTION_INVALID'; end if;
  if p_duration is null or p_duration<=0 or p_duration>r.max_duration_seconds then raise exception 'VIDEO_DURATION_LIMIT'; end if;
  seconds:=ceil(p_duration); needed:=greatest(0,seconds-r.included_seconds); delta:=r.reserved_seconds-needed;
  if delta<0 and not exists(select 1 from public.credit_balances where user_id=r.user_id and video_seconds>=-delta for update) then raise exception 'INSUFFICIENT_VIDEO_SECONDS'; end if;
  update public.video_seconds_reservations set reserved_seconds=needed,duration_seconds=seconds,status=case when p_action='settle' then 'settled' else 'held' end,updated_at=now() where production_id=p_id;
 end if;
 if delta<>0 then
  update public.credit_balances set video_seconds=video_seconds+delta,updated_at=now() where user_id=r.user_id;
  insert into public.video_seconds_ledger(user_id,production_id,delta,reason,external_id) values(r.user_id,p_id,delta,p_action,p_id||':'||p_action||':'||gen_random_uuid());
 end if;
end $$;
commit;
