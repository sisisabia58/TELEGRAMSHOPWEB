const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const vm = require('node:vm')
const express = require('express')
const session = require('express-session')

const security = require('../lib/http-security')

function listen(app) {
  return new Promise((resolve) => {
    const server = http.createServer(app)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      resolve({ server, url: `http://127.0.0.1:${port}` })
    })
  })
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()))
  })
}

function cookieHeader(res) {
  const cookies = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : [])
  return cookies.map((c) => c.split(';')[0]).join('; ')
}

function sessionApp(extraSetup) {
  const app = express()
  security.applyTrustProxy(app)
  security.applyHttpHardening(app)
  app.use(express.urlencoded({ extended: false }))
  app.use(express.json())
  app.use(session({
    secret: 'test-session-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', secure: false },
  }))
  app.use(security.csrfLocals)
  extraSetup(app)
  return app
}

test('login rate limiter is not bypassed by spoofed X-Forwarded-For when trust proxy is 1', async () => {
  const app = express()
  security.applyTrustProxy(app)
  app.use(security.createLoginRateLimiter({ max: 3, windowMs: 60_000 }))
  app.post('/login', (req, res) => res.status(200).send('ok'))

  const { server, url } = await listen(app)
  try {
    const realClient = '203.0.113.50'
    for (let i = 0; i < 3; i += 1) {
      const res = await fetch(`${url}/login`, {
        method: 'POST',
        headers: { 'X-Forwarded-For': `198.51.100.${i + 1}, ${realClient}` },
      })
      assert.equal(res.status, 200, `attempt ${i + 1} should be allowed`)
    }
    const blocked = await fetch(`${url}/login`, {
      method: 'POST',
      headers: { 'X-Forwarded-For': `198.51.100.99, ${realClient}` },
    })
    assert.equal(blocked.status, 429)
    const body = await blocked.text()
    assert.match(body, /too many requests/i)
  } finally {
    await close(server)
  }
})

test('login rate limiter treats a different trusted client IP as a separate bucket', async () => {
  const app = express()
  security.applyTrustProxy(app)
  app.use(security.createLoginRateLimiter({ max: 2, windowMs: 60_000 }))
  app.post('/login', (req, res) => res.status(200).send('ok'))

  const { server, url } = await listen(app)
  try {
    await fetch(`${url}/login`, {
      method: 'POST',
      headers: { 'X-Forwarded-For': '198.51.100.1, 203.0.113.10' },
    })
    await fetch(`${url}/login`, {
      method: 'POST',
      headers: { 'X-Forwarded-For': '198.51.100.1, 203.0.113.10' },
    })
    const otherClient = await fetch(`${url}/login`, {
      method: 'POST',
      headers: { 'X-Forwarded-For': '198.51.100.1, 203.0.113.11' },
    })
    assert.equal(otherClient.status, 200)
  } finally {
    await close(server)
  }
})

test('resolveEnvAdminCredentials fails closed with no hardcoded admin/admin123 default', () => {
  const logs = []
  const missing = security.resolveEnvAdminCredentials({}, {
    error(msg) { logs.push(String(msg)) },
  })
  assert.equal(missing, null)
  assert.match(logs.join('\n'), /ADMIN_USERNAME/)
  assert.match(logs.join('\n'), /ADMIN_PASSWORD/)
  assert.doesNotMatch(logs.join('\n'), /admin123/)

  const empty = security.resolveEnvAdminCredentials({
    ADMIN_USERNAME: '  ',
    ADMIN_PASSWORD: '',
  }, { error() {} })
  assert.equal(empty, null)

  const configured = security.resolveEnvAdminCredentials({
    ADMIN_USERNAME: 'ops-user',
    ADMIN_PASSWORD: 'dummy-not-a-real-secret',
  }, { error() {} })
  assert.deepEqual(configured, {
    username: 'ops-user',
    password: 'dummy-not-a-real-secret',
  })
})

test('dashboard.js does not hardcode default admin credentials', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'dashboard.js'), 'utf8')
  assert.equal(src.includes("|| 'admin123'"), false)
  assert.equal(src.includes('|| "admin123"'), false)
  assert.equal(src.includes("|| 'admin'"), false)
  assert.match(src, /resolveEnvAdminCredentials/)
  assert.match(src, /applyTrustProxy/)
  assert.match(src, /createLoginRateLimiter/)
})

