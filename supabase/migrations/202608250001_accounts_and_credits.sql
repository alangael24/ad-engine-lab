begin;

create table if not exists public.customer_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique check (email = lower(email)),
  stripe_customer_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.credit_balances (
  user_id uuid primary key references auth.users(id) on delete cascade,
  video_credits integer not null default 0 check (video_credits >= 0),
  image_credits integer not null default 0 check (image_credits >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.purchases (
  checkout_session_id text primary key,
  stripe_event_id text not null unique,
  stripe_payment_link_id text not null,
  user_id uuid not null references auth.users(id) on delete restrict,
  email text not null check (email = lower(email)),
  plan_code text not null check (plan_code in ('esencial', 'pro')),
  amount_total bigint not null check (amount_total >= 0),
  currency text not null check (currency = lower(currency)),
  payment_status text not null,
  video_credits integer not null check (video_credits >= 0),
  image_credits integer not null check (image_credits >= 0),
  granted_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.credit_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete restrict,
  checkout_session_id text references public.purchases(checkout_session_id) on delete restrict,
  credit_type text not null check (credit_type in ('video', 'image')),
  delta integer not null check (delta <> 0),
  reason text not null,
  external_id text not null unique,
  created_at timestamptz not null default now()
);

create index if not exists purchases_user_id_idx on public.purchases(user_id);
create index if not exists credit_ledger_user_id_idx on public.credit_ledger(user_id);
create index if not exists credit_ledger_checkout_session_id_idx on public.credit_ledger(checkout_session_id);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.touch_updated_at() from public, anon, authenticated;

drop trigger if exists customer_accounts_touch_updated_at on public.customer_accounts;
create trigger customer_accounts_touch_updated_at
before update on public.customer_accounts
for each row execute function public.touch_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is null then
    return new;
  end if;

  insert into public.customer_accounts (user_id, email)
  values (new.id, lower(new.email))
  on conflict (user_id) do update set email = excluded.email;

  insert into public.credit_balances (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.apply_stripe_purchase(
  p_event_id text,
  p_checkout_session_id text,
  p_payment_link_id text,
  p_email text,
  p_stripe_customer_id text,
  p_plan_code text,
  p_amount_total bigint,
  p_currency text,
  p_payment_status text,
  p_video_credits integer,
  p_image_credits integer
)
returns table (applied boolean, user_id uuid, video_balance integer, image_balance integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_email text := lower(trim(p_email));
  v_inserted_session text;
begin
  if v_email = '' or p_plan_code not in ('esencial', 'pro') then
    raise exception 'Invalid purchase identity or plan';
  end if;
  if p_video_credits < 0 or p_image_credits < 0 or p_amount_total < 0 then
    raise exception 'Invalid purchase amounts';
  end if;

  select id into v_user_id
  from auth.users
  where lower(email) = v_email
  order by created_at asc
  limit 1;

  if v_user_id is null then
    raise exception 'Auth user does not exist for paid email';
  end if;

  insert into public.customer_accounts (user_id, email, stripe_customer_id)
  values (v_user_id, v_email, nullif(p_stripe_customer_id, ''))
  on conflict (user_id) do update
  set email = excluded.email,
      stripe_customer_id = coalesce(excluded.stripe_customer_id, public.customer_accounts.stripe_customer_id);

  insert into public.credit_balances (user_id)
  values (v_user_id)
  on conflict (user_id) do nothing;

  insert into public.purchases (
    checkout_session_id, stripe_event_id, stripe_payment_link_id, user_id, email,
    plan_code, amount_total, currency, payment_status, video_credits, image_credits
  ) values (
    p_checkout_session_id, p_event_id, p_payment_link_id, v_user_id, v_email,
    p_plan_code, p_amount_total, lower(p_currency), p_payment_status, p_video_credits, p_image_credits
  )
  on conflict do nothing
  returning checkout_session_id into v_inserted_session;

  if v_inserted_session is null then
    return query
    select false, v_user_id, b.video_credits, b.image_credits
    from public.credit_balances b where b.user_id = v_user_id;
    return;
  end if;

  update public.credit_balances
  set video_credits = video_credits + p_video_credits,
      image_credits = image_credits + p_image_credits,
      updated_at = now()
  where credit_balances.user_id = v_user_id;

  if p_video_credits > 0 then
    insert into public.credit_ledger (user_id, checkout_session_id, credit_type, delta, reason, external_id)
    values (v_user_id, p_checkout_session_id, 'video', p_video_credits, 'stripe_purchase', p_checkout_session_id || ':video');
  end if;
  if p_image_credits > 0 then
    insert into public.credit_ledger (user_id, checkout_session_id, credit_type, delta, reason, external_id)
    values (v_user_id, p_checkout_session_id, 'image', p_image_credits, 'stripe_purchase', p_checkout_session_id || ':image');
  end if;

  return query
  select true, v_user_id, b.video_credits, b.image_credits
  from public.credit_balances b where b.user_id = v_user_id;
end;
$$;

revoke all on function public.apply_stripe_purchase(text,text,text,text,text,text,bigint,text,text,integer,integer)
from public, anon, authenticated;
grant execute on function public.apply_stripe_purchase(text,text,text,text,text,text,bigint,text,text,integer,integer)
to service_role;

alter table public.customer_accounts enable row level security;
alter table public.credit_balances enable row level security;
alter table public.purchases enable row level security;
alter table public.credit_ledger enable row level security;

drop policy if exists "customers_read_own_account" on public.customer_accounts;
create policy "customers_read_own_account"
on public.customer_accounts for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "customers_read_own_balance" on public.credit_balances;
create policy "customers_read_own_balance"
on public.credit_balances for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "customers_read_own_purchases" on public.purchases;
create policy "customers_read_own_purchases"
on public.purchases for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "customers_read_own_ledger" on public.credit_ledger;
create policy "customers_read_own_ledger"
on public.credit_ledger for select to authenticated
using ((select auth.uid()) = user_id);

revoke all on table public.customer_accounts, public.credit_balances, public.purchases, public.credit_ledger from anon, authenticated;
grant select on table public.customer_accounts, public.credit_balances, public.purchases, public.credit_ledger to authenticated;
grant all on table public.customer_accounts, public.credit_balances, public.purchases, public.credit_ledger to service_role;
grant usage, select on all sequences in schema public to service_role;

commit;
