# Task 3 Report: `page-header` partial + wire high-traffic pages

## Status

Complete.

## Commits

- `77482e6` — `feat(phase10): page-header partial and Semrush-like list chrome`

## Summary

- Created `views/partials/page-header.ejs` with breadcrumb nav + optional `pageHeaderActions`.
- Wired page-header on Overview, produk, stok, pricing, deposit, transaksi (breadcrumbs set in EJS tops).
- Converted summary stats to `.metric-strip` / `.metric-tile` on all list pages + Overview triage counts.
- Wrapped search/filters in `.toolbar` with `.toolbar-spacer` before CTAs (produk search, deposit filters, transaksi filters).
- Overview: metric-strip for KPI counts; actionable triage lists remain in `.card`; removed duplicate H1 (topbar keeps title).
- Replaced hardcoded hex grays in deposit/transaksi with design tokens.

## Verification

```bash
node --test
# 71/71 pass
```

## Concerns

- ~~Transaksi mobile filter-toggle removed with card→toolbar conversion; dense toolbar may wrap heavily on small screens.~~ **Fixed** — search stays visible on mobile; advanced filters collapse behind `#filterToggle`.
- Deposit toolbar packs six filter fields inline; may need responsive stacking tweak in a follow-up.

## Mobile filter collapse fix (review follow-up)

**Commit:** `4f1c231` — `fix(phase10): restore transaksi mobile filter collapse`

**Change:** Restored `#filterToggle`, `#filterBody`, `#filterCard` wiring on `views/transaksi.ejs`:
- Search field remains visible on ≤768px when filters are collapsed
- Advanced filters + Terapkan/Reset collapse behind toggle button
- CSS targets `#filterCard` / `.filter-body` (removed orphaned `.filter-card` rules)
**Verification:**

```bash
node --test
# 71/71 pass
```

## Transaksi filter emoji fix (review3 follow-up)

**Commit:** `ba8db9e` — `fix(phase10): replace transaksi filter emoji with SVG icons`

**Change:**
- Added `i-search` and `i-filter` symbols to `views/partials/icons.ejs` (24×24 line icons, `stroke="currentColor"`).
- Replaced search field emoji (`<span class="search-icon">🔍</span>`) with `<svg class="icon"><use href="#i-search"></use></svg>`.
- Replaced mobile filter-toggle emoji with `<svg class="icon"><use href="#i-filter"></use></svg>` (funnel icon, semantically correct for filter).

**Verification:**

```bash
node --test
# 71/71 pass
```