test('CSRF rejects state-changing requests without a token and accepts a valid session token', async () => {
  const app = sessionApp((a) => {
    a.use(security.csrfProtection)
    a.get('/session-login', (req, res) => {
      req.session.isLoggedIn = true
      res.sendStatus(204)
    })
    a.get('/form', (req, res) => {
      res.type('html').send(`<form method="POST" action="/form"><input type="hidden" name="_csrf" value="${res.locals.csrfToken}"></form>`)
    })
    a.post('/form', (req, res) => res.status(200).send('saved'))
    a.post('/api/bot-flow/publish', (req, res) => res.json({ success: true }))
  })

  const { server, url } = await listen(app)
  try {
    const denied = await fetch(`${url}/form`, { method: 'POST' })
    assert.equal(denied.status, 403)

    const login = await fetch(`${url}/session-login`)
    const cookie = cookieHeader(login)
    const page = await fetch(`${url}/form`, { headers: { Cookie: cookie } })
    assert.equal(page.status, 200)
    const html = await page.text()
    const token = html.match(/name="_csrf" value="([^"]+)"/)[1]
    assert.ok(token)
    assert.ok(cookie)

    const okForm = await fetch(`${url}/form`, {
      method: 'POST',
      headers: {
        Cookie: cookie,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: `_csrf=${encodeURIComponent(token)}`,
    })
    assert.equal(okForm.status, 200)

    const deniedApi = await fetch(`${url}/api/bot-flow/publish`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ draft: {} }),
    })
    assert.equal(deniedApi.status, 403)
    const deniedJson = await deniedApi.json()
    assert.equal(deniedJson.success, false)

    const okApi = await fetch(`${url}/api/bot-flow/publish`, {
      method: 'POST',
      headers: {
        Cookie: cookie,
        'Content-Type': 'application/json',
        'X-CSRF-Token': token,
      },
      body: JSON.stringify({ draft: {} }),
    })
    assert.equal(okApi.status, 200)
    assert.deepEqual(await okApi.json(), { success: true })
  } finally {
    await close(server)
  }
})

test('Pakasir webhook POST is not CSRF-blocked', async () => {
  const app = sessionApp((a) => {
    a.use(security.csrfProtection)
    a.post('/webhook/pakasir', (req, res) => res.sendStatus(200))
  })
  const { server, url } = await listen(app)
  try {
    const res = await fetch(`${url}/webhook/pakasir`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: 'demo' }),
    })
    assert.equal(res.status, 200)
  } finally {
    await close(server)
  }
})

test('helmet is enabled, X-Powered-By is hidden, and CSP allows Drawflow plus inline scripts', async () => {
  const app = sessionApp((a) => {
    a.get('/', (req, res) => res.status(200).send('ok'))
  })
  const { server, url } = await listen(app)
  try {
    const res = await fetch(url)
    assert.equal(res.headers.get('x-powered-by'), null)
    const csp = res.headers.get('content-security-policy')
    assert.ok(csp, 'Content-Security-Policy should be set')
    assert.match(csp, /script-src/)
    assert.match(csp, /'unsafe-inline'/)
    assert.match(csp, /cdn\.jsdelivr\.net/)
  } finally {
    await close(server)
  }
})

test('helmet sets X-Content-Type-Options nosniff', async () => {
  const app = sessionApp((a) => {
    a.get('/', (req, res) => res.status(200).send('ok'))
  })
  const { server, url } = await listen(app)
  try {
    const res = await fetch(url)
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff')
  } finally {
    await close(server)
  }
})

test('unauthenticated /api/* requests return 401 JSON instead of a login redirect', async () => {
  const app = sessionApp((a) => {
    a.use(security.csrfProtection)
    a.get('/api/stats', security.requireAuth, (req, res) => res.json({ ok: true }))
    a.post('/api/notifications/read-all', security.requireAuth, (req, res) => res.json({ success: true }))
    a.get('/produk', security.requireAuth, (req, res) => res.status(200).send('produk'))
    a.get('/session-login', (req, res) => {
      req.session.isLoggedIn = true
      res.sendStatus(204)
    })
  })
  const { server, url } = await listen(app)
  try {
    const unauth = await fetch(`${url}/api/stats`, { redirect: 'manual' })
    assert.equal(unauth.status, 401)
    assert.equal(unauth.headers.get('location'), null)
    const payload = await unauth.json()
    assert.equal(payload.success, false)
    assert.match(String(payload.error), /unauthorized/i)

    const unauthPost = await fetch(`${url}/api/notifications/read-all`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    assert.equal(unauthPost.status, 401)
    assert.equal(unauthPost.headers.get('location'), null)
    const postPayload = await unauthPost.json()
    assert.equal(postPayload.success, false)
    assert.match(String(postPayload.error), /unauthorized/i)

    const page = await fetch(`${url}/produk`, { redirect: 'manual' })
    assert.equal(page.status, 302)
    assert.match(page.headers.get('location') || '', /\/login/)

    const login = await fetch(`${url}/session-login`)
    const cookie = cookieHeader(login)
    const auth = await fetch(`${url}/api/stats`, { headers: { Cookie: cookie } })
    assert.equal(auth.status, 200)
    assert.deepEqual(await auth.json(), { ok: true })
  } finally {
    await close(server)
  }
})

test('login form, head partial, and frontend fetch helpers include the CSRF token', () => {
  const login = fs.readFileSync(path.join(__dirname, '..', 'views', 'login.ejs'), 'utf8')
  assert.match(login, /include\('partials\/csrf'\)|name="_csrf"/)
  assert.match(login, /csrf-token/)

  const csrfPartial = fs.readFileSync(path.join(__dirname, '..', 'views', 'partials', 'csrf.ejs'), 'utf8')
  assert.match(csrfPartial, /name="_csrf"/)

  const head = fs.readFileSync(path.join(__dirname, '..', 'views', 'partials', 'head.ejs'), 'utf8')
  assert.match(head, /name="csrf-token"/)
  assert.match(head, /\/js\/csrf\.js/)

  const csrfJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'csrf.js'), 'utf8')
  assert.match(csrfJs, /X-CSRF-Token/)
  assert.match(csrfJs, /_csrf/)

  const flow = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'flow-builder.js'), 'utf8')
  assert.match(flow, /\/api\/bot-flow\/draft/)
  assert.match(flow, /\/api\/bot-flow\/publish/)
  assert.match(flow, /X-CSRF-Token|csrfHeaders/)

  const inlineEdit = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'inline-edit.js'), 'utf8')
  assert.match(inlineEdit, /X-CSRF-Token|csrfHeaders/)

  const notifications = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'notifications.js'), 'utf8')
  assert.match(notifications, /X-CSRF-Token|csrfHeaders/)
})

