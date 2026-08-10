# Phase 10 — Semrush-inspired Dashboard Style Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Polish the Phase 8 EJS admin shell to a Semrush-like soft, carded, KPI/filter density with **monochrome professional icons**, while keeping teal brand tokens and existing IA.

**Architecture:** Expand design tokens and shared CSS in `dashboard.css`; add SVG icon sprite + `page-header` partial; restyle Overview + core list pages; replace emoji chrome with B&W line icons in sidebar/tabs/actions; purge remaining purple from views + login. No SPA, no dual rail, no bot runtime changes.

**Tech Stack:** Express + EJS, vanilla JS, Plus Jakarta Sans, inline SVG sprite (`currentColor` strokes), existing `public/css/dashboard.css` tokens, `node --test`.

**Design spec:** [docs/superpowers/specs/2026-08-10-dashboard-style-polish-design.md](../specs/2026-08-10-dashboard-style-polish-design.md)

## Global Constraints

- Keep EJS + vanilla JS — **no** React/Vue/build step
- Preserve Phase 8 routes and nav IA (Overview / Catalog / Bot / Customers / Insights / System)
- Do **not** introduce Semrush purple (`#667eea` / `#764ba2`) — accent stays teal `#0F766E`
- Do **not** build a dual icon-rail sidebar
- Icons: monochrome line SVG (`stroke="currentColor"`); **no emoji as primary chrome** (sidebar, tabs, toggles, table action buttons, pageTitle prefixes)
- Do not change bot/`index.js` checkout or flow runtime (Telegram emoji in bot copy stays)
- Tests: pure helpers via `node --test` only; no HTTP/Telegram mocks
- Dashboard density OK (multi-section admin UI); cards allowed as data/filter containers
- Login may be restyled but is not a marketing landing hero
- Migrations: none

---

## File map

| File | Responsibility |
|------|----------------|
| `public/css/dashboard.css` | Token bump + page-header, toolbar, metric-strip, pills, `.icon`, table/sidebar polish |
| `public/css/login.css` | Remove purple gradient; align with teal/neutral shell |
| `views/partials/icons.ejs` | SVG `<symbol>` sprite (monochrome line icons) |
| `views/partials/head.ejs` | Include sprite once (hidden) |
| `views/partials/page-header.ejs` | Breadcrumb + optional actions |
| `views/partials/sidebar.ejs` | Nav items with icons; pill active state |
| `views/partials/mobile-tabs.ejs` | Tab icons (B&W) |
| `views/partials/topbar.ejs` | Menu icon SVG instead of ☰ |
| `views/partials/variant-row.ejs` | Action icons without emoji |
| `dashboard.js` | Strip emoji from `chromeLocalsByView` pageTitle / topbarExtra |
| `views/dashboard.ejs` + core list views | Metric strip / toolbar / page-header |
| Multiple `views/*.ejs` | Replace inline `#667eea` / `#764ba2` |
| `docs/runbooks/phase10-dashboard-style.md` | Cutover / visual QA checklist |
| Update | roadmap |

---

### Task 1: Tokens + shared CSS components

**Files:**
- Modify: `public/css/dashboard.css`
- Create: `docs/runbooks/phase10-dashboard-style.md`
- Modify: `docs/superpowers/plans/2026-08-09-admin-ux-overhaul-roadmap.md` (link plan; status Not started until final task)

**Interfaces:**
- Consumes: existing `--color-*`, `.card`, `.btn`, `.table-wrapper`
- Produces: CSS classes `.page-header`, `.breadcrumb`, `.toolbar`, `.metric-strip`, `.metric-tile`, `.status-pill`, `.icon`, updated `.nav-item.active`, optional `--color-link`, `--radius-pill`

- [ ] **Step 1: Extend `:root` tokens**

At top of `dashboard.css` `:root`, ensure/add:

```css
:root {
  --font-sans: 'Plus Jakarta Sans', system-ui, sans-serif;
  --color-bg: #F1F5F9;
  --color-surface: #FFFFFF;
  --color-surface-muted: #F8FAFC;
  --color-text: #0F172A;
  --color-muted: #64748B;
  --color-border: #E2E8F0;
  --color-accent: #0F766E;
  --color-accent-hover: #0D9488;
  --color-accent-soft: #CCFBF1;
  --color-link: #2563EB;
  --color-danger: #DC2626;
  --color-success: #059669;
  --color-warning: #D97706;
  --sidebar-width: 260px;
  --topbar-height: 64px;
  --tabs-height: 64px;
  --radius: 12px;
  --radius-sm: 8px;
  --radius-pill: 999px;
  --shadow: 0 1px 2px rgba(15, 23, 42, 0.05), 0 8px 24px rgba(15, 23, 42, 0.04);
}
```

