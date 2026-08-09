# Phase 7 — Bot Command Retirement (Design Spec)

**Date:** 2026-08-09  
**Source:** Admin UX Overhaul (cozy-sky) Phase 7  
**Status:** Approved for planning (implementation via separate PR)

## Problem

Owner admin still lives in two places: the **dashboard** (Phases 2–6) and **~21 Telegram slash wizards** plus owner callback UIs in `index.js`. That duplicates product/stock/voucher/broadcast work and keeps thousands of lines of fragile `*State` machines.

## Goal

Make the **dashboard the only admin console**. The bot keeps buyer flows plus a few **read-only** owner reports. Retired commands either disappear or reply with a one-line pointer to the dashboard.

## Non-goals

- Phase 8 nav / mobile IA
- Phase 9 `err.*` / residual `btn.*` copy extraction
- Building a full Premium management UI (no dashboard exists yet — see Decisions)
- Changing checkout (`p:` / `v:` / bayar) or flow-engine runtime

## Decisions

| Topic | Decision |
|-------|----------|
| Keep owner reports | `/stok` (read), `/rekap`, `/listuser` (list only — no detail/export callbacks) |
| Keep buyer commands | `/start`, `/saldo`, `/deposit`, `/riwayatdeposit`, `/getid`, plus flow/checkout callbacks |
| Retire style | **Delete** wizard handlers + state; install **one** shared stub for retired slash names so owners get “use Dashboard” instead of silence |
| `/ownermenu` | Replace with dashboard URL message (not a command directory) |
| `/setgrup` family | Already absent after Phase 2 — no work |
| Premium (`/setpremium`, `/addpremiumuser`, `/removepremiumuser`) | **Retire from bot.** Manage `Premium` rows in Supabase Studio until a later dashboard task. Document in runbook. |
| `/deluser` | **Retire from bot.** No Telegram-user delete route on dashboard today — Studio (or a tiny follow-up). Do **not** block Phase 7 on building user-delete UI. |
| `stok_*` callbacks | **Keep read** (buyer/owner report). **Delete edit** paths (`stok_edit_menu`, `editstok_*`, add-stok wizard callbacks). |
| Owner product/user drill-downs | Delete `produk_detail_`, `produk_trx_`, `produk_statistik`, `produk_export`, `user_detail_`, `user_statistik`, `user_export` |
| Tests | Pure list helper via `node --test`; post-delete `rg` gates; full `node --test` green |

## Dashboard coverage map

| Bot command | Dashboard replacement |
|-------------|----------------------|
| `/ownermenu` | Sidebar / `/` |
| `/addproduk` | `/produk/tambah` |
| `/delproduk` | `/produk/hapus/:id` |
| `/addstok` | `/produk/:produkId/varian/:varianId/stok/tambah`, `/bulk` |
| `/editstok` | `/produk/.../stok/edit/:stokId` |
| `/editnama` … `/editkategori` | `/produk/:id` (+ variant PATCH) |
| `/bc` | `/communication/broadcast` |
| `/addvoucher` `/delvoucher` `/listvoucher` | `/voucher*` |
| `/setpremium` family | Studio → table `Premium` (gap) |
| `/deluser` | Studio → table `User` (gap) |
| `/setgrup` family | N/A (schema gone) |

## Success criteria

1. `rg` finds no `bot.onText` for retired command names except the shared stub router.
2. `addProdukState`, `addStokState`, `editNamaState`, … and `editstok` maps are gone; depositState remains.
3. Command-reset block in `bot.on('message')` only mentions deposit (and any remaining buyer states).
4. `/stok`, `/rekap`, `/listuser` still work for owners; `/listuser` has no `user_detail_` buttons.
5. Buyer `/start` → product list → card still works with flow engine on/off.
6. `node --test` passes; `node --check index.js` passes.
7. Roughly **2.5k–3.8k lines** removed from `index.js` (measured in PR diff).

## Risk

Shared helpers (`addStokItems`, `getStokItems`, …) must **stay** if checkout/buyer `/stok` still call them. Grep before delete.
