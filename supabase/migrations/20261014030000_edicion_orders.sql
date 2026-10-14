-- Pedidos de edición por referencia: el cliente sube su video y una referencia,
-- paga un video con Stripe Checkout y un worker lo procesa con lease.
create table public.edicion_orders (
 id uuid primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 plan text not null check (plan in ('basico','pro','premium')),
 amount_mxn integer not null check (amount_mxn > 0),
 status text not null default 'awaiting_payment'
  check (status in ('awaiting_payment','paid','processing','delivered','failed','canceled')),
 source_asset_id uuid not null,
 reference_asset_id uuid,
 reference_url text check (reference_url is null or (reference_url ~ '^https://' and length(reference_url) <= 500)),
 instructions text not null default '' check (length(instructions) <= 1500),
 checkout_session_id text unique,
 stripe_event_id text unique,
 paid_at timestamptz,
 attempts integer not null default 0,
 worker_id text, lease_token uuid, lease_expires_at timestamptz,
 result_path text, result_note text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check ((reference_asset_id is null) <> (reference_url is null))
);
create table public.edicion_workers (id text primary key, last_seen_at timestamptz not null default now());
create index edicion_orders_owner on public.edicion_orders(user_id, created_at desc);
create index edicion_orders_queue on public.edicion_orders(status, paid_at);
alter table public.edicion_orders enable row level security;
alter table public.edicion_workers enable row level security;
revoke all on public.edicion_orders, public.edicion_workers from public, anon, authenticated;
grant all on public.edicion_orders, public.edicion_workers to service_role;

-- Vista segura de un pedido para las rutas autenticadas (sin rutas internas ni leases).
create function public.edicion_public(o public.edicion_orders) returns jsonb language sql immutable as $$
 select jsonb_build_object('id', o.id, 'plan', o.plan, 'amountMxn', o.amount_mxn, 'status', o.status,
  'referenceUrl', o.reference_url, 'instructions', o.instructions, 'note', o.result_note,
  'createdAt', o.created_at, 'paidAt', o.paid_at)
$$;
revoke all on function public.edicion_public(public.edicion_orders) from public, anon, authenticated;
grant execute on function public.edicion_public(public.edicion_orders) to service_role;

create function public.edicion_write(p_user uuid, p_action text, p_id uuid, p_data jsonb)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare o public.edicion_orders; src uuid; ref uuid; ref_url text; instr text;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user::text, 417));
 if p_action = 'create' then
  select * into o from public.edicion_orders where id = p_id;
  if found then
   -- Reintento del mismo pedido: idempotente para su dueño.
   if o.user_id <> p_user then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
   return public.edicion_public(o);
  end if;
  if (select count(*) from public.edicion_orders where user_id = p_user and created_at > now() - interval '1 day') >= 20 then
   raise exception 'EDICION_LIMIT';
  end if;
  src := nullif(p_data->>'sourceAssetId', '')::uuid;
  ref := nullif(p_data->>'referenceAssetId', '')::uuid;
  ref_url := nullif(btrim(coalesce(p_data->>'referenceUrl', '')), '');
  instr := coalesce(p_data->>'instructions', '');
  if src is null or coalesce(p_data->>'plan', '') not in ('basico','pro','premium')
   or coalesce((p_data->>'amountMxn')::integer, 0) <= 0 or length(instr) > 1500
   or (ref is null) = (ref_url is null) then
   raise exception 'EDICION_INVALID';
  end if;
  if not exists (select 1 from public.studio_assets a where a.id = src and a.user_id = p_user and a.kind = 'clip' and a.bucket = 'studio-media')
   or (ref is not null and (ref = src or not exists (select 1 from public.studio_assets a where a.id = ref and a.user_id = p_user and a.kind = 'clip' and a.bucket = 'studio-media'))) then
   raise exception 'STUDIO_ASSET_NOT_FOUND';
  end if;
  insert into public.edicion_orders(id, user_id, plan, amount_mxn, source_asset_id, reference_asset_id, reference_url, instructions)
  values (p_id, p_user, p_data->>'plan', (p_data->>'amountMxn')::integer, src, ref, ref_url, instr) returning * into o;
  return public.edicion_public(o);
 elsif p_action = 'attach_session' then
  select * into o from public.edicion_orders where id = p_id and user_id = p_user for update;
  if not found then raise exception 'EDICION_NOT_FOUND'; end if;
  if o.status <> 'awaiting_payment' then raise exception 'EDICION_ALREADY_PAID'; end if;
  if length(coalesce(p_data->>'checkoutSessionId', '')) < 8 then raise exception 'EDICION_INVALID'; end if;
  update public.edicion_orders set checkout_session_id = p_data->>'checkoutSessionId', updated_at = now()
   where id = p_id returning * into o;
  return public.edicion_public(o);
 end if;
 raise exception 'EDICION_INVALID';
