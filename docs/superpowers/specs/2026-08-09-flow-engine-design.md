# Flow Engine (Phase 6) — Design Spec

**Date:** 2026-08-09  
**Source:** Admin UX Overhaul roadmap (Phase 6) + Phase 1 `BotSession` prep + Phase 5 `BotCopy` screen keys  
**Status:** Draft for plan — decisions locked from roadmap

## Problem

Buyer navigation (welcome menu, saldo, cara-order, kategori entry, “kembali”) is an imperative if-chain of `callback_data` strings in `index.js`. Admins cannot reorder menus, retarget buttons, or add a static info screen without a code deploy. Phase 5 made **copy** editable via `BotCopy`; Phase 6 makes **navigation structure** editable via a flow graph, while leaving transactional checkout code in place.

`BotSession` already reserves `screen_key`, `nav_stack`, and `banner_msg_id` (unused). Roadmap locks: **flow builder = navigation only**; transactional steps stay as **code action nodes**; use a **`FLOW_ENGINE_ENABLED` kill switch**.

## Goal

Ship a dashboard-editable navigation graph (`BotFlow` + `BotFlowNode`) that the bot can execute when enabled: screen nodes render `BotCopy` captions + keyboard edges; action nodes invoke existing `index.js` helpers (`sendProductPage`, `sendProductCard`, checkout qty, stok, riwayat, etc.). Persist the user’s current screen on `BotSession`. Keep a kill switch so production can fall back to today’s if-chain instantly.

## Non-goals

- Phase 7 owner slash-command retirement (`/addproduk`, `/addstok` interactive wizards, etc.)
- Phase 8 dashboard IA / mobile layout overhaul
- Phase 9 `err` / residual `btn` copy registry
- Replacing checkout / QRIS / saldo payment / voucher logic with a visual workflow
- Full visual graph canvas (drag nodes on a canvas) — keep EJS form editor
- Multi-flow A/B experiments or per-user flow assignment
- Conditionals / loops / expressions in the graph (no “if saldo > 0”)
- Migrating `Database/Trx/temp_*.json` QRIS bridging (separate hygiene; out of Phase 6 success criteria)
- Inventing a second cache-version key

## Decisions

### D1 — Two node kinds only: `screen` | `action`

| Kind | Behavior |
|------|----------|
| `screen` | Render `copy.get(node.screen_key, vars)` as banner caption; attach inline keyboard from `node.buttons`; set `BotSession.screen_key = node.key` |
| `action` | Do **not** render from BotCopy. Return a typed action for `index.js` to run existing code (`product_list`, `product_card`, `qty`, `kategori_menu`, `stok`, `riwayat`, `deposit_menu`, …). Action nodes may still update `screen_key` for analytics/back-stack |

Transactional purchase steps (qty adjust, bayar, QRIS poll, deliver) remain **outside** the editable graph — they stay as today’s handlers. The graph only **enters** those flows via action nodes / existing `p:` / `v:` callbacks.

### D2 — Schema

Single active flow (YAGNI: one row `is_active = true`).

```
BotFlow
  id           UUID PK
  name         TEXT NOT NULL
  is_active    BOOLEAN NOT NULL DEFAULT false
  entry_key    TEXT NOT NULL          -- node key for /start and kembaliawal
  created_at   TIMESTAMPTZ
  updated_at   TIMESTAMPTZ

BotFlowNode
  id           UUID PK
  flow_id      UUID NOT NULL REFERENCES BotFlow(id) ON DELETE CASCADE
  key          TEXT NOT NULL         -- stable id: welcome, saldo_menu, product_list, …
  kind         TEXT NOT NULL CHECK (kind IN ('screen', 'action'))
  screen_key   TEXT                  -- BotCopy key when kind=screen (e.g. screen.welcome)
  action       TEXT                  -- handler name when kind=action (see D4)
  buttons      JSONB NOT NULL DEFAULT '[]'::jsonb
  description  TEXT
  updated_at   TIMESTAMPTZ
  UNIQUE (flow_id, key)
```

