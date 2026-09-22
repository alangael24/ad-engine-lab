-- Guest intake is private and opt-in. No auth or storage policies are relaxed.
create table public.gift_guest_drafts (
 id uuid primary key, secret_hash text not null, ip_hash text not null,
 fields jsonb not null, photos jsonb not null default '[]',
 created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '7 days'
);
create index gift_guest_draft_rate on public.gift_guest_drafts(ip_hash,created_at);
create table public.gift_guest_checkouts (
 id uuid primary key, draft_id uuid not null references public.gift_guest_drafts,
 plan text not null check(plan in ('gift_60','gift_120')), access_token text not null unique,
 checkout_session_id text unique, email text, order_id uuid unique references public.gift_orders,
 parent_id uuid references public.gift_guest_checkouts,
 created_at timestamptz not null default now()
);
create unique index gift_guest_initial_checkout on public.gift_guest_checkouts(draft_id,plan) where parent_id is null;
create table public.gift_email_outbox (
 id uuid primary key default gen_random_uuid(), order_id uuid not null references public.gift_orders,
 kind text not null check(kind in ('received','script_ready','ready')), revision integer not null,
 status text not null default 'pending' check(status in ('pending','sending','sent','failed')),
 attempts integer not null default 0, lease uuid, lease_until timestamptz,
 next_attempt_at timestamptz not null default now(), first_attempt_at timestamptz,
 provider_id text, error_code text, sent_at timestamptz, created_at timestamptz not null default now(),
 unique(order_id,kind,revision)
);
alter table public.gift_guest_drafts enable row level security;
alter table public.gift_guest_checkouts enable row level security;
alter table public.gift_email_outbox enable row level security;
revoke all on public.gift_guest_drafts,public.gift_guest_checkouts,public.gift_email_outbox from public,anon,authenticated;
grant all on public.gift_guest_drafts,public.gift_guest_checkouts,public.gift_email_outbox to service_role;

create function public.gift_guest_create(p_id uuid,p_hash text,p_ip text,p_fields jsonb,p_photos jsonb)
returns void language plpgsql security invoker set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtext('gift-guest-intake'));
 if exists(select 1 from public.gift_guest_drafts where id=p_id and secret_hash=p_hash and fields=p_fields and photos=p_photos) then return; end if;
 if (select count(*) from public.gift_guest_drafts where ip_hash=p_ip and created_at>now()-interval '1 day')>=10
 or (select count(*) from public.gift_guest_drafts where created_at>now()-interval '1 day')>=500 then raise exception 'UPLOAD_LIMIT'; end if;
 if jsonb_array_length(p_photos)>3 or length(p_hash)<>64 or length(p_ip)<>64 then raise exception 'GIFT_INVALID'; end if;
 insert into public.gift_guest_drafts(id,secret_hash,ip_hash,fields,photos) values(p_id,p_hash,p_ip,p_fields,p_photos);
end $$;

