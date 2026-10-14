-- /edicion sin cuenta: el cliente paga primero y después entrega su material en una página privada.
-- El acceso es un enlace con llave secreta; aquí solo se guarda su hash (sha256 en hex).
-- El material llega por partes de 8 MB a un bucket privado (subida que se reanuda en el celular).
alter table public.edicion_orders
 alter column user_id drop not null,
 alter column source_asset_id drop not null,
 add column access_hash text unique check (access_hash is null or access_hash ~ '^[0-9a-f]{64}$'),
 add column email text check (email is null or length(email) <= 320),
 add column source_upload jsonb,
 add column reference_upload jsonb,
 add column names text not null default '' check (length(names) <= 300),
 add column material_at timestamptz,
 drop constraint edicion_orders_check,
 drop constraint edicion_orders_status_check,
 add constraint edicion_orders_status_check
  check (status in ('awaiting_payment','awaiting_material','paid','processing','delivered','failed','canceled')),
 add constraint edicion_orders_owner_check check (user_id is not null or access_hash is not null),
 add constraint edicion_orders_reference_check check (num_nonnulls(reference_asset_id, reference_url, reference_upload) <= 1),
 -- En cola o después, el pedido siempre tiene su video y exactamente una referencia.
 add constraint edicion_orders_material_check check (status in ('awaiting_payment','awaiting_material','canceled')
  or ((source_asset_id is not null or source_upload is not null) and num_nonnulls(reference_asset_id, reference_url, reference_upload) = 1));
alter table public.edicion_revisions alter column user_id drop not null;

create function public.edicion_material_ready(o public.edicion_orders) returns boolean language sql immutable as $$
 select (o.source_asset_id is not null or o.source_upload is not null) and num_nonnulls(o.reference_asset_id, o.reference_url, o.reference_upload) = 1
$$;
revoke all on function public.edicion_material_ready(public.edicion_orders) from public, anon, authenticated;
grant execute on function public.edicion_material_ready(public.edicion_orders) to service_role;

create or replace function public.edicion_public(o public.edicion_orders) returns jsonb language sql immutable as $$
 select jsonb_build_object('id', o.id, 'plan', o.plan, 'amountMxn', o.amount_mxn, 'status', o.status,
  'referenceUrl', o.reference_url, 'referenceName', o.reference_upload->>'name', 'sourceName', o.source_upload->>'name',
  'instructions', o.instructions, 'names', o.names, 'note', o.result_note,
  'createdAt', o.created_at, 'paidAt', o.paid_at, 'materialAt', o.material_at, 'version', o.result_version,
  'revisionsUsed', o.revisions_used, 'revisionsMax', public.edicion_revision_max(o.plan), 'revisionStatus', o.revision_status)
$$;

-- Pago confirmado (webhook o consulta a Stripe). Sin material, el pedido espera al cliente en vez de entrar a la cola.
drop function public.edicion_payment(text, text, uuid, integer, text);
create function public.edicion_payment(p_event_id text, p_session_id text, p_order_id uuid, p_amount_total integer, p_currency text, p_email text default null)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare o public.edicion_orders;
begin
 select * into o from public.edicion_orders where id = p_order_id for update;
 if not found then raise exception 'EDICION_NOT_FOUND'; end if;
 if o.stripe_event_id = p_event_id or o.status <> 'awaiting_payment' then
  return jsonb_build_object('applied', false, 'status', o.status, 'duplicatePayment', o.checkout_session_id is distinct from p_session_id);
 end if;
 if lower(coalesce(p_currency, '')) <> 'mxn' or p_amount_total <> o.amount_mxn * 100 then
  raise exception 'EDICION_PAYMENT_MISMATCH';
 end if;
 update public.edicion_orders set status = case when public.edicion_material_ready(o) then 'paid' else 'awaiting_material' end,
  paid_at = now(), stripe_event_id = p_event_id, checkout_session_id = p_session_id,
  email = coalesce(email, left(nullif(btrim(p_email), ''), 320)), updated_at = now()
  where id = p_order_id returning * into o;
 return jsonb_build_object('applied', true, 'status', o.status);
