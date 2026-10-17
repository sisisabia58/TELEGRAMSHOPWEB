# Dashboard HTTP security

Railway deploys the Express dashboard (`dashboard.js`) behind one reverse proxy. After this hardening, confirm these **variable names** on the service (values stay in Railway; do not put secrets in git):

- `SESSION_SECRET` — required when `NODE_ENV=production`
- `ADMIN_USERNAME` — env-fallback login username (no default)
- `ADMIN_PASSWORD` — env-fallback login password (no default)
- `SECURE_COOKIES` — optional; `true` forces Secure cookies outside production
- `SUPABASE_URL`
- `SUPABASE_KEY`

## Behaviour

- `trust proxy` is 1 so `req.ip` is the client behind Railway. Login rate limiting keys on `req.ip`.
- Env-fallback login is fail closed: if `ADMIN_USERNAME` or `ADMIN_PASSWORD` is missing, login via env is refused and the server logs an error. Database `Admin` rows still work.
- Session form POSTs and `fetch` mutating calls need a CSRF token (`_csrf` field or `X-CSRF-Token` header). `/webhook/pakasir` is excluded. Unauthenticated `/api/*` mutations skip CSRF so `requireAuth` can return 401 JSON for missing/expired sessions; authenticated API mutations still require a CSRF token.
- Helmet sets security headers (CSP allows `'unsafe-inline'` and `cdn.jsdelivr.net` for Drawflow / Chart.js). `X-Powered-By` is disabled.
- Unauthenticated `/api/*` requests (GET and POST) return **401 JSON**, not a 302 to `/login` or a 403 CSRF error.
- Login rate-limiter store drops expired IP records when a later attempt is processed.
