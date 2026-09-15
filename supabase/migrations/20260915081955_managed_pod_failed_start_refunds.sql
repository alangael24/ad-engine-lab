begin;
alter function public.h3_pod_work(text,text,uuid,jsonb) rename to h3_pod_work_before_start_refund;
create function public.h3_pod_work(p_owner text,p_action text,p_token uuid default null,p_data jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb; j public.generation_jobs;
begin
 result:=public.h3_pod_work_before_start_refund(p_owner,p_action,p_token,p_data);
 -- Refund only after the controller verifies provider deletion. No submitted
 -- or running generation is considered safe to refund by this path.
 if p_action='close' and result#>>'{run,phase}'='closed'
   and result#>>'{run,ready_at}' is null and result#>>'{run,reason}'<>'idle' then
  for j in select * from public.generation_jobs
   where status='queued' and not submission_started and provider_backend='comfy'
     and created_at <= (result#>>'{run,closed_at}')::timestamptz
   for update
  loop
   perform public.refund_generation(j.id,'failed','H3_STARTUP_FAILED');
  end loop;
 end if;
 return result;
end $$;
revoke all on function public.h3_pod_work(text,text,uuid,jsonb),public.h3_pod_work_before_start_refund(text,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.h3_pod_work(text,text,uuid,jsonb),public.h3_pod_work_before_start_refund(text,text,uuid,jsonb) to service_role;
commit;
