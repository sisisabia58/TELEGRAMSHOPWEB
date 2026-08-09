# Task 4 Report: Overview triage helpers + dashboard route rewrite

## Status

Complete.

## Commits

- `72e377a` - `feat(phase8): overview triage with batched stock summary`

## Summary

- Added `lib/dashboard-overview.js` with `summarizeStock`, `pickRecent`, and `buildOverviewModel`.
- Added the exact `test/dashboard-overview.test.js` cases from the brief and verified RED before implementation.
- Rewrote `GET /` in `dashboard.js` to load overview triage data instead of the old vanity stat grid data.
- Dashboard stock summary uses one `stock.getStokCountsByKode(...)` call for all active variants; no per-variant stock count loop was added to `GET /`.
- Dashboard route now loads pending deposits, active variants, product stock thresholds, today's WIB transactions, recent transactions, and active Bot Flow draft metadata.
- Rewrote `views/dashboard.ejs` as a triage UI linking to `/deposit`, `/stok`, `/pricing`, `/transaksi`, and `/settings/bot-flow`.

## Verification

- `node --test test/dashboard-overview.test.js` failed RED before implementation with `MODULE_NOT_FOUND` for `../lib/dashboard-overview`.
- `node --test test/dashboard-overview.test.js` passed after implementation: 3/3 subtests.
- `node --test` passed: 69/69 subtests.
- Render smoke check passed for `views/dashboard.ejs` with representative overview locals.
- `rg` confirmed `views/dashboard.ejs` no longer references the old `stats`, `recentTransactions`, Chart.js, or `revenueChart` dashboard locals.
- `rg` confirmed `views/dashboard.ejs` includes required links for `/deposit`, `/stok`, `/pricing`, `/transaksi`, and `/settings/bot-flow`.

## Concerns

- `/stok` and `/pricing` links intentionally remain present even though those routes may 404 until Task 5.
- The full test run prints existing mocked cart database error logs, but exits 0 with all subtests passing.

## Review Fix (design tokens + low-stock CTA)

### What was fixed

- Replaced hardcoded overview inline colors in `views/dashboard.ejs` with design tokens from `public/css/dashboard.css`:
  - `#333` → `var(--color-text)`
  - `#666` → `var(--color-muted)`
  - `#777` → `var(--color-muted)`
  - `#f0f0f0` → `var(--color-border)`
  - `#ffc107` → `var(--color-warning)`
- Updated Stok Rendah card CTA href from `/pricing` to `/stok`.

### Commands run and output

```bash
node --test test/dashboard-overview.test.js
```

```
# tests 3
# pass 3
# fail 0
```

```bash
node --test
```

```
# tests 69
# pass 69
# fail 0
```

### Commit

- `1ff9f1f` - `fix(phase8): use design tokens on overview triage styles`

## Review Fix (Stok Rendah CTA label + todayTxnCount nullish coalesce)

### What was fixed

- Changed Stok Rendah card CTA button text from `Review Pricing` to `Buka Stok` (href remains `/stok`).
- Out-of-stock card already used `Buka Stok`; no change needed there.
- Changed `todayTrxResult.count || ...` to `todayTrxResult.count ?? ...` in `dashboard.js` GET `/` handler so a legitimate `0` count is preserved.

### Commands run and output

```bash
node --test test/dashboard-overview.test.js
```

```
TAP version 13
# Subtest: summarizeStock counts out-of-stock and low-stock
ok 1 - summarizeStock counts out-of-stock and low-stock
  ---
  duration_ms: 0.59025
  ...
# Subtest: pickRecent limits and preserves order
ok 2 - pickRecent limits and preserves order
  ---
  duration_ms: 0.525314
  ...
# Subtest: buildOverviewModel wires draft notice
ok 3 - buildOverviewModel wires draft notice
  ---
  duration_ms: 0.263714
  ...
1..3
# tests 3
# suites 0
# pass 3
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 39.803435
```

### Commit

- (pending) - `fix(phase8): correct stok triage CTA label`
