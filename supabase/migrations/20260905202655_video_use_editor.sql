-- Video-use sessions are separate from ad generation credits and project timelines.
create table public.video_edit_sessions (
 id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade,
 sources jsonb not null, revision integer not null default 1, status text not null default 'planning',
 strategy text, history jsonb not null default '[]', result jsonb, created_at timestamptz not null default now()
);
create table public.video_edit_jobs (
 id uuid primary key, session_id uuid not null references public.video_edit_sessions(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade, kind text not null check(kind in ('plan','edit')),
 request jsonb not null, status text not null default 'queued' check(status in ('queued','running','succeeded','failed')),
 worker_id text, lease_token uuid, lease_expires_at timestamptz, result jsonb,
 created_at timestamptz not null default now()
);
create table public.video_edit_workers (id text primary key,last_seen_at timestamptz not null default now());
create index video_edit_sessions_owner on public.video_edit_sessions(user_id,created_at desc);
create index video_edit_jobs_queue on public.video_edit_jobs(status,created_at);
create index video_edit_jobs_session on public.video_edit_jobs(session_id);
alter table public.video_edit_sessions enable row level security;
alter table public.video_edit_jobs enable row level security;
alter table public.video_edit_workers enable row level security;
revoke all on public.video_edit_sessions,public.video_edit_jobs,public.video_edit_workers from public,anon,authenticated;
grant all on public.video_edit_sessions,public.video_edit_jobs,public.video_edit_workers to service_role;
-- Only authenticated server routes expose sanitized history and signed results.
create function public.video_edit_write(p_user uuid,p_action text,p_id uuid,p_data jsonb)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare s public.video_edit_sessions; j public.video_edit_jobs; asset jsonb; sid uuid; kind text; msg text;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,311));
 select * into j from public.video_edit_jobs where id=p_id;
 if found then
  if j.user_id<>p_user or j.request<>p_data then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  return jsonb_build_object('sessionId',j.session_id,'jobId',j.id);
 end if;
 if not exists(select 1 from public.video_edit_workers where last_seen_at>now()-interval '90 seconds') then raise exception 'VIDEO_EDIT_OFFLINE'; end if;
 if (select count(*) from public.video_edit_jobs where user_id=p_user and created_at>now()-interval '1 day')>=50 then raise exception 'VIDEO_EDIT_LIMIT'; end if;
 if exists(select 1 from public.video_edit_jobs where user_id=p_user and status in ('queued','running')) then raise exception 'VIDEO_EDIT_BUSY'; end if;
 sid:=(p_data->>'sessionId')::uuid; msg:=p_data->>'message';
 if sid is null or length(coalesce(msg,''))>3000 then raise exception 'VIDEO_EDIT_INVALID'; end if;
 if p_action='create' then
  if jsonb_typeof(p_data->'sources')<>'array' or jsonb_array_length(p_data->'sources') not between 1 and 8 or length(coalesce(msg,''))<3 then raise exception 'VIDEO_EDIT_INVALID'; end if;
  if not exists(select 1 from jsonb_array_elements(p_data->'sources') a where coalesce((a->>'reference')::boolean,false)=false) then raise exception 'VIDEO_EDIT_INVALID'; end if;
  for asset in select * from jsonb_array_elements(p_data->'sources') loop
   if not exists(select 1 from public.studio_assets a where a.id=(asset->>'id')::uuid and a.user_id=p_user and a.kind='clip' and a.bucket='studio-media') then raise exception 'STUDIO_ASSET_NOT_FOUND'; end if;
  end loop;
  insert into public.video_edit_sessions(id,user_id,sources) values(sid,p_user,p_data->'sources') returning * into s;
  kind:='plan';
 else
  select * into s from public.video_edit_sessions where id=sid and user_id=p_user for update;
  if not found then raise exception 'STUDIO_NOT_FOUND'; end if;
  if s.revision<>(p_data->>'expected')::integer then raise exception 'STUDIO_CONFLICT'; end if;
  if s.status in ('planning','editing') then raise exception 'VIDEO_EDIT_BUSY'; end if;
  if p_action='approve' then
   if s.status<>'awaiting_approval' or s.strategy is null then raise exception 'VIDEO_EDIT_APPROVAL'; end if;
   kind:='edit';msg:=s.strategy;
  elsif p_action='message' and length(coalesce(msg,''))>=3 then kind:='plan';
  else raise exception 'VIDEO_EDIT_INVALID'; end if;
  update public.video_edit_sessions set revision=revision+1,status=case when kind='edit' then 'editing' else 'planning' end where id=sid returning * into s;
 end if;
 insert into public.video_edit_jobs(id,session_id,user_id,kind,request) values(p_id,sid,p_user,kind,p_data);
 update public.video_edit_sessions set history=history||jsonb_build_array(jsonb_build_object('role','user','message',case when kind='edit' then 'Sí, editar con esta propuesta.' else msg end)) where id=sid;
 return jsonb_build_object('sessionId',sid,'jobId',p_id);
