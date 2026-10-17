const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const ejs = require('ejs')
const { redactSecrets } = require('../lib/secret-mask')
const { WRITE_METHODS, isExemptWrite } = require('../lib/dashboard-auth')

const viewRoot = path.join(__dirname, '..', 'views')
const dashboardSrc = fs.readFileSync(path.join(__dirname, '..', 'dashboard.js'), 'utf8')

const PAKASIR = 'pakasir-live-SUPERSECRETVALUE-9xK2'
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.anon-SUPERSECRET-abcd'
const SERVICE_ROLE = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.service-role-SUPERSECRET-wxyz'

const chromeLocals = {
  title: 'Settings security test',
  namaBot: 'Test Bot',
  username: 'tester',
  req: { session: { role: 'admin' } },
  currentPage: 'settings',
  pageTitle: 'Settings',
  topbarExtra: '',
}

function mutatingRoutesFrom(src) {
  const routes = []
  const re = /app\.(post|put|patch|delete)\(\s*['`]([^'`]+)['`]/g
  let match
  while ((match = re.exec(src))) {
    routes.push({ method: match[1].toUpperCase(), path: match[2], index: match.index })
  }
  return routes
}

test('payment gateway and supabase settings HTML never contain the raw secrets', async () => {
  const paymentHtml = await ejs.renderFile(
    path.join(viewRoot, 'settings-payment-gateway.ejs'),
    {
      ...chromeLocals,
      currentPage: 'settings-payment-gateway',
      settings: redactSecrets({
        enabled: true,
        apiKey: PAKASIR,
        project: 'depodomain',
        baseUrl: 'https://app.pakasir.com',
        paymentTimeout: 10,
        qrisEnabled: true,
        saldoEnabled: true,
      }, ['apiKey']),
    },
    { views: [viewRoot] }
  )

  const supabaseHtml = await ejs.renderFile(
    path.join(viewRoot, 'settings-supabase.ejs'),
    {
      ...chromeLocals,
      currentPage: 'settings-supabase',
      settings: redactSecrets({
        enabled: true,
        url: 'https://example.supabase.co',
        key: SUPABASE_ANON,
        serviceKey: SERVICE_ROLE,
        connectionTimeout: 30,
        retryAttempts: 3,
        retryDelay: 1000,
      }, ['key', 'serviceKey']),
    },
    { views: [viewRoot] }
  )

  for (const [label, html, secret] of [
    ['payment', paymentHtml, PAKASIR],
    ['supabase anon', supabaseHtml, SUPABASE_ANON],
    ['service role', supabaseHtml, SERVICE_ROLE],
  ]) {
    assert.equal(html.includes(secret), false, `${label} secret leaked into HTML`)
    assert.equal(html.includes('SUPERSECRET'), false, `${label} secret fragment leaked into HTML`)
  }

  assert.match(paymentHtml, /9xK2/)
  assert.match(supabaseHtml, /abcd/)
  assert.match(supabaseHtml, /wxyz/)
})

function sliceRoute(src, routeLiteral) {
  const start = src.indexOf(routeLiteral)
  assert.ok(start >= 0, `missing route ${routeLiteral}`)
  const next = src.slice(start + routeLiteral.length).search(/\napp\.(get|post|put|patch|delete)\(/)
  return next < 0 ? src.slice(start) : src.slice(start, start + routeLiteral.length + next)
}

test('dashboard GET settings handlers redact secrets before render, and saves keep stored values', () => {
  assert.match(dashboardSrc, /redactSecrets\(\s*settings\s*,\s*\['apiKey'\]\s*\)/)
  assert.match(dashboardSrc, /redactSecrets\(\s*settings\s*,\s*\['key',\s*'serviceKey'\]\s*\)/)

  const paymentSave = sliceRoute(dashboardSrc, "app.post('/api/settings/payment-gateway',")
  const supabaseSave = sliceRoute(dashboardSrc, "app.post('/api/settings/supabase',")
  const supabaseTest = sliceRoute(dashboardSrc, "app.post('/api/settings/supabase/test',")

  assert.match(paymentSave, /secretUpdateRow\(\s*'payment_gateway_api_key'\s*,\s*apiKey\s*\)/)
  assert.doesNotMatch(paymentSave, /resolveSecretInput/)
  assert.doesNotMatch(paymentSave, /getPaymentGatewaySettings/)

  assert.match(supabaseSave, /secretUpdateRow\(\s*'supabase_key'\s*,\s*key\s*\)/)
  assert.match(supabaseSave, /secretUpdateRow\(\s*'supabase_service_key'\s*,\s*serviceKey\s*\)/)
  assert.doesNotMatch(supabaseSave, /resolveSecretInput/)
  assert.doesNotMatch(supabaseSave, /getSupabaseSettings/)

  assert.match(supabaseTest, /resolveSecretInput\(\s*req\.body\.key/)
  assert.match(supabaseTest, /getSupabaseSettings\s*\(/)
})

test('every mutating dashboard route is covered by requireWriteAccess (except login/webhook/self-service)', () => {
  assert.match(dashboardSrc, /app\.use\(\s*requireWriteAccess\s*\)/)
  const guardIndex = dashboardSrc.search(/app\.use\(\s*requireWriteAccess\s*\)/)
  assert.ok(guardIndex > 0, 'global write guard must be registered')

  const routes = mutatingRoutesFrom(dashboardSrc)
  assert.ok(routes.length > 10, 'expected many mutating dashboard routes')

  const uncovered = []
  for (const route of routes) {
    if (isExemptWrite(route.method, route.path)) continue
    if (route.index < guardIndex) uncovered.push(`${route.method} ${route.path}`)
  }
  assert.deepEqual(uncovered, [], `mutating routes registered before requireWriteAccess: ${uncovered.join(', ')}`)
  assert.equal(WRITE_METHODS.includes('POST'), true)
})