end $$;
revoke all on function public.edicion_write(uuid, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.edicion_write(uuid, text, uuid, jsonb) to service_role;

-- Llamada solo desde el webhook firmado de Stripe. Idempotente por pedido y por evento.
create function public.edicion_payment(p_event_id text, p_session_id text, p_order_id uuid, p_amount_total integer, p_currency text)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare o public.edicion_orders;
begin
 select * into o from public.edicion_orders where id = p_order_id for update;
 if not found then raise exception 'EDICION_NOT_FOUND'; end if;
 if o.stripe_event_id = p_event_id or o.status <> 'awaiting_payment' then
  -- Evento repetido o segundo pago del mismo pedido: no se vuelve a encolar.
  return jsonb_build_object('applied', false, 'status', o.status, 'duplicatePayment', o.checkout_session_id is distinct from p_session_id);
 end if;
 if lower(coalesce(p_currency, '')) <> 'mxn' or p_amount_total <> o.amount_mxn * 100 then
  raise exception 'EDICION_PAYMENT_MISMATCH';
 end if;
 update public.edicion_orders set status = 'paid', paid_at = now(), stripe_event_id = p_event_id,
  checkout_session_id = p_session_id, updated_at = now() where id = p_order_id;
 return jsonb_build_object('applied', true, 'status', 'paid');
end $$;
revoke all on function public.edicion_payment(text, text, uuid, integer, text) from public, anon, authenticated;
grant execute on function public.edicion_payment(text, text, uuid, integer, text) to service_role;

create function public.edicion_work(p_worker text, p_action text, p_id uuid default null, p_lease uuid default null, p_result jsonb default null)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare o public.edicion_orders; terminal text;
begin
 if p_action = 'claim' then
  insert into public.edicion_workers(id) values (p_worker) on conflict (id) do update set last_seen_at = now();
  -- Leases vencidos: se reintenta hasta 3 veces y luego queda para revisión humana.
  update public.edicion_orders set
   status = case when attempts >= 3 then 'failed' else 'paid' end,
   result_note = case when attempts >= 3 then 'La edición se interrumpió varias veces. Lo revisaremos manualmente.' else result_note end,
   worker_id = null, lease_token = null, lease_expires_at = null, updated_at = now()
   where status = 'processing' and lease_expires_at < now();
  select * into o from public.edicion_orders where status = 'paid' order by paid_at for update skip locked limit 1;
  if not found then return null; end if;
  update public.edicion_orders set status = 'processing', attempts = attempts + 1, worker_id = p_worker,
   lease_token = gen_random_uuid(), lease_expires_at = now() + interval '10 minutes', updated_at = now()
   where id = o.id returning * into o;
  return to_jsonb(o);
 end if;
 select * into o from public.edicion_orders where id = p_id and worker_id = p_worker and lease_token = p_lease for update;
 if not found then raise exception 'LEASE_LOST'; end if;
 if p_action = 'finish' and o.status in ('delivered', 'failed') then return public.edicion_public(o); end if;
 if o.status <> 'processing' or o.lease_expires_at <= now() then raise exception 'LEASE_LOST'; end if;
 if p_action = 'heartbeat' then
  update public.edicion_workers set last_seen_at = now() where id = p_worker;
  update public.edicion_orders set lease_expires_at = now() + interval '10 minutes', updated_at = now() where id = p_id;
  return jsonb_build_object('ok', true);
 elsif p_action = 'finish' then
  terminal := p_result->>'status';
  if terminal is null or terminal not in ('delivered', 'failed') or length(coalesce(p_result->>'note', '')) > 1000
   or (terminal = 'delivered' and coalesce(p_result->>'resultPath', '') <> o.user_id::text || '/edicion/' || o.id::text || '.mp4') then
   raise exception 'EDICION_INVALID';
  end if;
  update public.edicion_orders set status = terminal, result_note = nullif(p_result->>'note', ''),
   result_path = case when terminal = 'delivered' then p_result->>'resultPath' end, updated_at = now()
   where id = p_id returning * into o;
  return public.edicion_public(o);
 end if;
 raise exception 'EDICION_INVALID';
end $$;
revoke all on function public.edicion_work(text, text, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.edicion_work(text, text, uuid, uuid, jsonb) to service_role;