**`buttons` shape** (2D array = Telegram keyboard rows):

```json
[
  [{ "label_key": "msg.menu_daftar_produk", "go": "product_list" }],
  [
    { "label_key": "msg.menu_riwayat", "go": "riwayat" },
    { "label_key": "msg.menu_cara_order", "go": "cara_order" }
  ],
  [{ "label_key": "msg.menu_channel", "url_from": "channel_store" }]
]
```

Button fields:

| Field | Meaning |
|-------|---------|
| `label_key` | `BotCopy` `msg.*` key for button text (preferred) |
| `label` | Literal fallback if `label_key` missing |
| `go` | Target **node key** (callback `f:<nodeKey>`) |
| `url_from` | Resolve URL from `runtimeSettings` / channelContact: `channel_store` \| `cs` |
| `url` | Literal URL (rare; prefer `url_from`) |
| `callback` | Escape hatch: raw `callback_data` for legacy paths still owned by code (`deposit_menu`, `caraorder_faq`, …) — max 64 bytes |

Exactly one of `go` | `url_from` | `url` | `callback` must be set per button.

RLS + service-role policy. Migrations prepend `SET search_path TO public, extensions;`.

### D3 — Callback protocol

| Pattern | Owner |
|---------|--------|
| `f:<nodeKey>` | Flow engine goto (new) |
| `p:`, `v:`, `p_refresh:`, `produk_*`, cart/checkout cmds | Existing code (unchanged) |
| Legacy menu callbacks (`daftarproduk`, `saldomenu`, `caraorder`, `kembaliawal`, …) | When engine **on**: map to node keys via seed `legacy_aliases`; when engine **off**: today’s if-chain |

Seed each navigable screen/action with `key` matching a clear name. Engine registers aliases so old inline messages keep working after deploy:

```
daftarproduk → product_list
saldomenu → saldo_menu
caraorder → cara_order
kembaliawal → welcome
kategori_menu → kategori_menu
stok → stok
riwayattransaksi → riwayat
```

### D4 — Built-in action registry (code, not DB)

`lib/flow.js` exports `ACTIONS` allowlist. Dashboard can only set `action` to these strings. Unknown action → log + stay on current screen.

| `action` | Invokes (existing helpers) |
|----------|----------------------------|
| `product_list` | `sendProductPage(...)` |
| `product_card` | `sendProductCard(...)` — entered via `p:` still; optional |
| `kategori_menu` | Existing kategori picker handler body |
| `stok` | Existing stok report for buyer |
| `riwayat` | Existing riwayattransaksi handler |
| `deposit_menu` | Existing deposit_menu handler |
| `noop` | No-op (placeholder) |

Qty / checkout are **not** flow actions in Phase 6 — still reached via `v:` / cart callbacks.

### D5 — Session helpers (`lib/session.js`)

Thin wrapper on `BotSession` **without** touching `cart` (cart stays `lib/cart.js`):

```
getNav(userId) → { screen_key, nav_stack, banner_msg_id }
setScreen(userId, screenKey, { push?: boolean }) → boolean
setBanner(userId, messageId) → boolean
popScreen(userId) → string|null   // previous key or null
```

Rules:

- `setScreen(..., { push: true })` appends previous `screen_key` to `nav_stack` (cap 20)
- `kembaliawal` / entry: `setScreen('welcome', { push: false })` and clear `nav_stack` to `[]`
- `cart.clear` already preserves nav columns — do not change that contract

### D6 — Engine API (`lib/flow.js`)

```
refresh() → Promise<boolean>     // load active BotFlow + nodes into cache
isEnabled() → boolean            // kill switch
getEntryKey() → string
getNode(key) → node|null
legacyToKey(callback) → key|null
buildKeyboard(node) → Telegram reply_markup
async goto(userId, nodeKey, ctx) → FlowResult
```

`FlowResult`:

