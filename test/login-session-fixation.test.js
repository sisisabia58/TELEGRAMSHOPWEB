const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const crypto = require('crypto')
const bcrypt = require('bcrypt')

const dbUsername = 'ops-user'
const dbPassword = crypto.randomBytes(18).toString('base64url')
const envUsername = 'env-operator'
const envPassword = crypto.randomBytes(18).toString('base64url')

const adminRow = {
  id: 'admin-1',
  username: dbUsername,
  role: 'admin',
  is_active: true,
  password_hash: bcrypt.hashSync(dbPassword, 4),
}

function queryResult(table, op, filters) {
  if (table === 'Admin' && op === 'single') {
    if (filters.username === dbUsername) return { data: adminRow, error: null }
    return { data: null, error: { message: 'not found' } }
  }
  if (op === 'query' || op === 'write') return { data: [], error: null }
  return { data: null, error: null }
}

function supabaseBuilder(table) {
  const filters = {}
  let op = 'query'
  const builder = {
    select() { return builder },
    insert() { op = 'write'; return builder },
    update() { op = 'write'; return builder },
    upsert() { op = 'write'; return builder },
    delete() { op = 'write'; return builder },
    eq(column, value) { filters[column] = value; return builder },
    neq() { return builder },
    in() { return builder },
    order() { return builder },
    gte() { return builder },
    lt() { return builder },
    lte() { return builder },
    gt() { return builder },
    like() { return builder },
    ilike() { return builder },
    is() { return builder },
    match() { return builder },
    or() { return builder },
    filter() { return builder },
    limit() { return builder },
    range() { return builder },
    maybeSingle() { return Promise.resolve(queryResult(table, 'maybeSingle', filters)) },
    single() { return Promise.resolve(queryResult(table, 'single', filters)) },
    then(ok, bad) { return Promise.resolve(queryResult(table, op, filters)).then(ok, bad) },
  }
  return builder
}

process.env.ADMIN_USERNAME = envUsername
process.env.ADMIN_PASSWORD = envPassword

const jalurClient = require.resolve('../lib/supabase.js')
require.cache[jalurClient] = {
  id: jalurClient,
  filename: jalurClient,
  loaded: true,
  exports: {
    from(table) { return supabaseBuilder(table) },
    rpc() { return Promise.resolve({ data: null, error: null }) },
  },
}

const app = require('../dashboard')

function listen(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler)
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

function setCookieLines(res) {
  if (typeof res.headers.getSetCookie === 'function') return res.headers.getSetCookie()
  const raw = res.headers.get('set-cookie')
  return raw ? [raw] : []
}

function cookiePair(res, name) {
  const line = setCookieLines(res).find((entry) => entry.toLowerCase().startsWith(`${name.toLowerCase()}=`))
  assert.ok(line, `expected Set-Cookie ${name}`)
  return line.split(';')[0]
}

function sessionIdFromPair(pair) {
  const raw = decodeURIComponent(pair.slice(pair.indexOf('=') + 1))
  assert.match(raw, /^s:/)
  const body = raw.slice(2)
  const dot = body.lastIndexOf('.')
  assert.ok(dot > 0)
  return body.slice(0, dot)
}

function csrfFromHtml(html) {
  const match = String(html).match(/name="_csrf" value="([^"]+)"/)
    || String(html).match(/name="csrf-token" content="([^"]+)"/)
  assert.ok(match, 'page should render a CSRF token')
  return match[1]
}

async function assertLoginRotatesSession(url, credentials) {
  const loginPage = await fetch(`${url}/login`, { redirect: 'manual' })
  assert.equal(loginPage.status, 200)
  const preLoginPair = cookiePair(loginPage, 'connect.sid')
  const preLoginId = sessionIdFromPair(preLoginPair)
  const preLoginToken = csrfFromHtml(await loginPage.text())
  assert.ok(preLoginToken)

  const loginOk = await fetch(`${url}/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      Cookie: preLoginPair,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      _csrf: preLoginToken,
      username: credentials.username,
      password: credentials.password,
    }).toString(),
  })
  assert.equal(loginOk.status, 302)
  assert.equal(loginOk.headers.get('location'), '/')
  const postLoginPair = cookiePair(loginOk, 'connect.sid')
  const postLoginId = sessionIdFromPair(postLoginPair)
  assert.notEqual(postLoginId, preLoginId)

  const oldSession = await fetch(`${url}/admin/change-password`, {
    redirect: 'manual',
    headers: { Cookie: preLoginPair },
  })
  assert.equal(oldSession.status, 302)
  assert.match(oldSession.headers.get('location') || '', /\/login/)

  const authedPage = await fetch(`${url}/admin/change-password`, {
    redirect: 'manual',
    headers: { Cookie: postLoginPair },
  })
  assert.equal(authedPage.status, 200)
  const freshToken = csrfFromHtml(await authedPage.text())
  assert.notEqual(freshToken, preLoginToken)

  const staleToken = await fetch(`${url}/admin/change-password`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      Cookie: postLoginPair,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      _csrf: preLoginToken,
      currentPassword: credentials.password,
      newPassword: 'ignored',
      confirmPassword: 'ignored',
    }).toString(),
  })
  assert.equal(staleToken.status, 403)

  const freshTokenOk = await fetch(`${url}/admin/change-password`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      Cookie: postLoginPair,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ _csrf: freshToken }).toString(),
  })
  assert.equal(freshTokenOk.status, 200)
}

test('successful login regenerates the session id and retires the pre-login CSRF token', async () => {
  const { server, url } = await listen(app)
  try {
    await assertLoginRotatesSession(url, { username: dbUsername, password: dbPassword })
    await assertLoginRotatesSession(url, { username: envUsername, password: envPassword })
  } finally {
    await close(server)
  }
})
