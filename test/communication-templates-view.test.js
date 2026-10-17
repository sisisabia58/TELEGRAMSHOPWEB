const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const express = require('express')

const { formatrupiah, formatTanggal } = require('../lib/format')

const dashboardSrc = fs.readFileSync(path.join(__dirname, '..', 'dashboard.js'), 'utf8')
const views = path.join(__dirname, '..', 'views')

const templateRow = {
  id: 'tmpl-1',
  name: 'Welcome QA',
  category: 'umum',
  subject: 'Halo',
  variables: ['nama'],
  is_active: true,
  created_at: '2026-01-01T00:00:00.000Z',
}

// Locals match the route data (helpers come from app.locals, not this object).
const routeLocals = {
  title: 'Message Templates - Test Bot',
  namaBot: 'Test Bot',
  username: 'admin',
  templates: [templateRow],
  success: null,
  error: null,
  req: { session: { role: 'admin' } },
}

function listen(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      resolve({
        origin: `http://127.0.0.1:${port}`,
        close: () => new Promise((res, rej) => server.close((err) => (err ? rej(err) : res()))),
      })
    })
    server.on('error', reject)
  })
}

test('dashboard.js assigns format helpers on app.locals so every view has them', () => {
  assert.match(dashboardSrc, /app\.locals\.formatTanggal\s*=\s*formatTanggal/)
  assert.match(dashboardSrc, /app\.locals\.formatrupiah\s*=\s*formatrupiah/)
})

test('GET communication-templates with a template row returns 200 via app.locals helpers', async () => {
  const app = express()
  app.set('view engine', 'ejs')
  app.set('views', views)
  app.locals.formatTanggal = formatTanggal
  app.locals.formatrupiah = formatrupiah

  app.get('/communication/templates', (req, res) => {
    res.render('communication-templates', routeLocals)
  })

  const server = await listen(app)
  try {
    const res = await fetch(`${server.origin}/communication/templates`)
    const body = await res.text()
    assert.equal(res.status, 200, body.slice(0, 500))
    assert.match(body, /Welcome QA/)
    assert.match(body, /01 Januari 2026, 07:00/)
    assert.equal(body.includes('formatTanggal is not defined'), false)
    assert.equal(body.includes('ReferenceError'), false)
  } finally {
    await server.close()
  }
})
