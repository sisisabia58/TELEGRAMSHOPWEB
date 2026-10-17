const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const MIGRATIONS = path.join(__dirname, '..', 'supabase', 'migrations')
const SEED = path.join(__dirname, '..', 'supabase', 'seed.sql')
const ROLLBACK = path.join(__dirname, '..', 'docs', 'runbooks', 'prod-lockdown-rollback.sql')
const LOCKDOWN = '20261017000200_prod_lockdown_rls.sql'
const RPC_SIG = String.raw`public\.publish_bot_flow_graph\(\s*uuid,\s*jsonb,\s*text,\s*text\[\],\s*jsonb,\s*jsonb,\s*jsonb\s*\)`

// Lockdown ALTER/REVOKE targets these objects; each predecessor must exist and
// sort before LOCKDOWN. Do not require LOCKDOWN to be the newest file.
const LOCKDOWN_DEPENDENCIES = [
  '20250207000000_complete_teleshop_schema.sql',
  '20260818000001_publish_bot_flow_graph.sql',
  '20261016000000_restrict_supplier_rls.sql',
]

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

function assertSupabaseAdminBlockGuarded(sql, label) {
  const existsRe = /IF EXISTS\s*\(\s*SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin'\s*\)\s*THEN/i
  const memberRe = /pg_has_role\s*\(\s*current_user\s*,\s*'supabase_admin'\s*,\s*'MEMBER'\s*\)/i
  assert.match(sql, existsRe, `${label}: supabase_admin must be existence-checked`)
  assert.match(sql, memberRe, `${label}: must pg_has_role(current_user, supabase_admin, MEMBER)`)
  const existsIdx = sql.search(existsRe)
  const memberIdx = sql.search(memberRe)
  assert.ok(memberIdx > existsIdx, `${label}: pg_has_role must sit inside the role-existence check`)
}

function revokeFromClause(sql, kind) {
  const m = sql.match(
    new RegExp(`REVOKE ALL ON ALL ${kind} IN SCHEMA public FROM ([^;]+);`, 'i')
  )
  assert.ok(m, `must REVOKE ALL ON ALL ${kind}`)
  return m[1]
}

test('migration versions are unique', () => {
  const versions = migrationFiles().map((f) => f.split('_')[0])
  assert.deepStrictEqual(versions, [...new Set(versions)])
})

test('prod lockdown sorts after the migrations it depends on', () => {
  const files = migrationFiles()
  assert.ok(files.includes(LOCKDOWN), `${LOCKDOWN} must exist`)
  for (const dep of LOCKDOWN_DEPENDENCIES) {
    assert.ok(files.includes(dep), `dependency ${dep} must exist`)
    assert.ok(dep < LOCKDOWN, `${LOCKDOWN} must sort after ${dep}`)
  }
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
  const fnFrom = revokeFromClause(sql, 'FUNCTIONS')
  for (const role of ['PUBLIC', 'anon', 'authenticated']) {
    assert.match(fnFrom, new RegExp(`\\b${role}\\b`, 'i'), `${role} must lose function privileges`)
  }
  assert.match(
    sql,
    /GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role\s*;/i
  )
  assert.match(
    sql,
    /GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO service_role\s*;/i
  )
  assert.match(
    sql,
    /ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public\s+REVOKE ALL ON FUNCTIONS FROM PUBLIC,\s*anon,\s*authenticated\s*;/i
  )
  assert.match(
    sql,
    /REVOKE ALL ON FUNCTIONS FROM PUBLIC,\s*anon,\s*authenticated'/i
  )
  assertSupabaseAdminBlockGuarded(sql, LOCKDOWN)
})

test('prod lockdown rollback and seed guard supabase_admin the same way', () => {
  const rollback = fs.readFileSync(ROLLBACK, 'utf8')
  const seed = fs.readFileSync(SEED, 'utf8')
  assertSupabaseAdminBlockGuarded(rollback, 'rollback')
  const seedFnFrom = revokeFromClause(seed, 'FUNCTIONS')
  for (const role of ['PUBLIC', 'anon', 'authenticated']) {
    assert.match(seedFnFrom, new RegExp(`\\b${role}\\b`, 'i'), `seed: ${role} must lose function privileges`)
  }
  assert.match(
    seed,
    /ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM PUBLIC,\s*anon,\s*authenticated\s*;/i
  )
  assert.match(
    seed,
    /GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO service_role\s*;/i
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
