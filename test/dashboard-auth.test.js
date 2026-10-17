const assert = require('node:assert/strict')
const http = require('node:http')
const test = require('node:test')
const express = require('express')
const {
  requireRole,
  requireWriteAccess,
  requireQaAccess,
  createRefreshSessionAdmin,
  canWrite,
  WRITE_METHODS,
  isQaAllowed,
} = require('../lib/dashboard-auth')

const QA_ID = '11111111-1111-4111-8111-111111111111'

function mockAdminClient(store) {
  let selects = 0
  return {
    get selects() { return selects },
    from(table) {
      assert.equal(table, 'Admin')
      return {
        select() {
          return {
            eq(_col, id) {
              return {
                maybeSingle: async () => {
                  selects += 1
                  const row = store.get(id)
                  if (!row) return { data: null, error: null }
                  return { data: { role: row.role, is_active: row.is_active }, error: null }
                },
              }
            },
          }
        },
      }
    },
  }
}

function destroyableSession(fields) {
  const session = {
    isLoggedIn: true,
    ...fields,
    destroy(cb) {
      session.isLoggedIn = false
      session.destroyed = true
      if (typeof cb === 'function') cb()
    },
  }
  return session
}

function mountStubRoutes(app) {
  const ok = (_req, res) => res.json({ ok: true })
  const okHtml = (_req, res) => res.status(200).send('ok')

  app.get('/', okHtml)
  app.get('/settings/bot-flow', okHtml)
  app.get('/api/bot-flow', ok)
  app.post('/api/bot-flow/draft', ok)
  app.post('/api/bot-flow/preview-step', ok)
  app.post('/api/bot-flow/publish', ok)
  app.post('/settings/bot-flow/toggle', ok)
  app.get('/api/bot-copy', ok)
  app.get('/api/notifications/inbox', ok)
  app.get('/api/notifications/counts', ok)
  app.get('/api/notifications/stream', ok)

  app.get('/produk', okHtml)
  app.post('/produk/tambah', ok)
  app.get('/pricing', okHtml)
  app.get('/stok', okHtml)
  app.get('/deposit', okHtml)
  app.post('/deposit/1/approve', ok)
  app.get('/user/1/topup', okHtml)
  app.post('/user/1/topup', ok)
  app.get('/user/1/kurangi', okHtml)
  app.post('/user/1/kurangi', ok)
  app.get('/user/1/reset', okHtml)
  app.post('/user/1/reset', ok)

  app.get('/settings', okHtml)
  app.get('/settings/general', okHtml)
  app.post('/api/settings/general', ok)
  app.get('/settings/payment-gateway', okHtml)
  app.post('/api/settings/payment-gateway', ok)
  app.get('/settings/notifications', okHtml)
  app.post('/api/settings/notifications', ok)
  app.get('/settings/bot-copy', okHtml)
  app.post('/api/bot-copy', ok)
  app.get('/settings/reseller', okHtml)
  app.post('/api/settings/reseller', ok)
  app.get('/supplier/pengaturan', okHtml)

  app.get('/payments', okHtml)
  app.get('/voucher', okHtml)
  app.post('/voucher/tambah', ok)
  app.get('/communication/broadcast', okHtml)
  app.post('/communication/broadcast', ok)
  app.get('/supplier', okHtml)
  app.post('/supplier/simpan', ok)

  app.get('/admin/users', requireRole('admin'), okHtml)
  app.get('/admin/users/tambah', requireRole('admin'), okHtml)
  app.post('/admin/users/tambah', requireRole('admin'), ok)
  app.get('/admin/login-history', requireRole('admin'), okHtml)
  app.get('/admin/audit-log', requireRole('admin'), okHtml)

  app.get('/admin/change-password', okHtml)
  app.post('/admin/change-password', ok)
  app.post('/api/notifications/read-all', ok)
  app.post('/api/notifications/:id/read', ok)
  app.get('/logout', (_req, res) => res.status(200).send('logged-out'))
  app.get('/css/dashboard.css', (_req, res) => res.status(200).send('body{}'))
  app.get('/js/nav.js', (_req, res) => res.status(200).send('/* js */'))
  app.get('/favicon.ico', (_req, res) => res.status(200).send('ico'))
  app.get('/produk.js', okHtml)
  app.get('/admin/users.css', okHtml)
  app.get('/settings/payment-gateway.png', okHtml)
}

