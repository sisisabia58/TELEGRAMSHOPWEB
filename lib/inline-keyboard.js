// Filter Telegram inline keyboards so url buttons never go out with an empty
// or non-http/https/tg URL. Telegram rejects those as
// "Text buttons are not allowed in the inline keyboard" (ETELEGRAM 400).

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'tg:'])
const warnedSources = new Set()

function isAllowedInlineUrl(url) {
  if (typeof url !== 'string') return false
  const trimmed = url.trim()
  if (!trimmed) return false
  let parsed
  try {
    parsed = new URL(trimmed)
  } catch {
    return false
  }
  const protocol = String(parsed.protocol).toLowerCase()
  if (!ALLOWED_PROTOCOLS.has(protocol)) return false
  // Telegram documents inline-button URLs as HTTP or tg://. `new URL('tg:resolve')`
  // parses with protocol tg: but is not a tg:// URL, so reject the slash-less form.
  if (protocol === 'tg:') return /^tg:\/\//i.test(trimmed)
  return true
}

function warnSkippedUrlButton(source) {
  const key = source || 'url'
  if (warnedSources.has(key)) return
  warnedSources.add(key)
  console.warn(
    `[inline-keyboard] skipped URL button '${key}': empty or invalid URL (allowed schemes: http, https, tg)`
  )
}

function sanitizeInlineKeyboard(rows) {
  if (!Array.isArray(rows)) return []
  const out = []
  for (const row of rows) {
    if (!Array.isArray(row)) continue
    const kept = []
    for (const btn of row) {
      if (!btn || typeof btn !== 'object') continue
      if (Object.prototype.hasOwnProperty.call(btn, 'url')) {
        if (!isAllowedInlineUrl(btn.url)) {
          warnSkippedUrlButton(btn.text)
          continue
        }
        kept.push(Object.assign({}, btn, { url: String(btn.url).trim() }))
      } else {
        kept.push(btn)
      }
    }
    if (kept.length) out.push(kept)
  }
  return out
}

function __resetSkippedUrlWarnings() {
  warnedSources.clear()
}

module.exports = {
  isAllowedInlineUrl,
  sanitizeInlineKeyboard,
  warnSkippedUrlButton,
  __resetSkippedUrlWarnings,
}
