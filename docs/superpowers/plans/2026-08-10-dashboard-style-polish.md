# Phase 10 — Semrush-inspired Dashboard Style Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Polish the Phase 8 EJS admin shell to a Semrush-like soft, carded, KPI/filter density while keeping teal brand tokens and existing IA.

**Architecture:** Expand design tokens and shared CSS components in `dashboard.css`; add a `page-header` partial; restyle Overview + core list pages to use metric strips and toolbars; purge remaining purple from views + login; lightly polish sidebar active states. No SPA, no dual rail, no bot runtime changes.

**Tech Stack:** Express + EJS, vanilla JS, Plus Jakarta Sans, existing `public/css/dashboard.css` tokens, `node --test`.

**Design spec:** [docs/superpowers/specs/2026-08-10-dashboard-style-polish-design.md](../specs/2026-08-10-dashboard-style-polish-design.md)

## Global Constraints

- Keep EJS + vanilla JS — **no** React/Vue/build step
- Preserve Phase 8 routes and nav IA (Overview / Catalog / Bot / Customers / Insights / System)
- Do **not** introduce Semrush purple (`#667eea` / `#764ba2`) — accent stays teal `#0F766E`
- Do **not** build a dual icon-rail sidebar
- Do not change bot/`index.js` checkout or flow runtime
- Tests: pure helpers via `node --test` only; no HTTP/Telegram mocks
- Dashboard density OK (multi-section admin UI); cards allowed as data/filter containers
- Login may be restyled but is not a marketing landing hero
- Migrations: none

---

## File map

| File | Responsibility |
|------|----------------|
| `public/css/dashboard.css` | Token bump + page-header, toolbar, metric-strip, pills, table/sidebar polish |
| `public/css/login.css` | Remove purple gradient; align with teal/neutral shell |
| `views/partials/page-header.ejs` | Breadcrumb + title + optional actions |
| `views/partials/sidebar.ejs` | Class hooks for pill active state if needed |
| `views/partials/topbar.ejs` | Minor spacing alignment with new content panel |
| `views/dashboard.ejs` | Overview restyle to metric strip + soft panels |
| `views/produk.ejs`, `stok.ejs`, `pricing.ejs`, `deposit.ejs`, `transaksi.ejs` | Adopt page-header / toolbar / metric-strip |
| Multiple `views/*.ejs` | Replace inline `#667eea` / `#764ba2` with tokens/classes |
| `docs/runbooks/phase10-dashboard-style.md` | Cutover / visual QA checklist |
| Update | `docs/superpowers/plans/2026-08-09-admin-ux-overhaul-roadmap.md` |

---

### Task 1: Tokens + shared CSS components

**Files:**
- Modify: `public/css/dashboard.css`
- Create: `docs/runbooks/phase10-dashboard-style.md`
- Modify: `docs/superpowers/plans/2026-08-09-admin-ux-overhaul-roadmap.md` (link plan; status Not started until final task)

**Interfaces:**
- Consumes: existing `--color-*`, `.card`, `.btn`, `.table-wrapper`
- Produces: CSS classes `.page-header`, `.breadcrumb`, `.toolbar`, `.metric-strip`, `.metric-tile`, `.status-pill`, updated `.nav-item.active`, optional `--color-link`, `--radius-pill`

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

- [ ] **Step 5: Runbook + roadmap link**

`docs/runbooks/phase10-dashboard-style.md`:

```markdown
# Phase 10 — Dashboard style polish

1. Merge → Railway deploys; hard-refresh CSS.
2. Confirm no purple on login or settings/voucher pages.
3. Desktop: `/`, `/produk`, `/deposit` — header, metrics, toolbar, soft cards.
4. Mobile ≤768px: bottom tabs still work; tables → mobile cards.
5. Accent remains teal (not purple).
```

Roadmap row:

```markdown
| 10 — Dashboard style polish (Semrush-inspired) | [2026-08-10-dashboard-style-polish.md](./2026-08-10-dashboard-style-polish.md) | Not started (plan ready) |
```

- [ ] **Step 6: Visual smoke (no Chrome hang)**

```bash
rg -n "metric-strip|page-header|status-pill|--color-accent-soft" public/css/dashboard.css | head
node --test
```

Expected: classes present; tests still pass (CSS-only).

- [ ] **Step 7: Commit**

```bash
git add public/css/dashboard.css docs/runbooks/phase10-dashboard-style.md docs/superpowers/plans/2026-08-09-admin-ux-overhaul-roadmap.md
git commit -m "style(phase10): Semrush-like tokens, header, toolbar, metrics CSS"
```

---

### Task 2: `page-header` partial + wire high-traffic pages

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

### Task 3: Purple purge (views + login)

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

### Task 4: Table + form polish + motion

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

### Task 5: Verify + roadmap Done + PR

**Files:**
- Modify: roadmap, runbook

- [ ] **Step 1: Gates**

```bash
node --test
node --check dashboard.js
rg -n "667eea|764ba2" views public/css || echo OK
rg -n "metric-strip|page-header" views | head
```

Expected: tests pass; purple OK; pages use new classes.

- [ ] **Step 2: Manual checklist** (code/path if no browser; avoid hung headless Chrome)

Document in runbook: desktop `/`, `/produk`, `/deposit`; mobile tabs; login page teal.

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
| D1 CSS tokens + components | 1, 4 |
| D2 page-header partial | 2 |
| D3 purple purge | 3 |
| D4 sidebar pill active | 1 |
| D5 Overview + list metric/toolbar | 2 |
| D6 light motion | 4 |
| Success criteria / gates | 5 |
| Non-goals (no dual rail, no SPA, teal not purple) | Global |

## Placeholder scan

No TBD. Token values, CSS snippets, file paths, grep gates, and commit messages included.

## Type consistency

- Class names: `page-header`, `breadcrumb`, `toolbar`, `metric-strip`, `metric-tile`, `status-pill`
- Locals: `breadcrumbs[]`, optional `pageHeaderActions`
- Accent remains `#0F766E` / `--color-accent`
