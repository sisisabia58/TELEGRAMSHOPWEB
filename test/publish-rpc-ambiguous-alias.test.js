const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const MIGRATIONS = path.join(__dirname, '..', 'supabase', 'migrations')
const BROKEN = '20261017225540_validate_publish_bot_flow_graph.sql'

function migrationFiles() {
  return fs.readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql')).sort()
}

function stripSqlComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
}

function publishFunctions(sql) {
  const re = /CREATE OR REPLACE FUNCTION public\.publish_bot_flow_graph\s*\([\s\S]*?\$\$([\s\S]*?)\$\$/gi
  const bodies = []
  let match
  while ((match = re.exec(sql)) !== null) bodies.push(match[1])
  return bodies
}

function latestPublishBody() {
  let found = null
  for (const name of migrationFiles()) {
    const sql = fs.readFileSync(path.join(MIGRATIONS, name), 'utf8')
    const bodies = publishFunctions(sql)
    if (bodies.length) found = { name, sql, body: bodies[bodies.length - 1] }
  }
  return found
}

function declaredNames(body) {
  const decl = stripSqlComments(body).match(/\bDECLARE\b([\s\S]*?)\bBEGIN\b/i)
  if (!decl) return []
  return [...decl[1].matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s+(?:jsonb|text|uuid|integer|int|boolean|record)\b/gi)]
    .map((match) => match[1].toLowerCase())
}

function relationAliases(body) {
  return [...stripSqlComments(body).matchAll(/\bAS\s+([A-Za-z_][A-Za-z0-9_]*)\b/gi)]
    .map((match) => match[1].toLowerCase())
}

test('latest publish_bot_flow_graph does not reuse a PL/pgSQL variable as a SQL alias', () => {
  const latest = latestPublishBody()
  assert.ok(latest, 'publish_bot_flow_graph must be defined')
  assert.ok(
    latest.name > BROKEN,
    'the unambiguous definition must sort after the migration that introduced DECLARE n'
  )

  const names = declaredNames(latest.body)
  const aliases = relationAliases(latest.body)
  assert.deepEqual(names, ['node_item', 'copy_item'])
  const collision = names.filter((name) => aliases.includes(name))
  assert.deepEqual(collision, [], `DECLARE names collide with aliases: ${collision.join(', ')}`)

  const code = stripSqlComments(latest.body)
  assert.match(code, /AS node_row\b/)
  assert.match(code, /node_row\.value->>'key'/)
  assert.match(code, /node_row\.value->>'pos_x'/)
  assert.match(code, /node_row\.value->>'pos_y'/)
  assert.match(code, /AS copy_row\b/)
  assert.match(code, /copy_row\.value->>'key'/)
  assert.match(code, /copy_row\.value->>'body'/)
  assert.doesNotMatch(code, /\b(?:n|c)\s+jsonb\b/)
  assert.doesNotMatch(code, /\bAS\s+[nc]\b/)
  assert.doesNotMatch(code, /(?<![.\w])[nc]\s*->>/)
  assert.doesNotMatch(code, /(?<![.\w])[nc]\s*->/)

  assert.match(latest.sql, /SECURITY INVOKER/)
  assert.match(latest.sql, /SET search_path TO public/)
  assert.match(latest.sql, /node upsert missing key/)
  assert.match(latest.sql, /pos_x must be numeric/)
  assert.match(latest.sql, /copy insert missing key/)
  assert.match(
    latest.sql,
    /CREATE OR REPLACE FUNCTION public\.publish_bot_flow_graph\s*\(\s*p_flow_id uuid,\s*p_draft jsonb,\s*p_entry_key text,\s*p_node_deletes text\[\],\s*p_node_upserts jsonb,\s*p_copy_inserts jsonb,\s*p_copy_upserts jsonb\s*\)/i
  )
  assert.doesNotMatch(latest.sql, /GRANT\s+EXECUTE/i)
  assert.doesNotMatch(latest.sql, /REVOKE\s+/i)
  assert.doesNotMatch(latest.sql, /CREATE POLICY/i)
})

test('the prior publish function is the one that collides variable n with alias n', () => {
  const sql = fs.readFileSync(path.join(MIGRATIONS, BROKEN), 'utf8')
  const body = stripSqlComments(publishFunctions(sql).at(-1) || '')
  const names = declaredNames(body)
  const aliases = relationAliases(body)
  assert.ok(names.includes('n'))
  assert.ok(aliases.includes('n'))
  assert.ok(names.includes('c'))
  assert.ok(aliases.includes('c'))
})
