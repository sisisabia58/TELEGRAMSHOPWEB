# Phase 13 — Multi-Supplier Reseller Sourcing (runbook)

**Status:** implemented on `phase13-multi-supplier-sourcing`
**Migration:** `supabase/migrations/20260818000000_supplier_sourcing.sql` (additive; no `DROP`, no data rewrite)

## What this adds

A **third way stock enters the shop**, alongside the two that already existed:

| # | Source | Entry point | Changed by this phase? |
|---|--------|-------------|------------------------|
| 1 | Manual add | `POST /produk/:produkId/varian/:varianId/stok/tambah` | **No** |
| 2 | Bulk upload | `POST /bulk/stok/tambah`, catalog CSV import | **No** |
| 3 | Supplier API | Catalog → Supplier | New |

Our own stock competes as an ordinary offer priced at `Varian.harga` and **wins whenever it is
cheaper** — in that case not a single supplier call is made and the old purchase path runs unchanged.

## Where things live

| File | Role |
|------|------|
| `lib/fx.js` | `computeIdrPrice()` (pure) + daily USD→IDR fetch with last-known-good fallback |
| `lib/sourcing.js` | Builds and ranks offers; `pickBestOffer` is the "cheapest wins" rule |
| `lib/supplier-match.js` | Normalizes supplier names → matches to our variants (exact only) |
| `lib/supplier-sync.js` | Pulls supplier catalogs, upserts, maps, auto-creates |
| `lib/fulfillment.js` | Spends the money: cheapest-first with failover to the next source |
| `lib/suppliers/bitestore.js` | Bite Store API adapter |
| `lib/suppliers/index.js` | Adapter registry + the contract a new seller must implement |
| `lib/catalog.js` `attachStock()` | The single choke point where stock and effective price are resolved |

## Pricing formula

```
harga_jual = harga_supplier × kurs × (1 + buffer%) × (1 + margin%)   → rounded UP to `rounding`
```

**No IDR price is ever stored.** It is derived on read, so changing margin or rate takes effect
across the whole catalog immediately and can never leave a stale row selling at the old price.

## Adding a second seller

1. Create `lib/suppliers/<name>.js` exporting `listProducts`, `getBalance`, `createOrder`,
   `getOrder`, `testConnection` (see the contract comment in `lib/suppliers/index.js`).
2. Register it in `ADAPTERS` in `lib/suppliers/index.js`.
3. Add the supplier row via Catalog → Supplier → Tambah Supplier.

Nothing else changes — sourcing, fulfillment, and every screen work off the adapter's normalized shape.

## Operational notes

- **The reseller wallet is prepaid.** If it empties, every supplier-fulfilled purchase fails and
  refunds. A cron warns the owner channel every 6 hours below `supplier_wallet_min_usd`.
- **Sync** runs in the **bot process** only (cron ticks every minute, honours
  `supplier_sync_interval_menit`). The dashboard's "Sync sekarang" calls the same function directly;
  all writes are idempotent upserts so overlap is harmless.
- **Manual mappings are sticky.** Setting a mapping from the dashboard writes
  `mapping_mode = 'manual'` and sync never overwrites it.
- **Products that vanish** from a supplier catalog are marked `is_available = false`, never deleted,
  so mappings and order history survive.
- **Only instant-key products** are synced. File-based and manual/`pending` products are dropped
  during normalization and reported in the sync report's `skipped` count.

## Verify

```bash
npm test
```

Then:

1. Apply the migration (`supabase db push`, or paste the SQL in the Supabase SQL editor).
   Confirm `Varian.sumber` defaults to `'sendiri'` on all existing rows.
2. `npm run dashboard` → **Catalog → Supplier → Tambah Supplier**, enter the Bite Store key.
3. **Test koneksi** — must print the wallet balance, the **raw first product row**, and our
   normalized version of it. The published OpenAPI declares empty response schemas, so this is the
   check that our field mapping matches reality. Adjust `normalizeProductRow` if it doesn't.
4. **Sync sekarang** → open the supplier's catalog page. Spot-check two rows against the formula above.
5. Change the margin in **Supplier → Pengaturan** and reload — every IDR price moves at once.
6. Remap one item, re-sync, confirm `mapping_mode` stayed `manual`.
7. **Regression:** add stock manually and via bulk upload to a normal variant. Both must behave
   exactly as before, and that variant must still show its own price and its stock-picker screen.
8. Bot: an auto-created supplier product appears in its category with the computed rupiah price;
   the per-row stock picker is replaced by a plain quantity picker.
9. Mixed variant: displayed price is the cheaper of ours vs the supplier's; dropping our price below
   theirs flips the winner and the purchase consumes a `Stok` row with no supplier call.
10. Refund path: point a supplier `base_url` at an unreachable host, buy, and confirm saldo is
    returned in full, the buyer is told, and the owner channel is notified.

## Bugs fixed along the way (were blocking every purchase)

| Location | Bug |
|---|---|
| `index.js` saldo checkout | `vcr is not defined` — threw **after** balance was debited and stock marked sold, before delivery. Every saldo purchase lost the customer's money and stock with no delivery and no `Trx` row. |
| `index.js` QRIS checkout | Same expression; swallowed by the polling catch and misreported as a Pakasir network error after `Payment.status` was already `fulfilled` — silent paid-but-undelivered. |
| `index.js` QRIS channel log | `resolvedSaldo` referenced in the QRIS block (declared in the saldo block). |
| `index.js` transaction history | `resolvedSaldo` referenced in the buyer's history screen, where it was never in scope at all. Now uses `item.harga_satuan`. |

Both `discountAmount` sites now use a new `getVoucherPotongan()` helper next to the existing
`applyVoucherPotongan()`, so the receipt and the charge read the voucher the same way.

## Known pre-existing issues left alone (out of scope)

- `openStokBuyer` and two owner screens call `getStokCount(p.kode)` / `formatrupiah(p.harga)` on
  `Produk` rows, but `Produk` has no `kode` or `harga` column since the Phase 2 restructure — those
  counts are always 0 and the price renders as `NaN`.
- `minSaldo` / `addSaldo` are non-atomic read-modify-write, and `getStokForTransaction` takes no row
  lock. Both are lost-update races that predate this phase.
- `supabase/migrations/20260817000000_bot_flow_media.sql` references `bot_flow_node` unquoted, which
  will not resolve to the app's `"BotFlowNode"`.
