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
// Leading horizontal whitespace; optional horizontal whitespace after '=';
// a non-whitespace value on the same line (dotenv trims unquoted values).
const POLA_ASSIGN_ADMIN_USERNAME = /^[ \t]*ADMIN_USERNAME=[ \t]*\S/m
const POLA_ASSIGN_ADMIN_PASSWORD = /^[ \t]*ADMIN_PASSWORD=[ \t]*\S/m
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
  assert.match(teks, /Always set ADMIN_USERNAME and ADMIN_PASSWORD, or create an Admin row/)
  assert.match(teks, /hardening PR #47/)
})

test('README and AGENTS.md tell operators to set env credentials until #47', () => {
  const readme = baca('README.md')
  const agents = baca('AGENTS.md')
  assert.match(readme, /Selalu set kedua variabel itu, atau buat row Admin/)
  assert.match(readme, /hardening PR #47/)
  assert.match(agents, /Always set those env vars, or create an Admin row/)
  assert.match(agents, /hardening PR #47/)
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

test('docs do not assign a concrete ADMIN_USERNAME or ADMIN_PASSWORD value', () => {
  for (const berkas of daftarSumber()) {
    const teks = baca(berkas)
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
