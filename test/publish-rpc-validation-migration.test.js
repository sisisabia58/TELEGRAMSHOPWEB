const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const MIGRATION = path.join(
  __dirname,
  '..',
  'supabase',
  'migrations',
  '20261017000100_validate_publish_bot_flow_graph.sql'
)

function sql() {
  return fs.readFileSync(MIGRATION, 'utf8')
}

test('publish RPC validation migration replaces the function without touching grants', () => {
  const body = sql()
  assert.match(
    body,
    /CREATE OR REPLACE FUNCTION public\.publish_bot_flow_graph\s*\(\s*p_flow_id uuid,\s*p_draft jsonb,\s*p_entry_key text,\s*p_node_deletes text\[\],\s*p_node_upserts jsonb,\s*p_copy_inserts jsonb,\s*p_copy_upserts jsonb\s*\)/i
  )
  assert.match(body, /SECURITY INVOKER/)
  assert.match(body, /SET search_path TO public/)
  assert.match(body, /node upsert missing key/)
  assert.match(body, /pos_x must be numeric/)
  assert.match(body, /copy insert missing key/)
  assert.doesNotMatch(body, /GRANT\s+EXECUTE/i)
  assert.doesNotMatch(body, /REVOKE\s+ALL\s+ON FUNCTION/i)
  assert.doesNotMatch(body, /CREATE POLICY/i)
})
