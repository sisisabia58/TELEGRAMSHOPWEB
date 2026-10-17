const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const MIGRATIONS = path.join(__dirname, '..', 'supabase', 'migrations')
const SEED = path.join(__dirname, '..', 'supabase', 'seed.sql')
const ROLLBACK = path.join(__dirname, '..', 'docs', 'runbooks', 'prod-lockdown-rollback.sql')
const AUDIT = path.join(__dirname, '..', 'docs', 'runbooks', 'rls-audit.sql')
const LOCKDOWN = '20261017140126_prod_lockdown_rls.sql'
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
    /ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public\s+REVOKE ALL ON FUNCTIONS FROM anon,\s*authenticated\s*;/i
  )
  // Built-in PUBLIC EXECUTE is global; IN SCHEMA cannot revoke it.
  assert.match(
    sql,
    /ALTER DEFAULT PRIVILEGES FOR ROLE postgres\s+REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC\s*;/i
  )
  assert.doesNotMatch(
    sql,
    /ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public\s+REVOKE (?:ALL|EXECUTE) ON FUNCTIONS FROM PUBLIC/i
  )
  assert.match(
    sql,
    /REVOKE ALL ON FUNCTIONS FROM anon,\s*authenticated'/i
  )
  assert.match(
    sql,
    /ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC'/i
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
    /ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon,\s*authenticated\s*;/i
  )
  assert.match(
    seed,
    /ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC\s*;/i
  )
  assert.doesNotMatch(
    seed,
    /ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE (?:ALL|EXECUTE) ON FUNCTIONS FROM PUBLIC/i
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

test('prod lockdown rollback preserves Supplier* grants after GRANT ALL', () => {
  const rollback = fs.readFileSync(ROLLBACK, 'utf8')
  const grantIdx = rollback.search(
    /GRANT ALL ON ALL TABLES IN SCHEMA public TO anon,\s*authenticated,\s*service_role\s*;/i
  )
  assert.ok(grantIdx >= 0, 'rollback must GRANT ALL ON ALL TABLES')

  const supplierRevoke = /REVOKE ALL ON TABLE "Supplier",\s*"SupplierProduct",\s*"SupplierOrder"\s+FROM PUBLIC,\s*anon,\s*authenticated\s*;/i
  const apiKeyRevoke = /REVOKE SELECT\s*\(\s*api_key\s*\)\s+ON TABLE "Supplier"\s+FROM PUBLIC,\s*anon,\s*authenticated\s*;/i
  const supplierGrant = /GRANT ALL ON TABLE "Supplier",\s*"SupplierProduct",\s*"SupplierOrder" TO service_role\s*;/i

  assert.match(rollback, supplierRevoke)
  assert.match(rollback, apiKeyRevoke)
  assert.match(rollback, supplierGrant)

  const supplierRevokeIdx = rollback.search(supplierRevoke)
  const apiKeyRevokeIdx = rollback.search(apiKeyRevoke)
  assert.ok(
    supplierRevokeIdx > grantIdx,
    'Supplier* REVOKE must follow GRANT ALL ON ALL TABLES so TRUNCATE is not left granted'
  )
  assert.ok(apiKeyRevokeIdx > grantIdx, 'api_key column REVOKE must follow GRANT ALL')

  for (const tabel of ['Supplier', 'SupplierProduct', 'SupplierOrder']) {
    assert.doesNotMatch(
      rollback,
      new RegExp(`CREATE POLICY[\\s\\S]{0,80}ON "${tabel}"`, 'i'),
      `${tabel} policies stay TO service_role; rollback must not recreate them on PUBLIC`
    )
  }

  assert.match(
    rollback,
    /ALTER DEFAULT PRIVILEGES FOR ROLE postgres\s+GRANT EXECUTE ON FUNCTIONS TO PUBLIC\s*;/i
  )
  assert.match(
    rollback,
    /ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin GRANT EXECUTE ON FUNCTIONS TO PUBLIC'/i
  )
})

test('prod lockdown rollback restores PUBLIC EXECUTE on update_updated_at_column only', () => {
  const rollback = fs.readFileSync(ROLLBACK, 'utf8')
  assert.match(
    rollback,
    /GRANT EXECUTE ON FUNCTION public\.update_updated_at_column\(\)\s+TO PUBLIC\s*;/i,
    'rollback must restore the prior PUBLIC EXECUTE on the trigger function'
  )
  assert.doesNotMatch(
    rollback,
    new RegExp(`GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+${RPC_SIG}\\s+TO\\s+PUBLIC\\s*;`, 'i'),
    'publish_bot_flow_graph PUBLIC EXECUTE stays revoked'
  )
})

test('prod lockdown rollback keeps publish_bot_flow_graph service_role only after GRANT ALL FUNCTIONS', () => {
  const rollback = fs.readFileSync(ROLLBACK, 'utf8')
  const grantAllFn = /GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO anon,\s*authenticated,\s*service_role\s*;/i
  const grantIdx = rollback.search(grantAllFn)
  assert.ok(grantIdx >= 0, 'rollback must GRANT ALL ON ALL FUNCTIONS')

  const revoke = new RegExp(
    `REVOKE\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+${RPC_SIG}\\s+FROM\\s+PUBLIC,\\s*anon,\\s*authenticated\\s*;`,
    'i'
  )
  assert.match(rollback, revoke)
  const revokeIdx = rollback.search(revoke)
  assert.ok(
    revokeIdx > grantIdx,
    'publish_bot_flow_graph REVOKE must follow GRANT ALL ON ALL FUNCTIONS so anon EXECUTE is not left granted'
  )

  const serviceGrant = new RegExp(
    `GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+${RPC_SIG}\\s+TO\\s+service_role\\s*;`,
    'i'
  )
  assert.match(rollback, serviceGrant)
  assert.ok(
    rollback.search(serviceGrant) > revokeIdx,
    'service_role GRANT must follow the client-role REVOKE'
  )

  assert.doesNotMatch(
    rollback,
    new RegExp(
      `GRANT\\s+(?:ALL|EXECUTE)\\s+ON\\s+FUNCTION\\s+${RPC_SIG}\\s+TO\\s+[^;]*\\b(?:anon|authenticated|PUBLIC)\\b`,
      'i'
    ),
    'rollback must not grant publish_bot_flow_graph to anon, authenticated, or PUBLIC'
  )
})

test('rls-audit covers views, partitioned tables, and sequences', () => {
  const audit = fs.readFileSync(AUDIT, 'utf8')
  assert.match(
    audit,
    /c\.relkind IN\s*\(\s*'r'\s*,\s*'v'\s*,\s*'m'\s*,\s*'f'\s*,\s*'p'\s*\)/i
  )
  assert.doesNotMatch(
    audit,
    /c\.relkind\s*=\s*'r'\s*$/m,
    'must not filter only ordinary tables'
  )
  assert.match(audit, /has_sequence_privilege\(\s*'anon'\s*,\s*c\.oid\s*,\s*'USAGE'\s*\)/i)
  assert.match(audit, /has_sequence_privilege\(\s*'authenticated'\s*,\s*c\.oid\s*,\s*'USAGE'\s*\)/i)
  assert.match(audit, /c\.relkind\s*=\s*'S'/i)
  assert.match(audit, /has_table_privilege\(\s*'anon'\s*,\s*c\.oid\s*,\s*'TRUNCATE'\s*\)/i)
})

test('rls-audit checks REFERENCES and TRIGGER for anon and authenticated', () => {
  const audit = fs.readFileSync(AUDIT, 'utf8')
  for (const role of ['anon', 'authenticated']) {
    for (const priv of ['REFERENCES', 'TRIGGER']) {
      assert.match(
        audit,
        new RegExp(`has_table_privilege\\(\\s*'${role}'\\s*,\\s*c\\.oid\\s*,\\s*'${priv}'\\s*\\)`, 'i'),
        `${role} ${priv} must be audited`
      )
    }
  }
})

test('rls-audit checks column privileges for anon and authenticated', () => {
  const audit = fs.readFileSync(AUDIT, 'utf8')
  for (const role of ['anon', 'authenticated']) {
    for (const priv of ['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']) {
      assert.match(
        audit,
        new RegExp(
          `has_any_column_privilege\\(\\s*'${role}'\\s*,\\s*c\\.oid\\s*,\\s*'${priv}'\\s*\\)`,
          'i'
        ),
        `${role} column ${priv} must be audited`
      )
    }
  }
  const calls = audit.match(/has_any_column_privilege\([^)]*\)/gi) || []
  assert.ok(calls.length > 0)
  for (const call of calls) {
    assert.doesNotMatch(
      call,
      /DELETE|TRUNCATE|TRIGGER/i,
      'DELETE, TRUNCATE, and TRIGGER are not column privileges'
    )
  }
})

test('rls-audit checks global default function ACL and treats a missing entry as PUBLIC EXECUTE', () => {
  const audit = fs.readFileSync(AUDIT, 'utf8')
  assert.match(audit, /pg_default_acl/i)
  assert.match(audit, /defaclnamespace\s*=\s*0/)
  assert.match(audit, /defaclobjtype\s*=\s*'f'/)
  assert.match(audit, /['"]postgres['"]/)
  assert.match(audit, /['"]supabase_admin['"]/)
  assert.match(
    audit,
    /WHEN\s+[\w.]+\.oid\s+IS\s+NULL\s+THEN\s+true/i,
    'missing global default-ACL row is the built-in PUBLIC EXECUTE default, not a revoke'
  )
  assert.match(audit, /aclexplode/i)
})