end $$;
revoke all on function public.edicion_payment(text, text, uuid, integer, text, text) from public, anon, authenticated;
grant execute on function public.edicion_payment(text, text, uuid, integer, text, text) to service_role;

-- Todo lo que hace el cliente desde su enlace privado. La API valida formatos y archivos antes de llamar.
create function public.edicion_guest(p_action text, p_id uuid, p_hash text, p_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare o public.edicion_orders; r public.edicion_revisions; kind text; instr text; nm text; req text;
begin
 if coalesce(p_hash, '') !~ '^[0-9a-f]{64}$' then raise exception 'EDICION_NOT_FOUND'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text, 418));
 if p_action = 'create' then
  select * into o from public.edicion_orders where id = p_id;
  if found then
   if o.access_hash is distinct from p_hash then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
   return public.edicion_public(o);
  end if;
  if (select count(*) from public.edicion_orders where user_id is null and created_at > now() - interval '1 hour') >= 300 then
   raise exception 'EDICION_LIMIT';
  end if;
  if coalesce(p_data->>'plan', '') not in ('basico','pro','premium') or coalesce((p_data->>'amountMxn')::integer, 0) <= 0 then
   raise exception 'EDICION_INVALID';
  end if;
  insert into public.edicion_orders(id, plan, amount_mxn, access_hash)
  values (p_id, p_data->>'plan', (p_data->>'amountMxn')::integer, p_hash) returning * into o;
  return public.edicion_public(o);
 elsif p_action = 'recover' then
  -- La API ya confirmó con Stripe que esa sesión está pagada y es de este pedido: se emite una llave nueva.
  update public.edicion_orders set access_hash = p_hash, updated_at = now()
   where id = p_id and checkout_session_id = p_data->>'sessionId' and status <> 'awaiting_payment' and user_id is null
   returning * into o;
  if not found then raise exception 'EDICION_NOT_FOUND'; end if;
  return public.edicion_public(o);
 end if;

 select * into o from public.edicion_orders where id = p_id and access_hash = p_hash for update;
 if not found then raise exception 'EDICION_NOT_FOUND'; end if;
 if p_action = 'get' then
  return public.edicion_public(o);
 elsif p_action = 'attach_session' then
  if o.status <> 'awaiting_payment' then raise exception 'EDICION_ALREADY_PAID'; end if;
  if length(coalesce(p_data->>'checkoutSessionId', '')) < 8 then raise exception 'EDICION_INVALID'; end if;
  update public.edicion_orders set checkout_session_id = p_data->>'checkoutSessionId', updated_at = now() where id = p_id returning * into o;
  return public.edicion_public(o);
 elsif p_action = 'material' then
  if o.status not in ('awaiting_payment','awaiting_material') then raise exception 'EDICION_ALREADY_SUBMITTED'; end if;
  kind := p_data->>'kind';
  if kind = 'source' and jsonb_typeof(p_data->'upload') = 'object' then
   update public.edicion_orders set source_upload = p_data->'upload', source_asset_id = null, updated_at = now() where id = p_id returning * into o;
  elsif kind = 'reference' and nullif(p_data->>'referenceUrl', '') is not null then
   update public.edicion_orders set reference_url = p_data->>'referenceUrl', reference_upload = null, reference_asset_id = null, updated_at = now()
    where id = p_id returning * into o;
  elsif kind = 'reference' and jsonb_typeof(p_data->'upload') = 'object' then
   update public.edicion_orders set reference_upload = p_data->'upload', reference_url = null, reference_asset_id = null, updated_at = now()
    where id = p_id returning * into o;
  else
   raise exception 'EDICION_INVALID';
  end if;
  return public.edicion_public(o);
 elsif p_action = 'submit' then
  if o.status = 'awaiting_payment' then raise exception 'EDICION_NOT_PAID'; end if;
  if o.status <> 'awaiting_material' then return public.edicion_public(o); end if; -- reintento: ya está en cola
  if not public.edicion_material_ready(o) then raise exception 'EDICION_MATERIAL_MISSING'; end if;
  instr := btrim(coalesce(p_data->>'instructions', '')); nm := btrim(coalesce(p_data->>'names', ''));
  if length(instr) > 1500 or length(nm) > 300 then raise exception 'EDICION_INVALID'; end if;
  update public.edicion_orders set instructions = instr, names = nm, status = 'paid', material_at = now(), updated_at = now()
   where id = p_id returning * into o;
  return public.edicion_public(o);
 elsif p_action = 'revision' then
  select * into r from public.edicion_revisions where id = (p_data->>'revisionId')::uuid;
  if found then
   if r.order_id <> p_id then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
   return public.edicion_public(o);
  end if;
  req := btrim(coalesce(p_data->>'request', ''));
  if o.status <> 'delivered' then raise exception 'EDICION_NOT_READY'; end if;
  if o.revision_status in ('queued','processing') then raise exception 'EDICION_REVISION_BUSY'; end if;
  if o.revisions_used >= public.edicion_revision_max(o.plan) then raise exception 'EDICION_REVISION_LIMIT'; end if;
  if length(req) not between 3 and 1000 then raise exception 'EDICION_INVALID'; end if;
  insert into public.edicion_revisions(id, order_id, user_id, version, request)
   values ((p_data->>'revisionId')::uuid, p_id, o.user_id,
    greatest(o.result_version, coalesce((select max(version) from public.edicion_revisions where order_id = p_id), 1)) + 1, req);
  update public.edicion_orders set revisions_used = revisions_used + 1, revision_status = 'queued', updated_at = now()
   where id = p_id returning * into o;
  return public.edicion_public(o);
 elsif p_action = 'versions' then
  return coalesce((select jsonb_agg(jsonb_build_object('version', v.version, 'path', v.path, 'request', v.request) order by v.version)
   from (select 1 as version, coalesce(o.user_id::text, 'invitados') || '/edicion/' || o.id || '.mp4' as path, null::text as request
          where o.status = 'delivered'
         union all
         select version, result_path, request from public.edicion_revisions where order_id = p_id and status = 'delivered') v), '[]'::jsonb);
 end if;
 raise exception 'EDICION_INVALID';
