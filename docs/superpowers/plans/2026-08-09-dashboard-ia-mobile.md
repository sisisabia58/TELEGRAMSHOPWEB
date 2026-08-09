# Dashboard IA, Mobile & UI Modernization (Phase 8) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the purple-gradient, copy-pasted dashboard chrome with a professional tokenized shell, Phase 8 nav IA, mobile bottom tabs, Overview triage, and new Catalog Stock/Pricing pages — keeping EJS + vanilla JS.

**Architecture:** Introduce design tokens + shared `head`/`topbar`/`mobile-tabs` partials; rewrite `sidebar.ejs` for collapsible sections; migrate all authenticated views off duplicated chrome; add `/stok` + `/pricing` routes; rebuild Overview data with batched stock queries; light content polish on list pages. No SPA.

**Tech Stack:** Node.js 20, Express 5 + EJS, vanilla JS, Plus Jakarta Sans (Google Fonts), existing `dashboard.css` / `ui-utils.js`, `node --test`, Supabase.

**Design spec:** [docs/superpowers/specs/2026-08-09-dashboard-ia-mobile-design.md](../specs/2026-08-09-dashboard-ia-mobile-design.md)

## Global Constraints

- Keep EJS + vanilla JS — **no** React/Vue/build step
- Preserve existing routes (`/settings/bot-flow`, `/produk`, …) — regroup in nav only
- Do not change bot/`index.js` checkout or flow runtime
- Tests: pure helpers via `node --test` only; no HTTP/Telegram mocks
- Visual: **no** purple gradient theme; use design tokens; Plus Jakarta Sans; teal accent `#0F766E`
- Dashboard density OK (multi-section admin UI)
- Delete dead `views/partials/layout.ejs` after migration
- Session: stop hardcoding `secure: false` / default secret in production
- Migrations: none expected (uses existing `ProductStockThreshold`, `BotFlow.draft`)

---

## File map

| File | Responsibility |
|------|----------------|
| `public/css/dashboard.css` | Tokens + modernized shell (sidebar, topbar, tabs, cards, tables) |
| `views/partials/head.ejs` | Shared `<head>` (fonts, CSS, hooks) |
| `views/partials/topbar.ejs` | Title + user/actions slot |
| `views/partials/mobile-tabs.ejs` | Bottom tab bar |
| `views/partials/sidebar.ejs` | Sectioned collapsible nav |
| Delete | `views/partials/layout.ejs` |
| `views/dashboard.ejs` | Overview triage UI |
| `views/stok.ejs` | Cross-product stock list |
| `views/pricing.ejs` | Tier overview |
| `lib/dashboard-overview.js` | Pure aggregations for Overview (testable) |
| `test/dashboard-overview.test.js` | Unit tests |
| `dashboard.js` | Overview query rewrite; `/stok`; `/pricing`; session flags |
| `public/js/nav.js` | Section collapse + tab active state (optional small file) |
| `docs/runbooks/phase8-dashboard-ia.md` | Cutover notes |
| Update | roadmap status |

---

### Task 1: Design tokens + CSS foundation

**Files:**
- Modify: `public/css/dashboard.css` (prepend tokens; restyle body/sidebar/topbar/cards)
- Create: `docs/runbooks/phase8-dashboard-ia.md`
- Create: design spec (if missing)
- Modify: roadmap → **Plan ready**

**Interfaces:**
- Consumes: existing class names (`.sidebar`, `.main-content`, `.card`, `.btn`, …)
- Produces: `:root` tokens used by later partials

- [ ] **Step 1: Prepend tokens at top of `dashboard.css`** (after reset)

```css
@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap');

:root {
  --font-sans: 'Plus Jakarta Sans', system-ui, sans-serif;
  --color-bg: #F1F5F9;
  --color-surface: #FFFFFF;
  --color-text: #0F172A;
  --color-muted: #64748B;
  --color-border: #E2E8F0;
  --color-accent: #0F766E;
  --color-accent-hover: #0D9488;
  --color-danger: #DC2626;
  --color-success: #059669;
  --color-warning: #D97706;
  --sidebar-width: 260px;
  --topbar-height: 64px;
  --tabs-height: 64px;
  --radius: 10px;
  --shadow: 0 1px 2px rgba(15, 23, 42, 0.06), 0 4px 12px rgba(15, 23, 42, 0.04);
}
```

