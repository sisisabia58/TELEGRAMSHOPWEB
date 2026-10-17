-- ROLLBACK for 20261017000200_prod_lockdown_rls.sql
-- Restores the production state observed 2026-10-17 (read-only check),
-- except Supplier* table grants stay locked (see below):
--   * "Allow all for service role" on the 22 tables attached to PUBLIC
--   * GRANT ALL on public tables/sequences/functions to anon, authenticated
--     except Supplier / SupplierProduct / SupplierOrder
--   * EXECUTE on publish_bot_flow_graph for anon, authenticated, service_role
--     (PUBLIC stays revoked, matching 20260818000001)
--   * PUBLIC EXECUTE on update_updated_at_column restored (the forward
--     migration revoked PUBLIC from every existing public function)
--   * update_updated_at_column search_path reset to the prior unset state
--   * global PUBLIC EXECUTE default for future functions restored
--
-- Does NOT rewrite Supplier / SupplierProduct / SupplierOrder policies
-- (those were already TO service_role before the lockdown).
-- GRANT ALL ON ALL TABLES would also restore TRUNCATE on Supplier*. RLS
-- does not apply to TRUNCATE, so those grants are revoked again immediately
-- (same as 20261016000000). Column REVOKE on Supplier.api_key is restored too.
--
-- READ/WRITE. Apply only if the lockdown must be undone. Not applied by CI.

BEGIN;

SET search_path TO public, extensions;

GRANT EXECUTE ON FUNCTION public.publish_bot_flow_graph(uuid, jsonb, text, text[], jsonb, jsonb, jsonb)
  TO anon, authenticated, service_role;

GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
-- Keep the earlier Supplier* lockdown (20261016000000). GRANT ALL includes
-- TRUNCATE, and RLS policies do not apply to TRUNCATE.
REVOKE ALL ON TABLE "Supplier", "SupplierProduct", "SupplierOrder"
  FROM PUBLIC, anon, authenticated;
REVOKE SELECT (api_key) ON TABLE "Supplier"
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE "Supplier", "SupplierProduct", "SupplierOrder" TO service_role;

GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;
-- Named-role GRANT does not restore PUBLIC. The forward migration revoked
-- PUBLIC EXECUTE from every existing public function; restore it on the
-- trigger function only. publish_bot_flow_graph stays without PUBLIC
-- (20260818000001).
GRANT EXECUTE ON FUNCTION public.update_updated_at_column() TO PUBLIC;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON SEQUENCES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON FUNCTIONS TO anon, authenticated;
-- Undo the lockdown's global PUBLIC EXECUTE revoke (per-schema GRANT cannot
-- restore a global default).
ALTER DEFAULT PRIVILEGES FOR ROLE postgres
  GRANT EXECUTE ON FUNCTIONS TO PUBLIC;

-- ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin requires membership.
-- Check existence first so pg_has_role never resolves a missing role.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin') THEN
    IF pg_has_role(current_user, 'supabase_admin', 'MEMBER') THEN
      EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated';
      EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated';
      EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated';
      EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin GRANT EXECUTE ON FUNCTIONS TO PUBLIC';
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
