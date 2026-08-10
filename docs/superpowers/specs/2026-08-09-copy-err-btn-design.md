# Copy Registry err/btn (Phase 9) — Design Spec

**Date:** 2026-08-10  
**Source:** Admin UX Overhaul roadmap (Phase 9) + Phase 5 `BotCopy` + Phase 7 command retirement leftover strings  
**Status:** Ready for plan — decisions locked below

## Problem

Phase 5 put buyer **screen** and **msg** chrome into `BotCopy`. After Phase 7, owner CRUD wizards are gone from the bot, but **buyer errors**, **deposit/voucher/checkout failures**, and **many inline keyboard labels** remain hardcoded Indonesian template literals in `index.js` (and `retiredOwnerHelpText` in `lib/retired-commands.js`). Admins still need a deploy to change tone, typos, or dashboard pointers in those strings.

## Goal

Extend the existing `BotCopy` registry with kinds **`err`** and **`btn`**, seed a curated set of high-value keys (with code `DEFAULTS` fallback), wire bot call sites to `copy.get`, and add light dashboard filtering so ~70+ rows stay scannable.

## Non-goals

- New table or second cache version key
- Migrating every string in `index.js` (~420 error-pattern matches)
- Renaming Phase 5 `msg.btn_perbarui` / `msg.btn_kembali` (keep as-is for flow seeds)
- Success / completion templates (`PESANAN BERHASIL`, `DEPOSIT BERHASIL`, gamification)
- Channel / feed / English log copy
- Full-screen wizards not already `screen.*` (`KONFIRMASI PESANAN` body, FAQ blocks, `/rekap` chrome) — future `screen.*` pass
- i18n / multi-locale
- Changing MessageTemplate / broadcast
- Touching Product / Deposit / Voucher / Trx schemas

## Decisions

### D1 — Same `BotCopy` table; extend kind CHECK

```sql
ALTER TABLE "BotCopy" DROP CONSTRAINT IF EXISTS "BotCopy_kind_check";
ALTER TABLE "BotCopy" ADD CONSTRAINT "BotCopy_kind_check"
  CHECK (kind IN ('screen', 'msg', 'err', 'btn'));
```

Runtime `lib/copy.js` already keys only on `key` — no API change required beyond new `DEFAULTS` entries.

Migration name: `20260816000000_bot_copy_err_btn.sql` (additive; prepend `SET search_path TO public, extensions;`).

### D2 — Key naming

| Prefix | Use |
|--------|-----|
| `err.*` | Buyer-facing errors, validation failures, empty states, short callback toasts for the same semantic |
| `btn.*` | Residual inline keyboard **labels** not already covered by `msg.menu_*` or `msg.btn_*` |

**Do not** migrate `msg.btn_perbarui` / `msg.btn_kembali` to `btn.*` in this phase.

### D3 — Dedup before seed

Consolidate duplicate Indonesian variants to **one key** (pick the clearest Markdown body):

| Semantic | Canonical key |
|----------|---------------|
| Cart/session lost | `err.cart_session_lost` |
| Product missing | `err.product_not_found` |
| Stock empty / insufficient | `err.stock_empty`, `err.stock_insufficient` (`{{count}}`, `{{nama}}`) |
| Saldo short | `err.saldo_insufficient` |
| QRIS/payment config | `err.deposit_qris_not_configured`, `err.deposit_verify_not_configured` |
| Voucher failures | `err.voucher_*` (see seed list in plan) |

**Toast vs full message:** Prefer **one key** when the toast is a short form of the same meaning. Use a separate `err.toast_*` key only when the toast is materially different (progress/ack vs error body).

### D4 — Curated scope (must ship)

**Errors (~35–40 keys):** cart/product load, stock (empty/insufficient/selection), saldo, deposit QRIS/create/expire/cancel/invalid amount, voucher block + common toasts, riwayat access, owner-only + retired-command help, empty catalog/txn/user lists used by kept `/stok` `/rekap` `/listuser`.

**Buttons (~25–30 keys):** `btn.kembali`, menu/saldo/checkout payment labels, confirm/reset/cancel/voucher prompt, belanja lagi, pagination prev/next, filter/statistik where static.

Exact seed tables live in the implementation plan (verbatim Indonesian bodies from current `index.js`).

### D5 — Leave hardcoded

- Channel log / feed / English “Someone just bought…”
- Success & completion dumps; SNK + account delivery formatting
- Dynamic labels: amounts (`Rp 5.000`), variant names, numeric `±1`/`±5`, product row indices
- Raw `⚠️ ERROR: ${err}` catch-all (do not put stack traces in BotCopy)
- Progress toasts (`🔄 Memperbarui data...`)
- Existing `msg.*` / `screen.*` / flow `label_key` already on registry

### D6 — Stale Phase 7 leftovers when touching sites

When wiring `err.no_products` / related empty states, **remove references to retired `/addproduk`** and point admins to the dashboard (same idea as `retiredOwnerHelpText`).

Dead **➕ Tambah Stok** buttons with no handler: **remove the button markup** at those sites in the same wiring task (do not seed a `btn.tambah_stok` for dead UI).

### D7 — Dashboard + flow builder

- `/settings/bot-copy`: add kind filter chips (`All | screen | msg | err | btn`) via `?kind=` query or client filter; update intro copy to mention err/btn.
- `public/js/flow-builder.js`: treat `label` / `label_key` starting with `btn.` the same as `msg.` when persisting `label_key`.

### D8 — Templating & cache (unchanged)

- `{{var}}` only via existing `copy.render` / `copy.get`
- Dashboard write → `runtimeSettings.bump()` → bot `copy.refresh()` (~10s)
- Code `DEFAULTS` mirror seeds so empty table / lag never crashes the bot

## Architecture

```
Dashboard /settings/bot-copy (?kind=err|btn|…)
        │ POST body + bump()
        ▼
BotCopy (kinds: screen|msg|err|btn)
        │
runtimeSettings.cache_version poll
        ▼
copy.refresh() → index.js / retired-commands copy.get('err.*'|'btn.*')
```

## Success criteria

1. Edit `err.saldo_insufficient` in dashboard → within ~10s bot shows new text on insufficient-saldo path (no restart)
2. Missing DB row → `DEFAULTS` used; bot does not crash
3. `{{count}}` / `{{kode}}` / `{{nama}}` render correctly on wired paths
4. `node --test` covers new DEFAULTS keys (get + vars); existing copy tests still pass
5. Grep gate: known canonical hardcoded strings for **wired** keys are gone from `index.js` / `lib/retired-commands.js`
6. `msg.btn_*` and flow seeds unchanged
7. MessageTemplate / broadcast unchanged; bot checkout/flow runtime behavior unchanged aside from string source

## Out of scope reminders

- Phase 10+ (if any) for remaining `screen.*` checkout chrome
- Purple cleanup in settings page inline CSS (unrelated)
