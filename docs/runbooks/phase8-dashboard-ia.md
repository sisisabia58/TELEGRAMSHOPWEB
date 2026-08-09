# Phase 8 cutover — Dashboard IA & UI

1. Merge → Railway deploys.
2. Hard-refresh dashboard (fonts/CSS).
3. Confirm purple gradient gone; sidebar sections work.
4. Mobile ≤768px: bottom tabs visible.
5. Open `/`, `/stok`, `/pricing`.
6. **Session env vars** (Railway → dashboard service → Variables):
   - `SESSION_SECRET` — required in production; app exits on boot if missing when `NODE_ENV=production`. Use a long random string (e.g. `openssl rand -hex 32`).
   - `SECURE_COOKIES` — optional override; set to `true` to force `Secure` cookies outside production. In production, secure cookies are enabled automatically (`NODE_ENV=production`).
   - **Trust proxy:** `dashboard.js` sets `app.set('trust proxy', 1)` so Express treats Railway’s HTTPS reverse proxy as secure when setting `Secure` session cookies. If login fails after deploy, verify `SESSION_SECRET` is set, secure cookies are enabled, and the proxy trust setting is present.

See plan: `docs/superpowers/plans/2026-08-09-dashboard-ia-mobile.md`.

## Verification gates (Task 8)

- `node --test` — 69/69 pass
- `node --check dashboard.js` — OK
- Purple hardcodes (`667eea` / `764ba2`) in `public/css/dashboard.css` — zero matches
- `partials/layout` references in `views/` — none (dead `layout.ejs` removed)
- `include('partials/sidebar')` — 45 authenticated views
- `public/js/inline-edit.js` — `patchAndSwap` stable; used on produk-detail variant rows (tier panel uses JSON REST, unchanged)