- [ ] **Step 2: Restyle `body` / `.sidebar` / `.main-content` / `.card` / `.btn-primary`**

Replace purple gradient body with `background: var(--color-bg); font-family: var(--font-sans); color: var(--color-text);`.  
Map existing `#667eea` accents to `var(--color-accent)` via search-replace for the main accent usages (buttons, active nav, links). Keep semantic greens/reds.

- [ ] **Step 3: Add mobile tab bar + topbar utility classes**

```css
.mobile-tabs {
  display: none;
  position: fixed;
  left: 0; right: 0; bottom: 0;
  height: var(--tabs-height);
  background: var(--color-surface);
  border-top: 1px solid var(--color-border);
  z-index: 1100;
  grid-template-columns: repeat(4, 1fr);
}
.mobile-tabs a {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 600;
  color: var(--color-muted);
  text-decoration: none;
}
.mobile-tabs a.active { color: var(--color-accent); }
@media (max-width: 768px) {
  .mobile-tabs { display: grid; }
  .main-content { padding-bottom: calc(var(--tabs-height) + 16px); }
}
```

- [ ] **Step 4: Write runbook stub + roadmap Plan ready**

```markdown
# Phase 8 cutover — Dashboard IA & UI

1. Merge → Railway deploys.
2. Hard-refresh dashboard (fonts/CSS).
3. Confirm purple gradient gone; sidebar sections work.
4. Mobile ≤768px: bottom tabs visible.
5. Open `/`, `/stok`, `/pricing`.
6. SESSION_SECRET set in Railway for production.
```

- [ ] **Step 5: Commit**

```bash
git add public/css/dashboard.css docs/runbooks/phase8-dashboard-ia.md \
  docs/superpowers/specs/2026-08-09-dashboard-ia-mobile-design.md \
  docs/superpowers/plans/2026-08-09-dashboard-ia-mobile.md \
  docs/superpowers/plans/2026-08-09-admin-ux-overhaul-roadmap.md
git commit -m "docs(phase8): design tokens plan and CSS foundation"
```

Note: if CSS foundation is large, split commit: `docs(phase8): …` then `style(phase8): tokenized dashboard shell`.

---

### Task 2: Shared partials (`head`, `topbar`, `mobile-tabs`) + sidebar IA

**Files:**
- Create: `views/partials/head.ejs`
- Create: `views/partials/topbar.ejs`
- Create: `views/partials/mobile-tabs.ejs`
- Replace: `views/partials/sidebar.ejs`
- Create: `public/js/nav.js` (section collapse)

**Interfaces:**
- Locals expected: `title`, `namaBot`, `username`, `currentPage`, `req`, optional `pageTitle`, optional `topbarActions` (HTML string) or block via include pattern

- [ ] **Step 1: `views/partials/head.ejs`**

```ejs
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0, user-scalable=yes">
<title><%= title %></title>
<link rel="stylesheet" href="/css/dashboard.css">
<script src="/js/ui-utils.js"></script>
<script src="/js/nav.js" defer></script>
```

- [ ] **Step 2: `views/partials/topbar.ejs`**

```ejs
<div class="top-bar">
  <div class="top-bar-left">
    <button class="sidebar-toggle" onclick="toggleSidebar()" aria-label="Toggle sidebar">☰</button>
    <h1 class="page-title"><%= typeof pageTitle !== 'undefined' ? pageTitle : title %></h1>
  </div>
  <div class="top-bar-right">
    <% if (typeof topbarExtra !== 'undefined') { %><%- topbarExtra %><% } %>
    <div class="user-info">
      <span><%= username || 'Admin' %></span>
      <% if (req.session && req.session.role) { %>
        <span class="user-badge"><%= req.session.role %></span>
      <% } %>
    </div>
    <a href="/admin/change-password" class="btn-top">Password</a>
    <a href="/logout" class="btn-top btn-logout">Logout</a>
  </div>
</div>
```

