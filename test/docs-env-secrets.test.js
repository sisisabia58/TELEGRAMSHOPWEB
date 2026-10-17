const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const AKAR = path.join(__dirname, '..')
const LEWATI_DIR = new Set(['node_modules', '.git', '.supabase', 'Database'])
const EKSTENSI = new Set([
  '.md',
  '.ejs',
  '.sql',
  '.example',
  '.js',
  '.yml',
  '.yaml',
  '.txt',
  '.sh',
])

function baca(...bagian) {
  return fs.readFileSync(path.join(AKAR, ...bagian), 'utf8')
}

function daftarSumber(dir = AKAR, acc = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (LEWATI_DIR.has(ent.name)) continue
    const full = path.join(dir, ent.name)
    if (ent.isDirectory()) {
      daftarSumber(full, acc)
      continue
    }
    const ext = path.extname(ent.name)
    if (ent.name === '.env.example' || EKSTENSI.has(ext)) {
      acc.push(path.relative(AKAR, full))
    }
  }
  return acc
}

test('.env.example leaves ADMIN_USERNAME and ADMIN_PASSWORD empty', () => {
  const teks = baca('.env.example')
  assert.match(teks, /^ADMIN_USERNAME=\s*$/m)
  assert.match(teks, /^ADMIN_PASSWORD=\s*$/m)
})

test('README and AGENTS.md say env-fallback login has no default', () => {
  const readme = baca('README.md')
  const agents = baca('AGENTS.md')
  assert.match(readme, /tidak punya default/i)
  assert.match(readme, /Tidak ada kredensial default/)
  assert.match(agents, /no hardcoded default/i)
})

test('docs and examples do not show a default username/password pair', () => {
  for (const berkas of daftarSumber()) {
    const teks = baca(berkas)
    assert.doesNotMatch(
      teks,
      /default\s+`[^`]+`\s*\/\s*`[^`]+`/i,
      `${berkas} must not document a default username/password pair`
    )
  }
})

test('docs do not assign a concrete ADMIN_USERNAME or ADMIN_PASSWORD value', () => {
  for (const berkas of daftarSumber()) {
    const teks = baca(berkas)
    assert.doesNotMatch(
      teks,
      /^ADMIN_USERNAME=.+\S/m,
      `${berkas} must not ship a concrete ADMIN_USERNAME`
    )
    assert.doesNotMatch(
      teks,
      /^ADMIN_PASSWORD=.+\S/m,
      `${berkas} must not ship a concrete ADMIN_PASSWORD`
    )
  }
})

test('files other than dashboard.js have no quoted ADMIN_* env fallback', () => {
  // dashboard.js env-fallback strings are removed in PR #47; this PR does not touch that file.
  for (const berkas of daftarSumber()) {
    if (berkas === 'dashboard.js') continue
    const teks = baca(berkas)
    assert.doesNotMatch(
      teks,
      /process\.env\.ADMIN_(USERNAME|PASSWORD)\s*\|\|\s*['"][^'"]+['"]/,
      `${berkas} must not hardcode an ADMIN_* fallback`
    )
  }
})

test('settings.js secret env vars default to empty rather than a key', () => {
  const teks = baca('settings.js')
  assert.match(teks, /process\.env\.TOKEN_BOT \|\| ""/)
  assert.match(teks, /process\.env\.SUPABASE_KEY \|\| ""/)
  assert.match(teks, /process\.env\.PAKASIR_API_KEY \|\| ""/)
  assert.match(teks, /process\.env\.PAKASIR_PROJECT \|\| ""/)
})

test('dashboard.js refuses to boot in production without SESSION_SECRET', () => {
  const teks = baca('dashboard.js')
  assert.match(teks, /SESSION_SECRET is required in production/)
  assert.match(teks, /!sessionSecret && process\.env\.NODE_ENV === 'production'/)
})