end $$;
revoke all on function public.video_edit_write(uuid,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.video_edit_write(uuid,text,uuid,jsonb) to service_role;
create function public.video_edit_work(p_worker text,p_action text,p_id uuid default null,p_lease uuid default null,p_result jsonb default null)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare j public.video_edit_jobs; s public.video_edit_sessions; terminal text;
begin
 if p_action='claim' then
  insert into public.video_edit_workers(id) values(p_worker) on conflict(id) do update set last_seen_at=now();
  with expired as (update public.video_edit_jobs set status='failed',result='{"status":"failed","message":"La edición se interrumpió. Tu material sigue guardado."}' where status='running' and lease_expires_at<now() returning session_id)
   update public.video_edit_sessions set status='failed' where id in(select session_id from expired);
  select * into j from public.video_edit_jobs where status='queued' order by created_at for update skip locked limit 1;
  if not found then return null;end if;
  update public.video_edit_jobs set status='running',worker_id=p_worker,lease_token=gen_random_uuid(),lease_expires_at=now()+interval '2 minutes' where id=j.id returning * into j;
  select * into s from public.video_edit_sessions where id=j.session_id;
  return to_jsonb(j)||jsonb_build_object('session',to_jsonb(s));
 end if;
 select * into j from public.video_edit_jobs where id=p_id and worker_id=p_worker and lease_token=p_lease for update;
 if not found then raise exception 'LEASE_LOST';end if;
 if p_action='finish' and j.status in ('succeeded','failed') then return to_jsonb(j);end if;
 if j.status<>'running' or j.lease_expires_at<=now() then raise exception 'LEASE_LOST';end if;
 if p_action='heartbeat' then
  update public.video_edit_workers set last_seen_at=now() where id=p_worker;
  update public.video_edit_jobs set lease_expires_at=now()+interval '2 minutes' where id=p_id;
  return jsonb_build_object('ok',true);
 elsif p_action='finish' then
  terminal:=p_result->>'status';
  if terminal is null or terminal not in ('awaiting_approval','question','succeeded','needs_review','failed') or length(coalesce(p_result->>'message',''))>3000 or pg_column_size(p_result)>250000 then raise exception 'VIDEO_EDIT_INVALID';end if;
  if (j.kind='plan' and terminal in ('succeeded','needs_review')) or (j.kind='edit' and terminal in ('awaiting_approval','question')) then raise exception 'VIDEO_EDIT_INVALID';end if;
  update public.video_edit_jobs set status=case when terminal='failed' then 'failed' else 'succeeded' end,result=p_result where id=p_id;
  update public.video_edit_sessions set status=terminal,strategy=case when terminal='awaiting_approval' then p_result->>'message' else strategy end,
   history=history||jsonb_build_array(jsonb_build_object('role','assistant','message',p_result->>'message')),
   result=case when terminal='succeeded' then p_result||jsonb_build_object('jobId',j.id) else result end where id=j.session_id;
  return jsonb_build_object('status',terminal);
 end if;
 raise exception 'VIDEO_EDIT_INVALID';
end $$;
revoke all on function public.video_edit_work(text,text,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.video_edit_work(text,text,uuid,uuid,jsonb) to service_role;
