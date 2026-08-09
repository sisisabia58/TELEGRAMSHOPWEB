# Bulk Upload Rework (Phase 4) — Design Spec

**Date:** 2026-08-09  
**Source:** Admin UX Overhaul roadmap (Phase 4) + post–Phase 2/3 breakage on `/bulk`  
**Status:** Draft for plan — decisions locked from schema constraints (no open Q&A remaining)

## Problem

Dashboard **Bulk Operations** and bot **stock file upload** still assume the pre–Phase 2 flat `Produk` model (`Produk.kode`, `Produk.harga`, `Produk.data`). After Product → Variant → Stock and tiered pricing:

| Surface | Current state |
|---------|----------------|
| `POST /bulk/produk/import` | Inserts removed columns → fails |
| CSV template | `nama,kode,harga,...` — product-level kode/harga gone |
| `POST /bulk/produk/update-harga` | Updates `Produk.harga` — column gone |
| Bulk stock UI | Sends `produk_id`; API already requires `varian_id` |
| Product list JS | Expects `produk.kode` / `produk.harga` |
| Export produk | Flat product shape |
| Bot `/addstok` + `.txt` upload | Looks up `Produk.kode`, passes product id into `addStokItems` |
| HargaTier | Dashboard CRUD only — no bulk CSV |

Deposit bulk approve/reject still works and stays in scope only as “leave alone.”

## Goal

Make bulk catalog import, variant price mass-update, stock mass-add, optional tier CSV, export, and bot stock-add paths align with **Produk → Varian → Stok** (+ optional **HargaTier**), with pure helpers under `lib/bulk.js` covered by `node --test`.

## Non-goals

- Phase 5+ copy registry / flow engine / command retirement / dashboard IA
- Changing voucher schema or checkout pricing math (Phase 3 stays source of truth)
- New frontend framework; keep EJS + vanilla JS
- Destructive schema changes — no new tables required
- Percentage/fixed mass-update of `HargaTier` rows (tiers are set via CSV upsert or per-variant UI)
- Auto-creating products from stock-only uploads

## Decisions

### D1 — Catalog CSV = product + variant rows (grouped)

One row = one **variant**. Rows that share the same product key land under one `Produk`.

**Product key:** `produk_slug` if present, else `catalog.slugify(produk_nama)`.

**Required columns:**

| Column | Level | Notes |
|--------|-------|--------|
| `produk_nama` | Produk | Required |
| `produk_slug` | Produk | Optional; slugify(nama) if empty |
| `kategori` | Produk | Default `umum` |
| `deskripsi` | Produk | Required on first row of a new product |
| `snk` | Produk | Required on first row of a new product |
| `varian_label` | Varian | Required |
| `varian_kode` | Varian | Required; unique globally; lowercased |
| `harga` | Varian | Required; integer ≥ 0 (base/fallback; not a tier) |
| `format` | Varian | Optional |

**Behavior:**

- New slug → insert `Produk`, then insert `Varian`
- Existing slug → insert additional `Varian` only (skip product fields conflict; first-seen deskripsi/snk win for create; updates to product fields on re-import are **skipped**, not overwritten)
- Duplicate `varian_kode` (DB or within file) → row **skipped** with reason
- Invalid row → **failed** with row number; continue processing

### D2 — Mass price update targets variants

UI lists **variants** (label + kode + base harga), not products. Body: `{ varian_ids, update_type, value }` with `percentage` | `fixed`. Writes `Varian.harga` only. **Does not touch `HargaTier`.**

### D3 — Bulk stock is variant-scoped

- UI: product `<select>` then variant `<select>` (cascade from `/api/produk/list`), post `{ varian_id, data_stok }` (API already correct).
- Optional second input: stock CSV/TXT file with columns `varian_kode,data` (or one column of lines when a variant is pre-selected).
- Inserts use existing `Stok` shape: `{ varian_id, varian_kode, data, status: 'tersedia' }`, batch size 500.
- Dedup within request optional YAGNI — no unique constraint on `Stok.data`; do not invent one.

### D4 — Tier CSV upsert (in scope)

File columns: `varian_kode,min_qty,harga` with `min_qty >= 2`.

- Resolve kode → `Varian`
- Upsert on unique `(varian_id, min_qty)`: insert or update `harga`
- Invalid min_qty / missing kode → failed row

This is the “bulk upload pricing” deferred from Phase 3.

### D5 — Bot stock add fixed in this phase

`/addstok` quick mode, interactive flows, and `.txt` document handler resolve **`Varian` by kode** via `catalog.getVariantByKode`, then `addStokItems(varian.id, varian.kode, lines)`. Feed messages use product nama + variant label + `varian.harga`. Full bot command retirement remains Phase 7.

### D6 — Pure `lib/bulk.js`

Testable without Supabase:

- `normalizeCatalogRow(row) → { ok, value } | { ok:false, error }`
- `groupCatalogRows(rows) → { products: [{ slug, produk fields, variants: [...] }], failures: [...] }`
- `parseStockLines(text) → string[]`
- `normalizeTierRow(row) → …`
- `computeNewHarga(oldHarga, update_type, value) → number | error`

Dashboard routes call these, then perform DB writes.

### D7 — Templates & export

- Replace product template download with catalog template (product+variant columns).
- Add tier template download.
- Export `produk` sheet → one row per variant (same columns as import, filled). Stock/deposit export stay as today where already variant-aware.

### D8 — Deposit bulk unchanged

Approve/reject keep current routes and UI.

## Architecture

```
CSV/XLSX/TXT ──► parse (existing multer helpers)
                 │
                 ▼
            lib/bulk.js  (normalize / group / compute)
                 │
                 ▼
     dashboard routes ──► Supabase Produk / Varian / Stok / HargaTier
                 │
                 ▼
           bulk-operations.ejs (cascade selects + results)

Bot .txt / /addstok ──► catalog.getVariantByKode ──► addStokItems
```

No migration. Railway deploy = merge to `main` only.

## File map (planned)

| File | Role |
|------|------|
| `lib/bulk.js` | Pure parse/normalize/group/price helpers |
| `test/bulk.test.js` | `node --test` coverage |
| `dashboard.js` | Rework import, template, update-harga, stock UI binding, tier import, export |
| `views/bulk-operations.ejs` | Variant-aware forms + tier section |
| `index.js` | Fix `/addstok` + file upload to Varian |
| `docs/runbooks/phase4-bulk-upload.md` | Templates + verify checklist |
| Roadmap | Phase 3 Done; Phase 4 plan linked |

## Success criteria

1. Catalog CSV import creates Produk + Varian; second row same slug adds another variant  
2. Mass price update changes `Varian.harga` for selected ids  
3. Bulk stock UI posts `varian_id` and inserts `Stok` rows  
4. Tier CSV upserts `HargaTier`; bot qty still resolves via Phase 3 pricing  
5. `/addstok kode|line` works against a real `Varian.kode`  
6. `node --test` all green including new `test/bulk.test.js`  
7. Deposit bulk still works unchanged  

## Out of scope reminders

- Flow engine, copy registry, retiring owner product CRUD commands (Phase 5–7)  
- Editing product deskripsi/snk via re-import  
- Mass % adjustment of tier prices  
