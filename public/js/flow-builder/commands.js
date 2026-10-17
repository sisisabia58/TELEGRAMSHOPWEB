/* Named draft mutators for the flow builder command stack (Phase 14 PR2 / M4). */
(function (root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) {
    module.exports = api
  }
  if (root && typeof root === 'object') {
    root.FlowBuilderCommands = api
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  function clone(x) {
    return JSON.parse(JSON.stringify(x))
  }

  function addNode(draft, node) {
    const next = clone(draft)
    next.nodes = (next.nodes || []).concat([clone(node)])
    const entry = next.entry_key
    if (!next.nodes.some((n) => n.key === entry)) {
      next.entry_key = node.key
    }
    return next
  }

  function inboundKeySet(keys) {
    if (keys instanceof Set) return keys
    return new Set(Array.isArray(keys) ? keys : [keys])
  }

  function inboundGoCount(draft, keys) {
    const wanted = inboundKeySet(keys)
    let n = 0
    for (const node of (draft && draft.nodes) || []) {
      for (const row of node.buttons || []) {
        for (const btn of row || []) {
          if (wanted.has(btn.go)) n++
        }
      }
    }
    return n
  }

  function stripInboundGoButtons(nodes, keys) {
    const wanted = inboundKeySet(keys)
    return (nodes || []).map((node) => {
      const buttons = []
      for (const row of node.buttons || []) {
        const kept = []
        for (const btn of row || []) {
          if (!wanted.has(btn.go)) kept.push(btn)
        }
        if (kept.length) buttons.push(kept)
      }
      if (node.buttons === undefined && buttons.length === 0) return node
      return Object.assign({}, node, { buttons: buttons })
    })
  }

  function deleteNodes(draft, keys) {
    const wanted = inboundKeySet(keys)
    const next = clone(draft)
    next.nodes = stripInboundGoButtons(
      (next.nodes || []).filter((n) => !wanted.has(n.key)),
      wanted
    )
    return next
  }

  function deleteNode(draft, key) {
    return deleteNodes(draft, [key])
  }

  function defaultMessageButtons(entryKey) {
    if (!entryKey) return []
    return [[{ label: 'Menu', go: entryKey }]]
  }

  function diffStringMap(original, current) {
    const out = {}
    const prev = original || {}
    const src = current || {}
    for (const key of Object.keys(src)) {
      if (String(src[key] ?? '') !== String(prev[key] ?? '')) out[key] = src[key]
    }
    return out
  }

  function moveNode(draft, key, posX, posY) {
    const next = clone(draft)
    const node = (next.nodes || []).find((n) => n.key === key)
    if (node) {
      node.pos_x = posX
      node.pos_y = posY
    }
    return next
  }

  function applyWire(draft, fromKey, buttonFlatIndex, toKey) {
    const next = clone(draft)
    const node = (next.nodes || []).find((n) => n.key === fromKey)
    if (!node) return next
    let i = 0
    for (const row of node.buttons || []) {
      for (let c = 0; c < row.length; c++) {
        if (i === buttonFlatIndex) {
          const btn = Object.assign({}, row[c])
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

  function clearWire(draft, fromKey, buttonFlatIndex) {
    const next = clone(draft)
    const node = (next.nodes || []).find((n) => n.key === fromKey)
    if (!node) return next
    let i = 0
    for (const row of node.buttons || []) {
      for (let c = 0; c < row.length; c++) {
        if (i === buttonFlatIndex) {
          const btn = Object.assign({}, row[c])
          btn.go = ''
          row[c] = btn
          return next
        }
        i++
      }
    }
    return next
  }

  function patchNode(draft, key, patch) {
    const next = clone(draft)
    const idx = (next.nodes || []).findIndex((n) => n.key === key)
    if (idx < 0) return next
    next.nodes[idx] = Object.assign({}, next.nodes[idx], clone(patch || {}))
    next.nodes[idx].key = key
    return next
  }

  return {
    addNode: addNode,
    deleteNode: deleteNode,
    deleteNodes: deleteNodes,
    moveNode: moveNode,
    applyWire: applyWire,
    clearWire: clearWire,
    patchNode: patchNode,
    inboundGoCount: inboundGoCount,
    defaultMessageButtons: defaultMessageButtons,
    diffStringMap: diffStringMap,
  }
})
