# Admin UX Overhaul — Roadmap

> Source spec: Admin UX Overhaul — Telegram Shop Bot (cozy-sky plan).  
> This roadmap indexes per-phase implementation plans. Each phase plan is independently shippable and testable.

**Goal:** Dashboard is the single source of truth for products, variants, stock, pricing, bot navigation, and copy.

**Current branch of truth:** `main` (identical to `improvement-v2` after sync).

## Phase status

| Phase | Plan file | Status on `main` |
|-------|-----------|------------------|
| 0 — Bug fixes, lib/, hygiene | _(done in prior PRs)_ | **Done** (number grid gone; `lib/{supabase,format,stock,runtime-settings}`; grup migration; kategori on form) |
| 1 — Cart → Postgres | _(done in prior PRs)_ | **Done** (`BotSession`, `lib/cart.js`, tests). Leftover: delete `Database/Trx/` vestiges |
| 2 — Product → Variant → Stock | [2026-08-09-product-variant-stock.md](./2026-08-09-product-variant-stock.md) | **Done** (schema live; fixtures seeded) |
| 3 — Tiered pricing | [2026-08-09-tiered-pricing.md](./2026-08-09-tiered-pricing.md) | **In progress** |
| 4 — Bulk upload rework | _write after Phase 3 ships_ | Not started |
| 5 — Copy registry (screen/msg) | _write after Phase 0 cache exists_ | Not started |
| 6 — Flow engine | _depends on 1 + 5_ | Not started |
| 7 — Bot command retirement | _depends on 2 + 4 + 6_ | Not started |
| 8 — Dashboard IA + mobile | _depends on 2 + 3 + 6_ | Not started |
| 9 — Copy err/btn | _depends on 5 + 7_ | Not started |

## Why separate plans

Phases share a sequence but are different subsystems (schema/catalog vs pricing vs copy vs flow vs nav IA). One mega-plan with full TDD steps for all nine phases is unreviewable. Phase 2 alone is the destructive cutover; later plans can assume its schema.

## Global decisions (every phase inherits these)

- Flow builder = navigation only; transactional steps stay as code action nodes
- No dual-path `grup`/Varian reader — direct cutover + `FLOW_ENGINE_ENABLED` kill switch (Phase 6+)
- Discounts = tiered/bulk pricing only (Phase 3)
- `kode` lives on the variant; every product has ≥1 variant
- Keep EJS + vanilla JS; no frontend framework
- Tests: pure functions only via `node --test`; no Telegram mocks, no HTTP integration tests
- E2E script from the spec must pass at the end of every phase

## Deployment context

- Railway project `teleshop-improvement-v2` deploys from GitHub `main`
- Supabase project `teleshop-improvement-v2` (`sajffqniegtvhyopshvx`)
- Pre-launch: test data only — destructive migrations are allowed
