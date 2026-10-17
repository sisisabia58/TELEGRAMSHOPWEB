-- Local development seed for the Supabase CLI stack.
--
-- The local postgres image does not auto-grant table rights the way hosted
-- Supabase used to. The app talks to Postgres as service_role (lib/supabase.js),
-- so local grants match 20261017140126: service_role only. Do not grant tables
-- back to anon/authenticated — that would undo the lockdown after `supabase start`.
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;
-- PUBLIC EXECUTE is a built-in global default; IN SCHEMA cannot revoke it.
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;

-- Defense in depth for Supplier.api_key (already locked by 20261016000000).
REVOKE ALL ON TABLE "Supplier", "SupplierProduct", "SupplierOrder" FROM anon, authenticated, PUBLIC;
REVOKE SELECT (api_key) ON TABLE "Supplier" FROM anon, authenticated, PUBLIC;
GRANT ALL ON TABLE "Supplier", "SupplierProduct", "SupplierOrder" TO service_role;
