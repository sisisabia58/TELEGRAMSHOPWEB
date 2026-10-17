// Server-side dashboard RBAC.
// Admin table roles (CHECK): admin | staff | viewer
//   admin  — full write (unchanged)
//   staff  — limited write (operational routes; not admin-user management)
//   viewer — read only; every mutating method is 403

const WRITE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE']
const WRITE_ROLES = ['admin', 'staff']

const EXEMPT_WRITE = new Set([
  'POST /login',
  'POST /webhook/pakasir',
  'POST /admin/change-password',
  'POST /api/notifications/read-all',
  'POST /api/notifications/:id/read',
])

function canWrite(role) {
  return WRITE_ROLES.includes(role)
}

function isExemptWrite(method, path) {
  const m = String(method || '').toUpperCase()
  const p = String(path || '')
  if (EXEMPT_WRITE.has(`${m} ${p}`)) return true
  if (m === 'POST' && /^\/api\/notifications\/[^/]+\/read$/.test(p)) return true
  return false
}

function sendForbidden(req, res) {
  const accept = String(req.headers && req.headers.accept || '')
  const wantsJson = String(req.path || '').startsWith('/api') || accept.includes('application/json')
  const message = 'Akses ditolak. Anda tidak memiliki permission untuk halaman ini.'
  if (wantsJson) {
    return res.status(403).json({ success: false, error: message })
  }
  return res.status(403).send(message)
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

function requireWriteAccess(req, res, next) {
  const method = String(req.method || '').toUpperCase()
  if (!WRITE_METHODS.includes(method)) return next()
  if (isExemptWrite(method, req.path)) return next()
  if (!req.session || !req.session.isLoggedIn) return next()
  if (canWrite(req.session.role)) return next()
  return sendForbidden(req, res)
}

module.exports = {
  WRITE_METHODS,
  WRITE_ROLES,
  canWrite,
  isExemptWrite,
  sendForbidden,
  requireRole,
  requireWriteAccess,
}
