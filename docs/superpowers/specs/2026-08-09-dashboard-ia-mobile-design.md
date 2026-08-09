# Phase 8 — Dashboard IA, Mobile & UI Modernization (Design Spec)

**Date:** 2026-08-09  
**Source:** Admin UX Overhaul (cozy-sky) Phase 8 + request to modernize overall dashboard UI  
**Status:** Approved for planning

## Problem

The dashboard works but feels dated and inconsistent:

1. **IA is flat and emoji-heavy** — Settings/Bot buried; no Catalog / Bot / Insights grouping  
2. **Chrome is copy-pasted** — ~35 views each inline DOCTYPE + top-bar; dead `layout.ejs` duplicates a stale sidebar; `dashboard.ejs` inlines yet another incomplete nav  
3. **Look is generic purple-gradient admin** — `#667eea` → `#764ba2`, system fonts, no design tokens  
4. **Mobile costs two taps** — drawer-only; no bottom tabs  
5. **Missing triage surfaces** — no cross-product `/stok`, no `/pricing` overview; home is an 11-stat grid with N+1 stock queries  

## Goal

Ship a **professional, modern admin shell** with the Phase 8 information architecture, shared chrome, mobile bottom tabs, Overview triage, and Catalog stock/pricing pages — without rewriting business pages into a SPA.

## Non-goals

- React/Vue/build step  
- Phase 9 `err.*` / `btn.*` copy extraction  
- Redesigning login as a marketing landing page  
- Renaming every URL (keep working paths; regroup in nav)  
- Dark mode  

## Locked visual direction

| Token | Choice |
|-------|--------|
| Theme | Light admin shell on cool gray canvas — **not** purple gradient |
| Accent | Teal ink `#0F766E` (hover `#0D9488`) — single brand accent |
| Neutrals | `#0F172A` text, `#64748B` muted, `#E2E8F0` borders, `#F1F5F9` / `#F8FAFC` surfaces |
| Type | **Plus Jakarta Sans** (UI) via Google Fonts — not Inter/Roboto/system-only |
| Icons | Simple inline SVG sprite or Lucide CDN subset — retire emoji as primary nav icons |
| Cards | Soft border + one light shadow; no multi-layer glow |
| Density | Comfortable desktop; touch-friendly ≥44px targets on mobile |

Dashboard exception to landing-page rules: multi-section layout and data tables are expected.

## Decisions

### D1 — Shared chrome partials

Delete unused `views/partials/layout.ejs`. Every authenticated page uses:

```
partials/head.ejs      → meta, fonts, dashboard.css, page hooks
partials/sidebar.ejs   → sectioned nav (collapsible)
partials/topbar.ejs    → title slot + user/actions
partials/mobile-tabs.ejs → bottom bar (Overview / Catalog / Customers / More)
```

Pages keep page-specific scripts/styles in their own body; no express-ejs-layouts dependency required — use includes only.

### D2 — Nav IA (labels) vs routes (stable)

| Section | Item | Route (keep existing) |
|---------|------|------------------------|
| Overview | Home | `/` |
| Catalog | Products | `/produk` |
| | Stock | `/stok` **NEW** |
| | Pricing | `/pricing` **NEW** |
| | Bulk Import | `/bulk` |
| Bot | Flow Builder | `/settings/bot-flow` |
| | Copy & Text | `/settings/bot-copy` |
| | Broadcast | `/communication/broadcast` |
| | Templates | `/communication/templates` (if linked today) |
| Customers | Users | `/user` |
| | Deposits | `/deposit` |
| | Transactions | `/transaksi` |
| | Vouchers | `/voucher` |
| Insights | Analytics | `/analitik` |
| | Reports | `/laporan` |
| System | General · Channel · Payment · Supabase · Notifications | `/settings/*` |
| | Admins · Login · Audit | `/admin/*` (admin role) |

Optional aliases `/bot/flow` → `/settings/bot-flow` are **out of scope** (YAGNI).

### D3 — Overview triage (not 11-stat vanity grid)

Home shows actionable rows:

1. Pending deposits (count + deep link / inline approve if already available)  
2. Out-of-stock variants  
3. Low stock vs `ProductStockThreshold` / global `low_stock_threshold`  
4. Today revenue + txn count  
5. Recent 5 transactions  
6. Unpublished flow draft notice (`BotFlow.draft_updated_at` when draft differs / exists)

Fix N+1 stock counts with one grouped query (reuse `stock.getStokCountsByKode` or a single SQL aggregate).

### D4 — Mobile bottom tabs

Fixed bottom bar (≤768px): **Overview · Catalog · Customers · More**. “More” opens the drawer focused on Bot / Insights / System. Desktop: hide tabs; sidebar remains.

### D5 — Session hygiene (one-liners)

While touching `dashboard.js` session config:

- `secure: process.env.NODE_ENV === 'production'` (or `SECURE_COOKIES=true`)  
- Require `SESSION_SECRET` in production (fail boot or warn loudly if default)

### D6 — Pages left alone vs reworked

**Rework chrome + light polish:** all authenticated views migrate to partials.  
**Content rework (cozy-sky):** Overview, `/stok`, `/pricing`, `produk.ejs` list polish, `deposit.ejs` mobile approve cards, `transaksi*` variant column, `analitik` product rollup.  
**Content left alone:** settings forms, admin*, voucher*, user*, laporan, communication* bodies (chrome only).

## Success criteria

1. Changing sidebar once updates every page (no inline duplicate navs)  
2. Purple gradient gone; tokens in `:root`; Plus Jakarta Sans loaded  
3. Bottom tabs work on mobile; drawer still works  
4. `/stok` and `/pricing` usable; Overview is triage-first  
5. `node --test` green; manual E2E script from cozy-sky still passes  
6. No SPA framework introduced  
