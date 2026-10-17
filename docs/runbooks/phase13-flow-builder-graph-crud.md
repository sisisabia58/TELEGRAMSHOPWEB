# Phase 13 — Flow Builder Graph CRUD

## QA checklist

1. `/settings/bot-flow` — add Message Node → Save draft → reload → node in draft
2. Publish → new `BotFlowNode` row + `BotCopy` row for `screen.custom_*`
3. Delete non-entry node → Publish → row removed from DB
4. Set media URL + type photo → Publish → Telegram `/start` shows photo caption (engine on)
5. Action node: change to `riwayat` → Publish → bot opens riwayat
6. Entry dropdown → Publish → `/start` uses new entry screen
7. Preview shows image above caption when media URL set
8. Orphan BotCopy after delete: row remains in Global Strings (expected)

## Rollback

Re-publish a saved draft JSON from before changes, or restore `BotFlowNode`/`BotCopy` from Supabase backup.
