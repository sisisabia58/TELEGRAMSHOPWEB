# Notification Inbox — Design Spec

**Date:** 2026-08-10  
**Status:** Approved for implementation  
**Related:** Phase 10 dashboard chrome (`topbar`, monochrome SVG icons, teal tokens)

## Problem

Real-time alerts use a fixed top-right toast stack (`public/js/notifications.js`). On every page load the SSE client connects and the server **broadcasts one toast per low-stock variant** plus a deposit summary — easily 8+ overlapping cards that block page content (see voucher page screenshot).

## Goal

Replace the toast stack with a **standard header notification center**: bell icon in the top bar, badge count, single dropdown/panel listing all alerts. No auto-popup stack on connect.

## Non-goals

- Do not remove `toast` from `ui-utils.js` (form save success/error feedback stays)
- Do not change bot/`index.js` runtime
- Do not add React/build step
- Do not change Notification Settings toggles semantics (deposit/stock/transaction enable flags stay)
- No new DB migrations (reuse `NotificationLog`, `Deposit`, `Varian`, stock helpers)

## UX

| Element | Behavior |
|---------|----------|
| Bell button | In `topbar` right cluster, before user info; monochrome `#i-bell` SVG |
| Badge | Red pill with total actionable count (deposit pending + low stock); hidden when 0 |
| Panel | Click bell toggles dropdown (~360px wide, max-height scroll); click outside / Escape closes |
| List item | Title, message, relative time; click navigates to action URL and marks read if log-backed |
| Empty state | "Tidak ada notifikasi" when inbox empty |
| Real-time | SSE prepends **one** new item to panel + updates badge; **no** toast popup |
| Sidebar badges | Keep existing deposit/stock nav badges (fed from same counts API) |
| Browser notifications | Still optional via settings; unchanged permission flow |

## Architecture

```
Page load → GET /api/notifications/inbox → render panel + badge
SSE connect → { type: 'connected' } only (no broadcast flood)
New deposit/transaction → SSE event → prepend to panel + bump badge
```

**Root fix:** `checkDepositPending()` / `checkLowStockAlerts()` on SSE connect must **not** call `broadcastNotification()`. Inbox state is computed on demand via REST.

## API

### `GET /api/notifications/inbox`

```json
{
  "success": true,
  "counts": {
    "deposit_pending": 2,
    "low_stock": 7,
    "total": 9
  },
  "items": [
    {
      "id": "deposit-pending",
      "type": "deposit_pending",
      "title": "Deposit pending",
      "message": "2 deposit menunggu review",
      "href": "/deposit?status=pending",
      "priority": "high",
      "created_at": "2026-08-10T12:00:00.000Z",
      "is_read": false
    },
    {
      "id": "low-stock-<varian_uuid>",
      "type": "low_stock",
      "title": "Stok menipis",
      "message": "Spotify — 1 Month (spotify-1m): 0 item",
      "href": "/produk/<produk_id>/varian/<varian_id>/stok",
      "priority": "high",
      "created_at": "2026-08-10T12:00:00.000Z",
      "is_read": false,
      "data": { "varian_id": "...", "stok_count": 0 }
    }
  ]
}
```

- Deposit: **one** summary row when `count > 0` (not one per deposit on connect)
- Low stock: **one row per variant** at or below threshold (settings respected)
- Large transaction: recent unread rows from `NotificationLog` (limit 5)
- Titles: **no emoji** in chrome (plain text; matches Phase 10 icon rules)

## Visual

- Use existing tokens: `--color-accent`, `--color-surface`, `--color-border`, `--shadow`, `--radius`
- Panel: white card, soft shadow, `z-index` above content but below modals
- Item left border color by type: deposit `#0D9488`, low_stock `#D97706`, large_transaction `#059669`
- Mobile: panel anchors to viewport right edge; min 44px bell tap target

## Success criteria

1. Opening any admin page shows **zero** auto-popup toasts for existing alerts
2. Bell badge reflects total actionable count
3. Panel lists all deposit + low-stock + recent large-transaction alerts in one scrollable view
4. SSE reconnect does not re-flood toasts
5. `node --test` green; purple/emoji chrome rules preserved in new UI
