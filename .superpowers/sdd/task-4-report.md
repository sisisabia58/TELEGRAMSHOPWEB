# Task 4 Report: Refactor notifications.js client

## Status

**Complete**

## Branch

`cursor/phase11-notification-inbox-5789`

## Commit

- `cc6c424` — `feat(phase11): notification center client replaces toast stack`

## Summary

Replaced `NotificationManager` toast stack with `NotificationCenter` bell-panel client.

### Removed

- `createNotificationContainer()` — fixed `#notification-container` DOM injection
- `showInAppNotification()` — toast cards with inline styles
- `slideIn` / `slideOut` keyframe style injection
- `getNotificationColor()` — only used by toasts
- `updateBadge()` — per-SSE sidebar increment (counts API handles sidebar)

### Added / kept

| Method | Behavior |
|--------|----------|
| `loadInbox` | `GET /api/notifications/inbox` → `items`, `render()`, `updateHeaderBadge(counts.total)` |
| `render` | Populates `#notificationList` with Task 3 DOM ids; toggles `#notificationEmpty` |
| `handleLiveNotification` | Prepends SSE row (no toast); optional browser `Notification` when granted |
| `hrefFor` | Mirrors `lib/notification-inbox.js` `getNotificationHref` mapping |
| `togglePanel` | Toggles `#notificationPanel` hidden + `aria-expanded` on bell |
| `bindUi` | Bell click, outside click, Escape, mark-all → `POST /api/notifications/read-all` |
| `updateHeaderBadge` | Shows/hides `#notificationBadge` from total count |
| `loadNotificationCounts` | Sidebar deposit/stock badges via `/api/notifications/counts` (30s poll) |
| `connectSSE` | `/api/notifications/stream` → `handleLiveNotification` |
| Browser permission | Unchanged `Notification.requestPermission()` on load |

## Verification

```bash
rg -n "notification-container|notification-toast|showInAppNotification" public/js/notifications.js || echo OK
# OK

node --check public/js/notifications.js
# exit 0
```

## Concerns

1. **`hrefFor` deposit detail path** — Server `getNotificationHref` returns `/deposit?status=pending` for all `deposit_pending` before the `deposit_id` branch; live SSE deposit events therefore link to the pending list, not `/deposit/:id`. Matches server; change both if per-deposit links are desired.
2. **Live badge count** — `handleLiveNotification` sets badge to `this.items.length` (capped list), not `counts.total` from API. May diverge briefly until next `loadInbox` / page refresh.
3. **Task 5 dependency** — Script still loaded per-page until `head.ejs` global include (Task 5); pages without topbar bail early (`!this.els.bell`).

## Files changed

- `public/js/notifications.js`
