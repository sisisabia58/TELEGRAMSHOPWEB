# Tiered Pricing (Phase 3) — Design

**Status:** Approved 2026-08-09  
**Source:** Admin UX Overhaul roadmap (Phase 3) + design review

## Goal

Let admins configure optional quantity → unit-price breakpoints per variant. Checkout charges `resolved_unit_price × qty`, then applies voucher `potongan` on top. `Trx.harga_satuan` records the resolved unit price.

## Decisions

| Topic | Choice |
|-------|--------|
| Discount model | Qty breakpoints → **unit price** (not % off, not pack total) |
| `Varian.harga` | Base / **fallback** when no tier matches; tiers optional |
| Range shape | `min_qty` only (open-ended); highest `min_qty ≤ qty` wins |
| Vouchers | **Keep; stack** after tier subtotal (`max(0, subtotal - potongan)`) |
| Storage | New table `HargaTier` (Approach A) |
| Config UI | Dashboard product detail, per variant |
| Framework | EJS + vanilla JS; pure `node --test` only |

## Data model

```sql
CREATE TABLE "HargaTier" (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  varian_id UUID NOT NULL REFERENCES "Varian"(id) ON DELETE CASCADE,
  min_qty INTEGER NOT NULL CHECK (min_qty >= 2),
  harga INTEGER NOT NULL CHECK (harga >= 0),
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE (varian_id, min_qty)
);
```

- Qty 1 always uses `Varian.harga` (no tier with `min_qty = 1`).
- Deleting a variant cascades tiers.

## Resolution

```js
resolveUnitPrice(baseHarga, qty, tiers)
// → { harga_satuan, subtotal, matched_min_qty: number|null }
```

1. If `qty < 1`, caller aborts (do not resolve).
2. Among tiers with `min_qty <= qty`, pick the one with the largest `min_qty`.
3. If none → `harga_satuan = baseHarga`, `matched_min_qty = null`.
4. `subtotal = harga_satuan * qty`.
5. Voucher (unchanged rules): `charge = Math.max(0, subtotal - potongan)`.

## Checkout / Trx

- All bot price displays and charges (saldo + QRIS) use the resolver.
- `Trx.harga_satuan` = resolved unit price.
- `Trx.harga` = goods total after voucher (same meaning as today; Pakasir fee stays on `Payment`).

## Dashboard

On `/produk/:id`, under each variant:

- List tiers: min_qty | unit harga | delete
- Add tier form
- API: CRUD under `/api/produk/:id/varian/:varianId/tiers`
- Validate: `min_qty >= 2`, unique per variant, `harga >= 0`

## Out of scope

- Retiring vouchers
- Percentage or pack-total pricing
- Bulk upload pricing (Phase 4)
- Flow engine / copy registry / bot command retirement

## Success criteria

- Pure tests cover fallback, match, and subtotal.
- Solo product with no tiers behaves identically to Phase 2.
- Qty crossing a breakpoint changes displayed unit price and charged total before voucher.
- Voucher still subtracts `potongan` after tier subtotal.
- Seeded Netflix/Spotify fixtures can gain example tiers via dashboard without schema pain.