- [ ] **Step 2: Soften shell primitives**

Update `.card` to use `--radius`, `--color-border`, light `--shadow`, hover = subtle lift only (no glow). Update `.btn-primary` / `.btn-success` accents to tokens. Ensure `.badge-secondary` exists:

```css
.badge-secondary {
  background: var(--color-muted);
  color: #fff;
}
.status-pill {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  border-radius: var(--radius-pill);
  font-size: 12px;
  font-weight: 600;
  background: var(--color-surface-muted);
  color: var(--color-muted);
  border: 1px solid var(--color-border);
}
.status-pill.is-success { background: #ECFDF5; color: var(--color-success); border-color: #A7F3D0; }
.status-pill.is-warning { background: #FFFBEB; color: var(--color-warning); border-color: #FDE68A; }
.status-pill.is-danger { background: #FEF2F2; color: var(--color-danger); border-color: #FECACA; }
```

- [ ] **Step 3: Add page-header / toolbar / metric-strip**

```css
.page-header {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px 16px;
  margin-bottom: 20px;
}
.breadcrumb {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 13px;
  color: var(--color-muted);
  margin-bottom: 6px;
}
.breadcrumb a { color: var(--color-link); text-decoration: none; }
.breadcrumb a:hover { text-decoration: underline; }
.page-header h1 {
  margin: 0;
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--color-text);
}
.page-header-actions { display: flex; flex-wrap: wrap; gap: 8px; }

.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  margin-bottom: 16px;
}
.toolbar .toolbar-spacer { flex: 1; min-width: 8px; }
.toolbar input[type="search"],
.toolbar input[type="text"],
.toolbar select {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  padding: 8px 12px;
  font: inherit;
  background: var(--color-surface);
  color: var(--color-text);
}

.metric-strip {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}
.metric-tile {
  background: var(--color-surface-muted);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  padding: 14px 16px;
}
.metric-tile .label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-muted);
  margin-bottom: 6px;
}
.metric-tile .value {
  font-size: 24px;
  font-weight: 700;
  color: var(--color-text);
  line-height: 1.1;
}
```

- [ ] **Step 4: Sidebar active pill**

```css
.nav-item.active {
  background: var(--color-accent-soft);
  color: var(--color-accent);
  border-left-color: transparent;
  border-radius: var(--radius-sm);
  font-weight: 600;
}
.nav-group-toggle {
  color: var(--color-muted);
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
```

(Keep existing collapse behavior; only restyle.)

- [ ] **Step 5: Icon base styles**

```css
.icon {
  width: 18px;
  height: 18px;
  display: inline-block;
  flex-shrink: 0;
  stroke: currentColor;
  fill: none;
  vertical-align: -0.2em;
}
.icon-sm { width: 16px; height: 16px; }
.icon-lg { width: 22px; height: 22px; }
.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
}
.nav-item .icon { color: var(--color-muted); }
.nav-item.active .icon { color: var(--color-accent); }
.mobile-tab .icon { width: 20px; height: 20px; color: var(--color-muted); }
.mobile-tab.active .icon { color: var(--color-accent); }
.btn-icon .icon { width: 16px; height: 16px; }
.sidebar-toggle .icon { width: 20px; height: 20px; }
```

- [ ] **Step 6: Runbook + roadmap link**

`docs/runbooks/phase10-dashboard-style.md`:

```markdown
# Phase 10 — Dashboard style polish

1. Merge → Railway deploys; hard-refresh CSS.
2. Confirm no purple on login or settings/voucher pages.
3. Desktop: `/`, `/produk`, `/deposit` — header, metrics, toolbar, soft cards, **monochrome nav icons**.
4. Mobile ≤768px: bottom tabs with SVG icons; tables → mobile cards.
5. Accent remains teal (not purple); chrome has no emoji icons.
```

Roadmap row:

```markdown
| 10 — Dashboard style polish (Semrush-inspired) | [2026-08-10-dashboard-style-polish.md](./2026-08-10-dashboard-style-polish.md) | Not started (plan ready) |
```

- [ ] **Step 7: Visual smoke (no Chrome hang)**

```bash
rg -n "metric-strip|page-header|status-pill|--color-accent-soft|\\.icon" public/css/dashboard.css | head
node --test
```

