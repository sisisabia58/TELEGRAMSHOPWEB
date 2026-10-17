const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

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
// Dotenv: optional `export `, horizontal whitespace around '='.
// A non-whitespace value on the same line counts (unquoted values are trimmed).
const POLA_ASSIGN_ADMIN_USERNAME = /^[ \t]*(?:export[ \t]+)?ADMIN_USERNAME[ \t]*=[ \t]*\S/m
const POLA_ASSIGN_ADMIN_PASSWORD = /^[ \t]*(?:export[ \t]+)?ADMIN_PASSWORD[ \t]*=[ \t]*\S/m
const POLA_PLACEHOLDER_CONTOH = /^(?:[-–—])?$/

function baca(...bagian) {
  return fs.readFileSync(path.join(AKAR, ...bagian), 'utf8')
}

function selContohTabelEnv(markdown, namaVar) {
  const baris = markdown.split(/\r?\n/).find((l) => {
    const sel = l.split('|').map((s) => s.trim())
    return sel[1] === `\`${namaVar}\``
  })
  assert.ok(baris, `missing markdown table row for ${namaVar}`)
  const sel = baris.split('|').map((s) => s.trim())
  assert.ok(sel.length >= 4, `table row for ${namaVar} must have an example cell`)
  return sel[3]
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
  assert.match(teks, /No defaults: leaving these empty disables env fallback \(fail closed\)/)
  assert.doesNotMatch(teks, /hardening PR #47/)
})