test('csrfLocals creates tokens for /login and logged-in pages only', () => {
  const anonymous = { session: {}, path: '/produk', originalUrl: '/produk' }
  const anonymousRes = { locals: {} }
  security.csrfLocals(anonymous, anonymousRes, () => {})
  assert.equal(anonymousRes.locals.csrfToken, '')
  assert.equal(anonymous.session.csrfToken, undefined)

  const api = { session: {}, path: '/api/stats', originalUrl: '/api/stats' }
  const apiRes = { locals: {} }
  security.csrfLocals(api, apiRes, () => {})
  assert.equal(api.session.csrfToken, undefined)

  const login = { session: {}, path: '/login', originalUrl: '/login' }
  const loginRes = { locals: {} }
  security.csrfLocals(login, loginRes, () => {})
  assert.match(String(login.session.csrfToken), /^[a-f0-9]{64}$/)
  assert.equal(loginRes.locals.csrfToken, login.session.csrfToken)

  const loggedIn = { session: { isLoggedIn: true }, path: '/produk', originalUrl: '/produk' }
  const loggedInRes = { locals: {} }
  security.csrfLocals(loggedIn, loggedInRes, () => {})
  assert.match(String(loggedIn.session.csrfToken), /^[a-f0-9]{64}$/)
  assert.equal(loggedInRes.locals.csrfToken, loggedIn.session.csrfToken)
})

test('anonymous non-login GET does not Set-Cookie when saveUninitialized is false', async () => {
  const app = sessionApp((a) => {
    a.get('/produk', (req, res) => res.status(200).send('produk'))
    a.get('/login', (req, res) => res.status(200).send(`token=${res.locals.csrfToken}`))
  })
  const { server, url } = await listen(app)
  try {
    const anon = await fetch(`${url}/produk`)
    assert.equal(anon.status, 200)
    assert.equal(cookieHeader(anon), '')

    const login = await fetch(`${url}/login`)
    assert.equal(login.status, 200)
    assert.match(await login.text(), /token=[a-f0-9]{64}/)
    assert.ok(cookieHeader(login))
  } finally {
    await close(server)
  }
})

function loadCsrfScript({ token = 'test-csrf-token', fetchImpl }) {
  const context = vm.createContext({
    fetch: fetchImpl,
    document: {
      querySelector(sel) {
        if (sel === 'meta[name="csrf-token"]') {
          return { getAttribute: () => token }
        }
        return null
      },
      querySelectorAll() { return [] },
      readyState: 'complete',
      addEventListener() {},
    },
    Headers,
    Request,
    Response,
  })
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'csrf.js'), 'utf8'),
    context
  )
  return context
}

test('fetch wrapper preserves Request headers when init.headers is absent', async () => {
  const captured = []
  const context = loadCsrfScript({
    fetchImpl: async (input, init) => {
      captured.push({ input, init })
      return new Response('ok')
    },
  })

  const request = new Request('http://127.0.0.1/api/bot-flow/publish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ draft: {} }),
  })
  await context.fetch(request)

  assert.equal(captured.length, 1)
  const headers = new Headers(captured[0].init.headers)
  assert.equal(headers.get('Content-Type'), 'application/json')
  assert.equal(headers.get('Accept'), 'application/json')
  assert.equal(headers.get('X-CSRF-Token'), 'test-csrf-token')
})
