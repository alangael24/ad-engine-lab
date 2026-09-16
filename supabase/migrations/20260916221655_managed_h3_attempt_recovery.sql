begin;
do $$ begin
 if exists(select 1 from public.h3_pod_runs where phase<>'closed') then raise exception 'STOP_AND_RECONCILE_MANAGED_PODS_BEFORE_MIGRATION'; end if;
end $$;
update public.h3_pod_control set enabled=false where id;
-- Profiles are operator-owned. A smaller GPU is not approved by mere availability.
create table public.h3_execution_profiles (
 id text primary key, gpu text not null, cloud text not null check(cloud in ('COMMUNITY','SECURE')),
 min_cuda text not null default '13.0', min_vram_gb integer not null,
 enabled boolean not null default false, validated_at timestamptz, validation_evidence text,
 image_digest text check(image_digest ~ '^ghcr.io/alangael24/creativerush-h3-pod@sha256:[a-f0-9]{64}$'),
 max_hourly_usd numeric not null check(max_hourly_usd>0), billable_hourly_usd numeric not null,
 startup_seconds integer not null default 2100 check(startup_seconds between 60 and 2400),
 stalled_seconds integer not null default 600 check(stalled_seconds between 60 and 1200),
 upload_seconds integer not null default 60, seconds_per_video_second jsonb not null,
 supported_clips jsonb not null, suspended_at timestamptz, failure_reason text,
 check(id='h3-5090' or not enabled or (validated_at is not null and length(trim(validation_evidence))>=10 and image_digest is not null and jsonb_array_length(supported_clips)>0))
);
insert into public.h3_execution_profiles(id,gpu,cloud,min_vram_gb,enabled,max_hourly_usd,billable_hourly_usd,seconds_per_video_second,supported_clips) values
 ('h3-5090','NVIDIA GeForce RTX 5090','COMMUNITY',31,true,.71,.73,'{"480p":18,"720p":35}',
 '["480p:5:9:16", "480p:5:16:9", "480p:5:1:1", "480p:10:9:16", "480p:10:16:9", "480p:10:1:1", "480p:15:9:16", "480p:15:16:9", "480p:15:1:1", "720p:5:9:16", "720p:5:16:9", "720p:5:1:1", "720p:10:9:16", "720p:10:16:9", "720p:10:1:1", "720p:15:9:16", "720p:15:16:9", "720p:15:1:1"]'),
 ('h3-4090','NVIDIA GeForce RTX 4090','COMMUNITY',23,false,.71,.73,'{"480p":30,"720p":60}','[]');
alter table public.h3_execution_profiles enable row level security;
revoke all on public.h3_execution_profiles from public,anon,authenticated;
grant all on public.h3_execution_profiles to service_role;
alter table public.h3_pod_runs add column profile_id text references public.h3_execution_profiles(id),
 add column profile jsonb, add column needs_rotation boolean not null default false,
 add column boot_bytes bigint not null default 0;
alter table public.generation_jobs add column managed_deadline_at timestamptz,
 add column managed_run_id uuid references public.h3_pod_runs(id),
 add column managed_attempt_id uuid, add column infra_runs integer not null default 0,
 add column infra_reserved_microusd bigint not null default 0,
 add column infra_limit_microusd bigint not null default 1500000,
 add column managed_seed bigint;
