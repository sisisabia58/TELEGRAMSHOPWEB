const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const MIGRATIONS = path.join(__dirname, '..', 'supabase', 'migrations')

function qaRoleMigrationFiles() {
  return fs.readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith('.sql'))
    .filter((name) => {
      const sql = fs.readFileSync(path.join(MIGRATIONS, name), 'utf8')
      return /Admin_role_check/.test(sql) && /'qa'/.test(sql)
    })
    .sort()
}

test('a dedicated migration only widens Admin.role CHECK to admin/staff/viewer/qa', () => {
  const files = qaRoleMigrationFiles()
  assert.equal(files.length, 1, `expected one qa role CHECK migration, found ${files.join(', ') || 'none'}`)

  const sql = fs.readFileSync(path.join(MIGRATIONS, files[0]), 'utf8')

  assert.match(sql, /pg_constraint/)
  assert.match(sql, /DROP CONSTRAINT/i)
  assert.match(
    sql,
    /ADD CONSTRAINT\s+"Admin_role_check"\s+CHECK\s*\(\s*role\s+IN\s*\(\s*'admin'\s*,\s*'staff'\s*,\s*'viewer'\s*,\s*'qa'\s*\)\s*\)/i
  )
  assert.match(sql, /rollback/i)
  assert.match(sql, /qa/i)
  assert.match(sql, /(deactivat|delete|hapus|nonaktif)/i)

  assert.doesNotMatch(sql, /CREATE TABLE/i)
  assert.doesNotMatch(sql, /CREATE POLICY/i)
  assert.doesNotMatch(sql, /ALTER TABLE\s+(?!"Admin")/i)
  assert.doesNotMatch(sql, /INSERT\s+INTO/i)
})