Expected: classes present; tests still pass (CSS-only).

- [ ] **Step 8: Commit**

```bash
git add public/css/dashboard.css docs/runbooks/phase10-dashboard-style.md docs/superpowers/plans/2026-08-09-admin-ux-overhaul-roadmap.md
git commit -m "style(phase10): Semrush-like tokens, header, toolbar, metrics, icon CSS"
```

---

### Task 2: Monochrome SVG icon sprite + chrome wiring

**Files:**
- Create: `views/partials/icons.ejs`
- Modify: `views/partials/head.ejs`, `sidebar.ejs`, `mobile-tabs.ejs`, `topbar.ejs`, `variant-row.ejs`
- Modify: `dashboard.js` (`chromeLocalsByView` — strip emoji from titles/actions)

**Interfaces:**
- Consumes: CSS `.icon` from Task 1
- Produces: `<symbol id="i-*">` sprite; helper markup pattern for icons; emoji-free chrome titles

- [ ] **Step 1: Create sprite partial**

`views/partials/icons.ejs` — hidden SVG defs (Lucide-like paths, 24 viewBox). Include at least:

| id | Use |
|----|-----|
| `i-menu` | Sidebar/topbar toggle |
| `i-home` | Overview |
| `i-box` | Products |
| `i-layers` | Stock |
| `i-tag` | Pricing |
| `i-upload` | Bulk |
| `i-git-branch` | Flow |
| `i-file-text` | Copy / templates |
| `i-megaphone` | Broadcast |
| `i-users` | Users |
| `i-wallet` | Deposits |
| `i-receipt` | Transactions |
| `i-ticket` | Vouchers |
| `i-chart` | Analytics |
| `i-clipboard` | Reports |
| `i-settings` | System settings |
| `i-shield` | Admin |
| `i-plus` | Add actions |
| `i-download` | Export |
| `i-trash` | Delete |
| `i-pencil` | Edit |
| `i-package` | Stock row |
| `i-chevron-up` / `i-chevron-down` | Reorder |
| `i-more-horizontal` | Mobile “More” |

Example symbols (implementer may use equivalent Lucide path data):

```html
<svg xmlns="http://www.w3.org/2000/svg" style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true">
  <symbol id="i-home" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M3 10.5 12 3l9 7.5"/><path d="M5 10v10h14V10"/>
  </symbol>
  <symbol id="i-menu" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
    <path d="M4 6h16M4 12h16M4 18h16"/>
  </symbol>
  <!-- …remaining symbols… -->
</svg>
```

- [ ] **Step 2: Load sprite in `head.ejs`**

```ejs
<%- include('icons') %>
```

- [ ] **Step 3: Wire sidebar + mobile tabs + toggles**

Pattern:

```ejs
<a href="/produk" class="nav-item <%= activePage === 'produk' ? 'active' : '' %>">
  <svg class="icon" aria-hidden="true"><use href="#i-box"></use></svg>
  <span>Products</span>
</a>
```

Replace `☰` with:

```ejs
<button class="sidebar-toggle" onclick="toggleSidebar()" aria-label="Toggle sidebar">
  <svg class="icon" aria-hidden="true"><use href="#i-menu"></use></svg>
</button>
```

Mobile tabs: icon above/beside label using the same sprite ids.

- [ ] **Step 4: Strip emoji from `chromeLocalsByView`**

In `dashboard.js`, remove leading emoji from `pageTitle` / button labels, e.g.:

```js
produk: () => ({ currentPage: 'produk', pageTitle: 'Daftar Produk', topbarExtra: '<a href="/produk/tambah" class="btn btn-success">Tambah Produk</a>' }),
deposit: (locals) => { /* pageTitle: 'Manajemen Deposit' — no 💰 */ },
```

Optional: prepend icon HTML in `topbarExtra` only where it improves scanability:

```js
topbarExtra: '<a href="/produk/tambah" class="btn btn-success"><svg class="icon icon-sm" aria-hidden="true"><use href="#i-plus"></use></svg> Tambah Produk</a>'
```

- [ ] **Step 5: `variant-row.ejs` actions**

Replace 📦 ▲ ▼ 🗑️ with `#i-package`, `#i-chevron-up`, `#i-chevron-down`, `#i-trash` inside `.btn-icon`.

- [ ] **Step 6: Gates**

