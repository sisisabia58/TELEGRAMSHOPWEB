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

// Saving a new URL origin while omitting a secret would leave the stored
// key in place, and a later same-origin connection test would send it to
// the new host. Reject that save. Same-origin edits and explicitly typed
// keys stay as they are. A stored service-role key follows the same rule
// unless the admin clears it or types a replacement. An empty stored
// service-role key has nothing to retain, so a blank field is allowed.
function supabaseOriginChangeError({
  submittedUrl,
  storedUrl,
  submittedKey,
  submittedServiceKey,
  clearServiceKey,
  storedServiceKey,
} = {}) {
  if (httpOrigin(submittedUrl) === httpOrigin(storedUrl)) return null

  const errors = []
  if (isMaskedOrBlank(submittedKey)) {
    errors.push('API Key harus diisi ulang saat origin URL Supabase diubah')
  }
  const keepsStoredServiceKey = isMaskedOrBlank(submittedServiceKey) && !wantsClear(clearServiceKey)
  if (keepsStoredServiceKey && String(storedServiceKey || '').trim()) {
    errors.push('Service Role Key harus diisi ulang atau dihapus saat origin URL Supabase diubah')
  }
  return errors.length ? errors.join('. ') : null
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
  supabaseOriginChangeError,
  redactSecrets,
}
