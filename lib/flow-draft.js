function clone(x) {
  return JSON.parse(JSON.stringify(x))
}

function buttonModeCount(btn) {
  return [btn.go, btn.callback, btn.url_from, btn.url]
    .filter((v) => v !== undefined && v !== null && String(v) !== '').length
}

function validateDraft(draft, publishedKeys) {
  const errors = []
  if (!draft || typeof draft !== 'object') return { ok: false, errors: ['draft required'] }
  if (!Array.isArray(draft.nodes)) return { ok: false, errors: ['nodes must be array'] }

  const keys = draft.nodes.map((n) => n && n.key).filter(Boolean)
  const set = new Set(keys)
  for (const k of publishedKeys) {
    if (!set.has(k)) errors.push(`missing key: ${k}`)
  }
  for (const k of keys) {
    if (!publishedKeys.includes(k)) errors.push(`unknown key: ${k}`)
  }
  if (keys.length !== set.size) errors.push('duplicate keys')

  for (const n of draft.nodes) {
    if (!n || !n.key) {
      errors.push('node missing key')
      continue
    }
    if (n.kind !== 'screen' && n.kind !== 'action') errors.push(`${n.key}: bad kind`)
    if (n.kind === 'screen' && !n.screen_key) errors.push(`${n.key}: screen_key required`)
    if (n.kind === 'action' && !n.action) errors.push(`${n.key}: action required`)
    const rows = Array.isArray(n.buttons) ? n.buttons : null
    if (!rows) {
      errors.push(`${n.key}: buttons must be array`)
      continue
    }
    for (const row of rows) {
      if (!Array.isArray(row)) {
        errors.push(`${n.key}: button row must be array`)
        continue
      }
      for (const btn of row) {
        if (buttonModeCount(btn) !== 1) {
          errors.push(`${n.key}: each button needs exactly one of go|callback|url_from|url`)
        }
        if (btn.go && !set.has(btn.go)) {
          errors.push(`${n.key}: go target unknown: ${btn.go}`)
        }
      }
    }
  }

  if (draft.entry_key && !set.has(draft.entry_key)) {
    errors.push(`entry_key missing from nodes: ${draft.entry_key}`)
  }

  return { ok: errors.length === 0, errors }
}

function draftFromPublished(nodes, copyByKey, entryKey) {
  const list = Array.isArray(nodes) ? nodes : []
  return {
    entry_key: entryKey || 'welcome',
    nodes: list.map((n) => ({
      key: n.key,
      kind: n.kind,
      screen_key: n.screen_key || null,
      action: n.action || null,
      description: n.description || '',
      pos_x: Number(n.pos_x) || 0,
      pos_y: Number(n.pos_y) || 0,
      buttons: Array.isArray(n.buttons) ? clone(n.buttons) : [],
      body: n.kind === 'screen' && n.screen_key
        ? (copyByKey[n.screen_key] || '')
        : undefined,
    })),
  }
}

function flattenButtons(buttons) {
  const out = []
  for (const row of buttons || []) {
    for (const btn of row || []) out.push(btn)
  }
  return out
}

function applyWire(draft, fromKey, buttonFlatIndex, toKey) {
  const next = clone(draft)
  const node = next.nodes.find((n) => n.key === fromKey)
  if (!node) return next
  let i = 0
  for (const row of node.buttons || []) {
    for (let c = 0; c < row.length; c++) {
      if (i === buttonFlatIndex) {
        const btn = { ...row[c] }
        delete btn.callback
        delete btn.url
        delete btn.url_from
        btn.go = toKey
        row[c] = btn
        return next
      }
      i++
    }
  }
  return next
}

function publishPlan(draft) {
  const nodes = (draft.nodes || []).map((n) => ({
    key: n.key,
    kind: n.kind,
    screen_key: n.kind === 'screen' ? n.screen_key : null,
    action: n.kind === 'action' ? n.action : null,
    description: n.description || '',
    buttons: n.buttons || [],
    pos_x: Number(n.pos_x) || 0,
    pos_y: Number(n.pos_y) || 0,
  }))
  const copies = []
  for (const n of draft.nodes || []) {
    if (n.kind === 'screen' && n.screen_key && typeof n.body === 'string' && n.body.trim()) {
      copies.push({ key: n.screen_key, body: n.body })
    }
  }
  return { nodes, copies }
}

module.exports = {
  validateDraft,
  draftFromPublished,
  applyWire,
  publishPlan,
  flattenButtons,
}
