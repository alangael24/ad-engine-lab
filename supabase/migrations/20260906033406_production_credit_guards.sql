begin;
alter function public.studio_production_start(uuid,uuid,uuid,integer,boolean) rename to studio_production_start_before_credits;
create function public.studio_production_start(p_user uuid,p_id uuid,p_project uuid,p_expected integer,p_enabled boolean)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb; existed boolean; b public.credit_balances; previous public.studio_productions; retained jsonb; need_video integer; need_image integer;
begin
 perform pg_advisory_xact_lock(hashtext('studio:'||p_user::text));
 existed:=exists(select 1 from public.studio_productions where id=p_id);
 result:=public.studio_production_start_before_credits(p_user,p_id,p_project,p_expected,p_enabled);
 if existed then return result; end if;
 -- A new attempt on an unchanged pre-storyboard project keeps completed assets.
 -- A started/uncertain provider call is never silently resumed by a replay.
 if jsonb_array_length(coalesce(result->'snapshot'->'data'->'scenes','[]'))=0 then
  select * into previous from public.studio_productions where project_id=p_project and user_id=p_user and id<>p_id and status='failed'
   and expected_revision=p_expected and snapshot->'data'=result->'snapshot'->'data'
   and snapshot->'brand_snapshot'=result->'snapshot'->'brand_snapshot' order by created_at desc limit 1;
  if found then
   select coalesce(jsonb_object_agg(key,value),'{}') into retained from jsonb_each(previous.steps)
    where value->>'status'='done' and (key in ('plan','narration','timing') or key ~ '^image-[0-9]+$');
   update public.studio_productions set steps=retained where id=p_id returning to_jsonb(studio_productions) into result;
  end if;
 end if;
 select * into b from public.credit_balances where user_id=p_user for update;
 if not found then raise exception 'ACCOUNT_NOT_READY'; end if;
 if jsonb_array_length(coalesce(result->'snapshot'->'data'->'scenes','[]'))=0 then
  need_video:=1;need_image:=case when retained ? 'plan' then greatest(0,jsonb_array_length(retained->'plan'->'result'->'scenes')-(select count(*) from jsonb_each(retained) where key ~ '^image-[0-9]+$')) else 1 end;
 else
  select coalesce(sum(ceil(((s->>'end')::numeric-(s->>'start')::numeric)/5)),0),count(*) filter(where s->>'imageAssetId' is null)
   into need_video,need_image from jsonb_array_elements(result->'snapshot'->'data'->'scenes') s where s->>'selectedVersionId' is null;
 end if;
 if b.video_credits<need_video or b.image_credits<need_image then raise exception 'INSUFFICIENT_CREDITS'; end if;
 return result;
end $$;
alter function public.studio_production_work(text,text,uuid,uuid,jsonb) rename to studio_production_work_before_credits;
create function public.studio_production_work(p_worker text,p_action text,p_id uuid default null,p_lease uuid default null,p_data jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb; j public.studio_productions; k text; ext text; charged integer; step record; need_video integer; need_image integer; b public.credit_balances;
begin
 if p_action='write' and p_data->>'action'='version' and p_data->'data'->>'assetId' is null then
  perform public.studio_production_work_before_credits(p_worker,'heartbeat',p_id,p_lease,'{}');
  select * into j from public.studio_productions where id=p_id for update;
  if j.steps->(p_data->>'key')->>'status' is distinct from 'done' then
   select coalesce(sum(ceil(((s->>'end')::numeric-(s->>'start')::numeric)/5)),0) into need_video
    from public.studio_projects p cross join lateral jsonb_array_elements(p.data->'scenes') s where p.id=j.project_id and s->>'selectedVersionId' is null;
   select * into b from public.credit_balances where user_id=j.user_id for update;
   if b.video_credits<need_video then raise exception 'INSUFFICIENT_CREDITS'; end if;
  end if;
 end if;
 result:=public.studio_production_work_before_credits(p_worker,p_action,p_id,p_lease,p_data);
 if p_action='begin_step' and p_data->>'key' ~ '^(image-[0-9]+|repair-image-[0-9]+-[0-9]+)$' and result->>'status'='started' then
  select * into j from public.studio_productions where id=p_id for update;
  need_image:=1;
  if p_data->>'key' ~ '^image-[0-9]+$' and j.steps->'plan'->>'status'='done' then
   select count(*) into need_image from jsonb_array_elements(j.steps->'plan'->'result'->'scenes') with ordinality as t(s,n)
    where s->>'imageAssetId' is null and s->>'selectedVersionId' is null and j.steps->('image-'||(n-1)) ->>'status' is distinct from 'done';
  end if;
  select * into b from public.credit_balances where user_id=j.user_id for update;
  if b.image_credits<greatest(1,need_image) then raise exception 'INSUFFICIENT_CREDITS'; end if;
  update public.credit_balances set image_credits=image_credits-1,updated_at=now() where user_id=j.user_id and image_credits>=1;
  if not found then raise exception 'INSUFFICIENT_CREDITS'; end if;
  insert into public.credit_ledger(user_id,credit_type,delta,reason,external_id)
   values(j.user_id,'image',-1,'image_generation_reserved','production:'||j.id||':'||(p_data->>'key')||':reserve');
 elsif p_action='fail' then
  select * into j from public.studio_productions where id=p_id for update;
  -- Failed/uncertain images are not delivered. Refund the customer once; keep
  -- completed assets charged and available for an explicit retry.
  for step in select key,value from jsonb_each(j.steps) where key ~ '^(image-[0-9]+|repair-image-[0-9]+-[0-9]+)$' and value->>'status'='started' loop
   ext:='production:'||j.id||':'||step.key;
   if exists(select 1 from public.credit_ledger where user_id=j.user_id and external_id=ext||':reserve') then
    insert into public.credit_ledger(user_id,credit_type,delta,reason,external_id) values(j.user_id,'image',1,'image_generation_refunded',ext||':refund') on conflict(external_id) do nothing;
    get diagnostics charged=row_count;
    if charged=1 then update public.credit_balances set image_credits=image_credits+1,updated_at=now() where user_id=j.user_id; end if;
   end if;
  end loop;
 end if;
 return result;
end $$;
revoke all on function public.studio_production_start(uuid,uuid,uuid,integer,boolean),public.studio_production_work(text,text,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.studio_production_start(uuid,uuid,uuid,integer,boolean),public.studio_production_work(text,text,uuid,uuid,jsonb) to service_role;
commit;
