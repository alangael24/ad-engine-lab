begin;

-- Fix ambiguous ON CONFLICT targets in the original grant function.
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
  on conflict on constraint customer_accounts_pkey do update
  set email = excluded.email,
      stripe_customer_id = coalesce(excluded.stripe_customer_id, public.customer_accounts.stripe_customer_id);

  insert into public.credit_balances (user_id)
  values (v_user_id)
  on conflict on constraint credit_balances_pkey do nothing;

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

-- Grandfather existing course customers. Only new SaaS purchases omit this entitlement.
alter table public.purchases add column course_access boolean not null default true;
create function public.apply_saas_purchase(
  p_event_id text, p_checkout_session_id text, p_payment_link_id text, p_email text,
  p_stripe_customer_id text, p_plan_code text, p_amount_total bigint, p_currency text,
  p_payment_status text, p_video_credits integer, p_image_credits integer, p_course_access boolean
) returns table(applied boolean, user_id uuid, video_balance integer, image_balance integer)
language plpgsql security invoker set search_path = '' as $$
declare result record;
begin
  select * into result from public.apply_stripe_purchase(p_event_id,p_checkout_session_id,p_payment_link_id,
    p_email,p_stripe_customer_id,p_plan_code,p_amount_total,p_currency,p_payment_status,p_video_credits,p_image_credits);
  if result.applied then
    update public.purchases set course_access = coalesce(p_course_access,false) where checkout_session_id = p_checkout_session_id;
  end if;
  return query select result.applied, result.user_id, result.video_balance, result.image_balance;
end;
$$;
revoke all on function public.apply_saas_purchase(text,text,text,text,text,text,bigint,text,text,integer,integer,boolean) from public, anon, authenticated;
grant execute on function public.apply_saas_purchase(text,text,text,text,text,text,bigint,text,text,integer,integer,boolean) to service_role;

-- Additive migration: existing purchases, balances and course access remain intact.
create table public.generation_references (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete restrict,
  storage_path text not null unique,
  mime_type text not null check (mime_type in ('image/png','image/jpeg','image/webp')),
  size_bytes integer not null check (size_bytes between 1 and 6291456),
  created_at timestamptz not null default now()
);
create index generation_references_owner_idx on public.generation_references(user_id, created_at);

create function public.register_generation_reference(p_id uuid,p_user_id uuid,p_storage_path text,p_mime_type text,p_size_bytes integer)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare credits integer;
begin
  select video_credits into credits from public.credit_balances where user_id=p_user_id for update;
  if credits is null or credits < 1 then raise exception 'INSUFFICIENT_CREDITS'; end if;
  if (select count(*) from public.generation_references where user_id=p_user_id and created_at>now()-interval '1 day') >= 30 then
    raise exception 'UPLOAD_LIMIT';
  end if;
  insert into public.generation_references(id,user_id,storage_path,mime_type,size_bytes)
    values(p_id,p_user_id,p_storage_path,p_mime_type,p_size_bytes);
  return p_id;
end;
$$;
revoke all on function public.register_generation_reference(uuid,uuid,text,text,integer) from public,anon,authenticated;
grant execute on function public.register_generation_reference(uuid,uuid,text,text,integer) to service_role;

create table public.generation_workers (
  id text primary key check (length(id) between 1 and 80),
  last_seen_at timestamptz not null default now()
);

create table public.generation_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  request_id uuid not null,
  prompt text not null check (length(prompt) between 8 and 1600),
  duration_seconds integer not null check (duration_seconds in (5,10,15)),
  resolution text not null check (resolution in ('480p','720p')),
  aspect_ratio text not null check (aspect_ratio in ('9:16','16:9','1:1')),
  reference_id uuid references public.generation_references(id) on delete restrict,
  credit_cost integer not null check (credit_cost = duration_seconds / 5),
  preset text not null default 'turbo8' check (preset = 'turbo8'),
  status text not null default 'queued' check (status in ('queued','running','succeeded','failed','canceled')),
  worker_id text references public.generation_workers(id),
  lease_token uuid,
  lease_expires_at timestamptz,
  submission_started boolean not null default false,
  provider_prompt_id text,
  result_path text,
  error_code text,
  refunded_at timestamptz,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  unique(user_id, request_id),
  check ((status = 'succeeded') = (result_path is not null)),
  check (status <> 'running' or (lease_token is not null and worker_id is not null))
);
create index generation_jobs_owner_idx on public.generation_jobs(user_id, created_at desc);
create index generation_jobs_queue_idx on public.generation_jobs(created_at) where status = 'queued';
create index generation_jobs_lease_idx on public.generation_jobs(lease_expires_at) where status = 'running';
create index generation_jobs_reference_idx on public.generation_jobs(reference_id);
create unique index generation_jobs_worker_active_idx on public.generation_jobs(worker_id) where status = 'running';

