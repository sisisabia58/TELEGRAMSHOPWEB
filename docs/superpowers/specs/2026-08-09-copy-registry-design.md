# Copy Registry screen/msg (Phase 5) — Design Spec

**Date:** 2026-08-09  
**Source:** Admin UX Overhaul roadmap (Phase 5) + Phase 0 `runtime-settings` cache  
**Status:** Draft for plan — decisions locked from roadmap + current `index.js` inventory

## Problem

Buyer-facing Telegram UX copy lives as **hardcoded Markdown template literals** in `index.js` (welcome, product list/card chrome, saldo/cara-order guides, reply keyboard labels, etc.). Admins cannot edit copy without a code deploy. Phase 6 (flow engine) needs stable **`screen_key`** strings and editable screen bodies; Phase 0 already reserved a shared `cache_version` bump for “settings / copy / flow.”

`MessageTemplate` is **admin broadcast/DM only** — bot runtime never reads it. Do not overload it.

## Goal

Introduce a keyed **BotCopy** registry (`screen` + `msg`) editable in the dashboard, loaded by the bot with in-process cache invalidated via existing `runtimeSettings.bump()`, and wire the highest-value **buyer navigation screens** to read from the registry (with code defaults as fallback).

## Non-goals

- Phase 6 flow graph / `FLOW_ENGINE_ENABLED` / writing `BotSession.screen_key` (prep only: stable key names)
- Phase 7 owner command retirement
- Phase 8 dashboard IA overhaul
- Phase 9 **err/btn** — owner CRUD errors and remaining button leftovers after Phase 7
- Migrating every string in `index.js` (YAGNI: inventory + wire navigable buyer screens only)
- Product content (`Produk.deskripsi` / `snk` / `nama`) — already DB-backed
- Channel/CS URLs — already `NotificationSettings` via `runtime-settings`
- Replacing `MessageTemplate` or broadcast UI
- i18n / multi-locale

## Decisions

### D1 — New `BotCopy` table (not NotificationSettings blobs, not MessageTemplate)

```
key          TEXT PRIMARY KEY     -- e.g. screen.welcome, msg.reply_nav_enabled
kind         TEXT NOT NULL        -- 'screen' | 'msg'
body         TEXT NOT NULL        -- Markdown; {{var}} placeholders
description  TEXT                 -- admin hint
variables    JSONB DEFAULT '[]'   -- declared var names for UI (informational)
updated_at   TIMESTAMPTZ
```

RLS + service-role policy matching other tables. `SET search_path TO public, extensions;` in migration.

### D2 — Key naming

| Prefix | Use |
|--------|-----|
| `screen.*` | Full caption / body for a named buyer screen (stable IDs Phase 6 will reuse) |
| `msg.*` | Short standalone messages and **menu chrome labels** used on those screens |

Phase 9 owns `err.*` and residual `btn.*` after command retirement. Phase 5 may still use `msg.menu_*` for welcome/reply keyboard labels (navigational chrome).

**Initial screen keys (must seed + wire):**

| Key | Current home in `index.js` |
|-----|----------------------------|
| `screen.welcome` | `/start` + `kembaliawal` welcome caption |
| `screen.product_list` | `sendProductPage` list chrome |
| `screen.product_card` | `sendProductCard` caption chrome (static wrapper; product fields still interpolated) |
| `screen.qty` | `showVariantQtyScreen` caption |
| `screen.saldo_menu` | Saldo & deposit menu body |
| `screen.cara_order` | Cara order guide |

**Initial msg keys:**

| Key | Use |
|-----|-----|
| `msg.reply_nav_enabled` | “Menu navigasi cepat diaktifkan.” |
| `msg.menu_daftar_produk` | Reply/inline label “📦 Daftar Produk” / “‹📦› Daftar Produk” (one canonical; wire both to same key or two keys if wording differs) |
| `msg.menu_riwayat` | Riwayat Transaksi |
| `msg.menu_kategori` | Kategori Produk |
| `msg.menu_cara_order` | Cara Order |
| `msg.menu_saldo` | Saldo & Deposit |
| `msg.menu_stok` | Stok |
| `msg.menu_channel` | Channel |
| `msg.menu_cs` | Customer Service |
| `msg.btn_perbarui` | Product card “⟳ Perbarui” |
| `msg.btn_kembali` | “← Kembali” chrome on product screens |

Exact seed bodies = today’s Indonesian Markdown, with `{{var}}` for dynamic bits (`first_name`, `nama_bot`, `user_count`, `stok_terjual`, `stok_tersedia`, `saldo`, etc.).

### D3 — Templating

Minimal Mustache-style only:

- `{{name}}` → `String(vars.name ?? '')`
- No conditionals, no loops, no HTML escaping beyond what callers already do
- Pure `render(body, vars)` in `lib/copy.js` — unit tested

### D4 — Load + cache

- `lib/copy.js` holds in-process map `key → body`
- On boot: `copy.refresh()` after `runtimeSettings.refresh(true)`
- When `runtimeSettings.refresh()` detects version change, also `copy.refresh()`
- `copy.get(key, vars, fallback?)` → render(DB body || DEFAULTS[key] || fallback || key)
- Code `DEFAULTS` object mirrors seed so bot works if table empty / migration lag
- Dashboard copy write → `runtimeSettings.bump()` (same shared version; no second version key)

### D5 — Dashboard UX

- New page `/settings/bot-copy` (list by kind, edit body)
- Sidebar under Settings: “Bot Copy”
- Keep EJS + vanilla JS; inline edit or simple form POST/PATCH
- Show declared `variables` as help text; do not invent a visual template builder

### D6 — Wiring scope for this phase

Replace hardcoded strings **only** at:

1. Welcome / home caption (+ menu label lookups where cheap)
2. `generateReplyKeyboard` label strings (saldo cell stays dynamic: use `msg.menu_saldo_with_amount` with `{{saldo}}` or keep amount formatting in code and only localize the “Saldo:” prefix via `msg.menu_saldo_prefix`)
3. `sendProductPage` / `sendProductCard` static chrome
4. `showVariantQtyScreen` caption template
5. Saldo menu + Cara order screens
6. Deduplicate repeated welcome caption sites to one helper `sendWelcomeScreen(chatId, ctx)`

**Leave hardcoded:** owner CRUD errors, deposit QRIS edge cases not listed, purchase completion dumps, voucher edge errors → Phase 9 / later.

### D7 — Migration + seed

Additive migration `20260813000000_bot_copy.sql` + INSERT seed rows matching DEFAULTS. Apply after code deploy (or together; additive table is safe either order if code falls back to DEFAULTS).

## Architecture

```
Dashboard /settings/bot-copy
        │ write BotCopy + bump()
        ▼
NotificationSettings.cache_version
        │ poll (10s)
        ▼
runtimeSettings.refresh() → copy.refresh()
        │
        ▼
index.js  copy.get('screen.welcome', vars)
```

Phase 6 later: flow nodes reference the same `screen.*` keys; `BotSession.screen_key` stores them.

## Success criteria

1. Edit `screen.welcome` in dashboard → within ~10s bot `/start` shows new text (no restart)
2. Empty/missing row → DEFAULTS used; bot does not crash
3. `{{saldo}}` etc. render correctly
4. `node --test` includes `test/copy.test.js` (render + get fallback)
5. Owner CRUD strings unchanged
6. `MessageTemplate` / broadcast unchanged

## Out of scope reminders

- Flow engine graph editor
- err/btn registry
- Translating stock-empty one-liners everywhere
