const assert = require('node:assert/strict')
const http = require('node:http')
const test = require('node:test')
const express = require('express')
const { requireRole, requireWriteAccess, canWrite, WRITE_METHODS, isExemptWrite } = require('../lib/dashboard-auth')

function withSession(role) {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.session = { isLoggedIn: true, role }
    next()
  })
  app.use(requireWriteAccess)
  app.post('/api/bot-flow/publish', (_req, res) => res.json({ ok: true }))
  app.post('/api/settings/payment-gateway', (_req, res) => res.json({ ok: true }))
  app.post('/produk/tambah', (_req, res) => res.json({ ok: true }))
  app.post('/admin/users/tambah', requireRole('admin'), (_req, res) => res.json({ ok: true }))
  app.post('/admin/change-password', (_req, res) => res.json({ ok: true }))
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

async function postJson(port, path) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: '{}',
  })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* not json */ }
  return { status: res.status, text, json }
}

test('permission map: viewer is read-only, staff and admin may write', () => {
  assert.equal(canWrite('viewer'), false)
  assert.equal(canWrite('staff'), true)
  assert.equal(canWrite('admin'), true)
  assert.deepEqual(WRITE_METHODS, ['POST', 'PUT', 'PATCH', 'DELETE'])
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

test('isExemptWrite accepts case and trailing-slash variants and stays fail-closed', () => {
  assert.equal(isExemptWrite('post', '/login/'), true)
  assert.equal(isExemptWrite('POST', '/Admin/Change-Password'), true)
  assert.equal(isExemptWrite('POST', '/webhook/pakasir/'), true)
  assert.equal(isExemptWrite('POST', '/api/notifications/read-all/'), true)
  assert.equal(isExemptWrite('POST', '/api/notifications/42/read'), true)
  assert.equal(isExemptWrite('POST', '/API/Notifications/AbC/Read/'), true)
  // The route template is covered by the notification regex, not a literal ":id" entry.
  assert.equal(isExemptWrite('POST', '/api/notifications/:id/read'), true)

  assert.equal(isExemptWrite('POST', '/api/settings/supabase'), false)
  assert.equal(isExemptWrite('POST', '/api/settings/supabase/'), false)
  assert.equal(isExemptWrite('POST', '/login/extra'), false)
  assert.equal(isExemptWrite('GET', '/login'), false)
  assert.equal(isExemptWrite('POST', ''), false)
  assert.equal(isExemptWrite('POST', '/'), false)
  assert.equal(isExemptWrite('POST', '/api/notifications//read'), false)
})

test('change-password remains available to a logged-in viewer (self-service)', async () => {
  const app = withSession('viewer')
  const { server, port } = await listen(app)
  try {
    const changed = await postJson(port, '/admin/change-password')
    assert.equal(changed.status, 200)
    const slash = await postJson(port, '/admin/change-password/')
    assert.equal(slash.status, 200)
    const mixed = await postJson(port, '/Admin/Change-Password')
    assert.equal(mixed.status, 200)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('a trailing slash does not exempt a viewer from a normal write route', async () => {
  const app = withSession('viewer')
  const { server, port } = await listen(app)
  try {
    const published = await postJson(port, '/api/bot-flow/publish/')
    assert.equal(published.status, 403)
    assert.equal(published.json.success, false)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})
