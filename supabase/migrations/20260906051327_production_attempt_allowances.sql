begin;
-- Expiring, operator-only allowance for a bounded test; normal accounts stay at 5/day.
create table public.production_attempt_allowances(
 user_id uuid primary key references auth.users(id),
 daily_limit integer not null check(daily_limit between 1 and 10),
 expires_at timestamptz not null
);
alter table public.production_attempt_allowances enable row level security;
revoke all on public.production_attempt_allowances from public,anon,authenticated;
grant all on public.production_attempt_allowances to service_role;
do $$
declare definition text; needle text:='>=5 then raise exception ''PRODUCTION_LIMIT''';
begin
 definition:=pg_get_functiondef('public.studio_production_start_before_credits(uuid,uuid,uuid,integer,boolean)'::regprocedure);
 if position(needle in definition)=0 then raise exception 'Unexpected production start definition'; end if;
 definition:=replace(definition,needle,'>=coalesce((select a.daily_limit from public.production_attempt_allowances a where a.user_id=p_user and a.expires_at>now()),5) then raise exception ''PRODUCTION_LIMIT''');
 execute definition;
end $$;
commit;
