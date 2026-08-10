# Notification Inbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the annoying stacked popup toasts with a single header notification center (bell icon + dropdown panel) that lists all alerts without blocking page content.

**Architecture:** Add pure `lib/notification-inbox.js` helpers and a `GET /api/notifications/inbox` endpoint that computes current alert state on demand. Stop broadcasting deposit/low-stock floods on SSE connect; SSE only pushes genuinely new events into the inbox panel. Add bell UI to `topbar`, styles in `dashboard.css`, and refactor `notifications.js` into a `NotificationCenter` client. Load the script once from `head.ejs`.

**Tech Stack:** Express + EJS, vanilla JS, SSE (`EventSource`), Supabase (`Deposit`, `Varian`, `NotificationLog`), existing `lib/stock.js`, `node --test`.

**Design spec:** [docs/superpowers/specs/2026-08-10-notification-inbox-design.md](../specs/2026-08-10-notification-inbox-design.md)

## Global Constraints

- Keep EJS + vanilla JS — **no** React/Vue/build step
- Preserve Phase 8 routes and nav IA
- Accent stays teal `#0F766E` — **no** Semrush purple (`#667eea` / `#764ba2`)
- Icons: monochrome line SVG (`stroke="currentColor"`); **no emoji as primary chrome** in bell/panel UI
- Do not change bot/`index.js` checkout or flow runtime
- Tests: pure helpers via `node --test` only; no HTTP/Telegram mocks
- Do not remove `toast` from `ui-utils.js` (form feedback toasts stay separate)
- No new DB migrations
- Bell + panel must meet ≥44px tap targets on mobile

---

## File map

| File | Responsibility |
|------|----------------|
| `lib/notification-inbox.js` | Pure helpers: build inbox items, hrefs, sort, dedupe keys |
| `test/notification-inbox.test.js` | Unit tests for inbox helpers |
| `dashboard.js` | `GET /api/notifications/inbox`; stop SSE connect flood; wire helpers |
| `views/partials/icons.ejs` | Add `i-bell` symbol |
| `views/partials/notification-bell.ejs` | Bell button + dropdown panel markup |
| `views/partials/topbar.ejs` | Include notification bell in right cluster |
| `public/css/dashboard.css` | `.notification-bell`, `.notification-panel`, list item styles |
| `public/js/notifications.js` | Refactor to `NotificationCenter` (no toast stack) |
| `views/partials/head.ejs` | Load `notifications.js` once globally |
| `views/*.ejs` (~24 files) | Remove duplicate `<script src="/js/notifications.js">` |
| `docs/runbooks/phase11-notification-inbox.md` | QA checklist |
| `docs/superpowers/plans/2026-08-09-admin-ux-overhaul-roadmap.md` | Add Phase 11 row |

---

### Task 1: Inbox pure helpers + tests

**Files:**
- Create: `lib/notification-inbox.js`
- Create: `test/notification-inbox.test.js`

**Interfaces:**
- Consumes: nothing (pure)
- Produces:
  - `buildDepositSummaryItem({ count, latestAt })` → inbox item or `null`
  - `buildLowStockItem({ variant, produkId, stokCount, threshold })` → inbox item
  - `getNotificationHref(type, data)` → string URL
  - `sortInboxItems(items)` → sorted array (priority desc, created_at desc)
  - `countActionable(items)` → number

- [ ] **Step 1: Write the failing test**

