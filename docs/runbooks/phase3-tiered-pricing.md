# Phase 3 cutover runbook — Tiered pricing

1. Confirm Phase 2 schema is live (`Varian` exists; `Produk` has no `kode`).
2. Deploy app code that includes `lib/pricing.js` + tier APIs (merge PR to `main` → Railway).
3. Apply migration:
   `supabase db push` (linked to sajffqniegtvhyopshvx)
   OR paste SQL into Supabase SQL Editor (keep search_path line).
4. Confirm: `\d "HargaTier"` / Studio shows table; RLS on.
5. Optional seed (example for Netflix 7d):
   ```sql
   INSERT INTO "HargaTier" (varian_id, min_qty, harga)
   SELECT id, 5, 12000 FROM "Varian" WHERE kode = 'netflix-7d';
   INSERT INTO "HargaTier" (varian_id, min_qty, harga)
   SELECT id, 10, 10000 FROM "Varian" WHERE kode = 'netflix-7d';
   ```
6. Verify dashboard: open product → variant → tiers list; bot qty 5 shows new unit price.
