-- Local development seed for the Supabase CLI stack.
--
-- Hosted Supabase auto-grants SELECT/INSERT/UPDATE/DELETE on new public tables
-- to the anon/authenticated/service_role roles via default privileges. The local
-- postgres image used by `supabase start` does not, so tables created by the
-- migrations end up with only Dxtm privileges and the app hits
-- "permission denied for table ...". These GRANTs make the local database behave
-- like a hosted Supabase project. This file only affects the local dev stack.
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
