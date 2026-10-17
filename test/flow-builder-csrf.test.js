const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const crypto = require('crypto')
const bcrypt = require('bcrypt')

const ROOT = path.join(__dirname, '..')

const FLOW_BUILDER_FILES = [
  'public/js/flow-builder.js',
  'public/js/flow-builder/clipboard.js',
  'public/js/flow-builder/commands.js',
  'public/js/flow-builder/palette.js',
  'public/js/flow-builder/state.js',
  'views/settings-bot-flow.ejs',
  'views/settings-bot-copy.ejs',
]

// Inventory of every state-changing Flow Builder / bot-copy call. A new
// non-GET fetch or form in these files fails this test until it is added
// here and sends the CSRF token.
const EXPECTED_MUTATING_FETCHES = [
  { file: 'public/js/flow-builder.js', method: 'POST', url: '/api/bot-flow/draft' },
  { file: 'public/js/flow-builder.js', method: 'POST', url: '/api/bot-flow/publish' },
  { file: 'public/js/flow-builder.js', method: 'POST', url: '/api/bot-flow/preview-step' },
  { file: 'public/js/flow-builder.js', method: 'POST', url: '/settings/bot-flow/toggle' },
  { file: 'public/js/flow-builder.js', method: 'POST', url: '/api/bot-copy' },
]

const EXPECTED_GET_FETCHES = [
  { file: 'public/js/flow-builder.js', method: 'GET', url: '/api/bot-copy' },
  { file: 'public/js/flow-builder.js', method: 'GET', url: '/api/bot-flow' },
]

const EXPECTED_MUTATING_FORMS = [
  {
    file: 'views/settings-bot-copy.ejs',
    method: 'POST',
    action: '/settings/bot-copy/<%= encodeURIComponent(row.key) %>',
  },
]

function readSource(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
}

function extractCall(source, openParenIndex) {
  let depth = 0
  let quote = null
  let escape = false
  for (let i = openParenIndex; i < source.length; i += 1) {
    const ch = source[i]
    if (quote) {
      if (escape) {
        escape = false
        continue
      }
      if (ch === '\\') {
        escape = true
        continue
      }
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch
      continue
    }
    if (ch === '(') depth += 1
    else if (ch === ')') {
      depth -= 1
      if (depth === 0) return source.slice(openParenIndex, i + 1)
    }
  }
  throw new Error('unbalanced call')
}

