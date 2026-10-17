const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const {
  inspectSupabaseKeyRole,
  warnIfNotServiceRole,
  getSupabaseKeyDiagnostics,
} = require('../lib/supabase-key-role')

function jwtForRole(role) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({ role, iss: 'supabase' })).toString('base64url')
  return `${header}.${payload}.signature-not-verified`
}

test('inspectSupabaseKeyRole accepts a service_role JWT', () => {
  const info = inspectSupabaseKeyRole(jwtForRole('service_role'))
  assert.equal(info.role, 'service_role')
  assert.equal(info.isServiceRole, true)
})

test('inspectSupabaseKeyRole rejects anon JWT and non-JWT keys', () => {
  assert.equal(inspectSupabaseKeyRole(jwtForRole('anon')).isServiceRole, false)
  assert.equal(inspectSupabaseKeyRole(jwtForRole('anon')).role, 'anon')
  assert.equal(inspectSupabaseKeyRole('sb_publishable_not-a-jwt').isServiceRole, false)
  assert.equal(inspectSupabaseKeyRole('dummy').isServiceRole, false)
  assert.equal(inspectSupabaseKeyRole('').isServiceRole, false)
  assert.equal(inspectSupabaseKeyRole(null).isServiceRole, false)
})

test('warnIfNotServiceRole logs a loud warning without the key (fail open)', () => {
  const key = jwtForRole('anon')
  const lines = []
  const log = { warn: (msg) => lines.push(String(msg)) }

  const info = warnIfNotServiceRole(key, log)
  assert.equal(info.isServiceRole, false)
  assert.ok(lines.length >= 1, 'must warn')
  const joined = lines.join('\n')
  assert.match(joined, /SECURITY/)
  assert.match(joined, /anon/)
  assert.doesNotMatch(joined, new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.doesNotMatch(joined, /signature-not-verified/)
})

test('warnIfNotServiceRole is silent for service_role', () => {
  const lines = []
  const log = { warn: (msg) => lines.push(String(msg)) }
  const info = warnIfNotServiceRole(jwtForRole('service_role'), log)
  assert.equal(info.isServiceRole, true)
  assert.deepEqual(lines, [])
})

test('diagnostics expose only the boolean, never the key', () => {
  const key = jwtForRole('service_role')
  const diag = getSupabaseKeyDiagnostics(key)
  assert.deepEqual(Object.keys(diag).sort(), ['supabaseKeyIsServiceRole'])
  assert.equal(diag.supabaseKeyIsServiceRole, true)
  assert.equal(getSupabaseKeyDiagnostics(jwtForRole('anon')).supabaseKeyIsServiceRole, false)
  assert.equal(JSON.stringify(diag).includes(key), false)
})

test('lib/supabase.js runs the warn-only self-check at startup', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'supabase.js'), 'utf8')
  assert.match(src, /warnIfNotServiceRole\s*\(/)
  assert.match(src, /createClient\s*\(\s*SUPABASE_URL\s*,\s*SUPABASE_KEY\s*\)/)
})

test('admin-only diagnostic endpoint exposes the boolean without the key', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'dashboard.js'), 'utf8')
  assert.match(src, /app\.get\(\s*'\/api\/diagnostics\/supabase-key'/)
  assert.match(src, /requireRole\(\s*'admin'\s*\)/)
  assert.match(src, /supabaseKeyIsServiceRole/)
  const handler = src.slice(src.indexOf('/api/diagnostics/supabase-key'))
  const jsonBlock = handler.slice(0, 800)
  assert.doesNotMatch(jsonBlock, /SUPABASE_KEY/)
})