```bash
rg -n "☰|📦|💰|🗑️|➕|📊|🎟️|📢" views/partials dashboard.js | head
# Expect: no hits in partials/chromeLocals titles (bot copy / help text elsewhere OK)
node --test
```

- [ ] **Step 7: Commit**

```bash
git add views/partials/icons.ejs views/partials/head.ejs views/partials/sidebar.ejs views/partials/mobile-tabs.ejs views/partials/topbar.ejs views/partials/variant-row.ejs dashboard.js
git commit -m "feat(phase10): monochrome SVG icons for admin chrome"
```

---

### Task 3: `page-header` partial + wire high-traffic pages

**Files:**
- Create: `views/partials/page-header.ejs`
- Modify: `views/dashboard.ejs`, `views/produk.ejs`, `views/stok.ejs`, `views/pricing.ejs`, `views/deposit.ejs`, `views/transaksi.ejs`
- Optionally adjust: `views/partials/topbar.ejs` (reduce duplicate H1 if page-header owns title — prefer: topbar keeps compact title; page-header is in content for breadcrumb. **Decision:** keep topbar title; page-header shows breadcrumb + optional subtitle only **OR** hide duplicate by passing `hideTopbarTitle`. Simplest: page-header is **inside** `.container` with breadcrumb + actions; topbar still shows `pageTitle`. Avoid double H1 — page-header uses breadcrumb + leaves H1 to topbar.)

**Interfaces:**
- Consumes: locals `breadcrumbs` optional array of `{ label, href? }`, `pageHeaderActions` optional HTML string
- Produces: rendered header block

- [ ] **Step 1: Create partial**

```ejs
<%# views/partials/page-header.ejs %>
<% const crumbs = typeof breadcrumbs !== 'undefined' && Array.isArray(breadcrumbs) ? breadcrumbs : [] %>
<div class="page-header">
  <div>
    <% if (crumbs.length) { %>
      <nav class="breadcrumb" aria-label="Breadcrumb">
        <% crumbs.forEach((c, i) => { %>
          <% if (i > 0) { %><span aria-hidden="true">›</span><% } %>
          <% if (c.href) { %>
            <a href="<%= c.href %>"><%= c.label %></a>
          <% } else { %>
            <span><%= c.label %></span>
          <% } %>
        <% }) %>
      </nav>
    <% } %>
  </div>
  <% if (typeof pageHeaderActions !== 'undefined' && pageHeaderActions) { %>
    <div class="page-header-actions"><%- pageHeaderActions %></div>
  <% } %>
</div>
```

- [ ] **Step 2: Wire pages**

In each high-traffic view, after topbar / inside `.container`, include:

```ejs
<%- include('partials/page-header') %>
```

Set locals in route `res.render` **or** via `chromeLocalsByView` / inline in EJS:

```ejs
<%
  breadcrumbs = [
    { label: 'Home', href: '/' },
    { label: 'Catalog', href: '/produk' },
    { label: 'Products' }
  ]
%>
```

Prefer setting `breadcrumbs` in the EJS view top (like Overview does for model vars) to avoid large `dashboard.js` churn — **YAGNI on route locals** unless already there.

Convert existing summary stat cards on produk/stok/pricing/deposit to `.metric-strip` / `.metric-tile` markup (same numbers, new classes).

Wrap filter/search rows in `.toolbar` with `.toolbar-spacer` before primary CTA when a CTA exists.

- [ ] **Step 3: Overview restyle**

In `views/dashboard.ejs`, restyle triage count cards to `.metric-strip` + keep actionable lists in `.card`. Remove any hardcoded hex still using gray literals; use tokens (`var(--color-*)`).

- [ ] **Step 4: Commit**

```bash
git add views/partials/page-header.ejs views/dashboard.ejs views/produk.ejs views/stok.ejs views/pricing.ejs views/deposit.ejs views/transaksi.ejs
git commit -m "feat(phase10): page-header partial and Semrush-like list chrome"
```

---

### Task 4: Purple purge (views + login)

**Files:**
- Modify: `public/css/login.css`
- Modify: all `views/**/*.ejs` that still contain `#667eea` or `#764ba2` (see `rg` list)

**Interfaces:**
- Consumes: `--color-accent`, `--color-accent-soft`, `.btn-primary`
- Produces: zero purple hardcodes in views + login.css

- [ ] **Step 1: Inventory**

```bash
rg -n "667eea|764ba2" views public/css
```

- [ ] **Step 2: Restyle login**

Replace purple gradient background with:

