# Phase 2 cutover runbook

1. Confirm no real customers (test data only).
2. Scale/stop bot traffic if needed (Railway service can stay up; purchases will fail until code deploys).
3. Apply migration:
   `supabase db push` (linked to sajffqniegtvhyopshvx)
   OR paste SQL into Supabase SQL Editor.
4. Confirm tables: Produk, Varian, Stok, Trx, ProductStockThreshold exist; old columns kode/grup gone from Produk.
5. Confirm `SELECT count(*) FROM "Payment" WHERE status IN ('pending','paid');` → 0.
6. Deploy app code that expects the new schema (same PR / immediate follow-up commit).
7. Seed three fixtures via dashboard or SQL:
   - Product A: 1 variant (solo path)
   - Product B: 3 variants, one with 0 stock
   - Product C: 3 variants, all 0 stock
8. Run Phase 2 E2E checklist (see implementation plan Task 9).
