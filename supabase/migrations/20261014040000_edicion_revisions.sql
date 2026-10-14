-- Rondas de cambios sobre un video de /edicion ya entregado.
-- Cada cambio genera una nueva versión del MP4; el pedido apunta siempre a la última.
alter table public.edicion_orders
 add column revisions_used integer not null default 0,
 add column revision_status text check (revision_status in ('queued','processing','delivered','failed')),
 add column result_version integer not null default 1;

create table public.edicion_revisions (
 id uuid primary key,
 order_id uuid not null references public.edicion_orders(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 version integer not null check (version >= 2),
 request text not null check (length(request) between 3 and 1000),
 status text not null default 'queued' check (status in ('queued','processing','delivered','failed')),
 attempts integer not null default 0,
 worker_id text, lease_token uuid, lease_expires_at timestamptz,
 result_path text, note text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique (order_id, version)
);
create index edicion_revisions_queue on public.edicion_revisions(status, created_at);
alter table public.edicion_revisions enable row level security;
revoke all on public.edicion_revisions from public, anon, authenticated;
grant all on public.edicion_revisions to service_role;

-- Rondas incluidas por plan. Debe coincidir con assets/edicion-plans.js (lo verifica un test).
create function public.edicion_revision_max(p_plan text) returns integer language sql immutable as $$
 select case p_plan when 'basico' then 2 when 'pro' then 3 when 'premium' then 5 else 0 end
$$;
revoke all on function public.edicion_revision_max(text) from public, anon, authenticated;
grant execute on function public.edicion_revision_max(text) to service_role;

create or replace function public.edicion_public(o public.edicion_orders) returns jsonb language sql immutable as $$
 select jsonb_build_object('id', o.id, 'plan', o.plan, 'amountMxn', o.amount_mxn, 'status', o.status,
  'referenceUrl', o.reference_url, 'instructions', o.instructions, 'note', o.result_note,
  'createdAt', o.created_at, 'paidAt', o.paid_at, 'version', o.result_version,
  'revisionsUsed', o.revisions_used, 'revisionsMax', public.edicion_revision_max(o.plan), 'revisionStatus', o.revision_status)
$$;

create function public.edicion_revision_write(p_user uuid, p_id uuid, p_order uuid, p_request text)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare o public.edicion_orders; r public.edicion_revisions;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user::text, 417));
 select * into r from public.edicion_revisions where id = p_id;
 if found then
  -- Reintento del mismo pedido de cambio: idempotente para su dueño.
  if r.user_id <> p_user or r.order_id <> p_order then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  select * into o from public.edicion_orders where id = p_order;
  return public.edicion_public(o);
 end if;
 select * into o from public.edicion_orders where id = p_order and user_id = p_user for update;
 if not found then raise exception 'EDICION_NOT_FOUND'; end if;
 if o.status <> 'delivered' then raise exception 'EDICION_NOT_READY'; end if;
 if o.revision_status in ('queued','processing') then raise exception 'EDICION_REVISION_BUSY'; end if;
 if o.revisions_used >= public.edicion_revision_max(o.plan) then raise exception 'EDICION_REVISION_LIMIT'; end if;
 if length(btrim(coalesce(p_request, ''))) not between 3 and 1000 then raise exception 'EDICION_INVALID'; end if;
 -- La versión nueva sigue a la mayor usada (incluye cambios fallidos, que no reutilizan su número).
 insert into public.edicion_revisions(id, order_id, user_id, version, request)
  values (p_id, p_order, p_user,
   greatest(o.result_version, coalesce((select max(version) from public.edicion_revisions where order_id = p_order), 1)) + 1,
   btrim(p_request));
 update public.edicion_orders set revisions_used = revisions_used + 1, revision_status = 'queued', updated_at = now()
  where id = p_order returning * into o;
 return public.edicion_public(o);
end $$;
revoke all on function public.edicion_revision_write(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.edicion_revision_write(uuid, uuid, uuid, text) to service_role;

create function public.edicion_revision_work(p_worker text, p_action text, p_id uuid default null, p_lease uuid default null, p_result jsonb default null)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare r public.edicion_revisions; o public.edicion_orders; terminal text;
begin
 if p_action = 'claim' then
  insert into public.edicion_workers(id) values (p_worker) on conflict (id) do update set last_seen_at = now();
  -- Leases vencidos: un reintento; si vuelve a fallar, la ronda se devuelve al cliente.
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
   or (terminal = 'delivered' and coalesce(p_result->>'resultPath', '') <> r.user_id::text || '/edicion/' || r.order_id::text || '_v' || r.version || '.mp4') then
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
revoke all on function public.edicion_revision_work(text, text, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.edicion_revision_work(text, text, uuid, uuid, jsonb) to service_role;

-- Proyecto de cada versión (receta, script e imágenes generadas, sin los videos del cliente) en un bucket privado.
-- Permite aplicar cambios baratos en cualquier servidor, sin depender del disco del worker.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('edicion-proyectos', 'edicion-proyectos', false, 52428800, array['application/gzip']) on conflict (id) do nothing;