test('README and AGENTS.md describe fail-closed env-fallback login', () => {
  const readme = baca('README.md')
  const agents = baca('AGENTS.md')
  assert.match(readme, /tidak punya default/i)
  assert.match(readme, /fallback ditolak \(fail closed\)/)
  assert.match(readme, /wajib di-set; tidak ada default/)
  assert.match(readme, /Tidak ada kredensial default/)
  assert.match(agents, /no hardcoded default/i)
  assert.match(agents, /env-fallback login is refused/)
  assert.doesNotMatch(readme, /hardening PR #47|tiba di PR #47/)
  assert.doesNotMatch(agents, /hardening PR #47/)
})

test('ADMIN_* assignment regex matches single-character and indented values', () => {
  assert.match('ADMIN_USERNAME=a', POLA_ASSIGN_ADMIN_USERNAME)
  assert.match('ADMIN_PASSWORD=x', POLA_ASSIGN_ADMIN_PASSWORD)
  assert.match('  ADMIN_USERNAME=foo', POLA_ASSIGN_ADMIN_USERNAME)
  assert.match('\tADMIN_PASSWORD=bar', POLA_ASSIGN_ADMIN_PASSWORD)
  assert.match(' \tADMIN_USERNAME=z', POLA_ASSIGN_ADMIN_USERNAME)
  // dotenv trims unquoted values, so a space after '=' is still a concrete assignment.
  assert.match('ADMIN_PASSWORD= dummy-pass', POLA_ASSIGN_ADMIN_PASSWORD)
  assert.match('ADMIN_USERNAME=\tnot-a-real-user', POLA_ASSIGN_ADMIN_USERNAME)
  assert.match('ADMIN_PASSWORD=  fake-pass-xyz', POLA_ASSIGN_ADMIN_PASSWORD)
  assert.match('ADMIN_PASSWORD = secret', POLA_ASSIGN_ADMIN_PASSWORD)
  assert.match('ADMIN_USERNAME = secret', POLA_ASSIGN_ADMIN_USERNAME)
  assert.match('export ADMIN_PASSWORD = secret', POLA_ASSIGN_ADMIN_PASSWORD)
  assert.match('export ADMIN_USERNAME=secret', POLA_ASSIGN_ADMIN_USERNAME)
  assert.doesNotMatch('ADMIN_USERNAME=', POLA_ASSIGN_ADMIN_USERNAME)
  assert.doesNotMatch('ADMIN_PASSWORD=', POLA_ASSIGN_ADMIN_PASSWORD)
  assert.doesNotMatch('ADMIN_USERNAME=  ', POLA_ASSIGN_ADMIN_USERNAME)
  assert.doesNotMatch('# ADMIN_USERNAME=a', POLA_ASSIGN_ADMIN_USERNAME)
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

function assertTidakAdaAssignAdmin(berkas, teks) {
  assert.doesNotMatch(
    teks,
    POLA_ASSIGN_ADMIN_USERNAME,
    `${berkas} must not ship a concrete ADMIN_USERNAME`
  )
  assert.doesNotMatch(
    teks,
    POLA_ASSIGN_ADMIN_PASSWORD,
    `${berkas} must not ship a concrete ADMIN_PASSWORD`
  )
}

test('docs do not assign a concrete ADMIN_USERNAME or ADMIN_PASSWORD value', () => {
  for (const berkas of daftarSumber()) {
    assertTidakAdaAssignAdmin(berkas, baca(berkas))
  }
})

test('documentation scan rejects ADMIN_PASSWORD with space before equals', () => {
  const fixture = 'ADMIN_PASSWORD = secret'
  assert.throws(
    () => assertTidakAdaAssignAdmin('fixture', fixture),
    /must not ship a concrete ADMIN_PASSWORD/
  )
})

test('README example-cell checker rejects a concrete credential example', () => {
  const fixture = [
    '| Variabel | Deskripsi | Contoh |',
    '|----------|-----------|--------|',
    '| `ADMIN_USERNAME` | Username login dashboard | `not-a-real-user` |',
    '| `ADMIN_PASSWORD` | Password login dashboard | `fake-pass-xyz` |',
  ].join('\n')
  assert.doesNotMatch(
    selContohTabelEnv(fixture, 'ADMIN_USERNAME'),
    POLA_PLACEHOLDER_CONTOH
  )
  assert.doesNotMatch(
    selContohTabelEnv(fixture, 'ADMIN_PASSWORD'),
    POLA_PLACEHOLDER_CONTOH
  )
})

test('README ADMIN_USERNAME and ADMIN_PASSWORD example cells are placeholders', () => {
  const readme = baca('README.md')
  assert.match(
    selContohTabelEnv(readme, 'ADMIN_USERNAME'),
    POLA_PLACEHOLDER_CONTOH,
    'README ADMIN_USERNAME example cell must be a placeholder'
  )
  assert.match(
    selContohTabelEnv(readme, 'ADMIN_PASSWORD'),
    POLA_PLACEHOLDER_CONTOH,
    'README ADMIN_PASSWORD example cell must be a placeholder'
  )
})

test('source files have no quoted ADMIN_* env fallback', () => {
  // #47 removed the dashboard.js hardcoded env fallback. Empty credentials
  // now fail closed in lib/http-security.js resolveEnvAdminCredentials.
  // The page-render smoke test defaults ADMIN_* when unset so it can log in
  // locally. That is test setup, not the login fallback.
  for (const berkas of daftarSumber()) {
    if (berkas === 'test/dashboard-page-render.test.js') continue
    const teks = baca(berkas)
    assert.doesNotMatch(
      teks,
      /process\.env\.ADMIN_(USERNAME|PASSWORD)\s*\|\|\s*['"][^'"]+['"]/,
      `${berkas} must not hardcode an ADMIN_* fallback`
    )
  }
})

test('dashboard login refuses env fallback when credentials are empty', () => {
  const dash = baca('dashboard.js')
  const security = baca('lib/http-security.js')
  assert.match(dash, /resolveEnvAdminCredentials\(\)/)
  assert.match(dash, /if \(!envAdmin\)/)
  assert.match(security, /function resolveEnvAdminCredentials/)
  assert.match(security, /if \(!username \|\| !password\)/)
  assert.match(security, /refusing env fallback login \(fail closed, no defaults\)/)
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
  const guard = teks.match(
    /if \(!sessionSecret && process\.env\.NODE_ENV === 'production'\) \{[^}]*\}/
  )
  assert.ok(guard, 'production SESSION_SECRET guard must exist')
  assert.match(guard[0], /SESSION_SECRET is required in production/)
  assert.match(guard[0], /process\.exit\(1\)/)

  // Require dashboard as a library from an empty directory. dotenv then finds
  // no .env, require.main is not dashboard.js (no listen, no cron), and
  // index.js (the Telegram poller) is never started.
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-nosecret-'))
  try {
    const env = { ...process.env }
    env.NODE_ENV = 'production'
    env.SUPABASE_URL = 'http://127.0.0.1:54321'
    env.SUPABASE_KEY = 'dummy'
    delete env.SESSION_SECRET
    delete env.TOKEN_BOT
    delete env.ADMIN_USERNAME
    delete env.ADMIN_PASSWORD
    delete env.PAKASIR_API_KEY
    delete env.PAKASIR_PROJECT
    const hasil = spawnSync(
      process.execPath,
      ['-e', 'require(process.argv[1])', path.join(AKAR, 'dashboard.js')],
      { cwd, env, encoding: 'utf8', timeout: 20000 }
    )
    assert.equal(hasil.status, 1, hasil.stderr || hasil.stdout || String(hasil.error))
    assert.match(hasil.stderr || '', /SESSION_SECRET is required in production/)
    assert.doesNotMatch(hasil.stdout || '', /Dashboard berjalan/)
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true })
  }
})
