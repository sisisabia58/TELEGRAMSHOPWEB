-- Prod lockdown — revoke Data API access from anon/authenticated.
--
-- Read-only prod check 2026-10-17 (teleshop-improvement-v2):
--   * 22 tables still have policy "Allow all for service role" attached to PUBLIC.
--   * Supplier / SupplierProduct / SupplierOrder are already TO service_role.
--   * anon/authenticated have GRANT ALL (including TRUNCATE) on every public table
--     and EXECUTE on publish_bot_flow_graph.
--   * 24h of edge logs: every app request used JWT role=service_role. No anon
--     or authenticated traffic. Restricting these grants/policies should not
--     break the bot or dashboard.
--
-- PR #43 (20261017000000_lock_publish_bot_flow_graph.sql) has the same
-- REVOKE/GRANT EXECUTE on publish_bot_flow_graph. Both files are idempotent
-- so they can be applied in either order.
--
-- Do not apply from this PR automatically. Migration file only.

BEGIN;

SET search_path TO public, extensions;

-- ---------------------------------------------------------------------------
-- 1. publish_bot_flow_graph: service_role only (same statements as PR #43)
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.publish_bot_flow_graph(uuid, jsonb, text, text[], jsonb, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_bot_flow_graph(uuid, jsonb, text, text[], jsonb, jsonb, jsonb)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 2. Table / sequence / function privileges
-- ---------------------------------------------------------------------------
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;

GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- Future objects: stop auto-granting to client roles.
-- Hosted Supabase creates objects as postgres and (often) supabase_admin.
-- The local CLI image has postgres but not supabase_admin; skip that role there.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON FUNCTIONS FROM anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin') THEN
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated';
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated';
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. RLS policies: 22 tables that were attached to PUBLIC.
--    Supplier* already TO service_role — left unchanged.
--    RLS stays enabled (already ON; this does not disable it).
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Allow all for service role" ON "User";
CREATE POLICY "Allow all for service role" ON "User"
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all for service role" ON "Trx";
CREATE POLICY "Allow all for service role" ON "Trx"
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all for service role" ON "Admin";
CREATE POLICY "Allow all for service role" ON "Admin"
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all for service role" ON "Deposit";
CREATE POLICY "Allow all for service role" ON "Deposit"
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all for service role" ON "Voucher";
CREATE POLICY "Allow all for service role" ON "Voucher"
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all for service role" ON "BotFlow";
CREATE POLICY "Allow all for service role" ON "BotFlow"
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all for service role" ON "BotFlowNode";
CREATE POLICY "Allow all for service role" ON "BotFlowNode"
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all for service role" ON "BotCopy";
CREATE POLICY "Allow all for service role" ON "BotCopy"
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all for service role" ON "NotificationSettings";
CREATE POLICY "Allow all for service role" ON "NotificationSettings"
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all for service role" ON "AuditLog";
CREATE POLICY "Allow all for service role" ON "AuditLog"
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all for service role" ON "BotSession";
CREATE POLICY "Allow all for service role" ON "BotSession"
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all for service role" ON "HargaTier";
CREATE POLICY "Allow all for service role" ON "HargaTier"
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all for service role" ON "LoginHistory";
CREATE POLICY "Allow all for service role" ON "LoginHistory"
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all for service role" ON "MessageHistory";
CREATE POLICY "Allow all for service role" ON "MessageHistory"
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all for service role" ON "MessageTemplate";
CREATE POLICY "Allow all for service role" ON "MessageTemplate"
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all for service role" ON "NotificationLog";
CREATE POLICY "Allow all for service role" ON "NotificationLog"
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all for service role" ON "Payment";
CREATE POLICY "Allow all for service role" ON "Payment"
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all for service role" ON "Premium";
CREATE POLICY "Allow all for service role" ON "Premium"
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all for service role" ON "ProductStockThreshold";
CREATE POLICY "Allow all for service role" ON "ProductStockThreshold"
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all for service role" ON "Produk";
CREATE POLICY "Allow all for service role" ON "Produk"
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all for service role" ON "Stok";
CREATE POLICY "Allow all for service role" ON "Stok"
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all for service role" ON "Varian";
CREATE POLICY "Allow all for service role" ON "Varian"
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- 4. Trigger function search_path (advisor function_search_path_mutable)
-- ---------------------------------------------------------------------------
ALTER FUNCTION public.update_updated_at_column() SET search_path = public;

COMMIT;
