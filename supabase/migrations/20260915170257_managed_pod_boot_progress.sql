begin;
alter table public.h3_pod_runs add column boot_stage text,
 add column boot_updated_at timestamptz, add column boot_error text;
create function public.h3_pod_boot_progress(p_run uuid,p_worker text,p_stage text,p_error text default null)
returns void language plpgsql security invoker set search_path='' as $$
declare c public.h3_pod_control; r public.h3_pod_runs;
begin
 if p_stage is null or p_stage not in ('starting','models','cuda','comfy','ready_callback')
  or (p_error is not null and p_error !~ '^[A-Za-z][A-Za-z0-9_]{0,59}$') then raise exception 'INVALID_BOOT_PROGRESS'; end if;
 select * into c from public.h3_pod_control where id for update;
 select * into r from public.h3_pod_runs where id=p_run;
 if c.current_run is distinct from p_run or r.id is null or r.phase not in ('creating','preparing')
  or p_worker is distinct from r.worker_prefix or r.deadline_at<=now() then raise exception 'POD_NOT_ADMITTED'; end if;
 update public.h3_pod_runs set boot_stage=p_stage,boot_updated_at=now(),boot_error=p_error where id=p_run;
end $$;
revoke all on function public.h3_pod_boot_progress(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.h3_pod_boot_progress(uuid,text,text,text) to service_role;
commit;
