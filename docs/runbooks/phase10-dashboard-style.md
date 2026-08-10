# Phase 10 — Dashboard style polish

## Deploy

1. Merge → Railway deploys; hard-refresh CSS.

## Automated gates (Task 6 — 2026-08-10)

**Unit tests** — PASS 71/71

```bash
node --test
```

**Syntax** — PASS

```bash
node --check dashboard.js
```

**Purple purge** — OK (no matches)

```bash
rg -n "667eea|764ba2" views public/css || echo OK
```

**New classes / icons** — OK — `page-header`, `metric-strip`, `#i-*` SVG refs in dashboard, produk, deposit, sidebar, mobile-tabs

```bash
rg -n "metric-strip|page-header|#i-" views | head
```

**Hamburger glyph** — OK (no matches; menu uses `#i-menu` SVG)

```bash
rg -n "☰" views/partials || echo OK
```

## Manual checklist (code/path verification — no headless browser)

> Headless Chrome / Playwright / Puppeteer were **not** used in this environment (known hang risk). Items below were verified by inspecting templates, CSS, and JS paths.

| Check | Method | Result |
|-------|--------|--------|
| Desktop `/` (Overview) | `views/dashboard.ejs` includes `partials/page-header`, `metric-strip` (4 tiles), triage `card` sections; `partials/sidebar` + `mobile-tabs` | **PASS** |
| Desktop `/produk` | `views/produk.ejs` includes `page-header`, `metric-strip` (4 tiles), `.toolbar` with SVG search icon, `table-card` | **PASS** |
| Desktop `/deposit` | `views/deposit.ejs` includes `page-header`, `metric-strip` (5 tiles), `.toolbar` filter form | **PASS** |
| Monochrome nav/tab icons | `views/partials/icons.ejs` sprite (`stroke="currentColor"`); sidebar + mobile-tabs use `<svg class="icon"><use href="#i-*">`; CSS `.nav-item .icon { color: var(--color-muted) }`, `.nav-item.active .icon { color: var(--color-accent) }` | **PASS** |
| Mobile ≤768px bottom tabs | `views/partials/mobile-tabs.ejs` — 4 tabs with SVG icons; `dashboard.css` `@media (max-width: 768px) { .mobile-tabs { display: grid } }`; included in dashboard/produk/deposit | **PASS** |
| Tables → mobile cards | `public/js/ui-utils.js` converts `.table-wrapper` tables to `.table-mobile-card` / `.mobile-card-item` on narrow viewports; deposit has mobile-card action styles | **PASS** (JS path; not live-rendered) |
| Teal accent (not purple) | `public/css/dashboard.css` + `login.css` `--color-accent: #0F766E`; purple grep clean | **PASS** |
| Login page teal | `views/login.ejs` → `/css/login.css` with teal tokens; no purple in login CSS | **PASS** |
| No emoji in chrome partials | `rg` on `views/partials` — no hamburger glyph; sidebar/tabs/topbar use SVG only | **PASS** |

### Post-merge smoke (human)

After deploy, spot-check in a real browser:

1. Hard-refresh `/`, `/produk`, `/deposit` — header, metrics, toolbar, soft cards, monochrome nav icons.
2. Resize to ≤768px — bottom tabs with SVG icons; tables collapse to cards or horizontal scroll.
3. `/login` — teal accent, no purple gradient.
4. Settings / voucher pages — no purple accents.

### Known out-of-scope emoji (acceptable)

- Login alert copy (`❌`) and produk empty-state (`📦`) — content/empty-state, not nav chrome.
- Toast icons in `public/js/ui-utils.js` — not sidebar/tab/table-action chrome.
