/* Client/server flow-draft validation (Phase 14 PR6 / M6). */
(function (root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) {
    module.exports = api
  }
  if (root && typeof root === 'object') {
    root.FlowBuilderValidation = api
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  const DEFAULT_FLOW_ACTIONS = [
    'product_list', 'product_card', 'kategori_menu', 'stok', 'riwayat', 'deposit_menu', 'noop',
  ]

  function clone(x) {
    return JSON.parse(JSON.stringify(x))
  }

  function isHttpUrl(value) {
    if (value == null) return false
    return /^https?:\/\/\S+$/i.test(String(value).trim())
  }

  // InlineKeyboardButton.url is an HTTP or tg:// URL. lib/flow.js forwards btn.url as-is.
  function isTelegramButtonUrl(value) {
    if (isHttpUrl(value)) return true
    if (value == null) return false
    return /^tg:\/\/\S+$/i.test(String(value).trim())
  }

  function buttonModeCount(btn) {
    return [btn.go, btn.callback, btn.url_from, btn.url]
      .filter((v) => v !== undefined && v !== null && String(v) !== '').length
  }

  function buttonLabelText(btn) {
    if (!btn) return ''
    if (btn.label != null && String(btn.label).trim()) return String(btn.label).trim()
    if (btn.label_key != null && String(btn.label_key).trim()) return String(btn.label_key).trim()
    return ''
  }

  function isScreenCopyKey(key) {
    return typeof key === 'string' && key.startsWith('screen.')
  }

  function issue(partial) {
    return Object.assign({
      level: 'error',
      code: '',
      message: '',
      nodeKey: null,
      field: null,
      buttonIndex: null,
    }, partial)
  }

  function outboundGoTargets(node) {
    const targets = []
    for (const row of node.buttons || []) {
      for (const btn of row || []) {
        if (btn && btn.go != null && String(btn.go).trim()) targets.push(String(btn.go).trim())
      }
    }
    return targets
  }

  function reachableFromEntry(draft, nodeKeys) {
    const keySet = new Set(nodeKeys)
    const byKey = new Map()
    for (const n of draft.nodes || []) {
      if (n && n.key) byKey.set(n.key, n)
    }
    const start = draft && draft.entry_key && keySet.has(draft.entry_key) ? draft.entry_key : null
    const seen = new Set()
    if (!start) return seen
    const queue = [start]
    seen.add(start)
    while (queue.length) {
      const key = queue.shift()
      const node = byKey.get(key)
      if (!node) continue
      for (const target of outboundGoTargets(node)) {
        if (!keySet.has(target) || seen.has(target)) continue
        seen.add(target)
        queue.push(target)
      }
    }
    return seen
  }

  function collectDraftIssues(draft, options) {
    if (Array.isArray(options)) options = {}
    options = options || {}
    const allowedActions = options.allowedActions || DEFAULT_FLOW_ACTIONS
    const allowedSet = new Set(allowedActions)
    const errors = []
    const warnings = []

    if (!draft || typeof draft !== 'object') {
      errors.push(issue({ code: 'draft_required', message: 'draft required' }))
      return { ok: false, errors, warnings, issues: errors.slice() }
    }
    if (!Array.isArray(draft.nodes)) {
      errors.push(issue({ code: 'nodes_array', message: 'nodes must be array' }))
      return { ok: false, errors, warnings, issues: errors.slice() }
    }

    const keys = draft.nodes.map((n) => n && n.key).filter(Boolean)
    const set = new Set(keys)
    if (keys.length !== set.size) {
      errors.push(issue({ code: 'duplicate_keys', message: 'duplicate keys' }))
    }
    if (!draft.nodes.length) {
      errors.push(issue({ code: 'empty_graph', message: 'at least one node required' }))
    }

    const seenScreenKeys = new Set()
    for (const n of draft.nodes) {
      if (!n || !n.key) {
        errors.push(issue({ code: 'missing_key', message: 'node missing key' }))
        continue
      }
      const key = n.key
      if (n.kind !== 'screen' && n.kind !== 'action') {
        errors.push(issue({ code: 'bad_kind', nodeKey: key, field: 'kind', message: key + ': bad kind' }))
      }
      if (n.kind === 'screen' && !n.screen_key) {
        errors.push(issue({
          code: 'screen_key_required',
          nodeKey: key,
          field: 'screen_key',
          message: key + ': screen_key required',
        }))
      } else if (n.kind === 'screen' && n.screen_key) {
        if (!isScreenCopyKey(n.screen_key)) {
          errors.push(issue({
            code: 'screen_key_namespace',
            nodeKey: key,
            field: 'screen_key',
            message: key + ': screen_key must start with screen.',
          }))
        }
        if (seenScreenKeys.has(n.screen_key)) {
          errors.push(issue({
            code: 'duplicate_screen_key',
            nodeKey: key,
            field: 'screen_key',
            message: key + ': duplicate screen_key: ' + n.screen_key,
          }))
        }
        seenScreenKeys.add(n.screen_key)
      }

      if (n.kind === 'screen' && !(typeof n.body === 'string' && n.body.trim())) {
        errors.push(issue({
          code: 'empty_body',
          nodeKey: key,
          field: 'body',
          message: key + ': message body required',
        }))
      }

      if (n.kind === 'action' && !n.action) {
        errors.push(issue({
          code: 'action_required',
          nodeKey: key,
          field: 'action',
          message: key + ': action required',
        }))
      }
      if (n.kind === 'action' && n.action && !allowedSet.has(n.action)) {
        errors.push(issue({
          code: 'unknown_action',
          nodeKey: key,
          field: 'action',
          message: key + ': unknown action: ' + n.action,
        }))
      }

      const rows = Array.isArray(n.buttons) ? n.buttons : null
      if (!rows) {
        errors.push(issue({
          code: 'buttons_array',
          nodeKey: key,
          field: 'buttons',
          message: key + ': buttons must be array',
        }))
        continue
      }
      let flatIndex = 0
      for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
        const row = rows[rowIdx]
        if (!Array.isArray(row)) {
          errors.push(issue({
            code: 'button_row',
            nodeKey: key,
            field: 'buttons',
            message: key + ': button row must be array',
          }))
          continue
        }
        for (let colIdx = 0; colIdx < row.length; colIdx++) {
          const btn = row[colIdx]
          const idx = flatIndex
          flatIndex++
          if (!btn || typeof btn !== 'object') {
            errors.push(issue({
              code: 'button_shape',
              nodeKey: key,
              field: 'buttons',
              buttonIndex: idx,
              message: key + ': button ' + (idx + 1) + ' must be an object',
            }))
            continue
          }
          const buttonName = (btn && (btn.label || btn.label_key))
            ? String(btn.label || btn.label_key)
            : ('row ' + (rowIdx + 1) + ' col ' + (colIdx + 1))
          if (!buttonLabelText(btn)) {
            errors.push(issue({
              code: 'button_label',
              nodeKey: key,
              field: 'label',
              buttonIndex: idx,
              message: key + ': button ' + (idx + 1) + ' needs a label',
            }))
          }
          const emptyGo = !!(btn && btn.go !== undefined && btn.go !== null && String(btn.go).trim() === '')
          if (emptyGo) {
            errors.push(issue({
              code: 'empty_go',
              nodeKey: key,
              field: 'go',
              buttonIndex: idx,
              message: key + ': button "' + buttonName + '" has an empty go target',
            }))
          } else if (buttonModeCount(btn) !== 1) {
            errors.push(issue({
              code: 'button_mode',
              nodeKey: key,
              field: 'mode',
              buttonIndex: idx,
              message: key + ': button "' + buttonName + '" needs exactly one of go|callback|url_from|url',
            }))
          }
          if (btn.go && String(btn.go).trim() && !set.has(btn.go)) {
            errors.push(issue({
              code: 'go_target',
              nodeKey: key,
              field: 'go',
              buttonIndex: idx,
              message: key + ': go target unknown: ' + btn.go,
            }))
          }
          if (btn.url != null && String(btn.url) !== '' && !isTelegramButtonUrl(btn.url)) {
            errors.push(issue({
              code: 'url_scheme',
              nodeKey: key,
              field: 'url',
              buttonIndex: idx,
              message: key + ': url must be http(s) or tg://: ' + btn.url,
            }))
          }
        }
      }
    }

    if (!draft.entry_key || !String(draft.entry_key).trim()) {
      errors.push(issue({ code: 'entry_key', field: 'entry_key', message: 'entry_key required' }))
    } else if (!set.has(draft.entry_key)) {
      errors.push(issue({
        code: 'entry_key',
        field: 'entry_key',
        message: 'entry_key missing from nodes: ' + draft.entry_key,
      }))
    }

    const reachable = reachableFromEntry(draft, keys)
    for (const n of draft.nodes) {
      if (!n || !n.key) continue
      if (n.key !== draft.entry_key && !reachable.has(n.key)) {
        warnings.push(issue({
          level: 'warning',
          code: 'unreachable',
          nodeKey: n.key,
          message: n.key + ': not reachable from Start',
        }))
      }
      if (n.kind === 'screen') {
        const buttons = Array.isArray(n.buttons) ? n.buttons : []
        const hasButtons = buttons.some((row) => Array.isArray(row) && row.length)
        const hasOutbound = outboundGoTargets(n).length > 0
        if (!hasButtons && !hasOutbound) {
          warnings.push(issue({
            level: 'warning',
            code: 'dead_end',
            nodeKey: n.key,
            field: 'buttons',
            message: n.key + ': message has no buttons and no outbound link',
          }))
        }
      }
    }

    return {
      ok: errors.length === 0,
      errors,
      warnings,
      issues: errors.concat(warnings),
    }
  }

  function overlayNodePatch(draft, nodeKey, patch) {
    const next = clone(draft || { nodes: [] })
    const node = (next.nodes || []).find((n) => n.key === nodeKey)
    if (node && patch && typeof patch === 'object') {
      Object.assign(node, clone(patch))
      node.key = nodeKey
    }
    return next
  }

  function nodeHighlightClass(nodeKey, result) {
    const issues = result && result.issues ? result.issues : []
    let warning = false
    for (const item of issues) {
      if (item.nodeKey !== nodeKey) continue
      if (item.level === 'error') return 'is-error'
      if (item.level === 'warning') warning = true
    }
    return warning ? 'is-warning' : ''
  }

  function saveBlocked(result) {
    return !!(result && result.errors && result.errors.length)
  }

  function saveBlockTooltip(result) {
    if (!saveBlocked(result)) return ''
    return result.errors.map((e) => e.message).join('\n')
  }

  function canvasPanToCenter(viewport, nodeRect, zoom) {
    const z = Number(zoom)
    const scale = Number.isFinite(z) && z !== 0 ? z : 1
    const midX = Number(nodeRect.x) + Number(nodeRect.width || 0) / 2
    const midY = Number(nodeRect.y) + Number(nodeRect.height || 0) / 2
    // Drawflow scales around the precanvas centre (default transform-origin).
    return {
      canvas_x: (Number(viewport.width) / 2 - midX) * scale,
      canvas_y: (Number(viewport.height) / 2 - midY) * scale,
    }
  }

  return {
    DEFAULT_FLOW_ACTIONS: DEFAULT_FLOW_ACTIONS,
    isHttpUrl: isHttpUrl,
    collectDraftIssues: collectDraftIssues,
    overlayNodePatch: overlayNodePatch,
    nodeHighlightClass: nodeHighlightClass,
    saveBlocked: saveBlocked,
    saveBlockTooltip: saveBlockTooltip,
    canvasPanToCenter: canvasPanToCenter,
  }
})
