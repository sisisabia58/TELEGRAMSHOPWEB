# Phase 11 — Notification inbox (bell panel)

## Deploy

1. Merge → Railway deploys; hard-refresh dashboard pages.
2. Confirm `notifications.js` loads once from `views/partials/head.ejs`.

## Automated gates (Task 6 — 2026-08-10)

**Unit tests** — PASS 77/77

```bash
node --test
```

**Syntax** — PASS

```bash
node --check dashboard.js
```

**No toast stack** — OK (no matches for legacy popup container / `showInAppNotification`)

```bash
rg -n "notification-container|showInAppNotification" public/js || echo OK
```

**Purple purge** — OK (no matches)

```bash
rg -n "667eea|764ba2" views public/css || echo OK
```

**Bell markup present** — OK (`notificationBell`, `notification-panel` in partial + CSS)

```bash
rg -n "notificationBell|notification-panel" views public/css | head
```

## Manual QA checklist

> No headless Chrome in CI. Run these checks in a real browser after deploy (or local dev with pending deposits + low-stock fixtures).

### No auto toasts on load

1. Open `/voucher` (or any authenticated page) when there are **pending deposits** and **low-stock variants**.
2. Confirm **no stacked popup toasts** appear on page load.
3. Alerts should only appear inside the bell panel after you click the bell.

### Bell badge + single panel

1. Bell icon (`#notificationBell`) shows a badge (`#notificationBadge`) with the actionable item count.
2. Click the bell — one dropdown panel (`#notificationPanel`) opens with **all** inbox items listed (`#notificationList`).
3. Empty state (`#notificationEmpty`) shows when there are no actionable items.
4. “Mark all read” (`#notificationMarkAll`) clears unread styling when applicable.

### Row navigation

1. Click a **deposit pending** summary row → navigates to `/deposit?status=pending`.
2. Click a **low stock** row → navigates to the variant stok page (`/produk/:id/stok` or equivalent `href` from inbox API).

### SSE live prepend (sandbox)

1. With the panel open (or closed — badge should update), trigger a **new deposit** in sandbox/test.
2. Confirm **one new row** is prepended to the panel list — **not** a toast stack.
3. Badge count increments; no duplicate SSE connect flood on refresh.

### Mobile ≤768px

1. Resize viewport to ≤768px (or use device toolbar).
2. Bell is tappable (≥44px target); panel fits viewport without horizontal overflow.
3. Panel scrolls inside `.notification-panel-body` if the list is long.

### Regression checks

- Sidebar nav badges (deposit / stok counts) still work — unchanged from Phase 8.
- Form feedback toasts via `ui-utils.js` still work on save/error flows (separate from inbox).
