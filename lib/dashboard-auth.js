// Server-side dashboard RBAC.
// Admin table roles (CHECK): admin | staff | viewer | qa
//   admin  — full write (unchanged)
//   staff  — limited write (operational routes; not admin-user management)
//   viewer — read only; every mutating method is 403
//   qa     — deny-by-default allowlist: dashboard home + Flow Builder
//            (including publish). Toggle and every other route are 403.
//
// Per-request Admin re-check (createRefreshSessionAdmin):
//   one select of role,is_active by session.adminId. Env-var fallback
//   sessions have no adminId and are skipped. An in-memory cache
//   (default 3000ms) coalesces bursts of XHR; revocation can lag by
//   up to ttlMs. Pass { ttlMs: 0 } to disable.

const WRITE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE']
const WRITE_ROLES = ['admin', 'staff']

const EXEMPT_WRITE = new Set([
  'POST /login',
  'POST /webhook/pakasir',
  'POST /admin/change-password',
  'POST /api/notifications/read-all',
  'POST /api/notifications/:id/read',
])

const QA_ALLOWED = new Set([
  'GET /',
  'GET /settings/bot-flow',
  'GET /api/bot-flow',
  'POST /api/bot-flow/draft',
  'POST /api/bot-flow/preview-step',
  'POST /api/bot-flow/publish',
  'GET /logout',
  'GET /admin/change-password',
  'POST /admin/change-password',
  'POST /api/notifications/read-all',
])

const FORBIDDEN_MESSAGE = 'Akses ditolak. Anda tidak memiliki permission untuk halaman ini.'
const SESSION_EXPIRED_MESSAGE = 'Sesi tidak valid. Silakan login kembali.'

function canWrite(role) {
  return WRITE_ROLES.includes(role)
}

function canonicalizePath(rawPath) {
  let p = String(rawPath || '')
  try {
    p = decodeURIComponent(p)
  } catch {
    return null
  }
  if (p.includes('\0') || p.includes('..')) return null
  p = p.split('?')[0].split('#')[0]
  p = p.replace(/\/{2,}/g, '/')
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1)
  if (!p.startsWith('/')) p = '/' + p
  return p
}

function isExemptWrite(method, path) {
  const m = String(method || '').toUpperCase()
  const p = String(path || '')
  if (EXEMPT_WRITE.has(`${m} ${p}`)) return true
  if (m === 'POST' && /^\/api\/notifications\/[^/]+\/read$/.test(p)) return true
  return false
}

function isStaticAsset(method, path) {
  const m = String(method || '').toUpperCase()
  if (m !== 'GET' && m !== 'HEAD') return false
  if (/^\/(css|js|img|images|fonts|assets|static)\//.test(path)) return true
  if (/\.(css|js|mjs|map|png|jpe?g|gif|svg|ico|webp|woff2?|ttf|eot)$/i.test(path)) return true
  return path === '/favicon.ico'
}

function isQaAllowed(method, path) {
  const m = String(method || '').toUpperCase()
  const p = canonicalizePath(path)
  if (!p) return false
  if (QA_ALLOWED.has(`${m} ${p}`)) return true
  if (m === 'POST' && /^\/api\/notifications\/[^/]+\/read$/.test(p)) return true
  if (isStaticAsset(m, p)) return true
  return false
}

function wantsJsonResponse(req) {
  const accept = String(req.headers && req.headers.accept || '')
  return String(req.path || '').startsWith('/api') || accept.includes('application/json')
}

function sendForbidden(req, res) {
  if (wantsJsonResponse(req)) {
    return res.status(403).json({ success: false, error: FORBIDDEN_MESSAGE })
  }
  return res.status(403).send(FORBIDDEN_MESSAGE)
}

function endInvalidSession(req, res) {
  const finish = () => {
    if (wantsJsonResponse(req)) {
      return res.status(401).json({ success: false, error: SESSION_EXPIRED_MESSAGE })
    }
    return res.redirect('/login')
  }
  if (req.session && typeof req.session.destroy === 'function') {
    return req.session.destroy(() => finish())
  }
  return finish()
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session || !req.session.isLoggedIn) {
      return res.redirect('/login')
    }
    if (!req.session.role || !roles.includes(req.session.role)) {
      return sendForbidden(req, res)
    }
    next()
  }
}

function requireQaAccess(req, res, next) {
  if (!req.session || !req.session.isLoggedIn) return next()
  if (req.session.role !== 'qa') return next()
  if (isQaAllowed(req.method, req.path)) return next()
  return sendForbidden(req, res)
}

function requireWriteAccess(req, res, next) {
  const method = String(req.method || '').toUpperCase()
  if (!WRITE_METHODS.includes(method)) return next()
  if (isExemptWrite(method, req.path)) return next()
  if (!req.session || !req.session.isLoggedIn) return next()
  if (canWrite(req.session.role)) return next()
  if (req.session.role === 'qa' && isQaAllowed(method, req.path)) return next()
  return sendForbidden(req, res)
}

function createRefreshSessionAdmin(supabase, options = {}) {
  const ttlMs = options.ttlMs == null ? 3000 : Number(options.ttlMs)
  const cache = new Map()

  return async function refreshSessionAdmin(req, res, next) {
    try {
      if (!req.session || !req.session.isLoggedIn) return next()
      const adminId = req.session.adminId
      if (!adminId) return next()

      const now = Date.now()
      let row = null
      const cached = cache.get(adminId)
      if (ttlMs > 0 && cached && cached.expiresAt > now) {
        row = cached.row
      } else {
        const { data, error } = await supabase
          .from('Admin')
          .select('role, is_active')
          .eq('id', adminId)
          .maybeSingle()
        if (error) {
          console.error('[dashboard-auth] Admin re-check failed:', error.message || error)
          return next()
        }
        row = data || null
        if (ttlMs > 0) cache.set(adminId, { row, expiresAt: now + ttlMs })
      }

      if (!row || row.is_active === false) {
        cache.delete(adminId)
        return endInvalidSession(req, res)
      }
      if (row.role && req.session.role !== row.role) {
        req.session.role = row.role
      }
      return next()
    } catch (err) {
      console.error('[dashboard-auth] Admin re-check error:', err)
      return next()
    }
  }
}

module.exports = {
  WRITE_METHODS,
  WRITE_ROLES,
  QA_ALLOWED,
  canWrite,
  isExemptWrite,
  isQaAllowed,
  sendForbidden,
  requireRole,
  requireQaAccess,
  requireWriteAccess,
  createRefreshSessionAdmin,
}