create function public.gift_guest_checkout(p_draft uuid,p_plan text,p_token text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.gift_guest_checkouts;
begin
 if p_plan not in('gift_60','gift_120') or length(p_token)<>64 then raise exception 'GIFT_INVALID'; end if;
 perform 1 from public.gift_guest_drafts where id=p_draft and expires_at>now() for update;
 if not found then raise exception 'GIFT_NOT_FOUND'; end if;
 insert into public.gift_guest_checkouts(id,draft_id,plan,access_token) values(gen_random_uuid(),p_draft,p_plan,p_token)
 on conflict(draft_id,plan) where parent_id is null do nothing;
 select * into c from public.gift_guest_checkouts where draft_id=p_draft and plan=p_plan and parent_id is null;
 return to_jsonb(c);
end $$;

-- A Payment Link can be paid twice from separate tabs. A second actual payment
-- gets its own order; repeat delivery of the same session never creates one.
create function public.gift_guest_repeat_payment(p_parent uuid,p_session text,p_token text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.gift_guest_checkouts; parent public.gift_guest_checkouts;
begin
 select * into parent from public.gift_guest_checkouts where id=p_parent for update;
 if not found or parent.order_id is null then raise exception 'GIFT_INVALID'; end if;
 select * into c from public.gift_guest_checkouts where checkout_session_id=p_session;
 if found then
  if c.id<>p_parent and c.parent_id is distinct from p_parent then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  return to_jsonb(c);
 end if;
 insert into public.gift_guest_checkouts(id,draft_id,plan,access_token,parent_id,checkout_session_id)
 values(gen_random_uuid(),parent.draft_id,parent.plan,p_token,p_parent,p_session) returning * into c;
 return to_jsonb(c);
end $$;

-- Purchase, references, project and order commit together. A lost webhook response
-- can be retried without crediting or creating anything twice.
create function public.gift_guest_fulfill(p_checkout uuid,p_event text,p_session text,p_link text,p_email text,p_customer text,p_plan text,p_amount bigint,p_currency text,p_data jsonb,p_assets jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.gift_guest_checkouts; uid uuid; a jsonb; result jsonb;
begin
 select * into c from public.gift_guest_checkouts where id=p_checkout for update;
 if not found or c.plan<>p_plan then raise exception 'GIFT_INVALID'; end if;
 if c.checkout_session_id is not null and c.checkout_session_id<>p_session then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
 if c.order_id is not null then
  if c.email<>lower(trim(p_email)) then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  return jsonb_build_object('applied',false,'orderId',c.order_id);
 end if;
 select id into uid from auth.users where lower(email)=lower(trim(p_email)) order by created_at limit 1;
 if uid is null then raise exception 'ACCOUNT_NOT_READY'; end if;
 result:=public.apply_video_seconds_purchase(p_event,p_session,p_link,p_email,p_customer,p_plan,p_amount,p_currency,'paid');
 for a in select value from jsonb_array_elements(p_assets) loop
  perform public.studio_write(uid,'register_asset',(a->>'id')::uuid,a,null);
 end loop;
 perform public.studio_write(uid,'create_project',c.id,p_data,null);
 perform public.gift_order_customer(uid,c.id,'submit',null,'');
 update public.gift_guest_checkouts set email=lower(trim(p_email)),checkout_session_id=p_session,order_id=c.id where id=c.id;
 insert into public.gift_email_outbox(order_id,kind,revision) values(c.id,'received',1) on conflict do nothing;
 return result||jsonb_build_object('orderId',c.id);
end $$;

create function public.gift_queue_email() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.status in ('script_ready','ready') and (new.status is distinct from old.status or new.revision is distinct from old.revision)
 and exists(select 1 from public.gift_guest_checkouts where order_id=new.id) then
  insert into public.gift_email_outbox(order_id,kind,revision) values(new.id,new.status,new.revision) on conflict do nothing;
 end if;
 return new;
end $$;
create trigger gift_status_email after update on public.gift_orders for each row execute function public.gift_queue_email();

create function public.gift_email_claim() returns jsonb language plpgsql security invoker set search_path='' as $$
declare m public.gift_email_outbox;
begin
 -- Never resend uncertain deliveries outside Resend's 24h deduplication window.
 update public.gift_email_outbox set status='failed',error_code='MANUAL_RECONCILIATION_REQUIRED'
 where status in ('pending','sending') and first_attempt_at<now()-interval '23 hours';
 select * into m from public.gift_email_outbox where (status='pending' and next_attempt_at<=now())
 or (status='sending' and lease_until<now()) order by created_at for update skip locked limit 1;
 if not found then return null; end if;
 update public.gift_email_outbox set status='sending',attempts=attempts+1,lease=gen_random_uuid(),lease_until=now()+interval '2 minutes',
 first_attempt_at=coalesce(first_attempt_at,now()) where id=m.id returning * into m;
 return to_jsonb(m);
end $$;
create function public.gift_email_finish(p_id uuid,p_lease uuid,p_provider text,p_error text) returns void language plpgsql security invoker set search_path='' as $$
begin
 update public.gift_email_outbox set status=case when p_provider is not null then 'sent' when attempts>=8 then 'failed' else 'pending' end,
 provider_id=p_provider,error_code=p_error,sent_at=case when p_provider is not null then now() end,
 next_attempt_at=now()+interval '1 minute'*least(60,power(2,attempts)),lease_until=null,lease=null
 where id=p_id and lease=p_lease and status='sending';
end $$;
revoke all on function public.gift_guest_create(uuid,text,text,jsonb,jsonb),public.gift_guest_checkout(uuid,text,text),public.gift_guest_repeat_payment(uuid,text,text),public.gift_guest_fulfill(uuid,text,text,text,text,text,text,bigint,text,jsonb,jsonb),public.gift_queue_email(),public.gift_email_claim(),public.gift_email_finish(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.gift_guest_create(uuid,text,text,jsonb,jsonb),public.gift_guest_checkout(uuid,text,text),public.gift_guest_repeat_payment(uuid,text,text),public.gift_guest_fulfill(uuid,text,text,text,text,text,text,bigint,text,jsonb,jsonb),public.gift_queue_email(),public.gift_email_claim(),public.gift_email_finish(uuid,uuid,text,text) to service_role;