function listFetchCalls(rel) {
  const source = readSource(rel)
  const calls = []
  const re = /(?<![\w$])fetch\s*\(/g
  let match = re.exec(source)
  while (match) {
    const call = extractCall(source, match.index + match[0].lastIndexOf('('))
    const methodMatch = call.match(/method\s*:\s*['"]([A-Za-z]+)['"]/)
    const urlMatch = call.match(/^\(\s*['"]([^'"]+)['"]/)
    const method = methodMatch ? methodMatch[1].toUpperCase() : 'GET'
    const sendsCsrf = /csrfHeaders\s*\(|['"]X-CSRF-Token['"]|['"]x-csrf-token['"]|['"]_csrf['"]/.test(call)
    calls.push({
      file: rel,
      method,
      url: urlMatch ? urlMatch[1] : null,
      sendsCsrf,
      call,
    })
    match = re.exec(source)
  }
  return calls
}

function listXhrOpens(rel) {
  const source = readSource(rel)
  const opens = []
  const re = /\.open\(\s*['"]([A-Za-z]+)['"]/g
  let match = re.exec(source)
  while (match) {
    const method = match[1].toUpperCase()
    const around = source.slice(match.index, match.index + 500)
    const sendsCsrf = /csrfHeaders\s*\(|X-CSRF-Token|_csrf/.test(around)
    opens.push({ file: rel, method, sendsCsrf })
    match = re.exec(source)
  }
  return opens
}

function extractFormOpen(source, start) {
  let quote = null
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i]
    if (quote) {
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (ch === '>' && source[i - 1] !== '%') return source.slice(start, i + 1)
  }
  throw new Error('unclosed form tag')
}

function listForms(rel) {
  const source = readSource(rel)
  const forms = []
  const re = /<form\b/gi
  let match = re.exec(source)
  while (match) {
    const open = extractFormOpen(source, match.index)
    const closeAt = source.indexOf('</form>', match.index)
    const body = closeAt >= 0 ? source.slice(match.index + open.length, closeAt) : ''
    const methodMatch = open.match(/method\s*=\s*['"]([A-Za-z]+)['"]/i)
    const actionMatch = open.match(/action\s*=\s*['"]([^'"]*)['"]/i)
    const method = (methodMatch ? methodMatch[1] : 'GET').toUpperCase()
    forms.push({
      file: rel,
      method,
      action: actionMatch ? actionMatch[1] : '',
      sendsCsrf: /partials\/csrf|name=["']_csrf["']/.test(body),
    })
    match = re.exec(source)
  }
  return forms
}

test('every Flow Builder non-GET fetch and bot-copy form sends the CSRF token', () => {
  const fetches = FLOW_BUILDER_FILES.flatMap(listFetchCalls)
  const forms = FLOW_BUILDER_FILES.flatMap(listForms)
  const xhrs = FLOW_BUILDER_FILES.flatMap(listXhrOpens)

  const mutating = fetches.filter((call) => call.method !== 'GET' && call.method !== 'HEAD')
  const gets = fetches.filter((call) => call.method === 'GET' || call.method === 'HEAD')
  const mutatingForms = forms.filter((form) => form.method !== 'GET' && form.method !== 'HEAD')

  assert.deepEqual(
    mutating.map(({ file, method, url }) => ({ file, method, url })),
    EXPECTED_MUTATING_FETCHES
  )
  for (const call of mutating) {
    assert.equal(call.sendsCsrf, true, `${call.method} ${call.url} in ${call.file} must send the CSRF token`)
    assert.match(call.call, /csrfHeaders\s*\(/)
  }

  assert.deepEqual(
    gets.map(({ file, method, url }) => ({ file, method, url })),
    EXPECTED_GET_FETCHES
  )

  assert.deepEqual(
    mutatingForms.map(({ file, method, action }) => ({ file, method, action })),
    EXPECTED_MUTATING_FORMS
  )
  for (const form of mutatingForms) {
    assert.equal(form.sendsCsrf, true, `${form.method} ${form.action} in ${form.file} must include the CSRF field`)
  }

  const mutatingXhr = xhrs.filter((call) => call.method !== 'GET' && call.method !== 'HEAD')
  assert.deepEqual(mutatingXhr, [])

  const flowPage = readSource('views/settings-bot-flow.ejs')
  assert.ok(flowPage.indexOf("partials/head") >= 0)
  assert.ok(flowPage.indexOf("partials/head") < flowPage.indexOf('/js/flow-builder.js'))
  assert.equal(flowPage.includes('fetch('), false)
  assert.equal(flowPage.includes('XMLHttpRequest'), false)

  const head = readSource('views/partials/head.ejs')
  assert.match(head, /name="csrf-token"/)
  assert.match(head, /\/js\/csrf\.js/)
})

const password = crypto.randomBytes(18).toString('base64url')
const nextPassword = crypto.randomBytes(18).toString('base64url')
const username = 'ops-user'
const adminRow = {
  id: 'admin-1',
  username,
  role: 'admin',
  is_active: true,
  password_hash: bcrypt.hashSync(password, 4),
}
const activeFlow = {
  id: 'flow-1',
  name: 'Main',
  is_active: true,
  entry_key: 'welcome',
  draft: null,
}
const validDraft = {
  entry_key: 'welcome',
  nodes: [
    {
      key: 'welcome',
      kind: 'screen',
      screen_key: 'screen.welcome',
      action: null,
      body: 'Hi',
      pos_x: 0,
      pos_y: 0,
      buttons: [],
      description: '',
    },
  ],
}

function queryResult(table, op) {
  if (table === 'BotFlow' && op === 'maybeSingle') return { data: activeFlow, error: null }
  if (table === 'Admin' && op === 'single') return { data: adminRow, error: null }
  if (table === 'BotFlowNode' || table === 'BotCopy') return { data: [], error: null }
  if (table === 'NotificationSettings' && op === 'maybeSingle') {
    return { data: { setting_key: 'cache_version', setting_value: { value: 3 } }, error: null }
  }
  if (op === 'query') return { data: [], error: null }
  return { data: null, error: null }
}

function supabaseBuilder(table) {
  let op = 'query'
  const builder = {
    select() { return builder },
    insert() { op = 'write'; return builder },
    update() { op = 'write'; return builder },
    upsert() { op = 'write'; return builder },
    delete() { op = 'write'; return builder },
    eq() { return builder },
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
    maybeSingle() { return Promise.resolve(queryResult(table, 'maybeSingle')) },
    single() { return Promise.resolve(queryResult(table, 'single')) },
    then(ok, bad) { return Promise.resolve(queryResult(table, op)).then(ok, bad) },
  }
  return builder
}

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

delete process.env.ADMIN_USERNAME
delete process.env.ADMIN_PASSWORD

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

function cookieHeader(res) {
  const cookies = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : [])
  return cookies.map((c) => c.split(';')[0]).filter(Boolean)
}

function mergeCookies(previous, res) {
  const map = new Map()
  for (const part of String(previous || '').split(';').map((s) => s.trim()).filter(Boolean)) {
    const eq = part.indexOf('=')
    if (eq > 0) map.set(part.slice(0, eq), part)
  }
  for (const part of cookieHeader(res)) {
    const eq = part.indexOf('=')
    if (eq > 0) map.set(part.slice(0, eq), part)
  }
  return [...map.values()].join('; ')
}

function csrfFromHtml(html) {
  const match = String(html).match(/name="_csrf" value="([^"]+)"/)
  assert.ok(match, 'page should render a CSRF token')
  return match[1]
}

test('flow builder, bot copy, login, change-password, and logout honor CSRF', async () => {
  const { server, url } = await listen(app)
  try {
    const loginPage = await fetch(`${url}/login`, { redirect: 'manual' })
    assert.equal(loginPage.status, 200)
    let cookie = mergeCookies('', loginPage)
    const loginToken = csrfFromHtml(await loginPage.text())
    assert.ok(cookie)

    const loginDenied = await fetch(`${url}/login`, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        Cookie: cookie,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ username, password }).toString(),
    })
    assert.equal(loginDenied.status, 403)

    const loginOk = await fetch(`${url}/login`, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        Cookie: cookie,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ _csrf: loginToken, username, password }).toString(),
    })
    assert.equal(loginOk.status, 302)
    assert.equal(loginOk.headers.get('location'), '/')
    cookie = mergeCookies(cookie, loginOk)

    const passwordPage = await fetch(`${url}/admin/change-password`, {
      redirect: 'manual',
      headers: { Cookie: cookie },
    })
    assert.equal(passwordPage.status, 200)
    const token = csrfFromHtml(await passwordPage.text())

    const routes = [
      {
        path: '/api/bot-flow/draft',
        json: { draft: validDraft },
      },
      {
        path: '/api/bot-flow/preview-step',
        json: { draft: validDraft, nodeKey: 'welcome' },
      },
      {
        path: '/api/bot-flow/publish',
        json: { draft: validDraft },
      },
      {
        path: '/settings/bot-flow/toggle',
        json: { enabled: true },
        accept: 'application/json',
      },
      {
        path: '/api/bot-copy',
        json: { copy: { 'msg.menu_stok': 'Stok' } },
      },
      {
        path: '/settings/bot-copy/msg.menu_stok',
        form: { body: 'Stok tersedia' },
      },
    ]

    for (const route of routes) {
      const denied = await fetch(`${url}${route.path}`, {
        method: 'POST',
        redirect: 'manual',
        headers: {
          Cookie: cookie,
          ...(route.json
            ? { 'Content-Type': 'application/json', Accept: route.accept || 'application/json' }
            : { 'Content-Type': 'application/x-www-form-urlencoded' }),
        },
        body: route.json ? JSON.stringify(route.json) : new URLSearchParams(route.form).toString(),
      })
      assert.equal(denied.status, 403, `${route.path} without a token should be 403, got ${denied.status}`)

      const headers = {
        Cookie: cookie,
        ...(route.json
          ? {
            'Content-Type': 'application/json',
            Accept: route.accept || 'application/json',
            'X-CSRF-Token': token,
          }
          : { 'Content-Type': 'application/x-www-form-urlencoded' }),
      }
      const body = route.json
        ? JSON.stringify(route.json)
        : new URLSearchParams({ ...route.form, _csrf: token }).toString()
      const allowed = await fetch(`${url}${route.path}`, {
        method: 'POST',
        redirect: 'manual',
        headers,
        body,
      })
      assert.notEqual(allowed.status, 403, `${route.path} with a token should pass CSRF`)
      if (route.json) {
        assert.equal(allowed.status, 200, `${route.path} should succeed, got ${allowed.status}`)
        const payload = await allowed.json()
        assert.equal(payload.success, true, `${route.path} body: ${JSON.stringify(payload)}`)
      } else {
        assert.equal(allowed.status, 302, `${route.path} should redirect after save`)
        assert.match(allowed.headers.get('location') || '', /success=1/)
      }
    }

    const passwordDenied = await fetch(`${url}/admin/change-password`, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        Cookie: cookie,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        currentPassword: password,
        newPassword: nextPassword,
        confirmPassword: nextPassword,
      }).toString(),
    })
    assert.equal(passwordDenied.status, 403)

    const passwordOk = await fetch(`${url}/admin/change-password`, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        Cookie: cookie,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        _csrf: token,
        currentPassword: password,
        newPassword: nextPassword,
        confirmPassword: nextPassword,
      }).toString(),
    })
    assert.equal(passwordOk.status, 302)
    assert.match(passwordOk.headers.get('location') || '', /success=changed/)
    cookie = mergeCookies(cookie, passwordOk)

    const logout = await fetch(`${url}/logout`, {
      redirect: 'manual',
      headers: { Cookie: cookie },
    })
    assert.notEqual(logout.status, 403)
    assert.equal(logout.status, 302)
    assert.match(logout.headers.get('location') || '', /\/login/)
  } finally {
    await close(server)
  }
})