```javascript
// test/notification-inbox.test.js
const test = require('node:test')
const assert = require('node:assert/strict')
const {
  buildDepositSummaryItem,
  buildLowStockItem,
  getNotificationHref,
  sortInboxItems,
  countActionable,
} = require('../lib/notification-inbox')

test('buildDepositSummaryItem returns null when count is 0', () => {
  assert.strictEqual(buildDepositSummaryItem({ count: 0 }), null)
})

test('buildDepositSummaryItem builds summary row', () => {
  const item = buildDepositSummaryItem({ count: 2, latestAt: '2026-08-10T10:00:00.000Z' })
  assert.strictEqual(item.id, 'deposit-pending')
  assert.strictEqual(item.type, 'deposit_pending')
  assert.strictEqual(item.href, '/deposit?status=pending')
  assert.match(item.message, /2/)
})

test('buildLowStockItem builds variant row with stok link', () => {
  const item = buildLowStockItem({
    variant: { id: 'v1', label: '1 Month', kode: 'spotify-1m', produk: { id: 'p1', nama: 'Spotify' } },
    produkId: 'p1',
    stokCount: 0,
    threshold: 10,
  })
  assert.strictEqual(item.type, 'low_stock')
  assert.strictEqual(item.href, '/produk/p1/varian/v1/stok')
  assert.match(item.message, /0 item/)
})

test('getNotificationHref maps large_transaction to transaksi detail', () => {
  assert.strictEqual(
    getNotificationHref('large_transaction', { trx_uuid: 'abc-123' }),
    '/transaksi/abc-123'
  )
})

test('sortInboxItems orders high priority first', () => {
  const sorted = sortInboxItems([
    { priority: 'medium', created_at: '2026-08-10T12:00:00.000Z' },
    { priority: 'high', created_at: '2026-08-10T11:00:00.000Z' },
  ])
  assert.strictEqual(sorted[0].priority, 'high')
})

test('countActionable returns item length', () => {
  assert.strictEqual(countActionable([{ id: 'a' }, { id: 'b' }]), 2)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/notification-inbox.test.js`
Expected: FAIL with `Cannot find module '../lib/notification-inbox'`

- [ ] **Step 3: Write minimal implementation**

```javascript
// lib/notification-inbox.js
'use strict'

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 }

function buildDepositSummaryItem({ count, latestAt = new Date().toISOString() }) {
  if (!count || count <= 0) return null
  return {
    id: 'deposit-pending',
    type: 'deposit_pending',
    title: 'Deposit pending',
    message: `${count} deposit menunggu review`,
    href: '/deposit?status=pending',
    priority: 'high',
    created_at: latestAt,
    is_read: false,
  }
}

function buildLowStockItem({ variant, produkId, stokCount, threshold }) {
  const produkNama = variant.produk?.nama || 'Produk'
  const pid = produkId || variant.produk?.id
  return {
    id: `low-stock-${variant.id}`,
    type: 'low_stock',
    title: 'Stok menipis',
    message: `${produkNama} — ${variant.label} (${variant.kode}): ${stokCount} item (ambang ${threshold})`,
    href: pid ? `/produk/${pid}/varian/${variant.id}/stok` : '/stok',
    priority: 'high',
    created_at: new Date().toISOString(),
    is_read: false,
    data: {
      varian_id: variant.id,
      varian_kode: variant.kode,
      produk_id: pid,
      stok_count: stokCount,
      threshold,
    },
  }
}

function getNotificationHref(type, data = {}) {
  if (type === 'deposit_pending') return '/deposit?status=pending'
  if (type === 'low_stock' && data.produk_id && data.varian_id) {
    return `/produk/${data.produk_id}/varian/${data.varian_id}/stok`
  }
  if (type === 'large_transaction' && data.trx_uuid) {
    return `/transaksi/${data.trx_uuid}`
  }
  if (type === 'deposit_pending' && data.deposit_id) {
    return `/deposit/${data.deposit_id}`
  }
  return '/'
}

function sortInboxItems(items) {
  return [...items].sort((a, b) => {
    const pr = (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9)
    if (pr !== 0) return pr
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  })
}

function countActionable(items) {
  return items.length
}

module.exports = {
  buildDepositSummaryItem,
  buildLowStockItem,
  getNotificationHref,
  sortInboxItems,
  countActionable,
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/notification-inbox.test.js`
Expected: PASS (6/6)

- [ ] **Step 5: Commit**

```bash
git add lib/notification-inbox.js test/notification-inbox.test.js
git commit -m "feat(phase11): add notification inbox pure helpers"
```

---

### Task 2: Inbox API + stop SSE connect flood

**Files:**
- Modify: `dashboard.js` (notification section ~4960–5276)
- Test: `test/notification-inbox.test.js` (optional integration-style pure test for mapper)