function withSession(role, extras = {}) {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.session = destroyableSession({ role, ...extras.session })
    next()
  })
  if (extras.refresh) app.use(extras.refresh)
  app.use(requireQaAccess)
  app.use(requireWriteAccess)
  mountStubRoutes(app)
  return app
}

function listen(app) {
  return new Promise((resolve) => {
    const server = http.createServer(app)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      resolve({ server, port })
    })
  })
}

async function request(port, path, { method = 'GET', accept, json = false } = {}) {
  const headers = {}
  if (accept) headers.Accept = accept
  if (json || method !== 'GET') {
    headers['Content-Type'] = 'application/json'
    if (!headers.Accept) headers.Accept = 'application/json'
  }
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers,
    body: method === 'GET' || method === 'HEAD' ? undefined : '{}',
    redirect: 'manual',
  })
  const text = await res.text()
  let parsed = null
  try { parsed = JSON.parse(text) } catch { /* not json */ }
  return { status: res.status, text, json: parsed, location: res.headers.get('location') }
}

async function postJson(port, path) {
  return request(port, path, { method: 'POST', json: true })
}

test('permission map: viewer is read-only, staff and admin may write, qa may not', () => {
  assert.equal(canWrite('viewer'), false)
  assert.equal(canWrite('staff'), true)
  assert.equal(canWrite('admin'), true)
  assert.equal(canWrite('qa'), false)
  assert.deepEqual(WRITE_METHODS, ['POST', 'PUT', 'PATCH', 'DELETE'])
})

test('qa allowlist is deny-by-default and ignores trailing slashes and path tricks', () => {
  assert.equal(isQaAllowed('GET', '/'), true)
  assert.equal(isQaAllowed('GET', '/settings/bot-flow'), true)
  assert.equal(isQaAllowed('GET', '/settings/bot-flow/'), true)
  assert.equal(isQaAllowed('GET', '/api/bot-flow'), true)
  assert.equal(isQaAllowed('POST', '/api/bot-flow/draft'), true)
  assert.equal(isQaAllowed('POST', '/api/bot-flow/preview-step'), true)
  assert.equal(isQaAllowed('POST', '/api/bot-flow/publish'), true)
  assert.equal(isQaAllowed('POST', '/api/bot-flow/publish/'), true)
  assert.equal(isQaAllowed('GET', '/logout'), true)
  assert.equal(isQaAllowed('GET', '/admin/change-password'), true)
  assert.equal(isQaAllowed('POST', '/admin/change-password'), true)
  assert.equal(isQaAllowed('POST', '/api/notifications/read-all'), true)
  assert.equal(isQaAllowed('POST', '/api/notifications/abc/read'), true)
  assert.equal(isQaAllowed('GET', '/css/dashboard.css'), true)
  assert.equal(isQaAllowed('GET', '/js/nav.js'), true)
  assert.equal(isQaAllowed('HEAD', '/css/dashboard.css'), true)
  assert.equal(isQaAllowed('GET', '/favicon.ico'), true)
  assert.equal(isQaAllowed('GET', '/api/notifications/inbox'), true)
  assert.equal(isQaAllowed('GET', '/api/notifications/counts'), true)
  assert.equal(isQaAllowed('GET', '/api/notifications/stream'), true)
  assert.equal(isQaAllowed('GET', '/api/bot-copy'), true)

  assert.equal(isQaAllowed('POST', '/api/bot-copy'), false)
  assert.equal(isQaAllowed('GET', '/produk.js'), false)
  assert.equal(isQaAllowed('GET', '/admin/users.css'), false)
  assert.equal(isQaAllowed('GET', '/settings/payment-gateway.png'), false)
  assert.equal(isQaAllowed('GET', '/api/bot-flow.js'), false)
  assert.equal(isQaAllowed('POST', '/css/dashboard.css'), false)
  assert.equal(isQaAllowed('POST', '/api/bot-flow/publish%3F/extra'), false)
  assert.equal(isQaAllowed('GET', '/settings/bot-flow%3Ffoo'), false)
  assert.equal(isQaAllowed('GET', '/api/bot-flow%23fragment'), false)
  assert.equal(isQaAllowed('GET', '/settings/bot-flow?kind=all'), false)
  assert.equal(isQaAllowed('GET', '/css/dashboard.css%3Fv=1'), false)
  assert.equal(isQaAllowed('GET', '/settings//bot-flow'), true)

  assert.equal(isQaAllowed('GET', '/settings/bot-flow/toggle'), false)
  assert.equal(isQaAllowed('POST', '/settings/bot-flow/toggle'), false)
  assert.equal(isQaAllowed('POST', '/settings/bot-flow/toggle/'), false)
  assert.equal(isQaAllowed('GET', '/settings/bot-flow/../produk'), false)
  assert.equal(isQaAllowed('GET', '/produk'), false)
  assert.equal(isQaAllowed('GET', '/settings/bot-flow/%2e%2e/produk'), false)
  assert.equal(isQaAllowed('POST', '/api/bot-flow/publish/extra'), false)
  assert.equal(isQaAllowed('GET', '/api/bot-flow/draft'), false)
  assert.equal(isQaAllowed('POST', '/api/notifications/a/b/read'), false)
})

