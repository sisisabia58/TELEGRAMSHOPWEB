# Phase 9 cutover — BotCopy err/btn

1. Apply migration `20260816000000_bot_copy_err_btn.sql` on Supabase (`teleshop-improvement-v2`).
2. Deploy code (Railway `main`).
3. Open `/settings/bot-copy` — filter `err` / `btn`; edit one error; wait ~10s; trigger that path in Telegram.
4. Confirm retired commands still show dashboard pointer.
5. `node --test` locally green.

## Verification gates (Task 6 — 2026-08-10)

| Gate | Result |
|------|--------|
| `node --test` | **PASS** — 71/71 tests |
| `node --check index.js` | **PASS** |
| `node --check dashboard.js` | **PASS** |
| `node --check lib/copy.js` | **PASS** |
| `node --check lib/retired-commands.js` | **PASS** |
| `rg` legacy strings (`Harap ulangi pilih produk`, `Perintah admin bot sudah dipensiunkan`, `Tambah Stok`) | **OK** — no matches in `index.js` / `lib/retired-commands.js` |
