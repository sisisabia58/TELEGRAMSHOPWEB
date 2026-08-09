# Phase 4 cutover runbook — Bulk upload rework

1. Confirm Phase 2+3 live (`Varian`, `HargaTier` exist).
2. Merge Phase 4 PR → Railway deploys from `main` (no DB migration).
3. Download templates from `/bulk`:
   - Catalog: `/bulk/produk/template`
   - Tiers: `/bulk/tiers/template`
4. Smoke:
   - Import 1 product / 2 variants CSV → appear on `/produk/:id`
   - Bulk update harga on one variant → `Varian.harga` changes
   - Bulk stok: pick product → variant → paste 3 lines → Stok count +3
   - Tier CSV for existing `varian_kode` → dashboard tier panel shows rows
   - Bot: `/addstok <varian_kode>|line1` succeeds
5. Deposit bulk approve still loads pending deposits.
