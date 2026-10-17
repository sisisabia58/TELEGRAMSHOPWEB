const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const MIGRATIONS = path.join(__dirname, '..', 'supabase', 'migrations')
const SIG = String.raw`public\.publish_bot_flow_graph\(\s*uuid,\s*jsonb,\s*text,\s*text\[\],\s*jsonb,\s*jsonb,\s*jsonb\s*\)`

function migrationFiles() {
  return fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()
}

test('migration versions are unique', () => {
  const versions = migrationFiles().map((f) => f.split('_')[0])
  assert.deepStrictEqual(versions, [...new Set(versions)])
})

test('publish_bot_flow_graph EXECUTE is revoked from client roles after it was granted', () => {
  const files = migrationFiles()
  const grantIdx = files.indexOf('20260818000001_publish_bot_flow_graph.sql')
  assert.ok(grantIdx >= 0, 'original publish RPC migration must exist')
  const later = files.slice(grantIdx + 1)
    .map((f) => fs.readFileSync(path.join(MIGRATIONS, f), 'utf8'))
    .join('\n\n')

  const revoke = new RegExp(`REVOKE\\s+(EXECUTE|ALL)\\s+ON\\s+FUNCTION\\s+${SIG}\\s+FROM\\s+([^;]+);`, 'i')
  const m = later.match(revoke)
  assert.ok(m, 'a later migration must REVOKE EXECUTE on publish_bot_flow_graph')
  for (const role of ['PUBLIC', 'anon', 'authenticated']) {
    assert.match(m[2], new RegExp(`\\b${role}\\b`, 'i'), `${role} must lose EXECUTE`)
  }
  assert.match(
    later,
    new RegExp(`GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+${SIG}\\s+TO\\s+service_role\\s*;`, 'i'),
    'service_role must keep EXECUTE'
  )
})
