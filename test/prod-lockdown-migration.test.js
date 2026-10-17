const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const MIGRATIONS = path.join(__dirname, '..', 'supabase', 'migrations')
const LOCKDOWN = '20261017000200_prod_lockdown_rls.sql'
const RPC_SIG = String.raw`public\.publish_bot_flow_graph\(\s*uuid,\s*jsonb,\s*text,\s*text\[\],\s*jsonb,\s*jsonb,\s*jsonb\s*\)`

// Prod 2026-10-17: these 22 tables still have "Allow all for service role" on PUBLIC.
const PUBLIC_POLICY_TABLES = [
  'User',
  'Trx',
  'Admin',
  'Deposit',
  'Voucher',
  'BotFlow',
  'BotFlowNode',
  'BotCopy',
  'NotificationSettings',
  'AuditLog',
  'BotSession',
  'HargaTier',
  'LoginHistory',
  'MessageHistory',
  'MessageTemplate',
  'NotificationLog',
  'Payment',
  'Premium',
  'ProductStockThreshold',
  'Produk',
  'Stok',
  'Varian',
]

function migrationFiles() {
  return fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()
}

function lockdownSql() {
  return fs.readFileSync(path.join(MIGRATIONS, LOCKDOWN), 'utf8')
}

test('migration versions are unique', () => {
  const versions = migrationFiles().map((f) => f.split('_')[0])
  assert.deepStrictEqual(versions, [...new Set(versions)])
})

test('prod lockdown migration exists after every current version', () => {
  const files = migrationFiles()
  assert.ok(files.includes(LOCKDOWN), `${LOCKDOWN} must exist`)
  const versions = files.map((f) => f.split('_')[0])
  assert.ok(
    versions.every((v) => v <= '20261017000200' || v === '20261017000200'),
    '20261017000200 must be later than existing committed versions'
  )
})

test('prod lockdown covers all 22 PUBLIC-policy tables with TO service_role', () => {
  const sql = lockdownSql()
  assert.equal(PUBLIC_POLICY_TABLES.length, 22)

  for (const tabel of PUBLIC_POLICY_TABLES) {
    assert.match(
      sql,
      new RegExp(`DROP POLICY IF EXISTS "Allow all for service role" ON "${tabel}"\\s*;`, 'i'),
      `${tabel} must DROP POLICY IF EXISTS`
    )
    assert.match(
      sql,
      new RegExp(
        `CREATE POLICY "Allow all for service role" ON "${tabel}"\\s+FOR ALL TO service_role USING \\(true\\) WITH CHECK \\(true\\)`,
        'i'
      ),
      `${tabel} must CREATE POLICY TO service_role`
    )
  }
})

test('prod lockdown revokes anon and authenticated table/sequence/function privileges', () => {
  const sql = lockdownSql()
  assert.match(
    sql,
    /REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon,\s*authenticated\s*;/i
  )
  assert.match(
    sql,
    /REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon,\s*authenticated\s*;/i
  )
  assert.match(
    sql,
    /REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon,\s*authenticated\s*;/i
  )
  assert.match(
    sql,
    /GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role\s*;/i
  )
})

test('prod lockdown revokes publish_bot_flow_graph EXECUTE from client roles', () => {
  const sql = lockdownSql()
  const revoke = new RegExp(
    `REVOKE\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+${RPC_SIG}\\s+FROM\\s+([^;]+);`,
    'i'
  )
  const m = sql.match(revoke)
  assert.ok(m, 'must REVOKE EXECUTE on publish_bot_flow_graph')
  for (const role of ['PUBLIC', 'anon', 'authenticated']) {
    assert.match(m[1], new RegExp(`\\b${role}\\b`, 'i'), `${role} must lose EXECUTE`)
  }
  assert.match(
    sql,
    new RegExp(`GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+${RPC_SIG}\\s+TO\\s+service_role\\s*;`, 'i')
  )
})

test('prod lockdown pins update_updated_at_column search_path and wraps in a transaction', () => {
  const sql = lockdownSql()
  assert.match(
    sql,
    /ALTER FUNCTION public\.update_updated_at_column\(\)\s+SET search_path\s*=\s*public\s*;/i
  )
  assert.match(sql, /^\s*BEGIN\s*;/im)
  assert.match(sql, /^\s*COMMIT\s*;/im)
})

test('prod lockdown leaves Supplier* policies untouched', () => {
  const sql = lockdownSql()
  for (const tabel of ['Supplier', 'SupplierProduct', 'SupplierOrder']) {
    assert.doesNotMatch(
      sql,
      new RegExp(`CREATE POLICY[\\s\\S]{0,80}ON "${tabel}"`, 'i'),
      `${tabel} policies are already TO service_role; do not recreate them here`
    )
  }
})
