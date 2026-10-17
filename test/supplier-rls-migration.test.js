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

test('kolom api_key tidak bisa di-SELECT oleh anon/authenticated', () => {
  const sql = sqlSetelahBaseline()
  assert.match(
    sql,
    /REVOKE\s+SELECT\s*\(\s*api_key\s*\)\s+ON TABLE "Supplier" FROM[\s\S]*(anon|authenticated|PUBLIC)/i,
    'SELECT(api_key) harus di-REVOKE dari peran klien'
  )
})
