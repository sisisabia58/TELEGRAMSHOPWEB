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

// service_role harus jadi SATU-SATUNYA peran di klausa TO, bukan salah satu
// di daftar. `TO service_role, anon` tetap mengandung kata service_role.
function kebijakanServiceRoleSaja(tabel) {
  return new RegExp(
    `CREATE POLICY[^;]*ON "${tabel}"[^;]*\\bTO\\s+service_role\\b(?!\\s*,)[^;]*;`,
    'i'
  )
}

test('migrasi lanjutan mengunci RLS Supplier* ke service_role', () => {
  const sql = sqlSetelahBaseline()
  assert.ok(sql.trim().length > 0, 'harus ada migrasi baru setelah 20260818000000')

  for (const tabel of ['Supplier', 'SupplierProduct', 'SupplierOrder']) {
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