- [ ] **Step 3: `views/partials/mobile-tabs.ejs`**

Map `currentPage` → active tab (`dashboard`→overview, `produk|stok|pricing|bulk`→catalog, `user|deposit|transaksi|voucher`→customers, else→more).

```ejs
<nav class="mobile-tabs" aria-label="Mobile primary">
  <a href="/" class="<%= currentPage === 'dashboard' ? 'active' : '' %>">Overview</a>
  <a href="/produk" class="<%= ['produk','stok','pricing','bulk'].includes(currentPage) ? 'active' : '' %>">Catalog</a>
  <a href="/user" class="<%= ['user','deposit','transaksi','voucher'].includes(currentPage) ? 'active' : '' %>">Customers</a>
  <a href="#" onclick="toggleSidebar(); return false;" class="<%= ['dashboard','produk','stok','pricing','bulk','user','deposit','transaksi','voucher'].includes(currentPage) ? '' : 'active' %>">More</a>
</nav>
```

- [ ] **Step 4: Rewrite `sidebar.ejs`** with collapsible sections Overview / Catalog / Bot / Customers / Insights / System (+ Admin). Use `data-section` attributes; mark `active` via `currentPage`. Auto-expand section containing active link via `nav.js`.

Example Catalog group:

```ejs
<div class="nav-group" data-section="catalog">
  <button type="button" class="nav-group-toggle">Catalog</button>
  <div class="nav-group-items">
    <a href="/produk" class="nav-item <%= currentPage === 'produk' ? 'active' : '' %>">Products</a>
    <a href="/stok" class="nav-item <%= currentPage === 'stok' ? 'active' : '' %>">Stock</a>
    <a href="/pricing" class="nav-item <%= currentPage === 'pricing' ? 'active' : '' %>">Pricing</a>
    <a href="/bulk" class="nav-item <%= currentPage === 'bulk' ? 'active' : '' %>">Bulk Import</a>
  </div>
</div>
```

- [ ] **Step 5: `public/js/nav.js`**

```js
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.nav-group').forEach((g) => {
    if (g.querySelector('.nav-item.active')) g.classList.add('open')
    const btn = g.querySelector('.nav-group-toggle')
    if (btn) btn.addEventListener('click', () => g.classList.toggle('open'))
  })
})
```

- [ ] **Step 6: Commit**

```bash
git add views/partials/head.ejs views/partials/topbar.ejs views/partials/mobile-tabs.ejs \
  views/partials/sidebar.ejs public/js/nav.js
git commit -m "feat(phase8): shared chrome partials and sectioned sidebar"
```

---

### Task 3: Migrate views to shared chrome; delete `layout.ejs`

**Files:**
- Modify: all authenticated `views/*.ejs` that include sidebar (~35) + `dashboard.ejs`
- Delete: `views/partials/layout.ejs`

**Interfaces:**
- Each page head becomes `<%- include('partials/head') %>` (+ page-specific CSS/JS links after)
- After `<body>`: skip-link → sidebar → `<main>` → topbar → content → mobile-tabs

- [ ] **Step 1: Migrate `dashboard.ejs` first** (remove inline nav entirely)

Pattern:

```ejs
<!DOCTYPE html>
<html lang="id">
<head>
  <%- include('partials/head') %>
</head>
<body>
  <a href="#main-content" class="skip-link">Skip to main content</a>
  <%- include('partials/sidebar') %>
  <main class="main-content" id="main-content">
    <%- include('partials/topbar') %>
    <div class="container"><!-- page body --></div>
  </main>
  <%- include('partials/mobile-tabs') %>
</body>
</html>
```

Ensure route sets `currentPage: 'dashboard'`.

- [ ] **Step 2: Batch-migrate remaining views** that already `include('partials/sidebar')` — replace duplicated head/top-bar with partials. Keep page-specific `topbarExtra` where needed (e.g. Tambah Produk button):

