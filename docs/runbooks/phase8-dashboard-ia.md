# Phase 8 cutover — Dashboard IA & UI modernization

1. Merge implementation PR → Railway deploys.
2. Hard-refresh dashboard (fonts/CSS cache).
3. Confirm purple gradient is gone; Plus Jakarta Sans + teal accent.
4. Sidebar sections: Overview / Catalog / Bot / Customers / Insights / System.
5. Mobile ≤768px: bottom tabs (Overview · Catalog · Customers · More).
6. Open `/`, `/stok`, `/pricing` — triage + stock + pricing work.
7. Set `SESSION_SECRET` (required in production) and HTTPS so `secure` cookies work.

See plan: `docs/superpowers/plans/2026-08-09-dashboard-ia-mobile.md`.
