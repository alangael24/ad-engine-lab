-- Delivery preference can only be set on a confirmed, owned order.
create function public.gift_order_whatsapp(p_user uuid,p_order uuid,p_phone text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.gift_guest_checkouts;
begin
 if p_phone is not null and p_phone !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'GIFT_INVALID'; end if;
 perform 1 from public.gift_orders where id=p_order and user_id=p_user and status<>'cancelled';
 if not found then raise exception 'GIFT_NOT_FOUND'; end if;
 select * into c from public.gift_guest_checkouts where order_id=p_order and checkout_session_id is not null for update;
 if not found then raise exception 'GIFT_INVALID'; end if;
 update public.gift_guest_checkouts set whatsapp_phone=p_phone,
 whatsapp_consented_at=case when p_phone is null then null else now() end
 where id=c.id returning * into c;
 return jsonb_build_object('phone',c.whatsapp_phone,'consentedAt',c.whatsapp_consented_at);
end $$;
revoke all on function public.gift_order_whatsapp(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.gift_order_whatsapp(uuid,uuid,text) to service_role;
-- Older cached checkout clients must no longer collect delivery contact.
create or replace function public.gift_guest_checkout_contact(p_draft uuid,p_plan text,p_token text,p_phone text)
returns jsonb language sql security invoker set search_path='' as $$
 select public.gift_guest_checkout(p_draft,p_plan,p_token);
$$;
