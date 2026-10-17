// Server-side secret redaction for dashboard views and JSON.
// The browser must never receive Pakasir keys, Supabase keys, bot tokens,
// or other API secrets — only a "set/not set" flag and a last-4 hint.
// Secrets of `visible` characters or fewer are fully masked (no suffix),
// so a short value is never shown in full.

const MASK_PREFIX = '••••'

function maskSecret(value, visible = 4) {
  if (value == null) return { configured: false, masked: '' }
  const raw = String(value)
  if (!raw.trim()) return { configured: false, masked: '' }
  // A suffix is safe only when at least one character stays hidden.
  if (!(visible > 0) || raw.length <= visible) {
    return { configured: true, masked: MASK_PREFIX }
  }
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

// Save handlers must omit the upsert row when the field is blank or masked.
// Do not persist getPaymentGatewaySettings() / getSupabaseSettings() fallbacks
// (those may come from .env and would pin the secret into the database).
function wantsClear(flag) {
  return flag === true || flag === 'true'
}

function secretUpdateRow(settingKey, submitted, options = {}) {
  if (!isMaskedOrBlank(submitted)) {
    return {
      setting_key: settingKey,
      setting_value: { value: String(submitted) },
    }
  }
  // An explicit clear (service-role checkbox) persists an empty value.
  // A blank or masked field without that flag leaves the stored row unchanged.
  if (wantsClear(options.clear)) {
    return {
      setting_key: settingKey,
      setting_value: { value: '' },
    }
  }
  return null
}

function httpOrigin(value) {
  try {
    const url = new URL(String(value).trim())
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return ''
    return url.origin
  } catch {
    return ''
  }
}

// Reuse a stored key (DB row or SUPABASE_KEY env fallback) only when the
// requested URL origin matches the configured Supabase origin. Any other
// origin requires an explicitly typed key so the stored key is never sent
// to a caller-supplied host.
function selectSupabaseTestKey({ requestedUrl, submittedKey, storedUrl, storedKey } = {}) {
  if (!isMaskedOrBlank(submittedKey)) {
    return { key: String(submittedKey), reused: false, error: null }
  }
  const stored = storedKey == null ? '' : String(storedKey)
  const requestedOrigin = httpOrigin(requestedUrl)
  const storedOrigin = httpOrigin(storedUrl)
  if (stored && requestedOrigin && requestedOrigin === storedOrigin) {
    return { key: stored, reused: true, error: null }
  }
  const outsideConfiguredOrigin = Boolean(String(requestedUrl || '').trim()) && requestedOrigin !== storedOrigin
  return {
    key: '',
    reused: false,
    error: outsideConfiguredOrigin
      ? 'API Key harus diisi untuk URL di luar origin Supabase yang tersimpan'
      : 'URL dan API Key harus diisi',
  }
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
  secretUpdateRow,
  selectSupabaseTestKey,
  redactSecrets,
}