**Interfaces:**
- Consumes: `lib/notification-inbox.js` exports
- Produces: `GET /api/notifications/inbox` JSON shape from design spec; SSE connect no longer calls `broadcastNotification` from deposit/low-stock checks

- [ ] **Step 1: Add require at top of notification section**

```javascript
const inbox = require('./lib/notification-inbox')
```

- [ ] **Step 2: Add `buildNotificationInbox` async helper in `dashboard.js`**

```javascript
async function buildNotificationInbox() {
  const settings = await getNotificationSettings()
  const items = []

  if (settings.depositNotificationEnabled) {
    const { data: deposits, count } = await supabase
      .from('Deposit')
      .select('tanggal', { count: 'exact' })
      .eq('status', 'pending')
      .order('tanggal', { ascending: false })
      .limit(1)

    const summary = inbox.buildDepositSummaryItem({
      count: count || 0,
      latestAt: deposits?.[0]?.tanggal || new Date().toISOString(),
    })
    if (summary) items.push(summary)
  }

  if (settings.stockNotificationEnabled) {
    const { data: variants } = await supabase
      .from('Varian')
      .select('id, label, kode, produk_id, produk:Produk(id, nama)')
      .eq('is_active', true)

    for (const variant of variants || []) {
      const threshold = await getProductStockThreshold(variant.id)
      const stokCount = await stock.getStokCountByVarianId(variant.id)
      if (stokCount !== null && stokCount <= threshold) {
        items.push(inbox.buildLowStockItem({
          variant,
          produkId: variant.produk_id || variant.produk?.id,
          stokCount,
          threshold,
        }))
      }
    }
  }

  if (settings.transactionNotificationEnabled) {
    const { data: logs } = await supabase
      .from('NotificationLog')
      .select('*')
      .eq('notification_type', 'large_transaction')
      .eq('is_read', false)
      .order('created_at', { ascending: false })
      .limit(5)

    for (const log of logs || []) {
      items.push({
        id: log.id,
        type: 'large_transaction',
        title: (log.title || 'Transaksi besar').replace(/^[^\w]+/, '').trim() || 'Transaksi besar',
        message: log.message,
        href: inbox.getNotificationHref('large_transaction', log.data || {}),
        priority: 'medium',
        created_at: log.created_at,
        is_read: false,
        data: log.data,
      })
    }
  }

  const sorted = inbox.sortInboxItems(items)
  return {
    counts: {
      deposit_pending: sorted.filter((i) => i.type === 'deposit_pending').length ? (await supabase.from('Deposit').select('*', { count: 'exact', head: true }).eq('status', 'pending')).count || 0 : 0,
      low_stock: sorted.filter((i) => i.type === 'low_stock').length,
      total: inbox.countActionable(sorted),
    },
    items: sorted,
  }
}
```

> **Note:** For `deposit_pending` count in `counts`, compute once and reuse — avoid double query in final code (extract `pendingCount` variable when building summary).

- [ ] **Step 3: Add route**

```javascript
app.get('/api/notifications/inbox', isAuthenticated, async (req, res) => {
  try {
    const { counts, items } = await buildNotificationInbox()
    res.json({ success: true, counts, items })
  } catch (error) {
    console.error('Error building notification inbox:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})
```

- [ ] **Step 4: Stop SSE connect flood**

In `app.get('/api/notifications/stream', ...)`, **remove**:

```javascript
Promise.all([
  checkDepositPending(),
  checkLowStockAlerts()
]).catch(...)
```

Replace with comment: inbox state is fetched via REST on client load; SSE is for live events only.

- [ ] **Step 5: Refactor `checkDepositPending` / `checkLowStockAlerts`**

These functions must **not** call `broadcastNotification()` when used for periodic/state checks. Options:
- Delete their broadcast calls entirely (inbox API covers state)
- Keep them only for logging if needed, but **never** on SSE connect

`checkNewDeposit` and `checkLargeTransaction` may still `broadcastNotification` for real-time SSE (client adds one row to panel).

- [ ] **Step 6: Strip emoji from server notification titles**