```ejs
<% const topbarExtra = `<a href="/produk/tambah" class="btn btn-success">Tambah Produk</a>` %>
```

Or pass from route as `res.render(..., { topbarExtra: '...' })`.

- [ ] **Step 3: Fix orphans** that lack sidebar (`produk-hapus`, `voucher-*`, `user-reset`, communication templates/send) — add same chrome shell for consistency.

- [ ] **Step 4: Delete `views/partials/layout.ejs`**

```bash
git rm views/partials/layout.ejs
rg -n "partials/layout" views README.md || true
```

- [ ] **Step 5: Manual spot-check 5 pages + commit**

```bash
git add views
git commit -m "feat(phase8): migrate views to shared head/topbar/tabs chrome"
```

---

### Task 4: Overview triage helpers (TDD) + route rewrite

**Files:**
- Create: `lib/dashboard-overview.js`
- Create: `test/dashboard-overview.test.js`
- Modify: `dashboard.js` `GET /` handler

**Interfaces:**
- Produces:
  - `summarizeStock(variants: {id, kode, stok_count, threshold}[]): { outOfStock, lowStock }`
  - `pickRecent(txns, n)`
  - `buildOverviewModel(input) → { pendingDeposits, outOfStock, lowStock, todayRevenue, todayTxnCount, recentTxns, draftNotice }`

- [ ] **Step 1: Failing tests**

```js
// test/dashboard-overview.test.js
const test = require('node:test')
const assert = require('node:assert')
const { summarizeStock, pickRecent, buildOverviewModel } = require('../lib/dashboard-overview')

test('summarizeStock counts out-of-stock and low-stock', () => {
  const r = summarizeStock([
    { id: '1', stok_count: 0, threshold: 5 },
    { id: '2', stok_count: 3, threshold: 5 },
    { id: '3', stok_count: 10, threshold: 5 },
  ])
  assert.equal(r.outOfStock.length, 1)
  assert.equal(r.lowStock.length, 1)
  assert.equal(r.lowStock[0].id, '2')
})

test('pickRecent limits and preserves order', () => {
  const rows = [{ id: 1 }, { id: 2 }, { id: 3 }]
  assert.deepEqual(pickRecent(rows, 2).map((x) => x.id), [1, 2])
})

test('buildOverviewModel wires draft notice', () => {
  const m = buildOverviewModel({
    pendingDeposits: [{ id: 'd1' }],
    variants: [{ id: '1', stok_count: 0, threshold: 2 }],
    todayRevenue: 1000,
    todayTxnCount: 2,
    recentTxns: [],
    flowDraftUpdatedAt: '2026-08-09T00:00:00Z',
  })
  assert.equal(m.pendingDeposits.length, 1)
  assert.ok(m.draftNotice)
  assert.match(m.draftNotice, /draft/i)
})
```

- [ ] **Step 2: Run — expect FAIL**

```bash
node --test test/dashboard-overview.test.js
```

- [ ] **Step 3: Implement `lib/dashboard-overview.js`**

