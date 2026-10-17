-- Widen Admin.role CHECK to include 'qa'. Nothing else.
--
-- The original inline CHECK on "Admin".role is named Admin_role_check
-- (Postgres default: {table}_{column}_check). The DO block looks the
-- live name up in pg_constraint so a renamed constraint is still dropped.
--
-- Rollback (do NOT restore the old CHECK while any Admin.role = 'qa'
-- rows exist — Postgres will reject the narrower constraint):
--   1. Deactivate or delete those rows first, e.g.
--        UPDATE "Admin" SET is_active = false WHERE role = 'qa';
--        DELETE FROM "Admin" WHERE role = 'qa';
--   2. ALTER TABLE "Admin" DROP CONSTRAINT IF EXISTS "Admin_role_check";
--   3. ALTER TABLE "Admin" ADD CONSTRAINT "Admin_role_check"
--        CHECK (role IN ('admin', 'staff', 'viewer'));

DO $$
DECLARE
  cname text;
BEGIN
  SELECT c.conname
    INTO cname
  FROM pg_constraint c
  JOIN pg_class rel ON rel.oid = c.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE nsp.nspname = 'public'
    AND rel.relname = 'Admin'
    AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) ~* 'role'
  LIMIT 1;

  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE "Admin" DROP CONSTRAINT IF EXISTS %I', cname);
  END IF;
END $$;

ALTER TABLE "Admin" DROP CONSTRAINT IF EXISTS "Admin_role_check";
ALTER TABLE "Admin" ADD CONSTRAINT "Admin_role_check"
  CHECK (role IN ('admin', 'staff', 'viewer', 'qa'));
