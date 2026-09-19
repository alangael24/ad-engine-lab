begin;
-- Retain a healthy warm GPU inside existing authorizations instead of paying
-- another cold start when only the initial per-session reservation runs out.
alter function public.h3_pod_work(text,text,uuid,jsonb) rename to h3_pod_work_before_cost_recovery;
create function public.h3_pod_work(p_owner text,p_action text,p_token uuid default null,p_data jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb; c public.h3_pod_control; r public.h3_pod_runs; j public.generation_jobs;
 seconds integer; required bigint; extra bigint; spent bigint; rate numeric; horizon integer;
begin
 if p_action='retain' then
  -- Heartbeat authenticates/fences the controller and takes the control lock.
  result:=public.h3_pod_work_before_cost_recovery(p_owner,'heartbeat',p_token,'{}');
  select * into c from public.h3_pod_control where id for update;
  select * into r from public.h3_pod_runs where id=c.current_run for update;
  if not c.enabled or r.phase<>'running' or r.ready_at is null or r.boot_error is not null
    or exists(select 1 from public.generation_jobs where managed_run_id=r.id and status='running') then return result; end if;
  select * into j from public.generation_jobs where status='queued' and provider_backend='comfy'
   and (managed_run_id=r.id or (managed_run_id is null and infra_runs<3 and public.h3_order_can_rent(id,c.run_limit_microusd,r.id)))
   and r.profile->'supported_clips' ? (resolution||':'||duration_seconds||':'||aspect_ratio)
   and not submission_started and managed_deadline_at>now() order by (managed_run_id=r.id) desc nulls last,created_at,id for update limit 1;
  if not found then return result; end if;
  seconds:=coalesce((r.profile->>'upload_seconds')::integer,60)+ceil(j.duration_seconds*coalesce((r.profile->'seconds_per_video_second'->>j.resolution)::numeric,35));
  rate:=coalesce((r.profile->>'billable_hourly_usd')::numeric,.73)*1000000;
  required:=ceil((extract(epoch from now()-r.created_at)+seconds+60)*rate/3600)+30000;
  extra:=greatest(0,required-r.reserved_microusd);
  if least(r.deadline_at,j.managed_deadline_at)<=now()+make_interval(secs=>seconds+60) then return result; end if;
  select coalesce(sum(coalesce(estimated_microusd,reserved_microusd)),0) into spent from public.h3_pod_runs;
  if spent+extra>c.total_limit_microusd then return result; end if;
  if j.managed_run_id is null and j.infra_reserved_microusd+greatest(required,r.reserved_microusd)>j.infra_limit_microusd then return result; end if;
  if exists(select 1 from public.generation_jobs g join public.h3_pod_run_jobs l on l.job_id=g.id
    where l.run_id=r.id and g.infra_reserved_microusd+extra>g.infra_limit_microusd) then return result; end if;
  -- Preserve the existing $1.50 order-wide infrastructure cap, counting each
  -- physical session once even when several scenes share it.
  if exists(select 1 from public.studio_productions o where o.status in ('queued','running')
    and (exists(select 1 from public.studio_scene_versions v join public.h3_pod_run_jobs l on l.job_id=v.job_id where l.run_id=r.id and v.project_id=o.project_id)
      or exists(select 1 from public.studio_scene_versions v where v.job_id=j.id and v.project_id=o.project_id))
    and (select coalesce(sum(coalesce(x.estimated_microusd,x.reserved_microusd)),0) from public.h3_pod_runs x
      where x.id=r.id or exists(select 1 from public.h3_pod_run_jobs l join public.studio_scene_versions v on v.job_id=l.job_id where l.run_id=x.id and v.project_id=o.project_id and v.created_at>=o.created_at))+extra>1500000) then return result; end if;
  update public.h3_pod_runs set reserved_microusd=reserved_microusd+extra,needs_rotation=false where id=r.id returning * into r;
  update public.generation_jobs g set infra_reserved_microusd=infra_reserved_microusd+extra
   where exists(select 1 from public.h3_pod_run_jobs l where l.run_id=r.id and l.job_id=g.id);
  if j.managed_run_id is null then
   update public.generation_jobs set managed_run_id=r.id,infra_runs=infra_runs+1,infra_reserved_microusd=infra_reserved_microusd+r.reserved_microusd where id=j.id;
   insert into public.h3_pod_run_jobs(run_id,job_id) values(r.id,j.id);
  end if;
  return result||jsonb_build_object('run',to_jsonb(r),'retained',true,'additionalReservation',extra);
 end if;
 result:=public.h3_pod_work_before_cost_recovery(p_owner,p_action,p_token,p_data);
 if p_action='begin' then
  select * into c from public.h3_pod_control where id;
  select * into r from public.h3_pod_runs where id=c.current_run;
  -- Set the immutable admission horizon BEFORE creating the pod. No lease or
  -- client retry extends it. The controller still enforces the smaller current
  -- reservation, idle shutdown and startup progress timeout every minute.
  select coalesce(sum(coalesce(estimated_microusd,reserved_microusd)),0) into spent from public.h3_pod_runs where id<>r.id;
  rate:=coalesce((r.profile->>'billable_hourly_usd')::numeric,.73)*1000000;
  horizon:=greatest(1,least(7200,floor((least(1500000,greatest(0,c.total_limit_microusd-spent))-30000)*3600/rate)::integer));
  update public.h3_pod_runs set deadline_at=least(created_at+make_interval(secs=>horizon),
   coalesce((select min(managed_deadline_at) from public.generation_jobs where managed_run_id=r.id),created_at+interval '120 minutes')) where id=r.id returning * into r;
  result:=result||jsonb_build_object('run',to_jsonb(r));
 end if;
 return result;
end $$;
revoke all on function public.h3_pod_work(text,text,uuid,jsonb),public.h3_pod_work_before_cost_recovery(text,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.h3_pod_work(text,text,uuid,jsonb),public.h3_pod_work_before_cost_recovery(text,text,uuid,jsonb) to service_role;
-- Copy a completed step atomically, without reserving provider spend or charging
-- an image credit. Never turn an uncertain in-flight call into a new request.
create or replace function public.recover_production_step(p_worker text,p_job uuid,p_lease uuid,p_key text,p_stage text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare j public.studio_productions; old public.studio_productions; saved jsonb;
begin
 perform public.studio_production_work(p_worker,'heartbeat',p_job,p_lease,'{}');
 select * into j from public.studio_productions where id=p_job for update;
 if j.steps ? p_key or p_stage not in ('planning','images','narration','timing') or p_key !~ '^(plan|timing|narration|image-[0-9]+|repair-image-[0-9]+-[0-9]+|material-contracts-v[0-9]+|material-call-[a-f0-9]{64}|material-v[0-9]+-(still-check-[0-9]+-[0-9]+|image-review-[0-9]+))$' then return null; end if;
 select * into old from public.studio_productions p where p.user_id=j.user_id and p.project_id=j.project_id and p.status='failed'
  and p.expected_revision=(j.snapshot->>'revision')::integer and p.snapshot->'revision'=j.snapshot->'revision'
  and p.snapshot->'id'=j.snapshot->'id' and p.snapshot->'user_id'=j.snapshot->'user_id'
  and p.snapshot->'data'=j.snapshot->'data' and p.snapshot->'brand_snapshot'=j.snapshot->'brand_snapshot'
  and (p_key='plan' or j.steps->'plan'->>'status' is distinct from 'done' or p.steps->'plan'->'result'=j.steps->'plan'->'result')
  and p.steps->p_key->>'status'='done' and p.steps->p_key->'result' is not null
  order by p.created_at desc limit 1;
 if not found then return null; end if;
 saved:=old.steps->p_key||jsonb_build_object('recoveredFrom',old.id);
 update public.studio_productions set steps=jsonb_set(steps,array[p_key],saved),updated_at=now() where id=j.id;
 return saved;
end $$;
revoke all on function public.recover_production_step(text,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.recover_production_step(text,uuid,uuid,text,text) to service_role;
commit;