```js
function summarizeStock(variants) {
  const list = Array.isArray(variants) ? variants : []
  const outOfStock = list.filter((v) => (v.stok_count || 0) <= 0)
  const lowStock = list.filter((v) => {
    const c = v.stok_count || 0
    const t = v.threshold == null ? 5 : Number(v.threshold)
    return c > 0 && c <= t
  })
  return { outOfStock, lowStock }
}

function pickRecent(rows, n) {
  return (rows || []).slice(0, n)
}

function buildOverviewModel(input) {
  const stock = summarizeStock(input.variants || [])
  const draftNotice = input.flowDraftUpdatedAt
    ? `Flow draft saved ${input.flowDraftUpdatedAt} — open Bot Flow to review/publish.`
    : null
  return {
    pendingDeposits: input.pendingDeposits || [],
    outOfStock: stock.outOfStock,
    lowStock: stock.lowStock,
    todayRevenue: input.todayRevenue || 0,
    todayTxnCount: input.todayTxnCount || 0,
    recentTxns: pickRecent(input.recentTxns || [], 5),
    draftNotice,
  }
}

module.exports = { summarizeStock, pickRecent, buildOverviewModel }
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Rewrite `GET /` in `dashboard.js`**

- Load pending deposits (existing query)  
- Load active variants + **one** stock count map (`stock.getStokCountsByKode` or equivalent) — **no per-product loop queries**  
- Load thresholds from `ProductStockThreshold` (map by `varian_id`)  
- Today revenue/txn from `Trx` filtered by WIB day  
- Recent 5 `Trx`  
- Active `BotFlow.draft_updated_at`  
- `buildOverviewModel(...)` → render `dashboard.ejs`

- [ ] **Step 6: Rewrite `views/dashboard.ejs`** as triage list (cards/rows with links to `/deposit`, `/stok`, `/transaksi`, `/settings/bot-flow`) — not an 11-stat vanity grid.

- [ ] **Step 7: Commit**

```bash
git add lib/dashboard-overview.js test/dashboard-overview.test.js dashboard.js views/dashboard.ejs
git commit -m "feat(phase8): overview triage with batched stock summary"
```

---

### Task 5: Catalog pages `/stok` and `/pricing`

**Files:**
- Create: `views/stok.ejs`, `views/pricing.ejs`
- Modify: `dashboard.js` (routes)
- Modify: sidebar already links these (Task 2)

**Interfaces:**
- `GET /stok` → list variants with stock, sort **low/out first**, link to `/produk/:produkId/varian/:varianId/stok`
- `GET /pricing` → list variants with base harga + tier count; link to product detail tier section

- [ ] **Step 1: Add routes**

```js
app.get('/stok', isAuthenticated, async (req, res) => {
  try {
    const products = await catalog.listProducts({ activeOnly: false, withStock: true })
    const rows = []
    for (const p of products) {
      for (const v of p.variants || []) {
        rows.push({
          produk_id: p.id,
          produk_nama: p.nama,
          varian_id: v.id,
          label: v.label,
          kode: v.kode,
          stok_count: v.stok_count || 0,
          is_active: v.is_active !== false,
        })
      }
    }
    rows.sort((a, b) => a.stok_count - b.stok_count || a.produk_nama.localeCompare(b.produk_nama))
    res.render('stok', {
      title: `Stock - ${NamaBot}`,
      namaBot: NamaBot,
      username: req.session.username,
      currentPage: 'stok',
      pageTitle: 'Stock',
      rows,
      req,
    })
  } catch (e) {
    console.error(e)
    res.status(500).send(e.message)
  }
})
```

Similar for `/pricing` using `pricing` helpers / `HargaTier` counts per `varian_id` (batch `.in('varian_id', ids)` — no N+1).

- [ ] **Step 2: Views** — table + mobile cards using existing `.table-wrapper` / `.table-mobile-card` patterns; respect new tokens.

- [ ] **Step 3: Manual check + commit**

```bash
git add dashboard.js views/stok.ejs views/pricing.ejs
git commit -m "feat(phase8): catalog stock and pricing overview pages"
```

---

### Task 6: List-page polish (produk, deposit, transaksi, analitik)

**Files:**
- Modify: `views/produk.ejs`, `views/deposit.ejs`, `views/transaksi.ejs` (+ detail if needed), `views/analitik.ejs`
- Modify: `dashboard.js` analitik API product rollup if still grouping only by `Trx.kode`

- [ ] **Step 1: `produk.ejs`** — align filters/table with new chrome; ensure variant/stock counts visible without layout break.

- [ ] **Step 2: `deposit.ejs`** — mobile approve/reject as stacked cards (reuse mobile-card pattern); desktop table unchanged in spirit.

- [ ] **Step 3: `transaksi*.ejs`** — show variant label column when `varian_id`/`kode` present.

- [ ] **Step 4: Analitik** — add product-level rollup (sum variants under `produk_id` / product nama) alongside variant-level series. Locate `/api/analitik/products` (or equivalent) and extend response; update chart/table labels.

- [ ] **Step 5: Commit**

```bash
git add views/produk.ejs views/deposit.ejs views/transaksi.ejs views/transaksi-detail.ejs views/analitik.ejs dashboard.js
git commit -m "feat(phase8): polish catalog, deposit mobile, transaksi, analitik rollup"
```

---

### Task 7: Session cookie hygiene

**Files:**
- Modify: `dashboard.js` session config (~lines 61–66)
- Modify: runbook (document `SESSION_SECRET`)

- [ ] **Step 1: Update session**

```js
const sessionSecret = process.env.SESSION_SECRET
if (!sessionSecret && process.env.NODE_ENV === 'production') {
  console.error('FATAL: SESSION_SECRET is required in production')
  process.exit(1)
}
app.use(session({
  secret: sessionSecret || 'dev-only-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.SECURE_COOKIES === 'true' || process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000,
  },
}))
```

Adjust if current options differ — preserve `resave`/`saveUninitialized` behavior already in file.

- [ ] **Step 2: Commit**

```bash
git add dashboard.js docs/runbooks/phase8-dashboard-ia.md
git commit -m "fix(phase8): require SESSION_SECRET in production; secure cookies"
```

---

### Task 8: Expand `inline-edit.js` usage (light) + final verify

**Files:**
- Modify: `public/js/inline-edit.js` (optional toast on error)
- Prefer reusing on tier rows if still raw `fetch` — only if low-risk

- [ ] **Step 1: Keep helper API stable**

```js
async function patchAndSwap(url, body, rowSelector) {
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Accept: 'text/html' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(err || res.statusText)
  }
  const html = await res.text()
  const row = document.querySelector(rowSelector)
  if (row) row.outerHTML = html
}
```

- [ ] **Step 2: Full gates**

```bash
node --test
node --check dashboard.js
rg -n "667eea|764ba2" public/css/dashboard.css | head
# prefer zero or near-zero leftover purple hardcodes
rg -n "partials/layout" views || echo OK
rg -n "include\\('partials/sidebar'\\)" views | wc -l
# expect ~all authenticated pages
```

- [ ] **Step 3: Manual E2E**

1. Desktop: sectioned sidebar, Overview triage, `/stok`, `/pricing`  
2. Mobile width: bottom tabs; More opens drawer  
3. Produk → variant → stok still works  
4. Deposit approve on phone card  
5. Bot flow/copy links from Bot section  
6. Cozy-sky six-step buyer script still green  

- [ ] **Step 4: Mark roadmap Done + PR**

```bash
# set Phase 8 status Done
git add docs/superpowers/plans/2026-08-09-admin-ux-overhaul-roadmap.md docs/runbooks/phase8-dashboard-ia.md
git commit -m "docs(phase8): mark dashboard IA and UI modernization done"
git push -u origin HEAD
```

---

## Spec coverage self-review

| Spec / cozy-sky requirement | Task |
|-----------------------------|------|
| Delete dead `layout.ejs` | 3 |
| Shared topbar + sidebar chrome | 2–3 |
| New nav IA (Catalog/Bot/…) | 2 |
| Mobile bottom tabs | 1–2, 3 |
| Modern professional UI (tokens, fonts, no purple) | 1, 3 |
| Overview triage + fix N+1 | 4 |
| `/stok` + `/pricing` | 5 |
| Rework produk/deposit/transaksi/analitik | 6 |
| Session secure / secret | 7 |
| inline-edit shared helper | 8 |
| Left-alone page bodies | Global |

## Placeholder scan

No TBD. Routes, token values, partial snippets, and test code included. Exact current line numbers in `dashboard.js` drift — use `rg` for session block and `GET /`.

## Type consistency

- `buildOverviewModel` / `summarizeStock` / `pickRecent` names match Task 4 tests and route usage  
- `currentPage` keys: `dashboard`, `stok`, `pricing`, plus existing keys  
- Mobile tab mapping uses the same keys  
