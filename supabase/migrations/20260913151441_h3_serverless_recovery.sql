-- Separate application queueing, cold start and execution. Only the CPU service
-- controls these fields. No browser or model can extend paid job deadlines.
alter table public.generation_jobs
  add column provider_backend text not null default 'comfy' check (provider_backend in ('comfy','serverless')),
  add column provider_phase text not null default 'pending' check (provider_phase in ('pending','preparing','generating','reconciling')),
  add column provider_claimed_at timestamptz,
  add column provider_submitted_at timestamptz,
  add column provider_deadline_at timestamptz,
  add column provider_shutdown_required boolean not null default false;

-- Latched circuit breaker for this dedicated H3 endpoint. A failed deployment
-- must not repeatedly wake a GPU for every queued scene. Only an operator can
-- clear it after fixing the deployment; there is no browser reset operation.
create table public.generation_serverless_state (
  id boolean primary key default true check(id),
  tripped_at timestamptz,
  shutdown_verified_at timestamptz
);
insert into public.generation_serverless_state(id) values(true);
alter table public.generation_serverless_state enable row level security;
revoke all on public.generation_serverless_state from public,anon,authenticated;
grant all on public.generation_serverless_state to service_role;

-- Preserve in-flight submissions when upgrading the previous bridge. Unknown
-- legacy acknowledgements cannot be classified safely from an empty ID.
update public.generation_jobs set provider_backend='serverless',provider_phase='preparing',
  provider_claimed_at=coalesce(started_at,created_at),
  provider_submitted_at=coalesce(started_at,created_at),
  provider_deadline_at=coalesce(started_at,created_at)+interval '72 minutes',started_at=null
  where status='running' and provider_prompt_id like 'rp:%';

create function public.claim_serverless_generation(p_worker_id text,p_allow_new boolean default true)
returns public.generation_jobs language plpgsql security invoker set search_path='' as $$
declare j public.generation_jobs;
begin
  -- One dispatch lane for the current single-endpoint deployment, even across
  -- multiple CPU processes. The sentinel never advertises worker availability.
  insert into public.generation_workers(id,last_seen_at) values('h3-serverless-dispatch-lock','-infinity')
    on conflict(id) do nothing;
  perform 1 from public.generation_workers where id='h3-serverless-dispatch-lock' for update;
  insert into public.generation_workers(id) values(p_worker_id)
    on conflict(id) do update set last_seen_at=now();
  select * into j from public.generation_jobs
    where status='running' and provider_backend='serverless' order by provider_claimed_at,id for update limit 1;
  if found then
    if j.lease_expires_at>now() and j.worker_id<>p_worker_id then return null; end if;
    if j.lease_expires_at>now() then return j; end if;
    -- Reattach to the SAME submission, preserving absolute clocks and assets.
    update public.generation_jobs set worker_id=p_worker_id,lease_token=gen_random_uuid(),
      lease_expires_at=now()+interval '3 minutes' where id=j.id returning * into j;
    return j;
  end if;
  if not p_allow_new or exists(select 1 from public.generation_serverless_state where tripped_at is not null) then return null; end if;
  select * into j from public.generation_jobs where status='queued'
    and created_at>now()-interval '120 minutes' order by created_at,id for update skip locked limit 1;
  if not found then return null; end if;
  update public.generation_jobs set status='running',worker_id=p_worker_id,lease_token=gen_random_uuid(),
    lease_expires_at=now()+interval '3 minutes',started_at=null,provider_backend='serverless',
    provider_phase='preparing',provider_claimed_at=now(),
    provider_deadline_at=now()+interval '72 minutes' where id=j.id returning * into j;
  return j;
end;
$$;

