-- READ-ONLY verification for 20261017000200_prod_lockdown_rls.sql
-- Safe to run on production. Does not write.
--
-- Key check (resolved 2026-10-17): 24h of edge logs showed every app request
-- used JWT role=service_role (supabase-js-node/2.89.0). No anon/authenticated
-- traffic. The warn-only startup self-check in lib/supabase.js still logs if a
-- replica is later started with a non-service_role key.
--
-- Expected AFTER applying the lockdown (and NOT before):
--   1. pg_policies.roles is {service_role} for every "Allow all for service role"
--      policy, including Supplier* (already that way) and the 22 former-PUBLIC tables.
--   2. has_table_privilege(anon|authenticated, table, SELECT/INSERT/UPDATE/DELETE)
--      is false for every public table. TRUNCATE should also be false.
--   3. has_function_privilege(anon|authenticated, publish_bot_flow_graph, EXECUTE)
--      is false. service_role remains true.
--   4. pg_proc.proconfig for public.update_updated_at_column contains
--      search_path=public.

-- 1. Policies in public (tablename, policyname, roles, cmd, qual)
SELECT
  schemaname,
  tablename,
  policyname,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- 2. anon / authenticated table privileges on every public table
SELECT
  c.relname AS table_name,
  has_table_privilege('anon', c.oid, 'SELECT') AS anon_select,
  has_table_privilege('anon', c.oid, 'INSERT') AS anon_insert,
  has_table_privilege('anon', c.oid, 'UPDATE') AS anon_update,
  has_table_privilege('anon', c.oid, 'DELETE') AS anon_delete,
  has_table_privilege('anon', c.oid, 'TRUNCATE') AS anon_truncate,
  has_table_privilege('authenticated', c.oid, 'SELECT') AS authenticated_select,
  has_table_privilege('authenticated', c.oid, 'INSERT') AS authenticated_insert,
  has_table_privilege('authenticated', c.oid, 'UPDATE') AS authenticated_update,
  has_table_privilege('authenticated', c.oid, 'DELETE') AS authenticated_delete,
  has_table_privilege('authenticated', c.oid, 'TRUNCATE') AS authenticated_truncate,
  c.relrowsecurity AS rls_enabled
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
ORDER BY c.relname;

-- 3. Function EXECUTE for anon / authenticated / service_role
SELECT
  n.nspname AS schema_name,
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS identity_args,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
  has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
ORDER BY p.proname, identity_args;

-- 4. search_path pin on the updated_at trigger function
SELECT
  n.nspname AS schema_name,
  p.proname AS function_name,
  p.proconfig
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'update_updated_at_column';
