# Phase 10 — Semrush-inspired Dashboard Shell Polish (Design Spec)

**Date:** 2026-08-10  
**Source:** Operator request to match Semrush Ads / SEO dashboard *feel* (light canvas, soft cards, KPI strip, filter bar, clean tables) while keeping Phase 8 IA  
**Status:** Ready for plan

## Problem

Phase 8 shipped shared chrome, teal tokens, and triage Overview, but the shell still feels uneven next to modern SaaS admin UIs:

1. **Inconsistent page chrome** — some list pages have ad-hoc headers; no shared breadcrumb + title + primary-action pattern  
2. **Cards/tables are generic** — borders/shadows work, but lack Semrush-like soft gray metric tiles, pill status chips, and quiet filter bars  
3. **Purple leftovers** — many page bodies + `login.css` still use `#667eea` / `#764ba2` gradients (Phase 8 shell is clean; bodies are not)  
4. **Sidebar is functional but plain** — group toggles work; active state is a hard left bar rather than a soft selected pill  
5. **Density** — whitespace exists but action rows (search + filters + primary CTA) are not standardized  

## Goal

Polish the **existing EJS admin shell** to a Semrush-like professional density: soft surfaces, consistent page headers, metric strips, refined tables/filters, and zero purple — without a SPA rewrite or dual icon-rail nav.

## Non-goals

- React/Vue/build step  
- Semrush **dual** left rail (icon strip + second panel) — too heavy for our nav depth; keep single sectioned sidebar  
- Copying Semrush **purple** accents (conflicts with Phase 8 teal + product design rules)  
- Dark mode  
- Redesigning bot flow canvas / Drawflow  
- New routes or IA regrouping (Phase 8 IA stays)  
- Pixel-perfect Semrush clone  

## Reference takeaways (adapt, don’t clone)

| Semrush cue | Our adaptation |
|-------------|----------------|
| Light gray canvas + white content card | Keep `--color-bg` / `--color-surface`; enlarge content radius / padding |
| Soft metric KPI tiles | Shared `.metric-strip` / `.metric-tile` for Overview + list summaries |
| Tabs + filter + primary CTA row | Shared `.toolbar` (filters left, search, primary btn right) |
| Pill status badges | Global `.badge-*` + `.status-pill` tokens |
| Quiet table with row actions | Refined `table` styles; action icon group on the right |
| Breadcrumb + page title | New `partials/page-header.ejs` |
| Purple primary (Ads UI) | **Reject** — keep teal `#0F766E` |
| Blue primary (SEO UI) | Optional link blue via `--color-link`; primary actions stay teal |

## Locked visual direction

| Token | Choice |
|-------|--------|
| Theme | Light admin on cool gray — Semrush-like softness |
| Accent | Teal `#0F766E` / hover `#0D9488` (unchanged brand) |
| Link | `#2563EB` (optional, for text links only) |
| Canvas | `#F1F5F9` bg; content panel may use slightly softer inset |
| Surface | `#FFFFFF`; metric tiles `#F8FAFC` |
| Radius | Bump shell to `--radius: 12px`; pills `--radius-pill: 999px` |
| Shadow | Single soft elevation (no multi-layer glow) |
| Type | Plus Jakarta Sans (already loaded) |
| Icons | Prefer small inline SVG / Unicode sparingly; no emoji as primary chrome |

Dashboard exception to marketing-landing rules still applies: multi-section admin UI + data tables are expected. Cards are allowed as **interaction/data containers** (metrics, filters, tables).

## Decisions

### D1 — CSS token + component pass first

Expand `public/css/dashboard.css` with:

- `.page-header`, `.breadcrumb`, `.toolbar`
- `.metric-strip`, `.metric-tile`
- `.status-pill`, complete `.badge-*` set (incl. secondary/info)
- Soften `.card`, `.table-wrapper`, `.btn`, sidebar `.nav-item.active` (pill highlight)
- Optional `.content-panel` wrapping main column

No new CSS framework.

### D2 — Shared `page-header` partial

```
views/partials/page-header.ejs
  ← breadcrumb crumbs[]
  ← title (or use topbar pageTitle)
  ← optional actions slot (topbarExtra may move here over time)
```

Adopt on high-traffic pages first: Overview, produk, stok, pricing, deposit, transaksi, user, analitik. Remaining pages can keep topbar-only until a follow-up.

### D3 — Purple purge

Replace `#667eea` / `#764ba2` in `views/**` and `public/css/login.css` with tokens / teal. Login may use a soft teal wash or flat surface — **not** purple gradient.

### D4 — Sidebar polish (single rail)

- Section labels quieter (uppercase / muted / smaller)
- Active item: soft teal-tint background pill + accent text (not only left border)
- Keep collapsible groups + mobile tabs from Phase 8

### D5 — Overview + list pages adopt metric strip / toolbar

- Overview triage cards restyle to metric tiles + soft content card (logic unchanged)
- List pages (`produk`, `stok`, `pricing`, `deposit`, `transaksi`) use `.toolbar` + existing summary stats as `.metric-strip` where stats already exist

### D6 — Motion (light)

2–3 intentional motions only: sidebar active fade, card hover elevation, optional toolbar focus ring — no animated purple glow.

## Success criteria

1. Hard-refresh: no `#667eea` / `#764ba2` in authenticated views or login CSS  
2. Overview + core list pages show Semrush-like header/toolbar/metric density while teal brand remains  
3. Sidebar active state reads as a soft selected pill  
4. Mobile tabs ≤768px still work; touch targets ≥44px  
5. `node --test` green; no bot/`index.js` behavior changes  
6. Screenshots (desktop + mobile width) of `/`, `/produk`, `/deposit` for PR  

## Out of scope reminders

- Dual icon rail  
- Rewriting communication broadcast into a campaign builder  
- Changing Overview triage data queries  
