const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const MIGRATIONS = path.join(__dirname, '..', 'supabase', 'migrations')

function sqlSetelahBaseline() {
  return fs.readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql') && f > '20260818000000_supplier_sourcing.sql')
    .sort()
    .map((f) => fs.readFileSync(path.join(MIGRATIONS, f), 'utf8'))
    .join('\n\n')
}

const TABEL_SUPPLIER = ['Supplier', 'SupplierProduct', 'SupplierOrder']

// service_role harus jadi SATU-SATUNYA peran di klausa TO, bukan salah satu
// di daftar. `TO service_role, anon` tetap mengandung kata service_role.
function kebijakanServiceRoleSaja(tabel) {
  return new RegExp(
    `CREATE POLICY[^;]*ON "${tabel}"[^;]*\\bTO\\s+service_role\\b(?!\\s*,)[^;]*;`,
    'i'
  )
}

function tanpaKomentarSql(sql) {
  return String(sql)
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n')
}

function namaDanTabel(stmt, kata) {
  const re = new RegExp(
    `${kata}\\s+(?:IF\\s+EXISTS\\s+)?(?:"([^"]+)"|([A-Za-z_][A-Za-z0-9_]*))\\s+ON\\s+(?:"([^"]+)"|([A-Za-z_][A-Za-z0-9_]*))`,
    'i'
  )
  const m = stmt.match(re)
  if (!m) return null
  return { name: m[1] || m[2], tabel: m[3] || m[4] }
}

// Tanpa klausa TO, PostgreSQL memasang kebijakan ke PUBLIC.
function peranKebijakan(stmt) {
  const m = stmt.match(/\bTO\s+([\s\S]+?)(?=\s+USING\b|\s+WITH\s+CHECK\b|$)/i)
  if (!m) return ['PUBLIC']
  return m[1]
    .split(',')
    .map((role) => role.trim().replace(/^"(.*)"$/, '$1'))
    .filter(Boolean)
}

// Kebijakan yang masih ada setelah urutan DROP/CREATE, bukan setiap CREATE
// yang pernah tertulis. Kebijakan permisif kedua untuk anon/authenticated/PUBLIC
// tetap efektif walau ada kebijakan service_role di sampingnya.
function kebijakanEfektifSupplier(sql) {
  const aktif = new Map()
  for (const mentah of tanpaKomentarSql(sql).split(';')) {
    const stmt = mentah.trim()
    if (!stmt) continue
    if (/^DROP\s+POLICY\b/i.test(stmt)) {
      const info = namaDanTabel(stmt, 'DROP\\s+POLICY')
      if (info && TABEL_SUPPLIER.includes(info.tabel)) {
        aktif.delete(`${info.tabel}\0${info.name}`)
      }
      continue
    }
    if (/^CREATE\s+POLICY\b/i.test(stmt)) {
      const info = namaDanTabel(stmt, 'CREATE\\s+POLICY')
      if (!info || !TABEL_SUPPLIER.includes(info.tabel)) continue
      aktif.set(`${info.tabel}\0${info.name}`, {
        tabel: info.tabel,
        name: info.name,
        roles: peranKebijakan(stmt),
      })
    }
  }
  return [...aktif.values()]
}

function assertKebijakanSupplierHanyaServiceRole(sql) {
  const aktif = kebijakanEfektifSupplier(sql)
  for (const tabel of TABEL_SUPPLIER) {
    const milik = aktif.filter((k) => k.tabel === tabel)
    if (milik.length === 0) {
      throw new Error(`${tabel} tidak punya kebijakan efektif`)
    }
    for (const k of milik) {
      const hanya = k.roles.length === 1 && k.roles[0].toLowerCase() === 'service_role'
      if (!hanya) {
        throw new Error(`${tabel} kebijakan "${k.name}" menarget ${k.roles.join(', ') || '(kosong)'}`)
      }
    }
  }
}

function sqlServiceRoleUntukSemuaTabel() {
  return TABEL_SUPPLIER.map((tabel) => `
CREATE POLICY "Allow all for service role" ON "${tabel}"
    FOR ALL TO service_role USING (true) WITH CHECK (true);`).join('\n')
}

