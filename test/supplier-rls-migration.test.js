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

test('migrasi lanjutan mengunci RLS Supplier* ke service_role', () => {
  const sql = sqlSetelahBaseline()
  assert.ok(sql.trim().length > 0, 'harus ada migrasi baru setelah 20260818000000')

  for (const tabel of ['Supplier', 'SupplierProduct', 'SupplierOrder']) {
    assert.match(
      sql,
      new RegExp(`CREATE POLICY[\\s\\S]*ON "${tabel}"[\\s\\S]*TO service_role`, 'i'),
      `${tabel} harus punya kebijakan TO service_role`
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
    /CREATE POLICY[\s\S]*ON "Supplier"[\s\S]*TO service_role/i,
    'perlindungan yang tahan GRANT SELECT ON TABLE adalah kebijakan RLS TO service_role, bukan REVOKE kolom'
  )
  assert.match(
    sql,
    /column-level REVOKE does NOT override a table-level GRANT SELECT/i,
    'komentar migrasi harus menyatakan REVOKE kolom tidak mengalahkan GRANT SELECT tingkat tabel'
  )
  assert.match(
    sql,
    /REVOKE\s+SELECT\s*\(\s*api_key\s*\)\s+ON TABLE "Supplier" FROM[\s\S]*(anon|authenticated|PUBLIC)/i,
    'pernyataan REVOKE kolom tetap ada sebagai lapisan tambahan, bukan jaminan tahan lama'
  )
})
