-- ROLLBACK for 20261017000200_prod_lockdown_rls.sql
-- Restores the production state observed 2026-10-17 (read-only check):
--   * "Allow all for service role" on the 22 tables attached to PUBLIC
--   * GRANT ALL on all public tables/sequences/functions to anon, authenticated
--   * EXECUTE on publish_bot_flow_graph for anon, authenticated, service_role
--     (PUBLIC stays revoked, matching 20260818000001)
--   * update_updated_at_column search_path reset to the prior unset state
--
-- Does NOT rewrite Supplier / SupplierProduct / SupplierOrder policies
-- (those were already TO service_role before the lockdown).
-- GRANT ALL ON ALL TABLES does restore anon/authenticated table grants on
-- Supplier* as well, which was the prior grant state (RLS still blocked them).
--
-- READ/WRITE. Apply only if the lockdown must be undone. Not applied by CI.

BEGIN;

SET search_path TO public, extensions;

GRANT EXECUTE ON FUNCTION public.publish_bot_flow_graph(uuid, jsonb, text, text[], jsonb, jsonb, jsonb)
  TO anon, authenticated, service_role;

GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON SEQUENCES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON FUNCTIONS TO anon, authenticated;

-- ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin requires membership.
-- Check existence first so pg_has_role never resolves a missing role.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin') THEN
    IF pg_has_role(current_user, 'supabase_admin', 'MEMBER') THEN
      EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated';
      EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated';
      EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated';
    END IF;
  END IF;
END $$;

DROP POLICY IF EXISTS "Allow all for service role" ON "User";
CREATE POLICY "Allow all for service role" ON "User"
    FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all for service role" ON "Trx";
CREATE POLICY "Allow all for service role" ON "Trx"
    FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all for service role" ON "Admin";
CREATE POLICY "Allow all for service role" ON "Admin"
    FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all for service role" ON "Deposit";
CREATE POLICY "Allow all for service role" ON "Deposit"
    FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all for service role" ON "Voucher";
CREATE POLICY "Allow all for service role" ON "Voucher"
    FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all for service role" ON "BotFlow";
CREATE POLICY "Allow all for service role" ON "BotFlow"
    FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all for service role" ON "BotFlowNode";
CREATE POLICY "Allow all for service role" ON "BotFlowNode"
    FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all for service role" ON "BotCopy";
CREATE POLICY "Allow all for service role" ON "BotCopy"
    FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all for service role" ON "NotificationSettings";
CREATE POLICY "Allow all for service role" ON "NotificationSettings"
    FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all for service role" ON "AuditLog";
CREATE POLICY "Allow all for service role" ON "AuditLog"
    FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all for service role" ON "BotSession";
CREATE POLICY "Allow all for service role" ON "BotSession"
    FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all for service role" ON "HargaTier";
CREATE POLICY "Allow all for service role" ON "HargaTier"
    FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all for service role" ON "LoginHistory";
CREATE POLICY "Allow all for service role" ON "LoginHistory"
    FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all for service role" ON "MessageHistory";
CREATE POLICY "Allow all for service role" ON "MessageHistory"
    FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all for service role" ON "MessageTemplate";
CREATE POLICY "Allow all for service role" ON "MessageTemplate"
    FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all for service role" ON "NotificationLog";
CREATE POLICY "Allow all for service role" ON "NotificationLog"
    FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all for service role" ON "Payment";
CREATE POLICY "Allow all for service role" ON "Payment"
    FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all for service role" ON "Premium";
CREATE POLICY "Allow all for service role" ON "Premium"
    FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all for service role" ON "ProductStockThreshold";
CREATE POLICY "Allow all for service role" ON "ProductStockThreshold"
    FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all for service role" ON "Produk";
CREATE POLICY "Allow all for service role" ON "Produk"
    FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all for service role" ON "Stok";
CREATE POLICY "Allow all for service role" ON "Stok"
    FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all for service role" ON "Varian";
CREATE POLICY "Allow all for service role" ON "Varian"
    FOR ALL USING (true) WITH CHECK (true);

ALTER FUNCTION public.update_updated_at_column() RESET search_path;

COMMIT;
