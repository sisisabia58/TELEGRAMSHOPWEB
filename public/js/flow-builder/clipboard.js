/* Copy, paste, and duplicate helpers for the flow builder (Phase 14 PR5 / M5). */
(function (root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) {
    module.exports = api
  }
  if (root && typeof root === 'object') {
    root.FlowBuilderClipboard = api
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  const PASTE_OFFSET = 40

  function clone(x) {
    return JSON.parse(JSON.stringify(x))
  }

  function generateCopyNodeKey(baseKey, existingKeys) {
    const existing = existingKeys || []
    const base = String(baseKey || 'node')
    const first = base + '_copy'
    if (existing.indexOf(first) === -1) return first
    let n = 2
    while (existing.indexOf(base + '_copy' + n) !== -1) n++
    return base + '_copy' + n
  }

  function snapshotNodes(draft, keys) {
    const wanted = Array.isArray(keys) ? keys : []
    const nodes = (draft && draft.nodes) || []
    const out = []
    for (const key of wanted) {
      const node = nodes.find((n) => n && n.key === key)
      if (node) out.push(clone(node))
    }
    return out
  }

  function remapWires(node, keyMap, selectedKeys) {
    for (const row of node.buttons || []) {
      for (const btn of row || []) {
        if (btn.go === undefined || btn.go === null || String(btn.go) === '') continue
        if (selectedKeys.has(btn.go) && keyMap[btn.go]) {
          btn.go = keyMap[btn.go]
        } else {
          btn.go = ''
        }
      }
    }
  }

  function nextScreenKey(source, newKey, existingScreenKeys) {
    if (source.kind !== 'screen') {
      return source.screen_key == null ? null : source.screen_key
    }
    const base = source.screen_key || (String(newKey).indexOf('screen.') === 0 ? newKey : 'screen.' + newKey)
    return generateCopyNodeKey(base, existingScreenKeys)
  }

  function pasteNodes(draft, sourceNodes, options) {
    options = options || {}
    const sources = Array.isArray(sourceNodes) ? sourceNodes : []
    if (!sources.length) return draft
    const next = clone(draft)
    next.nodes = (next.nodes || []).slice()
    const existingKeys = next.nodes.map((n) => n.key)
    const existingScreenKeys = next.nodes.map((n) => n.screen_key).filter(Boolean)
    const selectedKeys = new Set(sources.map((n) => n.key))
    const keyMap = {}

    for (const src of sources) {
      const newKey = generateCopyNodeKey(src.key, existingKeys)
      existingKeys.push(newKey)
      keyMap[src.key] = newKey
    }

    let dx = options.offset != null ? options.offset : PASTE_OFFSET
    let dy = dx
    if (options.origin && options.origin.x != null && options.origin.y != null) {
      const first = sources[0]
      dx = options.origin.x - (Number(first.pos_x) || 0)
      dy = options.origin.y - (Number(first.pos_y) || 0)
    }

    for (const src of sources) {
      const copy = clone(src)
      copy.key = keyMap[src.key]
      copy.pos_x = (Number(src.pos_x) || 0) + dx
      copy.pos_y = (Number(src.pos_y) || 0) + dy
      if (copy.kind === 'screen') {
        copy.screen_key = nextScreenKey(src, copy.key, existingScreenKeys)
        existingScreenKeys.push(copy.screen_key)
      } else if (copy.screen_key == null) {
        copy.screen_key = null
      }
      remapWires(copy, keyMap, selectedKeys)
      next.nodes.push(copy)
    }
    return next
  }

  function duplicateNodes(draft, keys, options) {
    const nodes = snapshotNodes(draft, keys)
    const opts = Object.assign({ offset: PASTE_OFFSET }, options || {})
    return pasteNodes(draft, nodes, opts)
  }

  function createClipboard() {
    let nodes = []
    return {
      copy: function (sourceNodes) {
        nodes = clone(sourceNodes || [])
        return clone(nodes)
      },
      peek: function () {
        return clone(nodes)
      },
      isEmpty: function () {
        return nodes.length === 0
      },
      clear: function () {
        nodes = []
      },
    }
  }

  function entryDeleteMessage(key) {
    return 'Cannot delete the entry node ("' + key + '"). Change the entry node before deleting.'
  }

  function rectLeft(rect) {
    if (!rect) return 0
    if (rect.left != null) return Number(rect.left) || 0
    return Number(rect.x) || 0
  }

  function rectTop(rect) {
    if (!rect) return 0
    if (rect.top != null) return Number(rect.top) || 0
    return Number(rect.y) || 0
  }

  function toolbarPosition(nodeRect, wrapRect, toolbarSize, options) {
    const gap = options && options.gap != null ? options.gap : 8
    const width = (toolbarSize && toolbarSize.width) || 0
    const height = (toolbarSize && toolbarSize.height) || 0
    const wrapW = wrapRect && wrapRect.width != null ? Number(wrapRect.width) || 0 : 0
    const wrapH = wrapRect && wrapRect.height != null ? Number(wrapRect.height) || 0 : 0
    const nodeLeft = rectLeft(nodeRect) - rectLeft(wrapRect)
    const nodeTop = rectTop(nodeRect) - rectTop(wrapRect)
    const nodeWidth = (nodeRect && nodeRect.width) || 0
    let left = nodeLeft + nodeWidth / 2 - width / 2
    let top = nodeTop - height - gap
    const maxLeft = Math.max(0, wrapW - width)
    const maxTop = Math.max(0, wrapH - height)
    left = Math.min(Math.max(0, left), maxLeft)
    top = Math.min(Math.max(0, top), maxTop)
    return { left: left, top: top }
  }

  return {
    PASTE_OFFSET: PASTE_OFFSET,
    generateCopyNodeKey: generateCopyNodeKey,
    snapshotNodes: snapshotNodes,
    duplicateNodes: duplicateNodes,
    pasteNodes: pasteNodes,
    createClipboard: createClipboard,
    entryDeleteMessage: entryDeleteMessage,
    toolbarPosition: toolbarPosition,
  }
})