In `checkNewDeposit`, `checkDepositPending`, `checkLowStockAlerts`, `checkLargeTransaction`, change titles to plain text:
- `'Deposit Baru'` / `'Deposit pending'`
- `'Stok menipis'`
- `'Transaksi besar'`

- [ ] **Step 7: Verify syntax + tests**

```bash
node --check dashboard.js
node --test
```

Expected: all tests pass

- [ ] **Step 8: Commit**

```bash
git add dashboard.js
git commit -m "feat(phase11): add inbox API and stop SSE notification flood"
```

---

### Task 3: Bell icon + panel markup + CSS

**Files:**
- Modify: `views/partials/icons.ejs`
- Create: `views/partials/notification-bell.ejs`
- Modify: `views/partials/topbar.ejs`
- Modify: `public/css/dashboard.css`

**Interfaces:**
- Consumes: `#i-bell` sprite, topbar layout
- Produces: static bell/panel DOM scaffold; JS hooks via ids `notificationBell`, `notificationPanel`, `notificationList`, `notificationBadge`, `notificationEmpty`

- [ ] **Step 1: Add bell symbol to `icons.ejs`**

```html
<symbol id="i-bell" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/>
  <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
</symbol>
```

- [ ] **Step 2: Create `notification-bell.ejs`**

```html
<%# views/partials/notification-bell.ejs %>
<div class="notification-center" id="notificationCenter">
  <button type="button" class="notification-bell" id="notificationBell" aria-label="Notifikasi" aria-expanded="false" aria-controls="notificationPanel">
    <svg class="icon" aria-hidden="true"><use href="#i-bell"></use></svg>
    <span class="notification-badge" id="notificationBadge" hidden>0</span>
  </button>
  <div class="notification-panel" id="notificationPanel" role="region" aria-label="Daftar notifikasi" hidden>
    <div class="notification-panel-header">
      <strong>Notifikasi</strong>
      <button type="button" class="notification-mark-all" id="notificationMarkAll">Tandai dibaca</button>
    </div>
    <div class="notification-panel-body">
      <p class="notification-empty" id="notificationEmpty">Tidak ada notifikasi</p>
      <ul class="notification-list" id="notificationList"></ul>
    </div>
    <div class="notification-panel-footer">
      <a href="/settings/notifications">Pengaturan notifikasi</a>
    </div>
  </div>
</div>
```

- [ ] **Step 3: Wire into `topbar.ejs`**

Insert before `.user-info` in `.top-bar-right`:

```html
<%- include('partials/notification-bell') %>
```

- [ ] **Step 4: Add CSS to `dashboard.css`**

```css
.notification-center { position: relative; }
.notification-bell {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  background: var(--color-surface);
  color: var(--color-muted);
  cursor: pointer;
}
.notification-bell:hover,
.notification-bell[aria-expanded="true"] {
  color: var(--color-accent);
  border-color: var(--color-accent);
  background: var(--color-accent-soft);
}
.notification-badge {
  position: absolute;
  top: 4px;
  right: 4px;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--color-danger);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  line-height: 18px;
  text-align: center;
}
.notification-panel {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  width: min(360px, calc(100vw - 24px));
  max-height: 420px;
  display: flex;
  flex-direction: column;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  z-index: 1200;
}
.notification-panel-header,
.notification-panel-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid var(--color-border);
}
.notification-panel-footer { border-bottom: 0; border-top: 1px solid var(--color-border); font-size: 13px; }
.notification-panel-body { overflow: auto; padding: 8px 0; }
.notification-list { list-style: none; margin: 0; padding: 0; }
.notification-item { border-bottom: 1px solid var(--color-border); }
.notification-item:last-child { border-bottom: 0; }
.notification-item a {
  display: block;
  padding: 12px 14px;
  color: inherit;
  text-decoration: none;
}
.notification-item a:hover { background: var(--color-surface-muted); }
.notification-item-title { font-weight: 600; font-size: 14px; margin-bottom: 4px; }
.notification-item-message { font-size: 13px; color: var(--color-muted); }
.notification-item--deposit_pending { border-left: 3px solid var(--color-accent); }
.notification-item--low_stock { border-left: 3px solid var(--color-warning); }
.notification-item--large_transaction { border-left: 3px solid var(--color-success); }
.notification-empty { margin: 16px 14px; color: var(--color-muted); font-size: 14px; }
.notification-mark-all {
  border: 0;
  background: none;
  color: var(--color-link);
  font-size: 13px;
  cursor: pointer;
}
@media (max-width: 768px) {
  .notification-panel {
    position: fixed;
    top: calc(var(--topbar-height, 64px) + 8px);
    right: 12px;
    left: 12px;
    width: auto;
  }
}
```