create table public.h3_generation_attempts (
 id uuid primary key default gen_random_uuid(), job_id uuid not null references public.generation_jobs(id),
 run_id uuid not null references public.h3_pod_runs(id), ordinal integer not null,
 status text not null default 'running' check(status in ('running','reconciling','succeeded','closed')),
 output_path text not null unique, created_at timestamptz not null default now(), closed_at timestamptz,
 failure_reason text, progress_stage text, progress_at timestamptz,
 unique(job_id,ordinal),unique(job_id,run_id)
);
alter table public.h3_generation_attempts enable row level security;
revoke all on public.h3_generation_attempts from public,anon,authenticated;
grant all on public.h3_generation_attempts to service_role;
-- Attribute every rental (including failed boots) without duplicating actual
-- provider cost per clip. The order guard sums DISTINCT physical rentals.
create table public.h3_pod_run_jobs (
 run_id uuid not null references public.h3_pod_runs(id),job_id uuid not null references public.generation_jobs(id),
 primary key(run_id,job_id)
);
alter table public.h3_pod_run_jobs enable row level security;
revoke all on public.h3_pod_run_jobs from public,anon,authenticated;
grant all on public.h3_pod_run_jobs to service_role;
create function public.h3_order_can_rent(p_job uuid,p_reservation bigint,p_run uuid default null)
returns boolean language plpgsql stable security invoker set search_path='' as $$
declare order_row public.studio_productions; amount bigint; rentals integer;
begin
 select production.* into order_row from public.studio_productions production join public.studio_scene_versions version on version.project_id=production.project_id
  where version.job_id=p_job and production.status in ('queued','running') order by production.created_at desc limit 1;
 if not found then return true; end if;
 select count(*),coalesce(sum(coalesce(r.estimated_microusd,r.reserved_microusd)),0) into rentals,amount
 from public.h3_pod_runs r where exists(select 1 from public.h3_pod_run_jobs link join public.studio_scene_versions version on version.job_id=link.job_id
  where link.run_id=r.id and version.project_id=order_row.project_id and version.created_at>=order_row.created_at);
 if p_run is not null and exists(select 1 from public.h3_pod_run_jobs link join public.studio_scene_versions version on version.job_id=link.job_id
  where link.run_id=p_run and version.project_id=order_row.project_id and version.created_at>=order_row.created_at) then return true; end if;
 return rentals<3 and amount+p_reservation<=1500000;
end $$;
revoke all on function public.h3_order_can_rent(uuid,bigint,uuid) from public,anon,authenticated;
grant execute on function public.h3_order_can_rent(uuid,bigint,uuid) to service_role;
create index h3_run_jobs_job on public.h3_pod_run_jobs(job_id,run_id);
create index h3_managed_active_jobs on public.generation_jobs(managed_run_id,status) where managed_deadline_at is not null;
-- Avoid re-submitting an old ambiguous legacy clip during migration.
-- Those jobs retain the prior behavior until an operator reconciles them.
create function public.h3_stamp_managed_job() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.provider_backend='comfy' and exists(select 1 from public.h3_pod_control where id and enabled) then
  new.managed_deadline_at:=coalesce(new.managed_deadline_at,new.created_at+interval '120 minutes');
  new.managed_seed:=coalesce(new.managed_seed,abs(hashtext(new.id::text)::bigint));
 end if;
 return new;
end $$;
create trigger h3_stamp_managed_job before insert on public.generation_jobs for each row execute function public.h3_stamp_managed_job();

