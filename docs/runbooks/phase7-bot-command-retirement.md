# Phase 7 cutover — Bot command retirement

1. Merge implementation PR → Railway deploys.
2. As owner, send `/addproduk` → expect “use Dashboard” stub (not wizard).
3. Open Dashboard → Products / Stock / Vouchers / Broadcast — confirm CRUD still works.
4. Owner `/stok`, `/rekap`, `/listuser` still reply (`/listuser` is list-only).
5. Buyer `/start` → Daftar Produk still works.
6. **Gaps (Studio):** `Premium` whitelist and deleting a `User` row — no dashboard UI yet.
7. Rollback: revert the Phase 7 commit(s) on `main` (commands return).

**Result on branch:** `index.js` ~11.9k → ~7.3k lines; retired wizards stubbed via `lib/retired-commands.js`.

See plan: `docs/superpowers/plans/2026-08-09-bot-command-retirement.md`.