- [ ] **Step 5: Commit**

```bash
git add views/partials/icons.ejs views/partials/notification-bell.ejs views/partials/topbar.ejs public/css/dashboard.css
git commit -m "feat(phase11): add notification bell and panel chrome"
```

---

### Task 4: Refactor `notifications.js` client

**Files:**
- Modify: `public/js/notifications.js`

**Interfaces:**
- Consumes: DOM ids from Task 3; `GET /api/notifications/inbox`; existing `/api/notifications/counts`; SSE `/api/notifications/stream`; `/api/notifications/read-all`
- Produces: `NotificationCenter` singleton; **no** `#notification-container` toast stack

- [ ] **Step 1: Remove toast container code**

Delete `createNotificationContainer()`, `showInAppNotification()`, and inline `slideIn`/`slideOut` style injection.

- [ ] **Step 2: Implement core methods**

```javascript
class NotificationCenter {
  constructor() {
    this.items = []
    this.panelOpen = false
    this.els = {
      bell: document.getElementById('notificationBell'),
      panel: document.getElementById('notificationPanel'),
      list: document.getElementById('notificationList'),
      badge: document.getElementById('notificationBadge'),
      empty: document.getElementById('notificationEmpty'),
      markAll: document.getElementById('notificationMarkAll'),
    }
    if (!this.els.bell) return // pages without topbar
    this.bindUi()
    this.loadInbox()
    this.connectSSE()
    this.loadNotificationCounts()
    setInterval(() => this.loadNotificationCounts(), 30000)
  }

  async loadInbox() {
    const res = await fetch('/api/notifications/inbox')
    const data = await res.json()
    if (!data.success) return
    this.items = data.items || []
    this.render()
    this.updateHeaderBadge(data.counts?.total || 0)
  }

  render() {
    const { list, empty } = this.els
    list.innerHTML = ''
    if (!this.items.length) {
      empty.hidden = false
      return
    }
    empty.hidden = true
    for (const item of this.items) {
      const li = document.createElement('li')
      li.className = `notification-item notification-item--${item.type}`
      li.innerHTML = `<a href="${item.href}"><div class="notification-item-title">${item.title}</div><div class="notification-item-message">${item.message}</div></a>`
      list.appendChild(li)
    }
  }

  handleLiveNotification(notification) {
    if (!notification || notification.type === 'connected') return
    const href = this.hrefFor(notification)
    const row = {
      id: notification.data?.deposit_id || notification.data?.trx_uuid || notification.data?.varian_id || Date.now(),
      type: notification.type,
      title: notification.title,
      message: notification.message,
      href,
      priority: notification.priority || 'medium',
      created_at: notification.timestamp || new Date().toISOString(),
    }
    this.items = [row, ...this.items.filter((i) => i.id !== row.id)].slice(0, 50)
    this.render()
    this.updateHeaderBadge(this.items.length)
    // optional browser notification unchanged
  }

  togglePanel(open) {
    this.panelOpen = open ?? !this.panelOpen
    this.els.panel.hidden = !this.panelOpen
    this.els.bell.setAttribute('aria-expanded', String(this.panelOpen))
  }
}
```

Implement `bindUi` (bell click, outside click, Escape), `hrefFor` (mirror server mapping), `updateHeaderBadge`, `loadNotificationCounts` (sidebar badges), `connectSSE` (call `handleLiveNotification` instead of toast).

- [ ] **Step 3: Manual smoke (code path)**

Confirm `notifications.js` no longer references `notification-container` or `notification-toast`:

```bash
rg -n "notification-container|notification-toast|showInAppNotification" public/js/notifications.js || echo OK
```

Expected: OK

