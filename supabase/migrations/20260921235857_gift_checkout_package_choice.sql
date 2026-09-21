create function public.gift_order_package(p_user uuid,p_id uuid,p_expected integer,p_seconds integer)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare o public.gift_orders; p public.studio_projects; next_brief jsonb; instruction text;
begin
 if p_seconds is null or p_seconds not in(60,120) then raise exception 'GIFT_INVALID'; end if;
 perform pg_advisory_xact_lock(hashtext('studio:'||p_user::text));
 select * into p from public.studio_projects where id=p_id and user_id=p_user for update;
 if not found then raise exception 'GIFT_NOT_FOUND'; end if;
 select * into o from public.gift_orders where id=p_id and user_id=p_user for update;
 if not found then raise exception 'GIFT_NOT_FOUND'; end if;
 if o.status not in('received','script_ready') or o.reserved_seconds<>0 then raise exception 'GIFT_INVALID'; end if;
 if o.target_seconds=p_seconds then return to_jsonb(o); end if;
 if p_expected is distinct from o.revision then raise exception 'GIFT_CONFLICT'; end if;
 instruction:='Narra una historia de aproximadamente '||case when p_seconds=120 then 'dos minutos' else 'un minuto' end;
 next_brief:=jsonb_set(o.brief,'{creatorBrief,targetDuration}',to_jsonb(p_seconds));
 next_brief:=jsonb_set(next_brief,'{idea}',to_jsonb(regexp_replace(next_brief->>'idea','Narra una historia de aproximadamente (un minuto|dos minutos)',instruction)));
 next_brief:=jsonb_set(next_brief,'{scriptDraft}','""'::jsonb);
 update public.studio_projects set data=next_brief,revision=revision+1,updated_at=now() where id=p_id;
 update public.gift_orders set brief=next_brief,target_seconds=p_seconds,status='received',script='',revision=revision+1,updated_at=now() where id=p_id returning * into o;
 return to_jsonb(o);
end $$;
revoke all on function public.gift_order_package(uuid,uuid,integer,integer) from public,anon,authenticated;
grant execute on function public.gift_order_package(uuid,uuid,integer,integer) to service_role;