test('migrasi lanjutan mengunci RLS Supplier* ke service_role', () => {
  const sql = sqlSetelahBaseline()
  assert.ok(sql.trim().length > 0, 'harus ada migrasi baru setelah 20260818000000')
  assert.doesNotThrow(
    () => assertKebijakanSupplierHanyaServiceRole(sql),
    'setiap kebijakan Supplier* yang efektif harus TO service_role saja'
  )

  for (const tabel of TABEL_SUPPLIER) {
    assert.match(
      sql,
      kebijakanServiceRoleSaja(tabel),
      `${tabel} harus punya kebijakan TO service_role saja`
    )
    assert.match(
      sql,
      new RegExp(`REVOKE ALL ON TABLE "${tabel}" FROM[\\s\\S]*anon`, 'i'),
      `${tabel} harus di-REVOKE dari anon`
    )
  }

  for (const peran of ['anon', 'authenticated', 'PUBLIC']) {
    const campur = `${sqlServiceRoleUntukSemuaTabel()}
CREATE POLICY "baca klien" ON "Supplier"
    FOR SELECT TO ${peran} USING (true);`
    assert.throws(
      () => assertKebijakanSupplierHanyaServiceRole(campur),
      new RegExp(peran, 'i'),
      `kebijakan TO ${peran} di samping service_role harus gagal`
    )
  }

  const diganti = `
CREATE POLICY "baca klien" ON "Supplier" FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS "baca klien" ON "Supplier";
${sqlServiceRoleUntukSemuaTabel()}`
  assert.doesNotThrow(
    () => assertKebijakanSupplierHanyaServiceRole(diganti),
    'kebijakan klien yang di-DROP tidak lagi efektif'
  )
})

test('REVOKE SELECT(api_key) bukan pagar tahan lama; kebijakan RLS TO service_role yang melindungi', () => {
  const sql = sqlSetelahBaseline()
  assert.match(
    sql,
    kebijakanServiceRoleSaja('Supplier'),
    'perlindungan yang tahan GRANT SELECT ON TABLE adalah kebijakan RLS TO service_role, bukan REVOKE kolom'
  )
  assert.doesNotMatch(
    `CREATE POLICY "campur" ON "Supplier" FOR ALL TO service_role, anon USING (true);`,
    kebijakanServiceRoleSaja('Supplier'),
    'TO service_role, anon bukan daftar peran yang hanya service_role'
  )
  assert.doesNotMatch(
    `CREATE POLICY "campur" ON "Supplier" FOR ALL TO anon, service_role USING (true);`,
    kebijakanServiceRoleSaja('Supplier'),
    'service_role di belakang peran lain juga bukan daftar yang lengkap'
  )
  const sqlPalsu = `
CREATE POLICY "Allow all for service role" ON "Supplier"
    FOR ALL TO PUBLIC USING (true) WITH CHECK (true);

CREATE POLICY "Allow all for service role" ON "SupplierProduct"
    FOR ALL TO service_role USING (true) WITH CHECK (true);
`
  assert.doesNotMatch(
    sqlPalsu,
    kebijakanServiceRoleSaja('Supplier'),
    'TO service_role pada pernyataan SupplierProduct berikutnya tidak boleh memenuhi asersi Supplier'
  )
  const runbook = fs.readFileSync(
    path.join(__dirname, '..', 'docs', 'runbooks', 'phase13-supplier-sourcing.md'),
    'utf8'
  )
  assert.match(
    runbook,
    /column-level REVOKE does NOT override a table-level GRANT SELECT/i,
    'dokumentasi runbook harus menyatakan REVOKE kolom tidak mengalahkan GRANT SELECT tingkat tabel'
  )
  assert.match(
    sql,
    /REVOKE\s+SELECT\s*\(\s*api_key\s*\)\s+ON TABLE "Supplier" FROM[\s\S]*(anon|authenticated|PUBLIC)/i,
    'pernyataan REVOKE kolom tetap ada sebagai lapisan tambahan, bukan jaminan tahan lama'
  )
})
