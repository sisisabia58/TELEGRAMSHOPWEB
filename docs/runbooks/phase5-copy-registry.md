# Phase 5 cutover runbook — Copy registry

1. Merge Phase 5 PR → Railway deploys (code falls back to DEFAULTS if table missing).
2. Apply migration: `supabase db push` (project sajffqniegtvhyopshvx) OR paste SQL (keep search_path).
3. Confirm Studio shows `BotCopy` with seeded keys.
4. Dashboard → Settings → Bot Copy → edit `screen.welcome` body → save.
5. Within ~10s, bot `/start` shows edited text (no restart).
6. Delete a row in Studio → bot still renders DEFAULTS for that key.