-- Bypass the old failed-start refund wrapper: infrastructure attempts do not
-- authorize commercial compensation for every queued customer.
create or replace function public.h3_pod_work(p_owner text,p_action text,p_token uuid default null,p_data jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.h3_pod_control; r public.h3_pod_runs; p public.h3_execution_profiles;
 result jsonb; j public.generation_jobs; a public.h3_generation_attempts; ids uuid[]; reason text; scope text; recovered jsonb;
begin
 select * into c from public.h3_pod_control where id for update;
 if p_action<>'acquire' and (c.owner is distinct from p_owner or c.token is distinct from p_token or c.lease_until<=now()) then raise exception 'LEASE_LOST'; end if;
 select * into r from public.h3_pod_runs where id=c.current_run;
 if p_action='begin' then
  select * into p from public.h3_execution_profiles where id=coalesce(p_data->>'profileId','h3-5090') and enabled and suspended_at is null;
  if not found then raise exception 'PROFILE_NOT_APPROVED'; end if;
  if coalesce(p_data->>'imageDigest','') !~ '^ghcr.io/alangael24/creativerush-h3-pod@sha256:[a-f0-9]{64}$'
   or (p.image_digest is not null and p.image_digest<>p_data->>'imageDigest') then raise exception 'PROFILE_IMAGE_MISMATCH'; end if;
  -- Bind a bounded cohort before rent, so a boot failure cannot cancel another order.
  select array_agg(id) into ids from (select id from public.generation_jobs queued_job where status='queued' and provider_backend='comfy'
   and not submission_started and (managed_deadline_at is null or managed_deadline_at>now()) and infra_runs<3
   and infra_reserved_microusd+c.run_limit_microusd<=infra_limit_microusd
   and public.h3_order_can_rent(queued_job.id,c.run_limit_microusd)
   and p.supported_clips ? (queued_job.resolution||':'||queued_job.duration_seconds||':'||queued_job.aspect_ratio)
   order by created_at,id limit 3 for update) q;
  if ids is null then raise exception 'POD_NOT_ADMITTED'; end if;
  result:=public.h3_pod_work_before_start_refund(p_owner,p_action,p_token,p_data);
  select * into r from public.h3_pod_runs where id=(result->'run'->>'id')::uuid;
  update public.h3_pod_runs set profile_id=p.id,profile=to_jsonb(p)||jsonb_build_object('image_digest',p_data->>'imageDigest') where id=r.id;
  update public.generation_jobs set managed_run_id=r.id,infra_runs=infra_runs+1,
   infra_reserved_microusd=infra_reserved_microusd+c.run_limit_microusd,
   managed_deadline_at=coalesce(managed_deadline_at,created_at+interval '120 minutes'),
   managed_seed=coalesce(managed_seed,abs(hashtext(id::text)::bigint)) where id=any(ids);
  insert into public.h3_pod_run_jobs(run_id,job_id) select r.id,unnest(ids);
 elsif p_action='close' then
  -- The HTTP handler verifies each attempt's private output after provider deletion.
  if r.phase<>'draining' or r.pod_id is null then raise exception 'POD_SHUTDOWN_UNCONFIRMED'; end if;
  recovered:=coalesce(p_data->'recoveredAttemptIds','[]');
  result:=public.h3_pod_work_before_start_refund(p_owner,p_action,p_token,p_data);
  update public.h3_pod_runs set estimated_microusd=ceil(extract(epoch from now()-created_at)*
   coalesce((profile->>'billable_hourly_usd')::numeric,.73)*1000000/3600)::bigint where id=r.id;
  for j in select * from public.generation_jobs where managed_run_id=r.id and status in ('queued','running') for update loop
   select * into a from public.h3_generation_attempts where id=j.managed_attempt_id;
   if a.id is not null and recovered ? a.id::text then
    update public.generation_jobs set status='succeeded',result_path=a.output_path,finished_at=now(),lease_expires_at=null where id=j.id;
    update public.h3_generation_attempts set status='succeeded',closed_at=now() where id=a.id;
   else
    update public.h3_generation_attempts set status='closed',closed_at=now(),failure_reason=r.reason where id=a.id;
    if j.managed_deadline_at<=now() or j.infra_runs>=3 or j.infra_reserved_microusd+c.run_limit_microusd>j.infra_limit_microusd
       or not public.h3_order_can_rent(j.id,c.run_limit_microusd)
       or r.reason in ('gpu_oom','profile_configuration','credentials_invalid') then
     perform public.refund_generation(j.id,'failed',case when j.managed_deadline_at<=now() then 'H3_DELIVERY_DEADLINE' else 'H3_INFRASTRUCTURE_EXHAUSTED' end);
    else
     update public.generation_jobs set status='queued',worker_id=null,lease_token=null,lease_expires_at=null,
      managed_run_id=null,managed_attempt_id=null,provider_prompt_id=null,submission_started=false,
      provider_phase='pending',provider_submitted_at=null,provider_claimed_at=null,provider_deadline_at=null,started_at=null where id=j.id;
    end if;
   end if;
  end loop;
 else
  result:=public.h3_pod_work_before_start_refund(p_owner,p_action,p_token,p_data);
  if result->>'busy'='true' then return result; end if;
 end if;
 if p_action='drain' then
  reason:=p_data->>'reason';
  if reason in ('startup_failed','host_failed','worker_exited','budget_deadline','insufficient_run_window','transfer_failed') then
   -- Machine failures do not disable unrelated customers. Global accounting in
   -- begin still prevents new rent once the authorized budget is exhausted.
   update public.h3_pod_control set enabled=c.enabled where id;
  elsif reason in ('gpu_oom','profile_configuration') then
   update public.h3_execution_profiles set suspended_at=now(),failure_reason=reason where id=r.profile_id or (reason='profile_configuration' and image_digest=r.profile->>'image_digest');
   update public.h3_pod_control set enabled=c.enabled where id;
  end if;
 end if;
 if p_action='acquire' and c.enabled then
  update public.generation_jobs set managed_deadline_at=created_at+interval '120 minutes',managed_seed=abs(hashtext(id::text)::bigint)
   where status='queued' and provider_backend='comfy' and not submission_started and managed_deadline_at is null;
  perform public.sweep_generations();
  if exists(select 1 from public.generation_jobs where managed_run_id=c.current_run and status='running' and lease_expires_at<now()-interval '2 minutes') then
   update public.h3_pod_runs set boot_error='HOST_FAILED' where id=c.current_run and phase='running';
  end if;
  if exists(select 1 from public.generation_jobs where managed_run_id=c.current_run and status in ('queued','running') and managed_deadline_at<=now()) then
   update public.h3_pod_runs set needs_rotation=true where id=c.current_run;
  end if;
 end if;
 select * into c from public.h3_pod_control where id;
 select * into r from public.h3_pod_runs where id=c.current_run;
 return result||jsonb_build_object('enabled',c.enabled,'pending',exists(select 1 from public.generation_jobs where status='queued' and provider_backend='comfy'),'run',to_jsonb(r),'profiles',coalesce((select jsonb_agg(to_jsonb(profile_row) order by profile_row.id desc) from public.h3_execution_profiles profile_row
   where profile_row.enabled and profile_row.suspended_at is null and exists(select 1 from public.generation_jobs queued_job where queued_job.status='queued' and queued_job.provider_backend='comfy'
   and profile_row.supported_clips ? (queued_job.resolution||':'||queued_job.duration_seconds||':'||queued_job.aspect_ratio))),'[]'::jsonb));
end $$;

create or replace function public.claim_generation(p_worker_id text) returns public.generation_jobs language plpgsql security invoker set search_path='' as $$
declare c public.h3_pod_control; r public.h3_pod_runs; j public.generation_jobs; aid uuid; seconds integer;
begin
 -- Same lock order as controller: control, idle guard, jobs.
 select * into c from public.h3_pod_control where id for update;
 perform 1 from public.gpu_idle_control where id for update;
 if exists(select 1 from public.gpu_idle_control where id and draining) then return null; end if;
 if c.current_run is null then return public.claim_generation_before_idle_guard(p_worker_id); end if;
 select * into r from public.h3_pod_runs where id=c.current_run;
 if r.phase<>'running' or not c.enabled or p_worker_id not like r.worker_prefix||'_%' then return null; end if;
 insert into public.generation_workers(id) values(p_worker_id) on conflict(id) do update set last_seen_at=now();
 select * into j from public.generation_jobs where managed_run_id=r.id and status='running' for update limit 1;
 if found then
  if j.provider_phase='reconciling' then return null; end if;
  if j.lease_expires_at>now() and j.worker_id<>p_worker_id then return null; end if;
  -- A new process adopts the same physical attempt and reconciles Comfy/Storage.
  update public.generation_jobs set worker_id=p_worker_id,lease_token=case when worker_id=p_worker_id and lease_expires_at>now() then lease_token else gen_random_uuid() end,
   lease_expires_at=now()+interval '3 minutes' where id=j.id returning * into j;
  return j;
 end if;
 select * into j from public.generation_jobs where managed_run_id=r.id and status='queued' and managed_deadline_at>now() order by created_at,id for update limit 1;
 if not found then
  select * into j from public.generation_jobs where managed_run_id is null and status='queued' and provider_backend='comfy' and not submission_started
   and (managed_deadline_at is null or managed_deadline_at>now()) and infra_runs<3
   and infra_reserved_microusd+c.run_limit_microusd<=infra_limit_microusd
   and public.h3_order_can_rent(id,c.run_limit_microusd,r.id)
   and r.profile->'supported_clips' ? (resolution||':'||duration_seconds||':'||aspect_ratio)
   order by created_at,id for update limit 1;
  if not found then
   if exists(select 1 from public.generation_jobs where status='queued' and provider_backend='comfy') then update public.h3_pod_runs set needs_rotation=true where id=r.id; end if;
   return null;
  end if;
 end if;
 seconds:=coalesce((r.profile->>'upload_seconds')::integer,60)+ceil(j.duration_seconds*coalesce((r.profile->'seconds_per_video_second'->>j.resolution)::numeric,35));
 if least(r.deadline_at,coalesce(j.managed_deadline_at,j.created_at+interval '120 minutes'))<=now()+make_interval(secs=>seconds)
    or (extract(epoch from now()-r.created_at)+seconds)*coalesce((r.profile->>'billable_hourly_usd')::numeric,.73)*1000000/3600+30000>=r.reserved_microusd then
  update public.h3_pod_runs set needs_rotation=true where id=r.id; return null;
 end if;
 if j.managed_run_id is null then
  update public.generation_jobs set managed_run_id=r.id,infra_runs=infra_runs+1,infra_reserved_microusd=infra_reserved_microusd+c.run_limit_microusd,
   managed_deadline_at=coalesce(managed_deadline_at,created_at+interval '120 minutes'),managed_seed=coalesce(managed_seed,abs(hashtext(id::text)::bigint)) where id=j.id returning * into j;
 end if;
 insert into public.h3_pod_run_jobs(run_id,job_id) values(r.id,j.id) on conflict do nothing;
 aid:=gen_random_uuid();
 insert into public.h3_generation_attempts(id,job_id,run_id,ordinal,output_path)
 values(aid,j.id,r.id,(select count(*)+1 from public.h3_generation_attempts where job_id=j.id),j.user_id||'/'||j.id||'/'||aid||'.mp4');
 update public.generation_jobs set status='running',worker_id=p_worker_id,lease_token=gen_random_uuid(),lease_expires_at=now()+interval '3 minutes',
  started_at=now(),managed_attempt_id=aid,provider_phase='preparing',provider_claimed_at=now(),provider_deadline_at=least(r.deadline_at,j.managed_deadline_at)
  where id=j.id returning * into j;
 return j;
end $$;

alter function public.finish_generation(uuid,text,uuid,boolean) rename to finish_generation_before_managed_attempts;
create function public.finish_generation(p_job_id uuid,p_worker_id text,p_lease_token uuid,p_success boolean)
returns public.generation_jobs language plpgsql security invoker set search_path='' as $$
declare j public.generation_jobs; path text;
begin
 select * into j from public.generation_jobs where id=p_job_id for update;
 if j.managed_attempt_id is null then return public.finish_generation_before_managed_attempts(p_job_id,p_worker_id,p_lease_token,p_success); end if;
 if j.worker_id is distinct from p_worker_id or j.lease_token is distinct from p_lease_token then raise exception 'LEASE_LOST'; end if;
 if j.status='succeeded' then return j; end if;
 if j.status<>'running' or j.lease_expires_at<=now() or not exists(select 1 from public.h3_pod_runs where id=j.managed_run_id and phase='running') then raise exception 'LEASE_LOST'; end if;
 if not p_success then raise exception 'MANAGED_RECOVERY_REQUIRED'; end if;
 select output_path into path from public.h3_generation_attempts where id=j.managed_attempt_id and status='running';
 if path is null then raise exception 'LEASE_LOST'; end if;
 update public.generation_jobs set status='succeeded',result_path=path,finished_at=now(),lease_expires_at=null where id=j.id returning * into j;
 update public.h3_generation_attempts set status='succeeded',closed_at=now() where id=j.managed_attempt_id;
 return j;
end $$;
create function public.h3_attempt_progress(p_job_id uuid,p_worker_id text,p_lease_token uuid,p_stage text,p_failure text default null)
returns void language plpgsql security invoker set search_path='' as $$
declare j public.generation_jobs; r public.h3_pod_runs;
begin
 perform 1 from public.h3_pod_control where id for update;
 j:=public.heartbeat_generation(p_job_id,p_worker_id,p_lease_token,false,null);
 select * into r from public.h3_pod_runs where id=j.managed_run_id;
 if j.managed_attempt_id is null or r.phase<>'running' then raise exception 'LEASE_LOST'; end if;
 if p_stage not in ('generating','uploading','reconciling') or (p_failure is not null and p_failure not in ('host_failed','gpu_oom','profile_configuration','credentials_invalid','transfer_failed')) then raise exception 'INVALID_GENERATION'; end if;
 update public.h3_generation_attempts set progress_stage=p_stage,progress_at=case when progress_stage is distinct from p_stage then now() else progress_at end,
  status=case when p_failure is not null then 'reconciling' else status end,failure_reason=p_failure where id=j.managed_attempt_id;
 if p_failure is not null then
  update public.generation_jobs set provider_phase='reconciling' where id=j.id;
  update public.h3_pod_runs set boot_error=upper(p_failure) where id=r.id;
 else update public.generation_jobs set provider_phase='generating' where id=j.id;
 end if;
end $$;

create or replace function public.sweep_generations() returns integer language plpgsql security invoker set search_path='' as $$
declare j public.generation_jobs; n integer:=0;
begin
 for j in select * from public.generation_jobs where managed_deadline_at is null and
  ((status='queued' and created_at<now()-interval '120 minutes') or (status='running' and provider_backend='comfy' and (lease_expires_at<now() or started_at<now()-interval '45 minutes')))
  for update skip locked loop
  perform public.refund_generation(j.id,'failed','GENERATION_TIMEOUT'); n:=n+1;
 end loop;
 -- No refund/requeue while a physical resource could still be running.
 for j in select * from public.generation_jobs where status='queued' and managed_run_id is null and managed_deadline_at is not null and
   (managed_deadline_at<=now() or infra_runs>=3 or infra_reserved_microusd+(select run_limit_microusd from public.h3_pod_control where id)>infra_limit_microusd
    or not public.h3_order_can_rent(id,(select run_limit_microusd from public.h3_pod_control where id))) for update skip locked loop
  perform public.refund_generation(j.id,'failed',case when j.managed_deadline_at<=now() then 'H3_DELIVERY_DEADLINE' else 'H3_INFRASTRUCTURE_EXHAUSTED' end); n:=n+1;
 end loop;
 update public.generation_jobs set provider_phase='reconciling' where status='running' and provider_backend='serverless' and provider_deadline_at<=now();
 return n;
end $$;

-- Incremental download bytes, not a timer heartbeat, renew the startup progress clock.
create or replace function public.h3_pod_boot_progress(p_run uuid,p_worker text,p_stage text,p_error text default null)
returns void language plpgsql security invoker set search_path='' as $$
declare c public.h3_pod_control; r public.h3_pod_runs;
begin
 if p_stage is null or p_stage not in ('starting','models','cuda','comfy','ready_callback','runtime') or (p_error is not null and p_error !~ '^[A-Za-z][A-Za-z0-9_]{0,59}$') then raise exception 'INVALID_BOOT_PROGRESS'; end if;
 select * into c from public.h3_pod_control where id for update;
 select * into r from public.h3_pod_runs where id=p_run;
 if c.current_run is distinct from p_run or r.id is null or r.phase not in ('creating','preparing','running') or p_worker is distinct from r.worker_prefix or r.deadline_at<=now() then raise exception 'POD_NOT_ADMITTED'; end if;
 update public.h3_pod_runs set boot_stage=p_stage,boot_updated_at=case when boot_stage is distinct from p_stage then now() else boot_updated_at end,boot_error=p_error where id=p_run;
end $$;
create function public.h3_pod_download_progress(p_run uuid,p_worker text,p_bytes bigint) returns void language plpgsql security invoker set search_path='' as $$
begin
 perform 1 from public.h3_pod_control where id and current_run=p_run for update;
 if not found then raise exception 'POD_NOT_ADMITTED'; end if;
 update public.h3_pod_runs set boot_bytes=p_bytes,boot_updated_at=now() where id=p_run and phase in ('creating','preparing') and worker_prefix=p_worker and p_bytes>boot_bytes and p_bytes<=100000000000;
end $$;
revoke all on function public.h3_stamp_managed_job(),public.finish_generation(uuid,text,uuid,boolean),public.h3_attempt_progress(uuid,text,uuid,text,text),public.h3_pod_download_progress(uuid,text,bigint) from public,anon,authenticated;
grant execute on function public.h3_stamp_managed_job(),public.finish_generation(uuid,text,uuid,boolean),public.h3_attempt_progress(uuid,text,uuid,text,text),public.h3_pod_download_progress(uuid,text,bigint) to service_role;

-- Waiting on GPU capacity releases the coordinator lease; checkpoints and the
-- absolute delivery clock survive restarts. No model runs while it is asleep.
alter table public.studio_productions add column delivery_deadline_at timestamptz,
 add column next_attempt_at timestamptz not null default now();
update public.studio_productions set delivery_deadline_at=created_at+interval '120 minutes';
alter table public.studio_productions alter column delivery_deadline_at set default (now()+interval '120 minutes');
alter table public.studio_productions alter column delivery_deadline_at set not null;
alter function public.studio_production_work(text,text,uuid,uuid,jsonb) rename to studio_production_work_before_gpu_wait;
create function public.studio_production_work(p_worker text,p_action text,p_id uuid default null,p_lease uuid default null,p_data jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare j public.studio_productions;
begin
 if p_action='claim' then
  insert into public.studio_production_workers(id) values(p_worker) on conflict(id) do update set last_seen_at=now();
  update public.studio_productions set status='failed',error_code='PRODUCTION_TIMEOUT',lease_expires_at=null,updated_at=now()
   where status in ('queued','running') and delivery_deadline_at<=now() and (lease_expires_at is null or lease_expires_at<=now());
  select * into j from public.studio_productions where delivery_deadline_at>now() and next_attempt_at<=now()
   and (status='queued' or (status='running' and lease_expires_at<now())) order by created_at for update skip locked limit 1;
  if not found then return null; end if;
  update public.studio_productions set status='running',worker_id=p_worker,lease_token=gen_random_uuid(),lease_expires_at=now()+interval '120 seconds',updated_at=now() where id=j.id returning * into j;
  return to_jsonb(j);
 elsif p_action='yield_gpu' then
  -- Reuse all ownership/revision checks from the existing production function.
  perform public.studio_production_work_before_gpu_wait(p_worker,'heartbeat',p_id,p_lease,'{}');
  update public.studio_productions set status='queued',next_attempt_at=now()+interval '30 seconds',stage='waiting_gpu',
   lease_token=null,worker_id=null,lease_expires_at=null,updated_at=now() where id=p_id returning * into j;
  return to_jsonb(j);
 end if;
 return public.studio_production_work_before_gpu_wait(p_worker,p_action,p_id,p_lease,p_data);
end $$;
create function public.h3_order_clip_deadline() returns trigger language plpgsql security invoker set search_path='' as $$
declare deadline timestamptz;
begin
 select min(delivery_deadline_at)-interval '10 minutes' into deadline from public.studio_productions where project_id=new.project_id and status in ('queued','running');
 if deadline is not null then
  update public.generation_jobs set managed_deadline_at=least(managed_deadline_at,deadline) where id=new.job_id and managed_deadline_at is not null;
 end if;
 return new;
end $$;
create trigger h3_order_clip_deadline after insert on public.studio_scene_versions for each row execute function public.h3_order_clip_deadline();
revoke all on function public.studio_production_work(text,text,uuid,uuid,jsonb),public.h3_order_clip_deadline() from public,anon,authenticated;
grant execute on function public.studio_production_work(text,text,uuid,uuid,jsonb),public.h3_order_clip_deadline() to service_role;
commit;
