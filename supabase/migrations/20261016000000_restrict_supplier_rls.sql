-- Phase 13 follow-up — lock Supplier* tables away from the Data API.
--
-- The original policies were named "Allow all for service role" but were
-- created FOR ALL USING (true) without a role target, so they applied to
-- PUBLIC. Anyone holding the anon/publishable key could SELECT Supplier
-- and read api_key in plaintext.
--
-- This app's Express admin and Telegram bot talk to Postgres through the
-- Node process. That process must use the service_role key (which bypasses
-- RLS). There is no end-user JWT; "admin" here is the dashboard session,
-- not a Postgres role. Restricting these policies to service_role therefore
-- keeps the app working when SUPABASE_KEY is the service role, and denies
-- anon/authenticated even if table GRANTs exist.
--
-- Defense in depth: REVOKE table access from anon/authenticated/PUBLIC, and
-- additionally REVOKE SELECT(api_key). A later table-level GRANT SELECT would
-- restore column access; the service_role-only RLS policy is the real second
-- layer if table privileges are ever re-granted.
--
-- Do not apply this file to a database whose SUPABASE_KEY is a publishable
-- / anon key — supplier pages and sync would start returning empty. Switch
-- that process to the service_role key first.

SET search_path TO public, extensions;

-- ---------------------------------------------------------------------------
-- Row Level Security: service_role only
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Allow all for service role" ON "Supplier";
CREATE POLICY "Allow all for service role" ON "Supplier"
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all for service role" ON "SupplierProduct";
CREATE POLICY "Allow all for service role" ON "SupplierProduct"
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all for service role" ON "SupplierOrder";
CREATE POLICY "Allow all for service role" ON "SupplierOrder"
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- Table privileges: anon/authenticated cannot even attempt a query
-- ---------------------------------------------------------------------------
REVOKE ALL ON TABLE "Supplier" FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE "SupplierProduct" FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE "SupplierOrder" FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE "Supplier" TO service_role;
GRANT ALL ON TABLE "SupplierProduct" TO service_role;
GRANT ALL ON TABLE "SupplierOrder" TO service_role;

-- NOTE: a column-level REVOKE does NOT override a table-level GRANT SELECT.
-- If a client role is ever granted SELECT ON TABLE "Supplier" again, the
-- service_role-only RLS policy above is what still hides every row
-- (including api_key). Keep that policy in place.
REVOKE SELECT (api_key) ON TABLE "Supplier" FROM PUBLIC, anon, authenticated;
