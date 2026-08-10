# Phase 9 cutover — BotCopy err/btn

1. Apply migration `20260816000000_bot_copy_err_btn.sql` on Supabase (`teleshop-improvement-v2`).
2. Deploy code (Railway `main`).
3. Open `/settings/bot-copy` — filter `err` / `btn`; edit one error; wait ~10s; trigger that path in Telegram.
4. Confirm retired commands still show dashboard pointer.
5. `node --test` locally green.
