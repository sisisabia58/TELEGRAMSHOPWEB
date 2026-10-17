'use strict'

const crypto = require('crypto')
const helmet = require('helmet')

// Railway terminates TLS at one reverse proxy hop in front of the Express app.
const TRUST_PROXY_HOPS = 1
const CSRF_SESSION_KEY = 'csrfToken'
const CSRF_FORM_FIELD = '_csrf'
const CSRF_HEADER = 'x-csrf-token'

function applyTrustProxy(app, hops = TRUST_PROXY_HOPS) {
  app.set('trust proxy', hops)
}

function applyHttpHardening(app) {
  app.disable('x-powered-by')
  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
        scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://cdn.jsdelivr.net'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: ["'self'", 'data:', 'https:', 'blob:'],
        connectSrc: ["'self'"],
        upgradeInsecureRequests: null,
      },
    },
    // Local dashboard is HTTP; enable HSTS only when NODE_ENV=production (Railway HTTPS).
    strictTransportSecurity: process.env.NODE_ENV === 'production' ? undefined : false,
  }))
}

function clientIp(req) {
  return req.ip || (req.socket && req.socket.remoteAddress) || 'unknown'
}

function createLoginRateLimiter({ max = 5, windowMs = 15 * 60 * 1000, store = new Map() } = {}) {
  return (req, res, next) => {
    const ip = clientIp(req)
    const key = `${ip}-${req.path}`
    const now = Date.now()

    if (!store.has(key)) {
      store.set(key, { count: 1, resetTime: now + windowMs })
      return next()
    }

    const record = store.get(key)

    if (now > record.resetTime) {
      record.count = 1
      record.resetTime = now + windowMs
      return next()
    }

    if (record.count >= max) {
      return res.status(429).send('Too many requests. Please try again later.')
    }

    record.count += 1
    next()
  }
}

function resolveEnvAdminCredentials(env = process.env, log = console) {
  const username = typeof env.ADMIN_USERNAME === 'string' ? env.ADMIN_USERNAME.trim() : ''
  const password = typeof env.ADMIN_PASSWORD === 'string' ? env.ADMIN_PASSWORD : ''
  if (!username || !password) {
    log.error(
      '[login] ADMIN_USERNAME and ADMIN_PASSWORD are not configured; refusing env fallback login (fail closed, no defaults)'
    )
    return null
  }
  return { username, password }
}

function isApiRequest(req) {
  const path = req.path || ''
  const orig = String(req.originalUrl || '').split('?')[0]
  return path.startsWith('/api/') || orig.startsWith('/api/')
}

function requireAuth(req, res, next) {
  if (req.session && req.session.isLoggedIn) {
    return next()
  }
  if (isApiRequest(req)) {
    return res.status(401).json({ success: false, error: 'Unauthorized' })
  }
  return res.redirect('/login')
}

function ensureCsrfToken(req) {
  if (!req.session) return null
  if (!req.session[CSRF_SESSION_KEY]) {
    req.session[CSRF_SESSION_KEY] = crypto.randomBytes(32).toString('hex')
  }
  return req.session[CSRF_SESSION_KEY]
}

function csrfLocals(req, res, next) {
  if (!req.session) {
    res.locals.csrfToken = ''
    return next()
  }
  const needsToken = req.session.isLoggedIn || req.path === '/login'
  if (!needsToken) {
    res.locals.csrfToken = ''
    return next()
  }
  res.locals.csrfToken = ensureCsrfToken(req)
  next()
}

function readProvidedCsrfToken(req) {
  const bodyToken = req.body && req.body[CSRF_FORM_FIELD]
  const headerToken = req.headers[CSRF_HEADER] || req.headers['csrf-token']
  return bodyToken || headerToken || ''
}

function tokensEqual(expected, provided) {
  if (typeof expected !== 'string' || typeof provided !== 'string' || !expected || !provided) {
    return false
  }
  const left = crypto.createHash('sha256').update(expected).digest()
  const right = crypto.createHash('sha256').update(provided).digest()
  return crypto.timingSafeEqual(left, right)
}

function shouldSkipCsrf(req) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return true
  const path = req.path || ''
  return path === '/webhook/pakasir'
}

function csrfProtection(req, res, next) {
  if (shouldSkipCsrf(req)) return next()
  const expected = req.session && req.session[CSRF_SESSION_KEY]
  const provided = readProvidedCsrfToken(req)
  if (!tokensEqual(expected, provided)) {
    if (isApiRequest(req) || (req.headers.accept || '').includes('application/json')) {
      return res.status(403).json({ success: false, error: 'Invalid CSRF token' })
    }
    return res.status(403).send('Invalid CSRF token')
  }
  next()
}

module.exports = {
  TRUST_PROXY_HOPS,
  applyTrustProxy,
  applyHttpHardening,
  clientIp,
  createLoginRateLimiter,
  resolveEnvAdminCredentials,
  requireAuth,
  ensureCsrfToken,
  csrfLocals,
  csrfProtection,
}
