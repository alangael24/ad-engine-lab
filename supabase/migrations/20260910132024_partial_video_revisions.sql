begin;
-- A private render may replace its timings only under its active worker lease.
create or replace function public.studio_editorial_manifest(p_worker text,p_id uuid,p_lease uuid,p_scenes jsonb,p_editorial jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.studio_renders; s jsonb; old jsonb; result jsonb:='[]'; n integer:=0; boundary numeric:=0;
begin
 select * into r from public.studio_renders where id=p_id for update;
 if r.id is null or r.worker_id is distinct from p_worker or r.lease_token is distinct from p_lease or r.status<>'running' or r.lease_expires_at<=now() then raise exception 'LEASE_LOST'; end if;
 if jsonb_typeof(p_scenes)<>'array' or jsonb_array_length(p_scenes)<>jsonb_array_length(r.manifest->'scenes') or coalesce(p_editorial->>'sha256','')!~'^[a-f0-9]{64}$' then raise exception 'EDITORIAL_INVALID'; end if;
 if r.manifest ? 'editorial' then
  if r.manifest->'editorial'=p_editorial and r.manifest->'scenes'=p_scenes then return r.manifest; end if;
  raise exception 'IDEMPOTENCY_CONFLICT';
 end if;
 for s in select value from jsonb_array_elements(p_scenes) loop
  old:=r.manifest->'scenes'->n;
  if jsonb_typeof(s->'start') is distinct from 'number' or jsonb_typeof(s->'end') is distinct from 'number' or (s-array['start','end','sourceRanges'])<>(old-array['start','end','sourceRanges']) or (s->>'start')::numeric<>boundary or (s->>'end')::numeric-boundary<0.5 or (s->>'end')::numeric>120 then raise exception 'EDITORIAL_INVALID'; end if;
  boundary:=(s->>'end')::numeric;result:=result||jsonb_build_array(s);n:=n+1;
 end loop;
 update public.studio_renders set manifest=manifest||jsonb_build_object('scenes',result,'originalScenes',manifest->'scenes','editorial',p_editorial) where id=r.id returning manifest into result;
 return result;
end $$;
revoke all on function public.studio_editorial_manifest(text,uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.studio_editorial_manifest(text,uuid,uuid,jsonb,jsonb) to service_role;

create or replace function public.studio_editorial_begin(p_worker text,p_id uuid,p_lease uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.studio_renders;
begin
 select * into r from public.studio_renders where id=p_id for update;
 if r.id is null or r.worker_id is distinct from p_worker or r.lease_token is distinct from p_lease or r.status<>'running' or r.lease_expires_at<=now() then raise exception 'LEASE_LOST'; end if;
 if r.editorial_started_at is not null then raise exception 'EDITORIAL_UNCERTAIN'; end if;
 update public.studio_renders set editorial_started_at=now(),quality_status=coalesce(quality_status,'pending') where id=r.id;
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.studio_editorial_begin(text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.studio_editorial_begin(text,uuid,uuid) to service_role;

-- Existing-media revisions have the same private review gate as new productions.
alter function public.studio_render_worker(text,text,uuid,uuid,boolean) rename to studio_render_worker_before_partial;
create function public.studio_render_worker(p_worker text,p_action text,p_id uuid default null,p_lease uuid default null,p_success boolean default false)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb; r public.studio_renders;
begin
 if p_action='complete' then
  select * into r from public.studio_renders where id=p_id for update;
  if p_success and r.production_id is null and r.editorial_started_at is not null and
   (r.manifest->'editorial'->'review'->>'verdict' is distinct from 'pass' or r.manifest->'editorial'->'review'->>'sha256' is distinct from r.manifest->'editorial'->>'sha256') then raise exception 'EDITORIAL_REVIEW_REQUIRED'; end if;
 end if;
 result:=public.studio_render_worker_before_partial(p_worker,p_action,p_id,p_lease,p_success);
 if p_action='complete' and r.production_id is null and r.editorial_started_at is not null then
  update public.studio_renders set quality_status=case when status='succeeded' then 'passed' else 'rejected' end where id=p_id;
 end if;
 return result;
end $$;
revoke all on function public.studio_render_worker_before_partial(text,text,uuid,uuid,boolean) from public,anon,authenticated;
revoke all on function public.studio_render_worker(text,text,uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.studio_render_worker(text,text,uuid,uuid,boolean) to service_role;

commit;
