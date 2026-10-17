// Server-side secret redaction for dashboard views and JSON.
// The browser must never receive Pakasir keys, Supabase keys, bot tokens,
// or other API secrets — only a "set/not set" flag and a last-4 hint.

const MASK_PREFIX = '••••'

function maskSecret(value, visible = 4) {
  if (value == null) return { configured: false, masked: '' }
  const raw = String(value)
  if (!raw.trim()) return { configured: false, masked: '' }
  const last = raw.slice(-visible)
  return { configured: true, masked: `${MASK_PREFIX}${last}` }
}

function isMaskedOrBlank(value) {
  if (value == null) return true
  const s = String(value).trim()
  if (!s) return true
  if (s.startsWith(MASK_PREFIX) || /^•{2,}/.test(s)) return true
  if (/^\*{4,}/.test(s)) return true
  return false
}

function resolveSecretInput(incoming, existing) {
  if (isMaskedOrBlank(incoming)) return existing || ''
  return String(incoming)
}

function redactSecrets(obj, fields) {
  const source = obj && typeof obj === 'object' ? obj : {}
  const out = { ...source }
  for (const field of fields) {
    const masked = maskSecret(source[field])
    out[field] = masked.masked
    out[`${field}Set`] = masked.configured
  }
  return out
}

module.exports = {
  MASK_PREFIX,
  maskSecret,
  isMaskedOrBlank,
  resolveSecretInput,
  redactSecrets,
}