alter table public.generation_references enable row level security;
alter table public.generation_workers enable row level security;
alter table public.generation_jobs enable row level security;
-- All mutations go through authenticated server endpoints, not browser RPCs.
revoke all on public.generation_references, public.generation_workers, public.generation_jobs from public, anon, authenticated;
grant all on public.generation_references, public.generation_workers, public.generation_jobs to service_role;
grant select (id,user_id,request_id,prompt,duration_seconds,resolution,aspect_ratio,credit_cost,
  status,created_at,started_at,finished_at,refunded_at,error_code) on public.generation_jobs to authenticated;
create policy generation_jobs_read_own on public.generation_jobs for select to authenticated
  using ((select auth.uid()) = user_id);

create function public.reserve_generation(
  p_user_id uuid, p_request_id uuid, p_prompt text, p_duration integer,
  p_resolution text, p_ratio text, p_reference_id uuid default null
) returns public.generation_jobs
language plpgsql security invoker set search_path = '' as $$
declare j public.generation_jobs; b public.credit_balances; cost integer;
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
  cost := p_duration / 5;
  if b.video_credits < cost then raise exception 'INSUFFICIENT_CREDITS'; end if;
  insert into public.generation_jobs(user_id, request_id, prompt, duration_seconds, resolution, aspect_ratio, reference_id, credit_cost)
    values(p_user_id, p_request_id, p_prompt, p_duration, p_resolution, p_ratio, p_reference_id, cost) returning * into j;
  update public.credit_balances set video_credits = video_credits - cost, updated_at = now() where user_id = p_user_id;
  insert into public.credit_ledger(user_id, credit_type, delta, reason, external_id)
    values(p_user_id, 'video', -cost, 'generation_reserved', 'generation:' || j.id || ':reserve');
  return j;
end;
$$;

create function public.claim_generation(p_worker_id text) returns public.generation_jobs
language plpgsql security invoker set search_path = '' as $$
declare j public.generation_jobs;
begin
  insert into public.generation_workers(id) values(p_worker_id)
    on conflict(id) do update set last_seen_at = now();
  -- The worker row serializes duplicate polling with the same worker identity.
  perform 1 from public.generation_workers where id = p_worker_id for update;
  select * into j from public.generation_jobs where worker_id = p_worker_id and status = 'running' for update;
  if found then
    if j.lease_expires_at <= now() then return null; end if;
    return j;
  end if;
  select * into j from public.generation_jobs where status = 'queued' order by created_at, id for update skip locked limit 1;
  if not found then return null; end if;
  update public.generation_jobs set status = 'running', worker_id = p_worker_id, lease_token = gen_random_uuid(),
    lease_expires_at = now() + interval '3 minutes', started_at = now() where id = j.id returning * into j;
  return j;
end;
$$;

create function public.heartbeat_generation(p_job_id uuid, p_worker_id text, p_lease_token uuid,
  p_submission_started boolean default false, p_provider_prompt_id text default null)
returns public.generation_jobs language plpgsql security invoker set search_path = '' as $$
declare j public.generation_jobs;
begin
  select * into j from public.generation_jobs where id = p_job_id for update;
  if not found or j.status <> 'running' or j.worker_id is distinct from p_worker_id
    or j.lease_token is distinct from p_lease_token or j.lease_expires_at <= now() then raise exception 'LEASE_LOST'; end if;
  if p_submission_started and j.submission_started then raise exception 'SUBMISSION_ALREADY_STARTED'; end if;
  if j.provider_prompt_id is not null and p_provider_prompt_id is not null and j.provider_prompt_id <> p_provider_prompt_id then
    raise exception 'PROVIDER_CONFLICT';
  end if;
  update public.generation_jobs set lease_expires_at = now() + interval '3 minutes',
    submission_started = submission_started or p_submission_started,
    provider_prompt_id = coalesce(provider_prompt_id, p_provider_prompt_id) where id = p_job_id returning * into j;
  update public.generation_workers set last_seen_at = now() where id = p_worker_id;
  return j;