- [ ] **Step 4: Commit**

```bash
git add public/js/notifications.js
git commit -m "feat(phase11): notification center client replaces toast stack"
```

---

### Task 5: Load script globally + remove duplicates

**Files:**
- Modify: `views/partials/head.ejs`
- Modify: all `views/*.ejs` that include `<script src="/js/notifications.js"></script>`

**Interfaces:**
- Consumes: Task 4 client
- Produces: single script load on every authenticated page with `head.ejs`

- [ ] **Step 1: Add to `head.ejs`**

After `nav.js` line:

```html
<script src="/js/notifications.js" defer></script>
```

- [ ] **Step 2: Remove per-page script tags**

```bash
rg -l "notifications\\.js" views --glob "*.ejs" | grep -v partials
```

Remove `<script src="/js/notifications.js"></script>` from each matched view (24 files). **Do not** remove from `head.ejs`.

- [ ] **Step 3: Verify only one include remains**

```bash
rg -n "notifications\\.js" views
```

Expected: only `views/partials/head.ejs`

- [ ] **Step 4: Commit**

```bash
git add views/partials/head.ejs views/
git commit -m "chore(phase11): load notifications.js once from head partial"
```

---

### Task 6: Verify + roadmap + runbook

**Files:**
- Create: `docs/runbooks/phase11-notification-inbox.md`
- Modify: `docs/superpowers/plans/2026-08-09-admin-ux-overhaul-roadmap.md`

- [ ] **Step 1: Gates**

```bash
node --test
node --check dashboard.js
rg -n "notification-container|showInAppNotification" public/js || echo OK
rg -n "667eea|764ba2" views public/css || echo OK
rg -n "notificationBell|notification-panel" views public/css | head
```

Expected: tests pass; no toast stack code; no purple; bell markup present

- [ ] **Step 2: Document manual QA in runbook**

`docs/runbooks/phase11-notification-inbox.md` must include:
- Open `/voucher` (or any page) with pending deposits + low stock → **no auto toasts**
- Bell shows badge count; click opens single panel with all items
- Click deposit row → navigates to `/deposit?status=pending`
- Click low-stock row → navigates to variant stok page
- SSE: trigger new deposit (sandbox) → one new row appears in panel, not toast stack
- Mobile ≤768px: bell tappable, panel fits viewport

- [ ] **Step 3: Mark roadmap**

Add row:

```markdown
| 11 — Notification inbox (bell panel) | [2026-08-10-notification-inbox.md](./2026-08-10-notification-inbox.md) | **Done** |
```

(Set **Not started** until this task completes, then flip to **Done**.)

- [ ] **Step 4: Commit + push**

```bash
git add docs/runbooks/phase11-notification-inbox.md docs/superpowers/plans/2026-08-09-admin-ux-overhaul-roadmap.md
git commit -m "docs(phase11): notification inbox runbook and roadmap"
git push -u origin HEAD
```

---

## Spec coverage self-review

| Spec decision | Task |
|---------------|------|
| Bell in topbar | 3 |
| Single panel, no toast stack | 4 |
| Inbox API (deposit summary + low stock rows) | 1, 2 |
| Stop SSE connect flood | 2 |
| SSE live events → panel prepend | 4 |
| Monochrome bell SVG, no emoji chrome | 3 |
| Teal tokens, no purple | 3 |
| Keep form toasts (`ui-utils`) | Global (untouched) |
| Sidebar nav badges preserved | 4 |
| Success criteria / gates | 6 |

## Placeholder scan

No TBD. API shape, CSS classes, DOM ids, test code, grep gates, and commit messages included.

## Type consistency

- Inbox item fields: `id`, `type`, `title`, `message`, `href`, `priority`, `created_at`, `is_read`, optional `data`
- Types: `deposit_pending`, `low_stock`, `large_transaction`, `system`
- DOM ids: `notificationBell`, `notificationPanel`, `notificationList`, `notificationBadge`, `notificationEmpty`, `notificationMarkAll`
- Icon id: `i-bell`
- CSS classes: `notification-center`, `notification-bell`, `notification-panel`, `notification-item`, `notification-item--{type}`
