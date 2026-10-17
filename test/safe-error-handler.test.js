const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const express = require('express')

const { safeErrorHandler, exposeErrorDetails } = require('../lib/safe-error-handler')

const dashboardSrc = fs.readFileSync(path.join(__dirname, '..', 'dashboard.js'), 'utf8')
const MARKER = 'UNIQUE_STACK_MARKER_do_not_leak'

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

function withNodeEnv(value, fn) {
  const prev = process.env.NODE_ENV
  const had = Object.prototype.hasOwnProperty.call(process.env, 'NODE_ENV')
  if (value === undefined) delete process.env.NODE_ENV
  else process.env.NODE_ENV = value
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (had) process.env.NODE_ENV = prev
      else delete process.env.NODE_ENV
    })
}

function silenceConsoleError(t) {
  const errors = []
  const orig = console.error
  console.error = (...args) => { errors.push(args) }
  t.after(() => { console.error = orig })
  return errors
}

function boomApp(options = {}) {
  const app = express()
  app.set('view engine', 'ejs')
  app.set('views', path.join(__dirname, '..', 'views'))
  if (options.beforeRoutes) options.beforeRoutes(app)
  app.get('/boom', (req, res, next) => {
    next(Object.assign(new Error(MARKER), { stack: `${MARKER}\n    at fake.js:1:1` }))
  })
  app.get('/api/boom', (req, res, next) => {
    next(Object.assign(new Error(MARKER), { stack: `${MARKER}\n    at fake.js:1:1` }))
  })
  app.get('/ejs-boom', (req, res) => {
    res.render('does-not-exist-view')
  })
  app.use(safeErrorHandler)
  return app
}

test('dashboard.js registers the safe error handler after routes', () => {
  assert.match(dashboardSrc, /safeErrorHandler/)
  const handlerAt = dashboardSrc.lastIndexOf('app.use(safeErrorHandler)')
  const listenAt = dashboardSrc.lastIndexOf('app.listen')
  assert.ok(handlerAt > 0, 'safeErrorHandler must be mounted')
  assert.ok(listenAt > handlerAt, 'error handler must be registered before app.listen')
})

test('exposeErrorDetails is true only for development and test', () => {
  assert.equal(exposeErrorDetails('development'), true)
  assert.equal(exposeErrorDetails('test'), true)
  assert.equal(exposeErrorDetails('production'), false)
  assert.equal(exposeErrorDetails('staging'), false)
  assert.equal(exposeErrorDetails(''), false)
  assert.equal(exposeErrorDetails(undefined), false)
})

test('production HTML response hides stack and error message', async (t) => {
  const errors = silenceConsoleError(t)

  await withNodeEnv('production', async () => {
    const server = await listen(boomApp())
    try {
      const res = await fetch(`${server.origin}/boom`)
      const body = await res.text()
      assert.equal(res.status, 500)
      assert.match(body, /Terjadi kesalahan/)
      assert.equal(body.includes(MARKER), false)
      assert.equal(body.includes('fake.js'), false)
      assert.equal(body.includes('at '), false)
      assert.ok(errors.length >= 1, 'must log the error server-side')
    } finally {
      await server.close()
    }
  })
})

test('unset NODE_ENV hides details (do not rely on production being set)', async (t) => {
  silenceConsoleError(t)
  await withNodeEnv(undefined, async () => {
    const server = await listen(boomApp())
    try {
      const res = await fetch(`${server.origin}/boom`)
      const body = await res.text()
      assert.equal(res.status, 500)
      assert.equal(body.includes(MARKER), false)
      assert.equal(body.includes('at fake.js'), false)
    } finally {
      await server.close()
    }
  })
})

test('production /api JSON hides stack and error message', async (t) => {
  silenceConsoleError(t)
  await withNodeEnv('production', async () => {
    const server = await listen(boomApp())
    try {
      const res = await fetch(`${server.origin}/api/boom`)
      const body = await res.text()
      assert.equal(res.status, 500)
      assert.match(res.headers.get('content-type'), /json/)
      const json = JSON.parse(body)
      assert.equal(json.error, 'Terjadi kesalahan. Silakan coba lagi.')
      assert.equal('stack' in json, false)
      assert.equal(body.includes(MARKER), false)
    } finally {
      await server.close()
    }
  })
})

test('development HTML response includes message and stack', async (t) => {
  silenceConsoleError(t)
  await withNodeEnv('development', async () => {
    const server = await listen(boomApp())
    try {
      const res = await fetch(`${server.origin}/boom`)
      const body = await res.text()
      assert.equal(res.status, 500)
      assert.match(body, new RegExp(MARKER))
      assert.match(body, /fake\.js/)
    } finally {
      await server.close()
    }
  })
})

test('EJS render errors go through the handler and stay generic outside development/test', async (t) => {
  silenceConsoleError(t)
  await withNodeEnv('staging', async () => {
    const server = await listen(boomApp())
    try {
      const res = await fetch(`${server.origin}/ejs-boom`)
      const body = await res.text()
      assert.equal(res.status, 500)
      assert.match(body, /Terjadi kesalahan/)
      assert.equal(body.includes('does-not-exist-view'), false)
      assert.equal(/Failed to lookup view/i.test(body), false)
      assert.equal(body.includes('node_modules'), false)
    } finally {
      await server.close()
    }
  })
})