create function public.generation_serverless_shutdown(p_job_id uuid,p_worker_id text,p_lease_token uuid,p_verified boolean default false)
returns void language plpgsql security invoker set search_path='' as $$
declare j public.generation_jobs;
begin
  j:=public.heartbeat_generation(p_job_id,p_worker_id,p_lease_token,false,null);
  if j.provider_backend<>'serverless' then raise exception 'INVALID_GENERATION'; end if;
  if p_verified then
    if not j.provider_shutdown_required then raise exception 'INVALID_GENERATION'; end if;
    update public.generation_serverless_state set shutdown_verified_at=now();
  else
    update public.generation_jobs set provider_shutdown_required=true,provider_phase='reconciling' where id=j.id;
    update public.generation_serverless_state set tripped_at=coalesce(tripped_at,now()),shutdown_verified_at=null;
  end if;
end;
$$;

create or replace function public.heartbeat_generation(p_job_id uuid,p_worker_id text,p_lease_token uuid,
  p_submission_started boolean default false,p_provider_prompt_id text default null)
returns public.generation_jobs language plpgsql security invoker set search_path='' as $$
declare j public.generation_jobs;
begin
  select * into j from public.generation_jobs where id=p_job_id for update;
  if not found or j.status<>'running' or j.worker_id is distinct from p_worker_id
    or j.lease_token is distinct from p_lease_token or j.lease_expires_at<=now() then raise exception 'LEASE_LOST'; end if;
  if p_submission_started and j.submission_started then raise exception 'SUBMISSION_ALREADY_STARTED'; end if;
  if j.provider_prompt_id is not null and p_provider_prompt_id is not null and j.provider_prompt_id<>p_provider_prompt_id then
    raise exception 'PROVIDER_CONFLICT';
  end if;
  update public.generation_jobs set lease_expires_at=now()+interval '3 minutes',
    submission_started=submission_started or p_submission_started,
    provider_submitted_at=case when p_submission_started then coalesce(provider_submitted_at,now()) else provider_submitted_at end,
    provider_prompt_id=coalesce(provider_prompt_id,p_provider_prompt_id) where id=j.id returning * into j;
  update public.generation_workers set last_seen_at=now() where id=p_worker_id;
  return j;
end;
$$;

create function public.generation_provider_progress(p_job_id uuid,p_worker_id text,p_lease_token uuid,p_phase text)
returns public.generation_jobs language plpgsql security invoker set search_path='' as $$
declare j public.generation_jobs;
begin
  j:=public.heartbeat_generation(p_job_id,p_worker_id,p_lease_token,false,null);
  if j.provider_backend<>'serverless' or p_phase not in ('generating','reconciling') then raise exception 'INVALID_GENERATION'; end if;
  if p_phase='generating' and j.provider_prompt_id is null then raise exception 'INVALID_GENERATION'; end if;
  update public.generation_jobs set provider_phase=case when provider_phase='reconciling' then provider_phase else p_phase end,
    started_at=case when p_phase='generating' then coalesce(started_at,now()) else started_at end
    where id=j.id returning * into j;
  return j;
end;
$$;

create or replace function public.sweep_generations() returns integer
language plpgsql security invoker set search_path='' as $$
declare j public.generation_jobs;n integer:=0;
begin
  for j in select * from public.generation_jobs
    where (status='queued' and created_at<now()-interval '120 minutes')
      or (status='running' and provider_backend='comfy'
        and (lease_expires_at<now() or started_at<now()-interval '45 minutes'))
    for update skip locked
  loop
    perform public.refund_generation(j.id,'failed','GENERATION_TIMEOUT');n:=n+1;
  end loop;
  -- A dead CPU lease is recoverable, not proof that RunPod failed. Before a
  -- serverless job is refunded, the bridge must check storage and cancellation.
  update public.generation_jobs set provider_phase='reconciling'
    where status='running' and provider_backend='serverless' and provider_deadline_at<=now();
  return n;
end;
$$;

revoke all on function public.claim_serverless_generation(text,boolean),public.generation_provider_progress(uuid,text,uuid,text),
  public.generation_serverless_shutdown(uuid,text,uuid,boolean)
  from public,anon,authenticated;
grant execute on function public.claim_serverless_generation(text,boolean),public.generation_provider_progress(uuid,text,uuid,text),
  public.generation_serverless_shutdown(uuid,text,uuid,boolean)
  to service_role;
