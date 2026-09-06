begin;
alter table public.studio_renders add column production_id uuid references public.studio_productions(id), add column quality_status text check(quality_status in ('pending','passed','rejected'));
-- Inherit existing RLS/revokes: render records and media paths remain server-only.
alter function public.studio_production_work(text,text,uuid,uuid,jsonb) rename to studio_production_work_before_quality;
create function public.studio_production_work(p_worker text,p_action text,p_id uuid default null,p_lease uuid default null,p_data jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare j public.studio_productions; r public.studio_renders; result jsonb; report jsonb;
begin
 if p_action not in ('complete','finish_step','write') then
  return public.studio_production_work_before_quality(p_worker,p_action,p_id,p_lease,p_data);
 end if;
 -- Acquire the same account/lease/revision lock before validating or changing a candidate.
 perform public.studio_production_work_before_quality(p_worker,'heartbeat',p_id,p_lease,'{}');
 select * into j from public.studio_productions where id=p_id for update;
 if p_action='complete' then
  select * into r from public.studio_renders where id=(p_data->>'renderId')::uuid and production_id=j.id and project_revision=j.expected_revision;
  if not found or r.quality_status is distinct from 'passed' then raise exception 'PRODUCTION_QUALITY_REQUIRED'; end if;
 end if;
 if p_action='finish_step' and p_data->>'stage'='quality' then
  report:=p_data->'result';
  if report->>'version' is distinct from '1' or report->>'sha256' is null or report->>'sha256' !~ '^[a-f0-9]{64}$'
    or coalesce(report->>'verdict','') not in ('pass','repair','blocked') or coalesce(jsonb_typeof(report->'issues'),'')<>'array'
    or coalesce(jsonb_typeof(report->'sampleTimes'),'')<>'array' then raise exception 'PRODUCTION_QUALITY_INVALID'; end if;
  select * into r from public.studio_renders where id=(report->>'renderId')::uuid and production_id=j.id and project_id=j.project_id and project_revision=j.expected_revision and status='succeeded';
  if not found then raise exception 'PRODUCTION_QUALITY_INVALID'; end if;
  if report->>'verdict'='pass' and (jsonb_array_length(report->'issues')<>0 or jsonb_array_length(report->'sampleTimes')<>jsonb_array_length(r.manifest->'scenes')) then raise exception 'PRODUCTION_QUALITY_INVALID'; end if;
 end if;
 result:=public.studio_production_work_before_quality(p_worker,p_action,p_id,p_lease,p_data);
 if p_action='write' and p_data->>'action'='render' then
  update public.studio_renders set production_id=j.id,quality_status=coalesce(quality_status,'pending') where id=(result->'result'->>'id')::uuid and user_id=j.user_id and project_id=j.project_id;
 end if;
 if p_action='finish_step' and p_data->>'stage'='quality' then
  update public.studio_renders set quality_status=case when report->>'verdict'='pass' then 'passed' else 'rejected' end where id=r.id;
 end if;
 return result;
end $$;
revoke all on function public.studio_production_work(text,text,uuid,uuid,jsonb),public.studio_production_work_before_quality(text,text,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.studio_production_work(text,text,uuid,uuid,jsonb),public.studio_production_work_before_quality(text,text,uuid,uuid,jsonb) to service_role;
commit;
