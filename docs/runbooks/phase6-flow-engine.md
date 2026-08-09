# Phase 6 cutover runbook — Flow engine

1. Merge Phase 6 PR → Railway deploys (engine defaults OFF → legacy path).
2. Apply migration: `supabase db push` (project sajffqniegtvhyopshvx).
3. Confirm Studio: `BotFlow` (1 active), `BotFlowNode` (≥7 rows), `flow_engine_enabled=false`.
4. Smoke with engine OFF: `/start`, daftar produk, qty, bayar path OK.
5. Dashboard → Settings → Bot Flow → enable toggle → Save (bumps cache).
6. Within ~10s: `/start` still works; welcome buttons use flow (callback `f:…` on new messages).
7. Edit welcome buttons JSON (swap two labels) → save → `/start` reflects change.
8. Rollback: disable toggle → Save → bot uses legacy if-chain again.
