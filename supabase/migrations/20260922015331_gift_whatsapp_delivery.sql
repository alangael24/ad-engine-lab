-- Optional delivery contact. Private table remains service-role only.
alter table public.gift_guest_checkouts
 add column whatsapp_phone text,
 add column whatsapp_consented_at timestamptz,
 add constraint gift_whatsapp_contact check (
  (whatsapp_phone is null and whatsapp_consented_at is null) or
  (whatsapp_phone is not null and whatsapp_phone ~ '^\+[1-9][0-9]{7,14}$' and whatsapp_consented_at is not null)
 );

create function public.gift_guest_checkout_contact(p_draft uuid,p_plan text,p_token text,p_phone text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.gift_guest_checkouts;
begin
 if p_phone is not null and p_phone !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'GIFT_INVALID'; end if;
 perform public.gift_guest_checkout(p_draft,p_plan,p_token);
 select * into c from public.gift_guest_checkouts where draft_id=p_draft and plan=p_plan and parent_id is null for update;
 -- Paid contact cannot be redirected using the older draft credential.
 if c.order_id is null then
  update public.gift_guest_checkouts set whatsapp_phone=p_phone,
   whatsapp_consented_at=case when p_phone is null then null else now() end
  where id=c.id returning * into c;
 end if;
 return to_jsonb(c);
end $$;
revoke all on function public.gift_guest_checkout_contact(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.gift_guest_checkout_contact(uuid,text,text,text) to service_role;

create or replace function public.gift_guest_repeat_payment(p_parent uuid,p_session text,p_token text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.gift_guest_checkouts; parent public.gift_guest_checkouts;
begin
 select * into parent from public.gift_guest_checkouts where id=p_parent for update;
 if not found or parent.order_id is null then raise exception 'GIFT_INVALID'; end if;
 select * into c from public.gift_guest_checkouts where checkout_session_id=p_session;
 if found then
  if c.id<>p_parent and c.parent_id is distinct from p_parent then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  return to_jsonb(c);
 end if;
 insert into public.gift_guest_checkouts(id,draft_id,plan,access_token,parent_id,checkout_session_id,whatsapp_phone,whatsapp_consented_at)
 values(gen_random_uuid(),parent.draft_id,parent.plan,p_token,p_parent,p_session,parent.whatsapp_phone,parent.whatsapp_consented_at) returning * into c;
 return to_jsonb(c);
end $$;

