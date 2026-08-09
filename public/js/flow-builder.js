/* global Drawflow */
(function () {
  'use strict'

  let editor = null
  const keyToId = new Map()
  const idToKey = new Map()
  /** @type {Map<string, number[]>} node key -> flat button indices for each go output */
  const goOutputFlatIndices = new Map()

  const state = {
    draft: null,
    publishedKeys: [],
    enabled: false,
    actions: [],
    flow: null,
    selectedKey: null,
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  function setStatus(msg, kind) {
    const el = document.getElementById('flowStatus')
    if (!el) return
    el.textContent = msg || ''
    el.className = 'flow-status' + (kind ? ' ' + kind : '')
  }

  function clone(x) {
    return JSON.parse(JSON.stringify(x))
  }

  function flattenButtons(buttons) {
    const out = []
    for (const row of buttons || []) {
      for (const btn of row || []) out.push(btn)
    }
    return out
  }

  function buttonMode(btn) {
    if (btn.go !== undefined && btn.go !== null && String(btn.go) !== '') return 'go'
    if (btn.callback) return 'callback'
    if (btn.url_from) return 'url_from'
    if (btn.url) return 'url'
    if (btn.go !== undefined) return 'go'
    return 'go'
  }

  function buttonModeCount(btn) {
    return [btn.go, btn.callback, btn.url_from, btn.url]
      .filter((v) => v !== undefined && v !== null && String(v) !== '').length
  }

  function goFlatIndices(node) {
    const indices = []
    let flat = 0
    for (const row of node.buttons || []) {
      for (const btn of row) {
        if (buttonMode(btn) === 'go') indices.push(flat)
        flat++
      }
    }
    return indices
  }

  function countGoOutputs(node) {
    return goFlatIndices(node).length
  }

  function nodePreviewText(node) {
    if (node.kind === 'action') return 'action: ' + (node.action || '')
    const body = node.body || ''
    if (body.length <= 80) return body
    return body.slice(0, 80) + '…'
  }

  function nodeHtml(node) {
    const cls = node.kind === 'screen' ? 'flow-node-screen' : 'flow-node-action'
    return (
      '<div class="flow-node-inner ' + cls + '">' +
      '<div class="flow-node-header">' + escapeHtml(node.key) + '</div>' +
      '<div class="flow-node-body">' + escapeHtml(nodePreviewText(node)) + '</div>' +
      '</div>'
    )
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

  function clearWire(draft, fromKey, buttonFlatIndex) {
    const next = clone(draft)
    const node = next.nodes.find((n) => n.key === fromKey)
    if (!node) return next
    let i = 0
    for (const row of node.buttons || []) {
      for (let c = 0; c < row.length; c++) {
        if (i === buttonFlatIndex) {
          const btn = { ...row[c] }
          btn.go = ''
          row[c] = btn
          return next
        }
        i++
      }
    }
    return next
  }

  function syncPositionsFromEditor() {
    if (!editor || !state.draft) return
    for (const node of state.draft.nodes) {
      const id = keyToId.get(node.key)
      if (id == null) continue
      const info = editor.getNodeFromId(id)
      if (info) {
        node.pos_x = info.pos_x
        node.pos_y = info.pos_y
      }
    }
  }

  function renderCanvas() {
    if (!editor || !state.draft) return
    editor.clear()
    keyToId.clear()
    idToKey.clear()
    goOutputFlatIndices.clear()

    for (const node of state.draft.nodes) {
      const inputs = 1
      const outputs = countGoOutputs(node)
      const id = editor.addNode(
        node.key,
        inputs,
        outputs,
        Number(node.pos_x) || 0,
        Number(node.pos_y) || 0,
        node.kind === 'screen' ? 'flow-node-screen' : 'flow-node-action',
        { key: node.key },
        nodeHtml(node)
      )
      keyToId.set(node.key, id)
      idToKey.set(id, node.key)
      goOutputFlatIndices.set(node.key, goFlatIndices(node))
    }

    for (const node of state.draft.nodes) {
      const fromId = keyToId.get(node.key)
      if (!fromId) continue
      const flatList = goOutputFlatIndices.get(node.key) || []
      let outNum = 1
      for (const flatIdx of flatList) {
        const btn = flattenButtons(node.buttons)[flatIdx]
        if (btn && btn.go) {
          const toId = keyToId.get(btn.go)
          if (toId) {
            editor.addConnection(fromId, toId, 'output_' + outNum, 'input_1')
          }
        }
        outNum++
      }
    }
  }

  function getNode(key) {
    return (state.draft.nodes || []).find((n) => n.key === key)
  }

  function renderPanel() {
    const panel = document.getElementById('flowPanel')
    if (!panel) return
    const key = state.selectedKey
    if (!key) {
      panel.innerHTML = '<p class="muted flow-panel-empty">Select a node on the canvas</p>'
      return
    }
    const node = getNode(key)
    if (!node) {
      panel.innerHTML = '<p class="muted flow-panel-empty">Node not found</p>'
      return
    }

    let html = '<h3>' + escapeHtml(node.key) + '</h3>'
    html += '<div class="field"><label>Kind</label><input type="text" class="readonly" readonly value="' + escapeHtml(node.kind) + '"></div>'

    if (node.kind === 'screen') {
      html += '<div class="field"><label>screen_key</label><input type="text" class="readonly" readonly value="' + escapeHtml(node.screen_key || '') + '"></div>'
      html += '<div class="field"><label>Message body</label><textarea id="panelBody">' + escapeHtml(node.body || '') + '</textarea></div>'
    } else {
      html += '<div class="field"><label>Action</label><input type="text" class="readonly" readonly value="' + escapeHtml(node.action || '') + '"></div>'
    }

    html += '<div class="field"><label>Description</label><input type="text" id="panelDescription" value="' + escapeHtml(node.description || '') + '"></div>'

    html += '<div class="field"><label>Buttons</label>'
    html += '<table class="flow-buttons-table"><thead><tr><th>Label</th><th>Mode</th><th>Target</th></tr></thead><tbody id="panelButtonsBody">'

    const flat = flattenButtons(node.buttons)
    flat.forEach((btn, idx) => {
      const mode = buttonMode(btn)
      html += '<tr data-flat-index="' + idx + '">'
      html += '<td><input type="text" class="btn-label" value="' + escapeHtml(btn.label || btn.label_key || '') + '"></td>'
      html += '<td><select class="btn-mode">'
      ;['go', 'callback', 'url_from', 'url'].forEach((m) => {
        html += '<option value="' + m + '"' + (mode === m ? ' selected' : '') + '>' + m + '</option>'
      })
      html += '</select></td>'
      const target = btn.go || btn.callback || btn.url_from || btn.url || ''
      html += '<td><input type="text" class="btn-target" value="' + escapeHtml(target) + '"></td>'
      html += '</tr>'
    })

    html += '</tbody></table>'
    html += '<p class="muted" style="font-size:11px;margin:0 0 8px;">Draw wires on canvas for <code>go</code> targets. Save draft validates all buttons.</p>'
    html += '<button type="button" id="panelApply" class="btn btn-primary">Apply to canvas</button>'
    html += '</div>'

    panel.innerHTML = html

    document.getElementById('panelApply').addEventListener('click', applyPanelToDraft)
  }

  function applyPanelToDraft() {
    const key = state.selectedKey
    const node = getNode(key)
    if (!node) return

    const descEl = document.getElementById('panelDescription')
    if (descEl) node.description = descEl.value

    if (node.kind === 'screen') {
      const bodyEl = document.getElementById('panelBody')
      if (bodyEl) node.body = bodyEl.value
    }

    const tbody = document.getElementById('panelButtonsBody')
    if (tbody) {
      const rows = tbody.querySelectorAll('tr')
      const flat = flattenButtons(node.buttons)
      rows.forEach((row) => {
        const idx = Number(row.getAttribute('data-flat-index'))
        const label = row.querySelector('.btn-label').value.trim()
        const mode = row.querySelector('.btn-mode').value
        const target = row.querySelector('.btn-target').value.trim()
        const prev = flat[idx] || {}
        const btn = {}
        if (label) {
          if (prev.label_key && !prev.label) btn.label_key = label
          else btn.label = label
        }
        if (mode === 'go') btn.go = target
        else if (mode === 'callback') btn.callback = target
        else if (mode === 'url_from') btn.url_from = target
        else if (mode === 'url') btn.url = target
        flat[idx] = btn
      })

      const rebuilt = []
      let fi = 0
      for (const row of node.buttons || []) {
        const newRow = []
        for (let c = 0; c < row.length; c++) {
          newRow.push(flat[fi] || row[c])
          fi++
        }
        rebuilt.push(newRow)
      }
      node.buttons = rebuilt
    }

    const id = keyToId.get(key)
    if (id != null) {
      const info = editor.getNodeFromId(id)
      const outputs = countGoOutputs(node)
      const prevOutputs = (goOutputFlatIndices.get(key) || []).length
      if (outputs !== prevOutputs) {
        renderCanvas()
      } else {
        editor.updateNodeDataFromId(id, { key: node.key })
        const content = editor.drawflow.drawflow[editor.module].data[id]
        if (content) content.html = nodeHtml(node)
        editor.updateConnectionNodes(id)
      }
    } else {
      renderCanvas()
    }

    setStatus('Panel changes applied locally. Save draft to persist.', 'ok')
  }

  function bindEditorEvents() {
    editor.on('nodeSelected', function (id) {
      state.selectedKey = idToKey.get(id) || null
      renderPanel()
    })

    editor.on('nodeMoved', function (id) {
      const key = idToKey.get(id)
      const node = getNode(key)
      const info = editor.getNodeFromId(id)
      if (node && info) {
        node.pos_x = info.pos_x
        node.pos_y = info.pos_y
      }
    })

    editor.on('connectionCreated', function (info) {
      const fromKey = idToKey.get(info.output_id)
      const toKey = idToKey.get(info.input_id)
      if (!fromKey || !toKey) return
      const outNum = parseInt(String(info.output_class).replace('output_', ''), 10)
      const flatList = goOutputFlatIndices.get(fromKey) || []
      const flatIdx = flatList[outNum - 1]
      if (flatIdx === undefined) return
      state.draft = applyWire(state.draft, fromKey, flatIdx, toKey)
      if (state.selectedKey === fromKey) renderPanel()
      setStatus('Wire: ' + fromKey + ' → ' + toKey, 'ok')
    })

    editor.on('connectionRemoved', function (info) {
      const fromKey = idToKey.get(info.output_id)
      if (!fromKey) return
      const outNum = parseInt(String(info.output_class).replace('output_', ''), 10)
      const flatList = goOutputFlatIndices.get(fromKey) || []
      const flatIdx = flatList[outNum - 1]
      if (flatIdx === undefined) return
      state.draft = clearWire(state.draft, fromKey, flatIdx)
      if (state.selectedKey === fromKey) renderPanel()
      setStatus('Wire removed from ' + fromKey, 'ok')
    })
  }

  async function saveDraft() {
    syncPositionsFromEditor()
    setStatus('Saving draft…')
    const res = await fetch('/api/bot-flow/draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ draft: state.draft }),
    })
    const data = await res.json()
    if (!data.success) {
      const msg = (data.errors && data.errors.join('; ')) || data.error || 'Save failed'
      setStatus(msg, 'err')
      return
    }
    setStatus('Draft saved', 'ok')
  }

  async function publishDraft() {
    if (!window.confirm('Publish this draft to the live bot? Buyers will see changes after ~10 seconds.')) return
    syncPositionsFromEditor()
    setStatus('Publishing…')
    const res = await fetch('/api/bot-flow/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ draft: state.draft }),
    })
    const data = await res.json()
    if (!data.success) {
      const msg = (data.errors && data.errors.join('; ')) || data.error || 'Publish failed'
      setStatus(msg, 'err')
      return
    }
    setStatus('Published — bot reloads in ~10s', 'ok')
  }

  function buttonLabel(btn) {
    return btn.label || btn.label_key || 'Button'
  }

  function buildPreviewKeyboard(buttons) {
    const kb = document.getElementById('previewKeyboard')
    if (!kb) return
    kb.innerHTML = ''
    for (const row of buttons || []) {
      const rowEl = document.createElement('div')
      rowEl.className = 'phone-row'
      for (const btn of row || []) {
        const b = document.createElement('button')
        b.type = 'button'
        b.textContent = buttonLabel(btn)
        if (btn.go) {
          b.dataset.go = btn.go
        } else if (btn.callback) {
          b.className = 'stub'
          b.dataset.callback = btn.callback
        } else if (btn.url_from || btn.url) {
          b.className = 'stub'
          b.textContent = buttonLabel(btn) + ' (link)'
        }
        rowEl.appendChild(b)
      }
      kb.appendChild(rowEl)
    }
    kb.querySelectorAll('button[data-go]').forEach((btn) => {
      btn.addEventListener('click', function () {
        previewGoto(btn.dataset.go)
      })
    })
    kb.querySelectorAll('button[data-callback]').forEach((btn) => {
      btn.addEventListener('click', function () {
        document.getElementById('previewCaption').textContent =
          'Callback: ' + btn.dataset.callback + '\n\nThis runs in the live bot only.'
      })
    })
  }

  async function previewGoto(nodeKey) {
    const res = await fetch('/api/bot-flow/preview-step', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ draft: state.draft, nodeKey }),
    })
    const data = await res.json()
    if (!data.success) {
      setStatus(data.error || 'Preview failed', 'err')
      return
    }
    const cap = document.getElementById('previewCaption')
    if (data.type === 'action') {
      if (cap) {
        cap.textContent = 'Action: ' + data.action + '\n\nThis opens in the live bot only.'
      }
      const kb = document.getElementById('previewKeyboard')
      if (kb) {
        kb.innerHTML = ''
        const row = document.createElement('div')
        row.className = 'phone-row'
        const back = document.createElement('button')
        back.type = 'button'
        back.textContent = '← Back to entry'
        back.dataset.go = state.draft.entry_key || 'welcome'
        row.appendChild(back)
        kb.appendChild(row)
        back.addEventListener('click', function () {
          previewGoto(back.dataset.go)
        })
      }
      return
    }
    if (cap) cap.textContent = data.caption || ''
    buildPreviewKeyboard(data.buttons)
  }

  function openPreview() {
    syncPositionsFromEditor()
    const modal = document.getElementById('previewModal')
    if (modal) modal.classList.remove('hidden')
    previewGoto(state.draft.entry_key || 'welcome')
  }

  function closePreview() {
    const modal = document.getElementById('previewModal')
    if (modal) modal.classList.add('hidden')
  }

  async function toggleEnabled(checked) {
    const res = await fetch('/settings/bot-flow/toggle', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ enabled: checked }),
    })
    const data = await res.json()
    if (!data.success) {
      setStatus(data.error || 'Toggle failed', 'err')
      return
    }
    state.enabled = checked
    setStatus('Flow engine ' + (checked ? 'enabled' : 'disabled') + ' — bot reloads in ~10s', 'ok')
  }

  function bindToolbar() {
    document.getElementById('btnSaveDraft').addEventListener('click', saveDraft)
    document.getElementById('btnPublish').addEventListener('click', publishDraft)
    document.getElementById('btnPreview').addEventListener('click', openPreview)
    document.getElementById('previewClose').addEventListener('click', closePreview)
    document.getElementById('previewBackdrop').addEventListener('click', closePreview)

    const enabledEl = document.getElementById('flowEnabled')
    enabledEl.addEventListener('change', function () {
      toggleEnabled(enabledEl.checked)
    })
  }

  async function loadGraph() {
    setStatus('Loading…')
    const res = await fetch('/api/bot-flow')
    const data = await res.json()
    if (!data.success) {
      setStatus(data.error || 'Failed to load flow', 'err')
      return
    }
    state.draft = data.draft
    state.publishedKeys = data.publishedKeys
    state.enabled = data.enabled
    state.actions = data.actions || []
    state.flow = data.flow

    document.getElementById('flowEnabled').checked = !!state.enabled

    const meta = document.getElementById('flowMeta')
    if (meta && data.flow) {
      meta.textContent = 'Active flow: ' + data.flow.name + ' — entry: ' + (data.flow.entry_key || 'welcome') +
        (data.flow.draft_updated_at ? ' — draft saved ' + new Date(data.flow.draft_updated_at).toLocaleString() : '')
    } else if (meta) {
      meta.textContent = 'No active flow configured.'
    }

    if (!state.draft || !state.draft.nodes || !state.draft.nodes.length) {
      setStatus('No flow nodes to display', 'err')
      return
    }

    const container = document.getElementById('drawflow')
    editor = new Drawflow(container)
    editor.reroute = true
    editor.start()
    bindEditorEvents()
    renderCanvas()
    bindToolbar()
    setStatus('Ready — edit nodes and Save draft', 'ok')
  }

  document.addEventListener('DOMContentLoaded', loadGraph)
})()