end;
$$;

-- Caller must lock the job first. Only service_role can call this function.
create function public.refund_generation(p_job_id uuid, p_status text, p_error_code text)
returns public.generation_jobs language plpgsql security invoker set search_path = '' as $$
declare j public.generation_jobs;
begin
  select * into j from public.generation_jobs where id = p_job_id for update;
  if not found then raise exception 'JOB_NOT_FOUND'; end if;
  if j.status in ('succeeded','failed','canceled') then return j; end if;
  if p_status not in ('failed','canceled') then raise exception 'INVALID_STATUS'; end if;
  insert into public.credit_ledger(user_id, credit_type, delta, reason, external_id)
    values(j.user_id, 'video', j.credit_cost, 'generation_refunded', 'generation:' || j.id || ':refund');
  update public.credit_balances set video_credits = video_credits + j.credit_cost, updated_at = now() where user_id = j.user_id;
  update public.generation_jobs set status = p_status, error_code = p_error_code, refunded_at = now(),
    finished_at = now(), lease_expires_at = null where id = j.id returning * into j;
  return j;
end;
$$;

create function public.finish_generation(p_job_id uuid, p_worker_id text, p_lease_token uuid, p_success boolean)
returns public.generation_jobs language plpgsql security invoker set search_path = '' as $$
declare j public.generation_jobs;
begin
  select * into j from public.generation_jobs where id = p_job_id for update;
  if not found or j.worker_id is distinct from p_worker_id or j.lease_token is distinct from p_lease_token then
    raise exception 'LEASE_LOST';
  end if;
  if j.status in ('succeeded','failed','canceled') then return j; end if;
  if j.status <> 'running' or j.lease_expires_at <= now() then raise exception 'LEASE_LOST'; end if;
  if not p_success then return public.refund_generation(j.id, 'failed', 'GENERATION_FAILED'); end if;
  update public.generation_jobs set status = 'succeeded', result_path = user_id || '/' || id || '.mp4',
    finished_at = now(), lease_expires_at = null where id = j.id returning * into j;
  return j;
end;
$$;

create function public.cancel_generation(p_user_id uuid, p_job_id uuid) returns public.generation_jobs
language plpgsql security invoker set search_path = '' as $$
declare j public.generation_jobs;
begin
  select * into j from public.generation_jobs where id = p_job_id and user_id = p_user_id for update;
  if not found then raise exception 'JOB_NOT_FOUND'; end if;
  if j.status = 'canceled' then return j; end if;
  if j.status <> 'queued' then raise exception 'JOB_ALREADY_STARTED'; end if;
  return public.refund_generation(j.id, 'canceled', 'USER_CANCELED');
end;
$$;

create function public.sweep_generations() returns integer
language plpgsql security invoker set search_path = '' as $$
declare j public.generation_jobs; n integer := 0;
begin
  for j in select * from public.generation_jobs
    where (status = 'queued' and created_at < now() - interval '30 minutes')
      or (status = 'running' and (lease_expires_at < now() or started_at < now() - interval '45 minutes'))
    for update skip locked
  loop
    perform public.refund_generation(j.id, 'failed', 'GENERATION_TIMEOUT'); n := n + 1;
  end loop;
  return n;
end;
$$;

revoke all on function public.reserve_generation(uuid,uuid,text,integer,text,text,uuid),
  public.claim_generation(text), public.heartbeat_generation(uuid,text,uuid,boolean,text),
  public.refund_generation(uuid,text,text), public.finish_generation(uuid,text,uuid,boolean),
  public.cancel_generation(uuid,uuid), public.sweep_generations() from public, anon, authenticated;
grant execute on function public.reserve_generation(uuid,uuid,text,integer,text,text,uuid),
  public.claim_generation(text), public.heartbeat_generation(uuid,text,uuid,boolean,text),
  public.refund_generation(uuid,text,text), public.finish_generation(uuid,text,uuid,boolean),
  public.cancel_generation(uuid,uuid), public.sweep_generations() to service_role;

-- Private: no browser upload, public listing, or permanent public media URLs.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('generation-references','generation-references',false,6291456,array['image/png','image/jpeg','image/webp']),
       ('generation-results','generation-results',false,52428800,array['video/mp4']);
commit;
