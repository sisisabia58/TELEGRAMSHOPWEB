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
