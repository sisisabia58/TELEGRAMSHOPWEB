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
    return next
  }

  function deleteNode(draft, key) {
    const next = clone(draft)
    next.nodes = (next.nodes || []).filter((n) => n.key !== key)
    for (const other of next.nodes) {
      for (const row of other.buttons || []) {
        for (const btn of row || []) {
          if (btn.go === key) btn.go = ''
        }
      }
    }
    return next
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
    moveNode: moveNode,
    applyWire: applyWire,
    clearWire: clearWire,
    patchNode: patchNode,
  }
})
