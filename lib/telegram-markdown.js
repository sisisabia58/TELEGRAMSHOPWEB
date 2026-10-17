// Telegram Bot API legacy Markdown (`parse_mode: 'Markdown'`), which
// `lib/flow.js` `dispatchFlowScreen` sends on every flow screen.
//
// Allowed entities (must not nest): *bold*, _italic_, `code`, ```pre```,
// [label](url). Literal '_', '*', '`', '[' outside an entity must be escaped
// with a preceding '\'. See https://core.telegram.org/bots/api#markdown-style

const ESCAPABLE = new Set(['_', '*', '`', '['])

function validateTelegramMarkdown(text) {
  if (typeof text !== 'string') {
    return { ok: false, reason: 'message text must be a string' }
  }

  // {{placeholders}} are interpolated before Telegram sees the string. Fold
  // them to a single safe letter so template names like {{first_name}} do not
  // trip the `_` italic delimiter.
  text = text.replace(/\{\{[^}]+\}\}/g, 'x')

  let i = 0
  const n = text.length
  // text | bold | italic | code | pre
  let mode = 'text'
  let entityStart = -1

  function fail(reason) {
    return { ok: false, reason }
  }

  while (i < n) {
    if (mode === 'pre') {
      if (text.startsWith('```', i)) {
        if (i === entityStart) return fail('empty Markdown pre entity')
        mode = 'text'
        entityStart = -1
        i += 3
        continue
      }
      i += 1
      continue
    }

    if (mode === 'code') {
      if (text[i] === '`') {
        if (i === entityStart) return fail('empty Markdown code entity')
        mode = 'text'
        entityStart = -1
        i += 1
        continue
      }
      i += 1
      continue
    }

    // Escapes are only valid outside entities.
    if (text[i] === '\\' && i + 1 < n && ESCAPABLE.has(text[i + 1])) {
      if (mode !== 'text') {
        return fail('Markdown escape is not allowed inside an entity')
      }
      i += 2
      continue
    }

    if (text.startsWith('```', i)) {
      if (mode !== 'text') return fail('nested Markdown entities are not allowed')
      mode = 'pre'
      entityStart = i + 3
      i += 3
      continue
    }

    if (text[i] === '`') {
      if (mode !== 'text') return fail('nested Markdown entities are not allowed')
      mode = 'code'
      entityStart = i + 1
      i += 1
      continue
    }

    if (text[i] === '*') {
      if (mode === 'bold') {
        if (i === entityStart) return fail('empty Markdown bold entity')
        mode = 'text'
        entityStart = -1
        i += 1
        continue
      }
      if (mode !== 'text') return fail('nested Markdown entities are not allowed')
      mode = 'bold'
      entityStart = i + 1
      i += 1
      continue
    }

    if (text[i] === '_') {
      if (mode === 'italic') {
        if (i === entityStart) return fail('empty Markdown italic entity')
        mode = 'text'
        entityStart = -1
        i += 1
        continue
      }
      if (mode !== 'text') return fail('nested Markdown entities are not allowed')
      mode = 'italic'
      entityStart = i + 1
      i += 1
      continue
    }

    if (text[i] === '[') {
      if (mode !== 'text') return fail('nested Markdown entities are not allowed')
      const closeLabel = text.indexOf('](', i + 1)
      if (closeLabel < 0) return fail('unbalanced Markdown link')
      if (closeLabel === i + 1) return fail('empty Markdown link label')
      const closeUrl = text.indexOf(')', closeLabel + 2)
      if (closeUrl < 0) return fail('unbalanced Markdown link')
      const url = text.slice(closeLabel + 2, closeUrl)
      if (!url.trim()) return fail('empty Markdown link URL')
      i = closeUrl + 1
      continue
    }

    i += 1
  }

  if (mode === 'bold') return fail('unbalanced Markdown * entity')
  if (mode === 'italic') return fail('unbalanced Markdown _ entity')
  if (mode === 'code') return fail('unbalanced Markdown ` entity')
  if (mode === 'pre') return fail('unbalanced Markdown pre entity')
  return { ok: true, reason: null }
}

module.exports = {
  validateTelegramMarkdown,
}
