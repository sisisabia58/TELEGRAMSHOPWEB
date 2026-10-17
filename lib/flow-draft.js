const {
  collectDraftIssues,
  DEFAULT_FLOW_ACTIONS,
} = require('../public/js/flow-builder/validation')

function clone(x) {
  return JSON.parse(JSON.stringify(x))
}

function isScreenCopyKey(key) {
  return typeof key === 'string' && key.startsWith('screen.')
}

function normalizeCopyKinds(existingCopyKeys) {
  const kinds = new Map()
  for (const item of existingCopyKeys || []) {
    if (typeof item === 'string') {
      kinds.set(item, isScreenCopyKey(item) ? 'screen' : 'other')
    } else if (item && typeof item.key === 'string') {
      kinds.set(item.key, item.kind || 'other')
    }
  }
  return kinds
}

function validateDraft(draft, options = {}) {
  const result = collectDraftIssues(draft, options)
  return { ok: result.ok, errors: result.errors.map((e) => e.message) }
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
      media_url: n.media_url || null,
      media_type: n.media_type || 'photo',
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
    media_url: n.media_url || null,
    media_type: n.media_type || 'photo',
    buttons: n.buttons || [],
    pos_x: Number(n.pos_x) || 0,
    pos_y: Number(n.pos_y) || 0,
  }))
  const copies = []
  for (const n of draft.nodes || []) {
    if (n.kind === 'screen' && n.screen_key) {
      copies.push({
        key: n.screen_key,
        body: typeof n.body === 'string' ? n.body : '',
      })
    }
  }
  return { nodes, copies }
}

function diffPublishPlan(draft, publishedKeys = [], existingCopyKeys = []) {
  const copyKinds = normalizeCopyKinds(existingCopyKeys)
  const draftKeys = new Set((draft.nodes || []).map((n) => n.key))
  const plan = publishPlan(draft)

  const nodeDeletes = publishedKeys.filter((k) => !draftKeys.has(k))
  const copyInserts = []
  const copyUpserts = []
  for (const c of plan.copies) {
    if (copyKinds.has(c.key)) {
      if (copyKinds.get(c.key) === 'screen') {
        copyUpserts.push(c)
      }
    } else {
      const node = (draft.nodes || []).find((n) => n.screen_key === c.key)
      copyInserts.push({
        key: c.key,
        body: c.body,
        description: (node && node.description) || '',
      })
    }
  }
  return {
    nodeDeletes,
    nodeUpserts: plan.nodes,
    copyInserts,
    copyUpserts,
    entryKey: draft.entry_key || (draft.nodes && draft.nodes[0] && draft.nodes[0].key) || 'welcome',
  }
}

function buildPublishRpcPayload(flowId, draft, diff) {
  return {
    p_flow_id: flowId,
    p_draft: draft,
    p_entry_key: diff.entryKey,
    p_node_deletes: diff.nodeDeletes || [],
    p_node_upserts: diff.nodeUpserts || [],
    p_copy_inserts: diff.copyInserts || [],
    p_copy_upserts: diff.copyUpserts || [],
  }
}

function generateButtonLabelKey(screenKey, index) {
  const base = String(screenKey || 'node').replace(/^screen\./, '')
  return `btn.${base}.${index}`
}

function reorderButtonRow(buttons, fromIdx, toIdx) {
  const copy = clone(buttons || [])
  if (fromIdx < 0 || fromIdx >= copy.length || toIdx < 0 || toIdx >= copy.length) return copy
  const [moved] = copy.splice(fromIdx, 1)
  copy.splice(toIdx, 0, moved)
  return copy
}

module.exports = {
  validateDraft,
  collectDraftIssues,
  draftFromPublished,
  applyWire,
  publishPlan,
  diffPublishPlan,
  buildPublishRpcPayload,
  flattenButtons,
  generateButtonLabelKey,
  reorderButtonRow,
  DEFAULT_FLOW_ACTIONS,
}

