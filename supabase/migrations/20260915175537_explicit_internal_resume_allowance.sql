-- Operator-only, expiring test allowances; ordinary accounts still default to five.
-- Repeated infrastructure failures must not force deletion of audit history to retry.
alter table public.production_attempt_allowances
 drop constraint production_attempt_allowances_daily_limit_check,
 add constraint production_attempt_allowances_daily_limit_check check(daily_limit between 1 and 20);
