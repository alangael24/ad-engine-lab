-- Keep legacy orders intact; a confirmed purchase can await its story.
alter table public.gift_orders add column personalization jsonb;
create function public.gift_personalization_guard() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='INSERT' and exists(select 1 from public.gift_guest_checkouts c join public.gift_guest_drafts d on d.id=c.draft_id where c.id=new.id and d.fields->>'flow'='pay_first') then
  new.personalization:=jsonb_build_object('state','pending','fields','{}'::jsonb);
 end if;
 if tg_op='UPDATE' and old.personalization is not null and new.target_seconds<>old.target_seconds then raise exception 'GIFT_INVALID'; end if;
 if new.personalization->>'state'='pending' and new.status not in('received','cancelled') then raise exception 'GIFT_PERSONALIZATION_REQUIRED'; end if;
 return new;
end $$;
create trigger gift_personalization_guard before insert or update on public.gift_orders for each row execute function public.gift_personalization_guard();
create function public.gift_personalization_save(p_user uuid,p_order uuid,p_fields jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare o public.gift_orders;
begin
 perform pg_advisory_xact_lock(hashtext('studio:'||p_user::text));
 select * into o from public.gift_orders where id=p_order and user_id=p_user for update;
 if not found then raise exception 'GIFT_NOT_FOUND'; end if;
 if o.status<>'received' or o.personalization->>'state' is distinct from 'pending' or not exists(select 1 from public.gift_guest_checkouts where order_id=p_order and checkout_session_id is not null) then raise exception 'GIFT_INVALID'; end if;
 update public.gift_orders set personalization=jsonb_set(personalization,'{fields}',p_fields),updated_at=now() where id=p_order returning * into o;
 return to_jsonb(o);
end $$;
create function public.gift_personalization_complete(p_user uuid,p_order uuid,p_draft uuid,p_fields jsonb,p_data jsonb,p_assets jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare o public.gift_orders; a jsonb;
begin
 perform pg_advisory_xact_lock(hashtext('studio:'||p_user::text));
 select * into o from public.gift_orders where id=p_order and user_id=p_user for update;
 if not found then raise exception 'GIFT_NOT_FOUND'; end if;
 if o.personalization->>'state'='complete' and o.personalization->>'draftId'=p_draft::text then return to_jsonb(o); end if;
 if o.status<>'received' or o.personalization->>'state' is distinct from 'pending'
 or not exists(select 1 from public.gift_guest_checkouts where order_id=p_order and checkout_session_id is not null)
 or (p_data->'creatorBrief'->>'targetDuration')::integer is distinct from o.target_seconds then raise exception 'GIFT_INVALID'; end if;
 for a in select value from jsonb_array_elements(p_assets) loop perform public.studio_write(p_user,'register_asset',(a->>'id')::uuid,a,null); end loop;
 update public.studio_projects set data=p_data,revision=revision+1,updated_at=now() where id=p_order and user_id=p_user;
 update public.gift_orders set brief=p_data,personalization=jsonb_build_object('state','complete','draftId',p_draft,'fields',p_fields),revision=revision+1,updated_at=now() where id=p_order returning * into o;
 return to_jsonb(o);
end $$;
revoke all on function public.gift_personalization_guard(),public.gift_personalization_save(uuid,uuid,jsonb),public.gift_personalization_complete(uuid,uuid,uuid,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.gift_personalization_guard(),public.gift_personalization_save(uuid,uuid,jsonb),public.gift_personalization_complete(uuid,uuid,uuid,jsonb,jsonb,jsonb) to service_role;
