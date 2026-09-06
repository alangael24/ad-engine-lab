-- Server RPCs verify the user and reconcile purchases by email. Hosted Supabase
-- does not grant service_role these Auth columns by default. No browser grants.
grant usage on schema auth to service_role;
grant select (id, email, created_at) on auth.users to service_role;