```
{ type: 'screen', node, caption, reply_markup }
| { type: 'action', node, action, reply_markup? }
| { type: 'error', message }
```

`ctx` supplies template vars for screen captions (`first_name`, `saldo`, …) — same vars Phase 5 welcome uses. Engine calls `copy.get(node.screen_key, ctx.vars)`.

Cache invalidation: on `runtimeSettings` version change, also `flow.refresh()` (same pattern as `copy.refresh()`). Dashboard flow writes call `runtimeSettings.bump()`.

### D7 — Kill switch

Setting key in `NotificationSettings`:

- `flow_engine_enabled` → `{ value: true|false }`, default **false** until admin enables after verify

Also accept env `FLOW_ENGINE_ENABLED=true` as hard override for local/dev (env wins if set).

When disabled: `index.js` keeps current welcome/menu if-chain (Phase 5 copy still used). When enabled: `/start`, `kembaliawal`, and legacy menu callbacks + `f:*` dispatch through `flow.goto`.

### D8 — Seed graph (mirrors today’s welcome)

Active flow `default` with `entry_key = welcome`:

| key | kind | screen_key / action | buttons (summary) |
|-----|------|---------------------|-------------------|
| `welcome` | screen | `screen.welcome` | daftar produk, kategori, riwayat+cara order, saldo+stok, channel URL, CS URL |
| `saldo_menu` | screen | `screen.saldo_menu` | deposit_menu (callback), riwayatdeposit (callback), welcome |
| `cara_order` | screen | `screen.cara_order` | product_list, saldo_menu, welcome (+ keep FAQ/payment as `callback` escapes) |
| `product_list` | action | `product_list` | _(keyboard built by existing sendProductPage)_ |
| `kategori_menu` | action | `kategori_menu` | _(existing)_ |
| `stok` | action | `stok` | _(existing)_ |
| `riwayat` | action | `riwayat` | _(existing)_ |

Product card / qty remain code-driven (`p:` / `v:`); not seeded as flow nodes in Phase 6 (YAGNI). Phase 5 already templates their chrome via BotCopy.

### D9 — Dashboard UX

- Page `/settings/bot-flow`
- Toggle “Flow engine enabled”
- List nodes (key, kind, screen_key/action)
- Edit one node: description, screen_key or action select, buttons editor (JSON textarea is OK for Phase 6; validate shape server-side)
- Save → upsert node + `bump()`
- Sidebar: “Bot Flow” under Settings
- Keep EJS + vanilla JS; no React flow canvas

### D10 — Reply keyboard

Phase 6 leaves `generateReplyKeyboard` as today (copy-driven labels). Reply-text handlers stay string-matched. Optional follow-up: store reply-keyboard template on `BotFlow` — **out of scope** unless needed for parity testing.

## Architecture

```
Dashboard /settings/bot-flow
        │ write BotFlowNode + flow_engine_enabled + bump()
        ▼
NotificationSettings.cache_version
        │ poll (~10s)
        ▼
runtimeSettings.refresh() → copy.refresh() + flow.refresh()
        │
        ▼
index.js  if flow.isEnabled(): flow.goto(...)
          else: legacy if-chain (Phase 5 copy.get still used)
        │
        ▼
BotSession.screen_key / nav_stack / banner_msg_id
```

## Success criteria

1. With engine **off**, bot behavior matches Phase 5 (no regression)
2. With engine **on**, `/start` renders `screen.welcome` via seeded welcome node; menu buttons use `f:<key>` (or aliased legacy)
3. Edit welcome button target in dashboard → within ~10s bot reflects change (no restart)
4. Action node `product_list` still opens the real product list
5. Checkout path `v:` → qty → bayar unchanged
6. `node --test` covers pure flow resolve / keyboard build / session nav stack (mocked supabase)
7. `MessageTemplate`, owner CRUD, Phase 5 BotCopy page unchanged in purpose

## Out of scope reminders

- Visual graph builder
- Conditional edges
- Retiring owner commands (Phase 7)
- err/btn registry (Phase 9)