```css
body {
  background: var(--color-bg, #F1F5F9);
  /* optional soft teal radial: */
  background-image: radial-gradient(1200px 600px at 10% -10%, #CCFBF1 0%, transparent 55%);
}
```

Buttons/links: teal `#0F766E` (or link login.css to shared tokens by duplicating the few vars — do not `@import` dashboard.css if it breaks login layout; duplicate the 4–5 vars).

- [ ] **Step 3: Replace view inline purple**

For each hit:

- Borders / accents → `var(--color-accent)` or class `btn-primary`
- Gradients → solid `var(--color-accent)` or remove gradient
- `accent-color: #667eea` → `accent-color: var(--color-accent)`

Do not change layout structure while purging colors.

- [ ] **Step 4: Grep gate**

```bash
rg -n "667eea|764ba2" views public/css || echo OK
```

Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add public/css/login.css views
git commit -m "style(phase10): purge purple accents from login and page bodies"
```

---

### Task 5: Table + form polish + motion

**Files:**
- Modify: `public/css/dashboard.css`
- Touch list views only if markup hooks needed (e.g. wrap actions in `.table-actions`)

**Interfaces:**
- Produces: refined table header bg, row hover, form focus rings using accent

- [ ] **Step 1: Table polish**

```css
.table-wrapper {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  overflow: hidden;
}
.table-wrapper table thead th {
  background: var(--color-surface-muted);
  color: var(--color-muted);
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-weight: 600;
  border-bottom: 1px solid var(--color-border);
}
.table-wrapper table tbody tr:hover {
  background: #F8FAFC;
}
.table-actions {
  display: inline-flex;
  gap: 6px;
  align-items: center;
}
```

- [ ] **Step 2: Form focus**

```css
input:focus, select:focus, textarea:focus, .form-textarea:focus {
  outline: none;
  border-color: var(--color-accent);
  box-shadow: 0 0 0 3px rgba(15, 118, 110, 0.15);
}
```

- [ ] **Step 3: Light motion**

```css
.card, .metric-tile, .nav-item {
  transition: background-color 0.15s ease, box-shadow 0.15s ease, color 0.15s ease;
}
```

- [ ] **Step 4: Commit**

```bash
git add public/css/dashboard.css
git commit -m "style(phase10): refine tables, focus rings, light motion"
```

---

### Task 6: Verify + roadmap Done + PR

**Files:**
- Modify: roadmap, runbook

- [ ] **Step 1: Gates**

```bash
node --test
node --check dashboard.js
rg -n "667eea|764ba2" views public/css || echo OK
rg -n "metric-strip|page-header|#i-" views | head
rg -n "☰" views/partials || echo OK
```

Expected: tests pass; purple OK; pages use new classes; no hamburger glyph in partials.

- [ ] **Step 2: Manual checklist** (code/path if no browser; avoid hung headless Chrome)

Document in runbook: desktop `/`, `/produk`, `/deposit`; monochrome sidebar/tab icons; mobile tabs; login page teal.

- [ ] **Step 3: Mark roadmap Done**

```markdown
| 10 — Dashboard style polish (Semrush-inspired) | [2026-08-10-dashboard-style-polish.md](./2026-08-10-dashboard-style-polish.md) | **Done** |
```

- [ ] **Step 4: Commit + push**

```bash
git add docs/superpowers/plans/2026-08-09-admin-ux-overhaul-roadmap.md docs/runbooks/phase10-dashboard-style.md
git commit -m "docs(phase10): mark dashboard style polish done"
git push -u origin HEAD
```

---

## Spec coverage self-review

| Spec decision | Task |
|---------------|------|
| D1 CSS tokens + components | 1, 5 |
| D2 page-header partial | 3 |
| D3 purple purge | 4 |
| D4 sidebar pill active | 1 |
| D5 Overview + list metric/toolbar | 3 |
| D6 light motion | 5 |
| D7 monochrome icons | 2 |
| Success criteria / gates | 6 |
| Non-goals (no dual rail, no SPA, teal not purple) | Global |

## Placeholder scan

No TBD. Token values, CSS snippets, icon id table, file paths, grep gates, and commit messages included.

## Type consistency

- Class names: `page-header`, `breadcrumb`, `toolbar`, `metric-strip`, `metric-tile`, `status-pill`, `icon`
- Icon ids: `i-home`, `i-box`, `i-menu`, … (prefix `i-`)
- Locals: `breadcrumbs[]`, optional `pageHeaderActions`
- Accent remains `#0F766E` / `--color-accent`
