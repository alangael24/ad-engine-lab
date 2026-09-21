-- Manual gift fulfillment: no model or generation job is started by intake.
create table public.gift_orders (
 id uuid primary key references public.studio_projects(id),
 user_id uuid not null references auth.users(id),
 brief jsonb not null,
 target_seconds integer not null check(target_seconds in (60,120)),
 status text not null default 'received' check(status in ('received','script_ready','approved','producing','ready','cancelled')),
 script text not null default '',
 revision integer not null default 1,
 reserved_seconds integer not null default 0 check(reserved_seconds>=0),
 delivered_seconds integer,
 asset_id uuid references public.studio_assets(id),
 customer_note text not null default '',
 review_note text not null default '',
 approved_at timestamptz,
 delivered_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index gift_orders_owner on public.gift_orders(user_id,created_at desc);
alter table public.gift_orders enable row level security;
revoke all on public.gift_orders from public,anon,authenticated;
grant all on public.gift_orders to service_role;

create function public.gift_order_customer(p_user uuid,p_id uuid,p_action text,p_expected integer default null,p_note text default '')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare o public.gift_orders; p public.studio_projects; b public.credit_balances; target integer;
begin
 -- Same owner lock as existing video reservations prevents double spending.
 perform pg_advisory_xact_lock(hashtext('studio:'||p_user::text));
 select * into p from public.studio_projects where id=p_id and user_id=p_user for update;
 if not found then raise exception 'GIFT_NOT_FOUND'; end if;
 select * into o from public.gift_orders where id=p_id and user_id=p_user for update;
 if p_action='submit' then
  if found then return to_jsonb(o); end if;
  if coalesce(p.data->>'idea','') not like 'PELÍCULA PERSONALIZADA PARA REGALAR.%' or coalesce(p.data->>'productProfile','')<>'creator-v1' then raise exception 'GIFT_INVALID'; end if;
  target:=(p.data->'creatorBrief'->>'targetDuration')::integer;
  if target not in(60,120) or exists(select 1 from public.studio_chat_edits where project_id=p_id and status='running') or exists(select 1 from public.studio_productions where project_id=p_id and status in('queued','running')) then raise exception 'GIFT_INVALID'; end if;
  insert into public.gift_orders(id,user_id,brief,target_seconds) values(p_id,p_user,p.data,target) returning * into o;
  return to_jsonb(o);
 end if;
 if o.id is null then raise exception 'GIFT_NOT_FOUND'; end if;
 if p_action='approve' and o.status in ('approved','producing','ready') and p_expected=o.revision then return to_jsonb(o); end if;
 if p_expected is distinct from o.revision then raise exception 'GIFT_CONFLICT'; end if;
 if p_action='changes' then
  if o.status<>'script_ready' or length(trim(p_note)) not between 1 and 2000 then raise exception 'GIFT_INVALID'; end if;
  update public.gift_orders set status='received',customer_note=trim(p_note),revision=revision+1,updated_at=now() where id=p_id returning * into o;
 elsif p_action='approve' then
  if o.status<>'script_ready' or trim(o.script)='' then raise exception 'GIFT_INVALID'; end if;
  select * into b from public.credit_balances where user_id=p_user for update;
  if not found or not b.seconds_plan or b.video_seconds<o.target_seconds then raise exception 'GIFT_BALANCE'; end if;
  update public.credit_balances set video_seconds=video_seconds-o.target_seconds,updated_at=now() where user_id=p_user;
  insert into public.video_seconds_ledger(user_id,delta,reason,external_id) values(p_user,-o.target_seconds,'gift_reserved','gift:'||p_id||':reserve');
  update public.gift_orders set status='approved',reserved_seconds=target_seconds,approved_at=now(),updated_at=now() where id=p_id returning * into o;
 else raise exception 'GIFT_INVALID'; end if;
 return to_jsonb(o);
end $$;

-- Operator-only RPC, never exposed by the customer HTTP endpoint.
create function public.gift_order_operator(p_id uuid,p_action text,p_expected integer,p_data jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare o public.gift_orders; a public.studio_assets; secs integer; refund integer; uid uuid;
begin
 select user_id into uid from public.gift_orders where id=p_id;
 if uid is null then raise exception 'GIFT_NOT_FOUND'; end if;
 perform pg_advisory_xact_lock(hashtext('studio:'||uid::text));
 select * into o from public.gift_orders where id=p_id for update;
 if o.revision is distinct from p_expected then raise exception 'GIFT_CONFLICT'; end if;
 if p_action='script' then
  if o.status not in('received','script_ready') or length(trim(coalesce(p_data->>'script',''))) not between 1 and 6000 then raise exception 'GIFT_INVALID'; end if;
  if o.status='script_ready' and o.script=p_data->>'script' then return to_jsonb(o); end if;
  update public.gift_orders set script=p_data->>'script',status='script_ready',revision=revision+1,updated_at=now() where id=p_id returning * into o;
 elsif p_action='start' then
  if o.status='producing' then return to_jsonb(o); end if;
  if o.status<>'approved' or o.reserved_seconds<>o.target_seconds then raise exception 'GIFT_INVALID'; end if;
  update public.gift_orders set status='producing',updated_at=now() where id=p_id returning * into o;
 elsif p_action='deliver' then
  if o.status='ready' and o.asset_id::text=p_data->>'assetId' then return to_jsonb(o); end if;
  if o.status<>'producing' or o.reserved_seconds<>o.target_seconds or length(trim(coalesce(p_data->>'reviewNote',''))) not between 1 and 2000 then raise exception 'GIFT_INVALID'; end if;
  select * into a from public.studio_assets where id=(p_data->>'assetId')::uuid and user_id=o.user_id;
  if not found or a.kind<>'clip' or a.mime_type<>'video/mp4' or a.duration_seconds is null then raise exception 'GIFT_ASSET'; end if;
  secs:=ceil(a.duration_seconds);
  if secs<1 or secs>o.target_seconds then raise exception 'GIFT_DURATION'; end if;
  refund:=o.reserved_seconds-secs;
  if refund>0 then
   update public.credit_balances set video_seconds=video_seconds+refund,updated_at=now() where user_id=o.user_id;
   insert into public.video_seconds_ledger(user_id,delta,reason,external_id) values(o.user_id,refund,'gift_unused','gift:'||p_id||':unused');
  end if;
  update public.gift_orders set status='ready',asset_id=a.id,delivered_seconds=secs,reserved_seconds=0,review_note=p_data->>'reviewNote',delivered_at=now(),updated_at=now() where id=p_id returning * into o;
 elsif p_action='cancel' then
  if o.status='cancelled' then return to_jsonb(o); end if;
  if o.status='ready' then raise exception 'GIFT_INVALID'; end if;
  if o.reserved_seconds>0 then
   update public.credit_balances set video_seconds=video_seconds+o.reserved_seconds,updated_at=now() where user_id=o.user_id;
   insert into public.video_seconds_ledger(user_id,delta,reason,external_id) values(o.user_id,o.reserved_seconds,'gift_released','gift:'||p_id||':release');
  end if;
  update public.gift_orders set status='cancelled',reserved_seconds=0,updated_at=now() where id=p_id returning * into o;
 else raise exception 'GIFT_INVALID'; end if;
 return to_jsonb(o);
end $$;
revoke all on function public.gift_order_customer(uuid,uuid,text,integer,text),public.gift_order_operator(uuid,text,integer,jsonb) from public,anon,authenticated;
grant execute on function public.gift_order_customer(uuid,uuid,text,integer,text),public.gift_order_operator(uuid,text,integer,jsonb) to service_role;

-- Manual gift orders cannot accidentally start the paid automated pipeline.
alter function public.studio_chat_prepare(uuid,uuid,uuid,jsonb) rename to studio_chat_prepare_before_manual_gifts;
create function public.studio_chat_prepare(p_user uuid,p_id uuid,p_project uuid,p_data jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtext('studio:'||p_user::text));
 if exists(select 1 from public.gift_orders where id=p_project and user_id=p_user) then raise exception 'GIFT_MANUAL'; end if;
 return public.studio_chat_prepare_before_manual_gifts(p_user,p_id,p_project,p_data);
end $$;
alter function public.studio_production_start(uuid,uuid,uuid,integer,boolean) rename to studio_production_start_before_manual_gifts;
create function public.studio_production_start(p_user uuid,p_id uuid,p_project uuid,p_expected integer,p_enabled boolean)
returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtext('studio:'||p_user::text));
 if exists(select 1 from public.gift_orders where id=p_project and user_id=p_user) then raise exception 'GIFT_MANUAL'; end if;
 return public.studio_production_start_before_manual_gifts(p_user,p_id,p_project,p_expected,p_enabled);
end $$;
revoke all on function public.studio_chat_prepare(uuid,uuid,uuid,jsonb),public.studio_production_start(uuid,uuid,uuid,integer,boolean) from public,anon,authenticated;
grant execute on function public.studio_chat_prepare(uuid,uuid,uuid,jsonb),public.studio_production_start(uuid,uuid,uuid,integer,boolean) to service_role;