end $$;
revoke all on function public.edicion_guest(text, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.edicion_guest(text, uuid, text, jsonb) to service_role;

-- Rutas del resultado: los pedidos sin cuenta usan el prefijo "invitados".
create or replace function public.edicion_work(p_worker text, p_action text, p_id uuid default null, p_lease uuid default null, p_result jsonb default null)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare o public.edicion_orders; terminal text;
begin
 if p_action = 'claim' then
  insert into public.edicion_workers(id) values (p_worker) on conflict (id) do update set last_seen_at = now();
  update public.edicion_orders set
   status = case when attempts >= 3 then 'failed' else 'paid' end,
   result_note = case when attempts >= 3 then 'La edición se interrumpió varias veces. Lo revisaremos manualmente.' else result_note end,
   worker_id = null, lease_token = null, lease_expires_at = null, updated_at = now()
   where status = 'processing' and lease_expires_at < now();
  select * into o from public.edicion_orders where status = 'paid' order by coalesce(material_at, paid_at) for update skip locked limit 1;
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
   or (terminal = 'delivered' and coalesce(p_result->>'resultPath', '') <> coalesce(o.user_id::text, 'invitados') || '/edicion/' || o.id::text || '.mp4') then
   raise exception 'EDICION_INVALID';
  end if;
  update public.edicion_orders set status = terminal, result_note = nullif(p_result->>'note', ''),
   result_path = case when terminal = 'delivered' then p_result->>'resultPath' end, updated_at = now()
   where id = p_id returning * into o;
  return public.edicion_public(o);
 end if;
 raise exception 'EDICION_INVALID';
end $$;

create or replace function public.edicion_revision_work(p_worker text, p_action text, p_id uuid default null, p_lease uuid default null, p_result jsonb default null)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare r public.edicion_revisions; o public.edicion_orders; terminal text;
begin
 if p_action = 'claim' then
  insert into public.edicion_workers(id) values (p_worker) on conflict (id) do update set last_seen_at = now();
  with expired as (
   update public.edicion_revisions set status = case when attempts >= 2 then 'failed' else 'queued' end,
    note = case when attempts >= 2 then 'No pudimos aplicar este cambio. No se descontó la ronda.' else note end,
    worker_id = null, lease_token = null, lease_expires_at = null, updated_at = now()
   where status = 'processing' and lease_expires_at < now() returning order_id, status)
  update public.edicion_orders eo set revision_status = e.status,
   revisions_used = case when e.status = 'failed' then greatest(eo.revisions_used - 1, 0) else eo.revisions_used end, updated_at = now()
   from expired e where eo.id = e.order_id;
  select * into r from public.edicion_revisions where status = 'queued' order by created_at for update skip locked limit 1;
  if not found then return null; end if;
  update public.edicion_revisions set status = 'processing', attempts = attempts + 1, worker_id = p_worker,
   lease_token = gen_random_uuid(), lease_expires_at = now() + interval '15 minutes', updated_at = now()
   where id = r.id returning * into r;
  update public.edicion_orders set revision_status = 'processing', updated_at = now() where id = r.order_id returning * into o;
  return to_jsonb(r) || jsonb_build_object('plan', o.plan, 'previousVersion', o.result_version);
 end if;
 select * into r from public.edicion_revisions where id = p_id and worker_id = p_worker and lease_token = p_lease for update;
 if not found then raise exception 'LEASE_LOST'; end if;
 if p_action = 'finish' and r.status in ('delivered', 'failed') then return jsonb_build_object('status', r.status); end if;
 if r.status <> 'processing' or r.lease_expires_at <= now() then raise exception 'LEASE_LOST'; end if;
 if p_action = 'heartbeat' then
  update public.edicion_workers set last_seen_at = now() where id = p_worker;
  update public.edicion_revisions set lease_expires_at = now() + interval '15 minutes', updated_at = now() where id = p_id;
  return jsonb_build_object('ok', true);
 elsif p_action = 'finish' then
  terminal := p_result->>'status';
  if terminal is null or terminal not in ('delivered', 'failed') or length(coalesce(p_result->>'note', '')) > 1000
   or (terminal = 'delivered' and coalesce(p_result->>'resultPath', '') <> coalesce(r.user_id::text, 'invitados') || '/edicion/' || r.order_id::text || '_v' || r.version || '.mp4') then
   raise exception 'EDICION_INVALID';
  end if;
  update public.edicion_revisions set status = terminal, note = nullif(p_result->>'note', ''),
   result_path = case when terminal = 'delivered' then p_result->>'resultPath' end, updated_at = now() where id = p_id;
  if terminal = 'delivered' then
   update public.edicion_orders set result_path = p_result->>'resultPath', result_version = r.version,
    revision_status = 'delivered', updated_at = now() where id = r.order_id;
  else
   update public.edicion_orders set revision_status = 'failed', revisions_used = greatest(revisions_used - 1, 0), updated_at = now() where id = r.order_id;
  end if;
  return jsonb_build_object('status', terminal);
 end if;
 raise exception 'EDICION_INVALID';
end $$;

-- Partes del material del cliente (máx. 8 MB cada una). Solo el servidor firma subidas y descargas.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('edicion-material', 'edicion-material', false, 8388608, array['application/octet-stream']) on conflict (id) do nothing;
