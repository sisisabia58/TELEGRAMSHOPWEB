// Decode SUPABASE_KEY without verifying the signature. Never log the key.
// Fail open: callers warn and keep running when the key is not service-role
// format (JWT role=service_role, or sb_secret_ prefix). The prefix is format
// only — it is not proof the secret is valid.

function decodeJwtPayload(token) {
  if (typeof token !== 'string' || token.length === 0) return null
  const parts = token.split('.')
  // Exactly three segments (header.payload.signature). Truncated or extra
  // segments are rejected. An empty payload segment is also rejected.
  if (parts.length !== 3 || !parts[1]) return null
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
    const json = Buffer.from(padded, 'base64').toString('utf8')
    const payload = JSON.parse(json)
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
    return payload
  } catch {
    return null
  }
}

function isSbSecretKeyFormat(key) {
  return typeof key === 'string' && key.startsWith('sb_secret_')
}

function inspectSupabaseKeyRole(key) {
  const payload = decodeJwtPayload(key)
  const role = payload && typeof payload.role === 'string' ? payload.role : null
  // Format (sb_secret_ prefix or JWT role claim) is separate from validity.
  // The prefix is not proof the secret is a live service_role credential.
  const isServiceRoleFormat = isSbSecretKeyFormat(key) || role === 'service_role'
  return { role, isServiceRoleFormat, isServiceRole: role === 'service_role' }
}

function warnIfNotServiceRole(key, log = console) {
  const info = inspectSupabaseKeyRole(key)
  if (!info.isServiceRoleFormat) {
    const decoded = info.role ? `"${info.role}"` : 'missing/unreadable'
    log.warn(
      [
        '********************************************************************************',
        `[SECURITY] SUPABASE_KEY JWT role is ${decoded}, not "service_role".`,
        'The bot and dashboard must use the service_role secret. After RLS lockdown,',
        'an anon/publishable key will see empty results or permission errors.',
        'This process will keep running (fail open). Switch the key, then restart.',
        '********************************************************************************',
      ].join('\n')
    )
  }
  return info
}

function getSupabaseKeyDiagnostics(key) {
  return { supabaseKeyIsServiceRole: inspectSupabaseKeyRole(key).isServiceRole }
}

module.exports = {
  decodeJwtPayload,
  inspectSupabaseKeyRole,
  warnIfNotServiceRole,
  getSupabaseKeyDiagnostics,
}
