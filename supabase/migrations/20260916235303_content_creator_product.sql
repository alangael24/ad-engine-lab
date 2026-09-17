begin;
alter table public.studio_projects alter column brand_id drop not null;
alter table public.studio_projects add constraint studio_project_product_scope check (
 (coalesce(data->>'productProfile','continuity-v1')='creator-v1' and brand_id is null and data->>'brandId' is null)
 or (coalesce(data->>'productProfile','continuity-v1') in ('continuity-v1','ads-sales-v1') and brand_id is not null)
);
-- The creator lane has no synthetic brand. All other writes retain the existing
-- ownership, revision, idempotency, recovery and billing implementation.
alter function public.studio_write(uuid,text,uuid,jsonb,integer) rename to studio_write_before_creator;
create function public.studio_write(p_user_id uuid,p_action text,p_id uuid,p_data jsonb,p_expected integer default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.studio_projects; profile text; ref text;
begin
 perform pg_advisory_xact_lock(hashtext('studio:'||p_user_id::text));
 if not exists(select 1 from auth.users where id=p_user_id) then raise exception 'UNAUTHORIZED'; end if;
 if p_action in ('create_project','save_project') then
  profile:=coalesce(p_data->>'productProfile','continuity-v1');
  if profile not in ('creator-v1','continuity-v1','ads-sales-v1') then raise exception 'STUDIO_INVALID'; end if;
  select * into p from public.studio_projects where id=p_id and user_id=p_user_id for update;
  if found and coalesce(p.data->>'productProfile','continuity-v1')<>profile then raise exception 'STUDIO_PRODUCT_LOCKED'; end if;
  if profile='creator-v1' then
   if p_data->>'brandId' is not null then raise exception 'STUDIO_INVALID'; end if;
   -- Character/style references must belong to this customer, also on direct RPCs.
   for ref in select jsonb_array_elements_text(coalesce(p_data#>'{creativeMemory,characterAssetIds}','[]'))
    union select jsonb_array_elements_text(coalesce(p_data#>'{creativeMemory,referenceAssetIds}','[]'))
    union select jsonb_array_elements_text(coalesce(p_data#>'{creativeMemory,approvedAssets}','[]'))
    union select value->>'assetId' from jsonb_array_elements(coalesce(p_data#>'{creativeMemory,productViews}','[]'))
    union select value->>'assetId' from jsonb_array_elements(coalesce(p_data#>'{creativeMemory,observedStates}','[]')) loop
    if not exists(select 1 from public.studio_assets where id=ref::uuid and user_id=p_user_id and kind='image') then raise exception 'STUDIO_ASSET_NOT_FOUND'; end if;
   end loop;
   if p_action='create_project' then
    if p.id is not null then return to_jsonb(p); end if;
    if (select count(*) from public.studio_projects where user_id=p_user_id)>=100 then raise exception 'STUDIO_LIMIT'; end if;
    if coalesce(jsonb_array_length(p_data->'scenes'),0)<>0 or p_data->>'narrationAssetId' is not null or p_data->>'referenceAnalysisId' is not null then raise exception 'STUDIO_INVALID'; end if;
    insert into public.studio_projects(id,user_id,brand_id,brand_snapshot,data) values(p_id,p_user_id,null,'{}',p_data) returning * into p;
    return to_jsonb(p);
   end if;
  end if;
 elsif p_action='refresh_brand' then
  if exists(select 1 from public.studio_projects where id=p_id and user_id=p_user_id and data->>'productProfile'='creator-v1') then raise exception 'STUDIO_INVALID'; end if;
 end if;
 return public.studio_write_before_creator(p_user_id,p_action,p_id,p_data,p_expected);
end $$;
revoke all on function public.studio_write(uuid,text,uuid,jsonb,integer),public.studio_write_before_creator(uuid,text,uuid,jsonb,integer) from public,anon,authenticated;
grant execute on function public.studio_write(uuid,text,uuid,jsonb,integer),public.studio_write_before_creator(uuid,text,uuid,jsonb,integer) to service_role;
-- Leave the outer credit/budget/recovery wrappers intact.
do $$
declare def text; needle text := 'if p.brand_snapshot->>''productAssetId'' is null then';
begin
 select pg_get_functiondef('public.studio_production_start_before_credits(uuid,uuid,uuid,integer,boolean)'::regprocedure) into def;
 if position(needle in def)=0 then raise exception 'Creator migration: production prerequisite changed'; end if;
 execute replace(def,needle,'if coalesce(p.data->>''productProfile'',''continuity-v1'')<>''creator-v1'' and p.brand_snapshot->>''productAssetId'' is null then');
end $$;
commit;
