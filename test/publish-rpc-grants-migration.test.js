const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const MIGRATIONS = path.join(__dirname, '..', 'supabase', 'migrations')
const SIG = String.raw`public\.publish_bot_flow_graph\(\s*uuid,\s*jsonb,\s*text,\s*text\[\],\s*jsonb,\s*jsonb,\s*jsonb\s*\)`
const CLIENT_ROLES = ['public', 'anon', 'authenticated']
const LOCK_MIGRATION = '20261017145821_lock_publish_bot_flow_graph.sql'
const GRANT_MIGRATION = '20260818000001_publish_bot_flow_graph.sql'

function migrationFiles() {
  return fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()
}

function stripSqlComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
}

function normalizeRole(role) {
  return role
    .trim()
    .replace(/"/g, '')
    .replace(/\s+with\s+grant\s+option\s*$/i, '')
    .trim()
    .toLowerCase()
}

// Walk GRANT/REVOKE in filename order. Postgres applies them in that order, so
// the first REVOKE is not the final privilege: a later migration can grant
// EXECUTE back to a client role.
function resolvePublishExecute(orderedSql) {
  const execute = {
    public: false,
    anon: false,
    authenticated: false,
    service_role: false,
  }
  let created = false
  const createRe = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+${SIG}`, 'gi')
  const aclRe = new RegExp(
    `(GRANT|REVOKE)\\s+(EXECUTE|ALL)\\s+ON\\s+FUNCTION\\s+${SIG}\\s+(TO|FROM)\\s+([^;]+);`,
    'gi'
  )

  for (const raw of orderedSql) {
    const sql = stripSqlComments(raw)
    const events = []
    let match
    createRe.lastIndex = 0
    while ((match = createRe.exec(sql)) !== null) {
      events.push({ index: match.index, kind: 'create' })
    }
    aclRe.lastIndex = 0
    while ((match = aclRe.exec(sql)) !== null) {
      events.push({
        index: match.index,
        kind: 'acl',
        action: match[1].toUpperCase(),
        direction: match[3].toUpperCase(),
        roles: match[4].split(',').map(normalizeRole).filter(Boolean),
      })
    }
    events.sort((a, b) => a.index - b.index)

    for (const event of events) {
      if (event.kind === 'create') {
        // New functions receive EXECUTE for PUBLIC. CREATE OR REPLACE keeps
        // the privileges already recorded.
        if (!created) {
          execute.public = true
          created = true
        }
        continue
      }
      const grant = event.action === 'GRANT' && event.direction === 'TO'
      const revoke = event.action === 'REVOKE' && event.direction === 'FROM'
      if (!grant && !revoke) continue
      for (const role of event.roles) execute[role] = grant
    }
  }
  return execute
}

function migrationSqlInFilenameOrder(extra = []) {
  const entries = migrationFiles().map((name) => ({
    name,
    sql: fs.readFileSync(path.join(MIGRATIONS, name), 'utf8'),
  }))
  entries.push(...extra)
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  return entries.map((entry) => entry.sql)
}

function assertPublishExecuteLocked(execute) {
  for (const role of CLIENT_ROLES) {
    assert.strictEqual(
      execute[role],
      false,
      `${role} must not keep EXECUTE on publish_bot_flow_graph`
    )
  }
  assert.strictEqual(execute.service_role, true, 'service_role must keep EXECUTE')
}

test('migration versions are unique', () => {
  const versions = migrationFiles().map((f) => f.split('_')[0])
  assert.deepStrictEqual(versions, [...new Set(versions)])
})

test('publish_bot_flow_graph EXECUTE stays with service_role across migrations in filename order', () => {
  const files = migrationFiles()
  const grantIdx = files.indexOf(GRANT_MIGRATION)
  const lockIdx = files.indexOf(LOCK_MIGRATION)
  assert.ok(grantIdx >= 0, 'original publish RPC migration must exist')
  assert.ok(lockIdx > grantIdx, 'lock migration must sort after the original grant')
  assertPublishExecuteLocked(resolvePublishExecute(migrationSqlInFilenameOrder()))
})

for (const role of ['PUBLIC', 'anon', 'authenticated']) {
  test(`a later GRANT EXECUTE to ${role} fails the publish lock`, () => {
    const sql = migrationSqlInFilenameOrder([{
      name: '20990101000000_regrant_publish_bot_flow_graph.sql',
      sql: `GRANT EXECUTE ON FUNCTION public.publish_bot_flow_graph(uuid, jsonb, text, text[], jsonb, jsonb, jsonb) TO ${role};`,
    }])
    assert.throws(
      () => assertPublishExecuteLocked(resolvePublishExecute(sql)),
      { message: new RegExp(role.toLowerCase()) }
    )
  })
}