test('viewer gets 403 on a write route', async () => {
  const app = withSession('viewer')
  const { server, port } = await listen(app)
  try {
    const published = await postJson(port, '/api/bot-flow/publish')
    assert.equal(published.status, 403)
    assert.equal(published.json.success, false)

    const settings = await postJson(port, '/api/settings/payment-gateway')
    assert.equal(settings.status, 403)

    const produk = await postJson(port, '/produk/tambah')
    assert.equal(produk.status, 403)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('admin write behaviour is unchanged (200 on the same write route)', async () => {
  const app = withSession('admin')
  const { server, port } = await listen(app)
  try {
    const published = await postJson(port, '/api/bot-flow/publish')
    assert.equal(published.status, 200)
    assert.equal(published.json.ok, true)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('staff may write operational routes but not admin-user management', async () => {
  const app = withSession('staff')
  const { server, port } = await listen(app)
  try {
    const published = await postJson(port, '/api/bot-flow/publish')
    assert.equal(published.status, 200)

    const adminUsers = await postJson(port, '/admin/users/tambah')
    assert.equal(adminUsers.status, 403)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('change-password remains available to a logged-in viewer (self-service)', async () => {
  const app = withSession('viewer')
  const { server, port } = await listen(app)
  try {
    const changed = await postJson(port, '/admin/change-password')
    assert.equal(changed.status, 200)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('qa is allowed on home, flow builder, publish, and #45 self-service routes', async () => {
  const app = withSession('qa', { session: { adminId: QA_ID } })
  const { server, port } = await listen(app)
  try {
    assert.equal((await request(port, '/')).status, 200)
    assert.equal((await request(port, '/settings/bot-flow')).status, 200)
    assert.equal((await request(port, '/api/bot-flow')).status, 200)
    assert.equal((await postJson(port, '/api/bot-flow/draft')).status, 200)
    assert.equal((await postJson(port, '/api/bot-flow/preview-step')).status, 200)
    assert.equal((await postJson(port, '/api/bot-flow/publish')).status, 200)
    assert.equal((await request(port, '/admin/change-password')).status, 200)
    assert.equal((await postJson(port, '/admin/change-password')).status, 200)
    assert.equal((await postJson(port, '/api/notifications/read-all')).status, 200)
    assert.equal((await postJson(port, '/api/notifications/n1/read')).status, 200)
    assert.equal((await request(port, '/logout')).status, 200)
    assert.equal((await request(port, '/css/dashboard.css')).status, 200)
    assert.equal((await request(port, '/js/nav.js')).status, 200)
    assert.equal((await request(port, '/favicon.ico')).status, 200)
    assert.equal((await request(port, '/api/notifications/inbox')).status, 200)
    assert.equal((await request(port, '/api/notifications/counts')).status, 200)
    assert.equal((await request(port, '/api/notifications/stream')).status, 200)
    assert.equal((await request(port, '/api/bot-copy')).status, 200)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('qa is forbidden on catalog, money, settings, comms, and admin-management routes', async () => {
  const app = withSession('qa', { session: { adminId: QA_ID } })
  const { server, port } = await listen(app)
  const forbidden = [
    ['GET', '/produk'],
    ['GET', '/pricing'],
    ['GET', '/stok'],
    ['GET', '/deposit'],
    ['POST', '/user/1/topup'],
    ['POST', '/user/1/kurangi'],
    ['POST', '/user/1/reset'],
    ['GET', '/user/1/topup'],
    ['GET', '/settings/general'],
    ['GET', '/settings/payment-gateway'],
    ['GET', '/settings/notifications'],
    ['GET', '/settings/bot-copy'],
    ['GET', '/supplier/pengaturan'],
    ['GET', '/payments'],
    ['GET', '/voucher'],
    ['GET', '/communication/broadcast'],
    ['GET', '/supplier'],
    ['GET', '/admin/users'],
    ['GET', '/admin/users/tambah'],
    ['POST', '/admin/users/tambah'],
    ['POST', '/settings/bot-flow/toggle'],
    ['GET', '/settings/bot-flow/toggle'],
    ['POST', '/api/bot-copy'],
    ['GET', '/produk.js'],
    ['GET', '/admin/users.css'],
    ['GET', '/settings/payment-gateway.png'],
    ['POST', '/api/bot-flow/publish%3F/extra'],
    ['GET', '/settings/bot-flow%3Ffoo'],
    ['GET', '/api/bot-flow%23fragment'],
  ]
  try {
    for (const [method, path] of forbidden) {
      const res = await request(port, path, {
        method,
        json: path.startsWith('/api') || method !== 'GET',
      })
      assert.equal(res.status, 403, `${method} ${path} should be 403 for qa, got ${res.status}`)
      if (path.startsWith('/api') || method !== 'GET') {
        assert.equal(res.json && res.json.success, false, `${method} ${path} should return JSON 403`)
      }
    }
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('deactivated Admin row ends the session on the next request', async () => {
  const store = new Map([[QA_ID, { role: 'qa', is_active: false }]])
  const supabase = mockAdminClient(store)
  const refresh = createRefreshSessionAdmin(supabase, { ttlMs: 0 })
  const app = withSession('qa', { session: { adminId: QA_ID }, refresh })
  const { server, port } = await listen(app)
  try {
    const page = await request(port, '/')
    assert.equal(page.status, 302)
    assert.equal(page.location, '/login')

    const api = await request(port, '/api/bot-flow')
    assert.equal(api.status, 401)
    assert.equal(api.json.success, false)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('deleted Admin row ends the session on the next request', async () => {
  const store = new Map()
  const supabase = mockAdminClient(store)
  const refresh = createRefreshSessionAdmin(supabase, { ttlMs: 0 })
  const app = withSession('qa', { session: { adminId: QA_ID }, refresh })
  const { server, port } = await listen(app)
  try {
    const page = await request(port, '/settings/bot-flow')
    assert.equal(page.status, 302)
    assert.equal(page.location, '/login')
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('role change on the Admin row takes effect on the next request', async () => {
  const store = new Map([[QA_ID, { role: 'staff', is_active: true }]])
  const supabase = mockAdminClient(store)
  const refresh = createRefreshSessionAdmin(supabase, { ttlMs: 0 })
  const app = withSession('qa', { session: { adminId: QA_ID }, refresh })
  const { server, port } = await listen(app)
  try {
    const produk = await request(port, '/produk')
    assert.equal(produk.status, 200)

    const publish = await postJson(port, '/api/bot-flow/publish')
    assert.equal(publish.status, 200)

    const adminUsers = await postJson(port, '/admin/users/tambah')
    assert.equal(adminUsers.status, 403)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('env-var fallback admin sessions without adminId skip the Admin re-check', async () => {
  const supabase = mockAdminClient(new Map())
  const refresh = createRefreshSessionAdmin(supabase, { ttlMs: 0 })
  const app = withSession('admin', { refresh })
  const { server, port } = await listen(app)
  try {
    const home = await request(port, '/')
    assert.equal(home.status, 200)
    const publish = await postJson(port, '/api/bot-flow/publish')
    assert.equal(publish.status, 200)
    assert.equal(supabase.selects, 0)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})
