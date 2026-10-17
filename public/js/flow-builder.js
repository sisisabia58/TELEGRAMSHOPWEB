/* global Drawflow, FlowBuilderState, FlowBuilderCommands, FlowBuilderPalette, FlowBuilderClipboard, FlowBuilderValidation */
(function () {
  'use strict'

  let editor = null
  const keyToId = new Map()
  const idToKey = new Map()
  /** @type {Map<string, number[]>} node key -> flat button indices for each go output */
  const goOutputFlatIndices = new Map()

  const editorState = FlowBuilderState.createEditorState()
  const nodeClipboard = FlowBuilderClipboard.createClipboard()
  let lastCanvasPoint = null
  let historyLockCount = 0
  let lastValidation = { ok: true, errors: [], warnings: [], issues: [] }

  function isHistoryLocked() {
    return historyLockCount > 0
  }

  function withHistoryLock(fn) {
    historyLockCount++
    try {
      return fn()
    } finally {
      historyLockCount--
    }
  }

  const state = {
    draft: null,
    publishedKeys: [],
    enabled: false,
    envOverride: false,
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
    return FlowBuilderState.cloneDraft(x)
  }

  function applyCommand(mutator) {
    const next = editorState.applyCommand(mutator)
    state.draft = next
    updateHistoryButtons()
    refreshValidation()
    return next
  }

  function updateHistoryButtons() {
    const undoBtn = document.getElementById('btnUndo')
    const redoBtn = document.getElementById('btnRedo')
    if (undoBtn) undoBtn.disabled = !editorState.canUndo()
    if (redoBtn) redoBtn.disabled = !editorState.canRedo()
  }

  function effectiveEntryKey() {
    return FlowBuilderState.effectiveEntryKey(state.draft)
  }

  function restoreSelectionAfterHistory() {
    if (state.selectedKey && getNode(state.selectedKey)) return
    const draft = state.draft
    if (!draft || !draft.nodes || !draft.nodes.length) {
      state.selectedKey = null
      return
    }
    state.selectedKey = effectiveEntryKey()
  }

  function restoreFromHistory(next) {
    state.draft = next
    restoreSelectionAfterHistory()
    withHistoryLock(function () {
      renderCanvas()
      renderPanel()
    })
    updateHistoryButtons()
    refreshValidation()
  }

  function undoDraft() {
    if (!editorState.canUndo()) return
    restoreFromHistory(editorState.undo())
    setStatus('Undid last change', 'ok')
  }

  function redoDraft() {
    if (!editorState.canRedo()) return
    restoreFromHistory(editorState.redo())
    setStatus('Redid last change', 'ok')
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

  function displayLabel(btn) {
    return btn.label || btn.label_key || 'Button'
  }

  function nodePreviewText(node) {
    if (node.kind === 'action') {
      return 'Runs: ' + (node.action || '—') + '\n\nOpens this step in the live bot catalog / tools.'
    }
    const body = node.body || ''
    if (body.length <= 160) return body
    return body.slice(0, 160) + '…'
  }

  function nodeHtml(node) {
    const kindClass = node.kind === 'screen' ? 'screen' : 'action'
    const kindLabel = node.kind === 'screen' ? 'Message' : 'Action'
    const entryKey = effectiveEntryKey()
    let html = '<div class="sp-card ' + kindClass + '" data-node-key="' + escapeHtml(node.key) + '">'
    if (node.key === entryKey) {
      html += '<span class="sp-start-pill">Start</span>'
    }
    html += '<div class="sp-card-header"><span>' + kindLabel + '</span><span class="sp-card-key">' + escapeHtml(node.key) + '</span></div>'
    html += '<div class="sp-card-body">' + escapeHtml(nodePreviewText(node)) + '</div>'

    const goBtns = flattenButtons(node.buttons).filter((b) => buttonMode(b) === 'go')
    if (goBtns.length) {
      html += '<div class="sp-card-buttons">'
      goBtns.slice(0, 8).forEach((btn) => {
        html += '<div class="sp-card-btn"><span>' + escapeHtml(displayLabel(btn)) + '</span><span class="sp-port-hint"></span></div>'
      })
      if (goBtns.length > 8) {
        html += '<div class="sp-card-btn"><span>+' + (goBtns.length - 8) + ' more…</span></div>'
      }
      html += '</div>'
    } else if (node.kind === 'screen') {
      html += '<div class="sp-card-meta">No go-wires — use panel to edit callbacks / links</div>'
    }

    html += '</div>'
    return html
  }

  function refreshNodeDom(id, node) {
    const el = document.getElementById('node-' + id)
    if (!el) return
    const content = el.querySelector('.drawflow_content_node')
    if (content) content.innerHTML = nodeHtml(node)
    const data = editor.drawflow.drawflow[editor.module].data[id]
    if (data) data.html = nodeHtml(node)
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

  function resolveNodeId(raw) {
    if (raw == null) return null
    const n = Number(raw)
    if (idToKey.has(n)) return n
    if (idToKey.has(raw)) return raw
    const asStr = String(raw)
    for (const [id] of idToKey) {
      if (String(id) === asStr) return id
    }
    return null
  }

  function positionSelectionToolbar() {
    const toolbar = document.getElementById('selectionToolbar')
    if (!toolbar) return
    const key = state.selectedKey
    const id = key ? keyToId.get(key) : null
    const nodeEl = id != null ? document.getElementById('node-' + id) : null
    const wrap = document.querySelector('.flow-canvas-wrap')
    const deleteBtn = document.getElementById('btnToolbarDeleteNode')
    if (!key || !nodeEl || !wrap) {
      toolbar.hidden = true
      if (deleteBtn) deleteBtn.disabled = true
      return
    }
    toolbar.hidden = false
    const isStart = effectiveEntryKey() === key
    if (deleteBtn) {
      deleteBtn.disabled = isStart
      deleteBtn.title = isStart ? 'The Start node cannot be deleted' : 'Delete (Delete)'
    }
    const pos = FlowBuilderClipboard.toolbarPosition(
      nodeEl.getBoundingClientRect(),
      wrap.getBoundingClientRect(),
      { width: toolbar.offsetWidth, height: toolbar.offsetHeight },
      { gap: 8 }
    )
    toolbar.style.left = pos.left + 'px'
    toolbar.style.top = pos.top + 'px'
  }

  function selectNodeByKey(key) {
    if (!key || !state.draft) return
    state.selectedKey = key
    renderPanel()
    const id = keyToId.get(key)
    if (id == null || !editor) {
      positionSelectionToolbar()
      return
    }
    document.querySelectorAll('.drawflow-node.selected').forEach((n) => n.classList.remove('selected'))
    const el = document.getElementById('node-' + id)
    if (el) el.classList.add('selected')
    positionSelectionToolbar()
  }

  function copySelectedNode() {
    if (!state.draft || !state.selectedKey) return
    syncPositionsFromEditor()
    nodeClipboard.copy(FlowBuilderClipboard.snapshotNodes(state.draft, [state.selectedKey]))
    setStatus('Copied ' + state.selectedKey, 'ok')
  }

  function duplicateSelectedNode() {
    if (!state.draft || !state.selectedKey) return
    syncPositionsFromEditor()
    const sourceKey = state.selectedKey
    const beforeKeys = new Set((state.draft.nodes || []).map((n) => n.key))
    applyCommand((draft) => FlowBuilderClipboard.duplicateNodes(draft, [sourceKey]))
    renderCanvas()
    const created = (state.draft.nodes || []).find((n) => !beforeKeys.has(n.key))
    if (created) selectNodeByKey(created.key)
    setStatus('Duplicated ' + sourceKey + (created ? ' → ' + created.key : ''), 'ok')
  }

  function pasteClipboard() {
    if (!state.draft) return
    if (nodeClipboard.isEmpty()) {
      setStatus('Clipboard is empty', 'err')
      return
    }
    syncPositionsFromEditor()
    const origin = lastCanvasPoint
    const beforeKeys = new Set((state.draft.nodes || []).map((n) => n.key))
    applyCommand((draft) => FlowBuilderClipboard.pasteNodes(
      draft,
      nodeClipboard.peek(),
      origin ? { origin: origin } : {}
    ))
    renderCanvas()
    const created = (state.draft.nodes || []).find((n) => !beforeKeys.has(n.key))
    if (created) selectNodeByKey(created.key)
    setStatus('Pasted ' + (created ? created.key : 'node'), 'ok')
  }

  function selectedKeysForDelete() {
    return state.selectedKey ? [state.selectedKey] : []
  }

  function inboundRemovedStatus(removed) {
    if (removed === 1) return ' — removed 1 inbound button'
    if (removed > 1) return ' — removed ' + removed + ' inbound buttons'
    return ''
  }

  function requestDeleteSelectedNode() {
    const keys = selectedKeysForDelete()
    if (!keys.length) return
    const entry = effectiveEntryKey()
    const deletable = keys.filter((key) => key !== entry)
    if (!deletable.length) {
      alert(FlowBuilderClipboard.entryDeleteMessage(entry || keys[0]))
      return
    }
    const confirmMsg = deletable.length === 1
      ? 'Delete node "' + deletable[0] + '"? Connections pointing to this node will be disconnected.'
      : 'Delete ' + deletable.length + ' nodes? Connections pointing to these nodes will be disconnected.'
    if (!window.confirm(confirmMsg)) return
    const removed = FlowBuilderCommands.inboundGoCount(state.draft, deletable)
    applyCommand((draft) => FlowBuilderCommands.deleteNodes(draft, deletable))
    if (state.selectedKey && deletable.indexOf(state.selectedKey) !== -1) {
      state.selectedKey = null
    }
    renderCanvas()
    renderPanel()
    positionSelectionToolbar()
    const msg = deletable.length === 1
      ? 'Deleted node: ' + deletable[0]
      : 'Deleted ' + deletable.length + ' nodes'
    setStatus(msg + inboundRemovedStatus(removed), 'ok')
  }

  function renderCanvas() {
    if (!editor || !state.draft) return
    const keepKey = state.selectedKey
    withHistoryLock(function () {
    editor.clear()
    keyToId.clear()
    idToKey.clear()
    goOutputFlatIndices.clear()

    const entryKey = effectiveEntryKey()
    for (const node of state.draft.nodes) {
      const inputs = 1
      const outputs = Math.max(countGoOutputs(node), node.kind === 'action' ? 0 : 0)
      let nodeClass = node.kind === 'screen' ? 'flow-node-screen' : 'flow-node-action'
      if (node.key === entryKey) nodeClass += ' is-entry'
      const id = editor.addNode(
        node.key,
        inputs,
        outputs,
        Number(node.pos_x) || 40,
        Number(node.pos_y) || 40,
        nodeClass,
        { key: node.key },
        nodeHtml(node)
      )
      keyToId.set(node.key, id)
      idToKey.set(id, node.key)
      idToKey.set(String(id), node.key)
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
            try {
              editor.addConnection(fromId, toId, 'output_' + outNum, 'input_1')
            } catch (e) {
              /* ignore duplicate */
            }
          }
        }
        outNum++
      }
    }

    if (keepKey && keyToId.has(keepKey)) {
      selectNodeByKey(keepKey)
    } else {
      positionSelectionToolbar()
    }

    renderEntryKeySelect()
    })
    refreshValidation()
  }

  function getNode(key) {
    return ((state.draft && state.draft.nodes) || []).find((n) => n.key === key)
  }

  function validationDraft() {
    if (!state.draft) return { nodes: [], entry_key: '' }
    const node = state.selectedKey ? getNode(state.selectedKey) : null
    if (!node || !document.getElementById('panelApply')) return state.draft
    const patch = readPanelPatch(node)
    if (!patch) return state.draft
    return FlowBuilderValidation.overlayNodePatch(state.draft, node.key, patch)
  }

  function applyNodeHighlights(result) {
    if (!state.draft) return
    for (const node of state.draft.nodes || []) {
      const id = keyToId.get(node.key)
      const el = id != null ? document.getElementById('node-' + id) : null
      if (!el) continue
      el.classList.remove('is-error', 'is-warning')
      const cls = FlowBuilderValidation.nodeHighlightClass(node.key, result)
      if (cls) el.classList.add(cls)
    }
  }

  function insertFieldError(el, message) {
    if (!el) return
    el.classList.add('is-invalid')
    const err = document.createElement('p')
    err.className = 'field-error'
    err.textContent = message
    el.insertAdjacentElement('afterend', err)
  }

  function applyPanelFieldErrors(result) {
    const panel = document.getElementById('flowPanel')
    if (!panel) return
    panel.querySelectorAll('.field-error').forEach((el) => el.remove())
    panel.querySelectorAll('.is-invalid').forEach((el) => el.classList.remove('is-invalid'))
    const key = state.selectedKey
    if (!key || !result) return
    for (const item of result.errors || []) {
      if (item.nodeKey !== key) continue
      if (item.field === 'body') insertFieldError(document.getElementById('panelBody'), item.message)
      else if (item.field === 'action') insertFieldError(document.getElementById('panelAction'), item.message)
      else if (item.field === 'media_url') insertFieldError(document.getElementById('panelMediaUrl'), item.message)
      else if (item.buttonIndex != null) {
        const row = panel.querySelector('.sp-btn-row[data-flat-index="' + item.buttonIndex + '"]')
        if (!row) continue
        row.classList.add('is-invalid')
        if (item.field === 'label') {
          const labelEl = row.querySelector('.btn-label')
          if (labelEl) labelEl.classList.add('is-invalid')
        } else if (item.field === 'url' || item.field === 'go') {
          const targetEl = row.querySelector('.btn-target')
          if (targetEl) targetEl.classList.add('is-invalid')
        } else if (item.field === 'mode') {
          const modeEl = row.querySelector('.btn-mode')
          if (modeEl) modeEl.classList.add('is-invalid')
        }
        const existing = row.querySelector('.field-error')
        if (existing) {
          existing.textContent = existing.textContent + '; ' + item.message
        } else {
          const err = document.createElement('p')
          err.className = 'field-error'
          err.textContent = item.message
          row.appendChild(err)
        }
      }
    }
  }

  function updateSaveButtons(result) {
    const blocked = FlowBuilderValidation.saveBlocked(result)
    const tip = FlowBuilderValidation.saveBlockTooltip(result)
    const draftBtn = document.getElementById('btnSaveDraft')
    const pubBtn = document.getElementById('btnPublish')
    const menuBtn = document.getElementById('btnSaveMenu')
    if (draftBtn) {
      draftBtn.disabled = blocked
      draftBtn.title = blocked ? tip : 'Save draft'
    }
    if (pubBtn) {
      pubBtn.disabled = blocked
      pubBtn.title = blocked ? tip : 'Publish'
    }
    if (menuBtn) menuBtn.title = blocked ? tip : 'Save'
  }

  function closeValidationList() {
    const list = document.getElementById('validationList')
    const toggle = document.getElementById('validationToggle')
    if (list) list.classList.add('hidden')
    if (toggle) toggle.setAttribute('aria-expanded', 'false')
  }

  function renderValidationList(result) {
    const list = document.getElementById('validationList')
    const errBadge = document.getElementById('validationErrorBadge')
    const warnBadge = document.getElementById('validationWarnBadge')
    const wrap = document.getElementById('flowValidation')
    const errors = (result && result.errors) || []
    const warnings = (result && result.warnings) || []
    if (errBadge) {
      errBadge.hidden = errors.length === 0
      errBadge.textContent = '⛔' + errors.length
    }
    if (warnBadge) {
      warnBadge.hidden = warnings.length === 0
      warnBadge.textContent = '⚠' + warnings.length
    }
    if (wrap) wrap.hidden = errors.length === 0 && warnings.length === 0
    if (!list) return
    list.innerHTML = ''
    const items = (result && result.issues) || []
    items.forEach((item) => {
      const li = document.createElement('li')
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'flow-validation-item is-' + item.level
      if (item.nodeKey) btn.setAttribute('data-node-key', item.nodeKey)
      btn.textContent = (item.level === 'error' ? '⛔ ' : '⚠ ') + item.message
      btn.addEventListener('click', function () {
        focusValidationIssue(item)
      })
      li.appendChild(btn)
      list.appendChild(li)
    })
  }

  function centerOnNode(key) {
    if (!editor || !key) return
    syncPositionsFromEditor()
    const node = getNode(key)
    const id = keyToId.get(key)
    const nodeEl = id != null ? document.getElementById('node-' + id) : null
    const container = document.getElementById('drawflow')
    if (!container || !node) return
    const pan = FlowBuilderValidation.canvasPanToCenter(
      { width: container.clientWidth, height: container.clientHeight },
      {
        x: Number(node.pos_x) || 0,
        y: Number(node.pos_y) || 0,
        width: nodeEl ? nodeEl.offsetWidth : 240,
        height: nodeEl ? nodeEl.offsetHeight : 120,
      },
      editor.zoom || 1
    )
    editor.canvas_x = pan.canvas_x
    editor.canvas_y = pan.canvas_y
    if (editor.precanvas) {
      editor.precanvas.style.transform = 'translate(' + pan.canvas_x + 'px, ' + pan.canvas_y + 'px) scale(' + (editor.zoom || 1) + ')'
    }
    positionSelectionToolbar()
  }

  function focusValidationIssue(item) {
    if (item && item.nodeKey) {
      selectNodeByKey(item.nodeKey)
      centerOnNode(item.nodeKey)
    }
    closeValidationList()
  }

  function refreshValidation() {
    if (typeof FlowBuilderValidation === 'undefined') return
    lastValidation = FlowBuilderValidation.collectDraftIssues(validationDraft(), {
      allowedActions: state.actions && state.actions.length ? state.actions : FlowBuilderValidation.DEFAULT_FLOW_ACTIONS,
    })
    applyNodeHighlights(lastValidation)
    renderValidationList(lastValidation)
    updateSaveButtons(lastValidation)
    applyPanelFieldErrors(lastValidation)
  }

  function renderTelegramMarkdown(text) {
    if (!text) return ''
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\*(.*?)\*/g, '<b>$1</b>')
      .replace(/_(.*?)_/g, '<i>$1</i>')
      .replace(/~(.*?)~/g, '<del>$1</del>')
      .replace(/`(.*?)`/g, '<code>$1</code>')
      .replace(/\[(.*?)\]\((.*?)\)/g, (match, label, url) => {
        const trimmed = String(url).trim()
        const isSafe = /^https?:\/\//i.test(trimmed) || /^tg:\/\//i.test(trimmed)
        const safeUrl = isSafe ? encodeURI(trimmed).replace(/"/g, '&quot;') : '#'
        return `<a href="${safeUrl}" target="_blank">${label}</a>`
      })
  }

  function applyFormatting(before, after) {
    const textarea = document.getElementById('panelBody')
    if (!textarea) return
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const sel = textarea.value.substring(start, end)
    const replacement = before + (sel || 'text') + (after || before)
    textarea.value = textarea.value.substring(0, start) + replacement + textarea.value.substring(end)
    textarea.focus()
    textarea.setSelectionRange(start + before.length, end + before.length)
    textarea.dispatchEvent(new Event('input'))
  }

  function insertVariable(varName) {
    const textarea = document.getElementById('panelBody')
    if (!textarea) return
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    textarea.value = textarea.value.substring(0, start) + varName + textarea.value.substring(end)
    textarea.focus()
    textarea.setSelectionRange(start + varName.length, start + varName.length)
    textarea.dispatchEvent(new Event('input'))
  }

  function renderPanel() {
    const panel = document.getElementById('flowPanel')
    if (!panel) return
    const key = state.selectedKey
    if (!key) {
      panel.innerHTML =
        '<div class="flow-panel-empty">' +
        '<strong>Inspector</strong>' +
        'Select a Message or Action block to edit type, key, copy, and buttons.' +
        '</div>'
      return
    }
    const node = getNode(key)
    if (!node) {
      panel.innerHTML = '<div class="flow-panel-empty">Node not found</div>'
      return
    }

    const kindClass = node.kind === 'action' ? 'action' : ''
    const kindLabel = node.kind === 'screen' ? 'Message' : 'Action'

    const isStart = effectiveEntryKey() === node.key

    let html = '<div class="flow-panel-head">'
    html += '<p class="flow-panel-kicker">Inspector</p>'
    html += '<div class="sp-kind ' + kindClass + '">' + kindLabel + '</div>'
    html += '<h2>' + escapeHtml(node.key) + '</h2>'
    html += '</div><div class="flow-panel-body">'
    html += '<div class="flow-panel-meta">'
    html += '<div class="field"><label>Type</label><input type="text" class="readonly" readonly value="' + escapeHtml(kindLabel) + '"></div>'
    html += '<div class="field"><label>Key</label><input type="text" class="readonly" readonly value="' + escapeHtml(node.key) + '"></div>'
    html += '</div>'

    if (node.kind === 'screen') {
      html += '<div class="field"><label>Media URL (Image / Banner)</label>'
      html += '<input type="url" id="panelMediaUrl" placeholder="https://example.com/image.jpg" value="' + escapeHtml(node.media_url || '') + '">'
      if (node.media_url) {
        html += '<div class="media-thumb-preview"><img src="' + escapeHtml(node.media_url) + '" alt="Media preview" onerror="this.style.display=\'none\'"></div>'
      }
      html += '</div>'

      html += '<div class="field"><label>Media type</label>'
      html += '<select id="panelMediaType">'
      ;['photo', 'document'].forEach((t) => {
        html += '<option value="' + t + '"' + ((node.media_type || 'photo') === t ? ' selected' : '') + '>' + t + '</option>'
      })
      html += '</select></div>'

      html += '<div class="field"><label>Message text</label>'
      html += '<div class="composer-toolbar">'
      html += '<button type="button" class="btn-fmt" data-fmt="bold" title="Bold (*text*)"><b>B</b></button>'
      html += '<button type="button" class="btn-fmt" data-fmt="italic" title="Italic (_text_)"><i>I</i></button>'
      html += '<button type="button" class="btn-fmt" data-fmt="strike" title="Strikethrough (~text~)"><s>S</s></button>'
      html += '<button type="button" class="btn-fmt" data-fmt="code" title="Code (`code`)"><code>&lt;/&gt;</code></button>'
      html += '<button type="button" class="btn-fmt" data-fmt="link" title="Link ([text](url))">🔗</button>'
      html += '<div class="var-picker-container">'
      html += '<button type="button" class="btn-var-toggle" id="btnVarToggle" title="Insert Variable">{ }</button>'
      html += '<div class="var-dropup hidden" id="varDropup">'
      html += '<div class="var-item" data-var="{{first_name}}">first_name</div>'
      html += '<div class="var-item" data-var="{{saldo}}">saldo</div>'
      html += '<div class="var-item" data-var="{{username}}">username</div>'
      html += '<div class="var-item" data-var="{{user_id}}">user_id</div>'
      html += '</div>'
      html += '</div>'
      html += '</div>'

      html += '<textarea id="panelBody" placeholder="Message shown in Telegram…">' + escapeHtml(node.body || '') + '</textarea>'
      html += '<div class="live-preview-box"><strong>Live Preview:</strong><div id="livePreviewContent">' + renderTelegramMarkdown(node.body) + '</div></div>'
      html += '</div>'
      html += '<p class="flow-panel-hint">Use {{first_name}}, {{nama_bot}}, {{saldo}}, etc. Publish writes this to BotCopy.</p>'
      html += '<div class="field"><label>Copy key</label><input type="text" class="readonly" readonly value="' + escapeHtml(node.screen_key || '') + '"></div>'
    } else {
      html += '<div class="field"><label>Action</label><select id="panelAction">'
      ;(state.actions || []).forEach((a) => {
        html += '<option value="' + escapeHtml(a) + '"' + (node.action === a ? ' selected' : '') + '>' + escapeHtml(a) + '</option>'
      })
      html += '</select></div>'
      html += '<p class="flow-panel-hint">Action nodes open live catalog tools in the bot.</p>'
    }

    html += '<div class="field"><label>Description</label><input type="text" id="panelDescription" value="' + escapeHtml(node.description || '') + '"></div>'

    html += '<div class="field"><label>Buttons</label>'
    html += '<div class="sp-btn-list" id="panelButtonsBody">'

    const flat = flattenButtons(node.buttons)
    flat.forEach((btn, idx) => {
      const mode = buttonMode(btn)
      const target = btn.go || btn.callback || btn.url_from || btn.url || ''
      html += '<div class="sp-btn-row" data-flat-index="' + idx + '">'
      html += '<div class="sp-btn-grid">'
      html += '<input type="text" class="btn-label" placeholder="Label" value="' + escapeHtml(btn.label || btn.label_key || '') + '">'
      html += '<select class="btn-mode">'
      ;['go', 'callback', 'url_from', 'url'].forEach((m) => {
        html += '<option value="' + m + '"' + (mode === m ? ' selected' : '') + '>' + m + '</option>'
      })
      html += '</select>'
      html += '<input type="text" class="btn-target sp-btn-target" placeholder="Target (node key / callback / url)" value="' + escapeHtml(target) + '">'
      html += '<div class="btn-row-actions">'
      if (idx > 0) html += '<button type="button" class="btn-row-move" data-move="up" data-idx="' + idx + '" title="Move Up">↑</button>'
      if (idx < flat.length - 1) html += '<button type="button" class="btn-row-move" data-move="down" data-idx="' + idx + '" title="Move Down">↓</button>'
      html += '<button type="button" class="btn-row-delete" data-delete="' + idx + '" title="Delete Button">×</button>'
      html += '</div>'
      html += '</div></div>'
    })

    html += '</div>'
    html += '<button type="button" id="btnAddButton" class="btn btn-secondary btn-sm" style="margin-top:8px;">+ Add Button</button>'
    html += '<p class="flow-panel-hint">For <code>go</code> buttons: set the target node key here, or drag a wire from the card’s output ports. Then click Apply.</p>'
    html += '</div>'

    html += '<div class="flow-panel-footer">'
    if (isStart) {
      html += '<button type="button" id="panelDeleteNode" class="btn-delete-node" disabled title="The Start node cannot be deleted">Delete Node</button>'
    } else {
      html += '<button type="button" id="panelDeleteNode" class="btn-delete-node" title="Remove this node from the draft">Delete Node</button>'
    }
    html += '<button type="button" id="panelApply" class="btn-apply">Apply</button>'
    html += '</div>'
    if (isStart) {
      html += '<p class="flow-panel-hint flow-panel-start-hint">The Start node cannot be deleted. Change the entry node first.</p>'
    }

    panel.innerHTML = html

    // Attach composer events
    const bodyArea = document.getElementById('panelBody')
    if (bodyArea) {
      bodyArea.addEventListener('input', function () {
        const liveEl = document.getElementById('livePreviewContent')
        if (liveEl) liveEl.innerHTML = renderTelegramMarkdown(bodyArea.value)
      })
    }

    panel.querySelectorAll('.btn-fmt').forEach((btn) => {
      btn.addEventListener('click', function () {
        const fmt = btn.getAttribute('data-fmt')
        if (fmt === 'bold') applyFormatting('*', '*')
        else if (fmt === 'italic') applyFormatting('_', '_')
        else if (fmt === 'strike') applyFormatting('~', '~')
        else if (fmt === 'code') applyFormatting('`', '`')
        else if (fmt === 'link') applyFormatting('[', '](https://)')
      })
    })

    const varToggle = document.getElementById('btnVarToggle')
    const varDropup = document.getElementById('varDropup')
    if (varToggle && varDropup) {
      varToggle.addEventListener('click', function (e) {
        e.stopPropagation()
        varDropup.classList.toggle('hidden')
      })
      panel.querySelectorAll('.var-item').forEach((item) => {
        item.addEventListener('click', function () {
          const varName = item.getAttribute('data-var')
          insertVariable(varName)
          varDropup.classList.add('hidden')
        })
      })
    }

    const btnAdd = document.getElementById('btnAddButton')
    if (btnAdd) {
      btnAdd.addEventListener('click', function () {
        const nodeKey = state.selectedKey
        applyCommand((draft) => {
          const n = (draft.nodes || []).find((item) => item.key === nodeKey)
          if (!n) return draft
          if (!n.buttons) n.buttons = []
          const newIdx = flattenButtons(n.buttons).length
          n.buttons.push([{ label: 'Button ' + (newIdx + 1), go: '' }])
          return draft
        })
        renderPanel()
      })
    }

    panel.querySelectorAll('.btn-row-delete').forEach((btn) => {
      btn.addEventListener('click', function () {
        const idx = Number(btn.getAttribute('data-delete'))
        const nodeKey = state.selectedKey
        applyCommand((draft) => {
          const n = (draft.nodes || []).find((item) => item.key === nodeKey)
          if (!n) return draft
          let cur = 0
          const result = []
          for (const row of n.buttons || []) {
            const newRow = []
            for (const b of row) {
              if (cur !== idx) newRow.push(b)
              cur++
            }
            if (newRow.length > 0) result.push(newRow)
          }
          n.buttons = result
          return draft
        })
        renderPanel()
      })
    })

    panel.querySelectorAll('.btn-row-move').forEach((btn) => {
      btn.addEventListener('click', function () {
        const idx = Number(btn.getAttribute('data-idx'))
        const dir = btn.getAttribute('data-move')
        const nodeKey = state.selectedKey
        applyCommand((draft) => {
          const n = (draft.nodes || []).find((item) => item.key === nodeKey)
          if (!n) return draft
          const flatBtns = flattenButtons(n.buttons)
          const targetIdx = dir === 'up' ? idx - 1 : idx + 1
          if (targetIdx < 0 || targetIdx >= flatBtns.length) return draft
          const temp = flatBtns[idx]
          flatBtns[idx] = flatBtns[targetIdx]
          flatBtns[targetIdx] = temp
          let cur = 0
          const result = []
          for (const row of n.buttons || []) {
            const newRow = []
            for (let c = 0; c < row.length; c++) {
              if (cur < flatBtns.length) {
                newRow.push(flatBtns[cur])
                cur++
              }
            }
            if (newRow.length > 0) result.push(newRow)
          }
          n.buttons = result
          return draft
        })
        renderPanel()
      })
    })

    document.getElementById('panelApply').addEventListener('click', applyPanelToDraft)

    const btnDeleteNode = document.getElementById('panelDeleteNode')
    if (btnDeleteNode) {
      btnDeleteNode.addEventListener('click', requestDeleteSelectedNode)
    }
    refreshValidation()
  }

  function readPanelPatch(node) {
    if (!node) return null
    const patch = {}
    const descEl = document.getElementById('panelDescription')
    if (descEl) patch.description = descEl.value

    if (node.kind === 'screen') {
      const mediaEl = document.getElementById('panelMediaUrl')
      if (mediaEl) patch.media_url = mediaEl.value.trim() || null
      const mediaTypeEl = document.getElementById('panelMediaType')
      if (mediaTypeEl) patch.media_type = mediaTypeEl.value || 'photo'
      const bodyEl = document.getElementById('panelBody')
      if (bodyEl) patch.body = bodyEl.value
    } else {
      const actionEl = document.getElementById('panelAction')
      if (actionEl && node.kind === 'action') patch.action = actionEl.value
    }

    const list = document.getElementById('panelButtonsBody')
    if (list) {
      const rows = list.querySelectorAll('.sp-btn-row')
      const flat = flattenButtons(node.buttons)
      rows.forEach((row) => {
        const idx = Number(row.getAttribute('data-flat-index'))
        const label = row.querySelector('.btn-label').value.trim()
        const mode = row.querySelector('.btn-mode').value
        const target = row.querySelector('.btn-target').value.trim()
        const prev = flat[idx] || {}
        const btn = {}
        if (label) {
          if (prev.label_key && label === prev.label_key) btn.label_key = label
          else if (prev.label_key && !prev.label && (label.startsWith('msg.') || label.startsWith('btn.'))) btn.label_key = label
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
      patch.buttons = rebuilt
    }
    return patch
  }

  function applyPanelToDraft() {
    const key = state.selectedKey
    const node = getNode(key)
    if (!node) return
    const patch = readPanelPatch(node)
    if (!patch) return

    applyCommand((draft) => FlowBuilderCommands.patchNode(draft, key, patch))

    const applied = getNode(key)
    if (!applied) return
    const outputs = countGoOutputs(applied)
    const prevOutputs = (goOutputFlatIndices.get(key) || []).length
    if (outputs !== prevOutputs) {
      renderCanvas()
    } else {
      const id = keyToId.get(key)
      if (id != null) {
        editor.updateNodeDataFromId(id, { key: applied.key })
        refreshNodeDom(id, applied)
        editor.updateConnectionNodes('node-' + id)
      } else {
        renderCanvas()
      }
    }

    selectNodeByKey(key)
    setStatus('Applied to canvas — click Save draft to persist', 'ok')
  }

  function bindEditorEvents() {
    editor.on('nodeSelected', function (id) {
      const resolved = resolveNodeId(id)
      const key = resolved != null ? idToKey.get(resolved) : null
      if (key) selectNodeByKey(key)
    })

    editor.on('nodeUnselected', function () {
      /* keep last selection so panel stays useful while dragging wires */
    })

    editor.on('nodeMoved', function (id) {
      if (isHistoryLocked()) return
      const resolved = resolveNodeId(id)
      const key = resolved != null ? idToKey.get(resolved) : null
      const info = editor.getNodeFromId(resolved)
      if (key && info) {
        applyCommand((draft) => FlowBuilderCommands.moveNode(draft, key, info.pos_x, info.pos_y))
      }
      positionSelectionToolbar()
    })

    editor.on('connectionCreated', function (info) {
      if (isHistoryLocked()) return
      const fromKey = idToKey.get(resolveNodeId(info.output_id)) || idToKey.get(info.output_id)
      const toKey = idToKey.get(resolveNodeId(info.input_id)) || idToKey.get(info.input_id)
      if (!fromKey || !toKey) return
      const outNum = parseInt(String(info.output_class).replace('output_', ''), 10)
      const flatList = goOutputFlatIndices.get(fromKey) || []
      const flatIdx = flatList[outNum - 1]
      if (flatIdx === undefined) return
      applyCommand((draft) => FlowBuilderCommands.applyWire(draft, fromKey, flatIdx, toKey))
      if (state.selectedKey === fromKey) renderPanel()
      setStatus('Connected ' + fromKey + ' → ' + toKey, 'ok')
    })

    editor.on('connectionRemoved', function (info) {
      if (isHistoryLocked()) return
      const fromKey = idToKey.get(resolveNodeId(info.output_id)) || idToKey.get(info.output_id)
      if (!fromKey) return
      const outNum = parseInt(String(info.output_class).replace('output_', ''), 10)
      const flatList = goOutputFlatIndices.get(fromKey) || []
      const flatIdx = flatList[outNum - 1]
      if (flatIdx === undefined) return
      applyCommand((draft) => FlowBuilderCommands.clearWire(draft, fromKey, flatIdx))
      if (state.selectedKey === fromKey) renderPanel()
      setStatus('Wire removed from ' + fromKey, 'ok')
    })

    // Fallback: clicking card content always opens the inspector
    const container = document.getElementById('drawflow')
    container.addEventListener('click', function (ev) {
      const card = ev.target.closest('.sp-card, .drawflow-node')
      if (!card) return
      const nodeEl = card.classList.contains('drawflow-node') ? card : card.closest('.drawflow-node')
      if (!nodeEl || !nodeEl.id) return
      const id = resolveNodeId(nodeEl.id.replace(/^node-/, ''))
      const key = id != null ? idToKey.get(id) : null
      if (key) selectNodeByKey(key)
    })
    container.addEventListener('mousemove', function (ev) {
      const geo = getCanvasGeometry()
      if (!geo) return
      lastCanvasPoint = FlowBuilderPalette.canvasPositionFromClient(
        ev.clientX,
        ev.clientY,
        geo.precanvasRect,
        geo.zoom
      )
    })
    let toolbarWheelRaf = 0
    container.addEventListener('wheel', function () {
      if (toolbarWheelRaf) return
      toolbarWheelRaf = requestAnimationFrame(function () {
        toolbarWheelRaf = 0
        positionSelectionToolbar()
      })
    })
  }

  function syncPanelIntoDraft() {
    if (!state.selectedKey || !getNode(state.selectedKey)) return
    if (!document.getElementById('panelApply')) return
    applyPanelToDraft()
  }

  async function saveDraft() {
    syncPositionsFromEditor()
    syncPanelIntoDraft()
    refreshValidation()
    if (FlowBuilderValidation.saveBlocked(lastValidation)) {
      setStatus(FlowBuilderValidation.saveBlockTooltip(lastValidation) || 'Fix validation errors before saving', 'err')
      return
    }
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
    syncPanelIntoDraft()
    refreshValidation()
    if (FlowBuilderValidation.saveBlocked(lastValidation)) {
      setStatus(FlowBuilderValidation.saveBlockTooltip(lastValidation) || 'Fix validation errors before publishing', 'err')
      return
    }
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
    setStatusFromBump(data, 'Published — bot reloads in ~10s')
  }

  function buttonLabel(btn) {
    return btn.text || btn.label || btn.label_key || 'Button'
  }

  function formatCaptionHtml(caption) {
    if (!caption) return ''
    let s = escapeHtml(caption)
    s = s.replace(/\*([^*\n]+)\*/g, '<strong>$1</strong>')
    s = s.replace(/_([^_\n]+)_/g, '<em>$1</em>')
    s = s.replace(/~([^~\n]+)~/g, '<s>$1</s>')
    s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>')
    s = s.replace(/\[(.*?)\]\((.*?)\)/g, function (_m, label, url) {
      const trimmed = String(url).trim()
      const ok = /^https?:\/\//i.test(trimmed) || /^tg:\/\//i.test(trimmed)
      const href = ok ? encodeURI(trimmed).replace(/"/g, '&quot;') : '#'
      return '<a href="' + href + '" target="_blank" rel="noopener">' + label + '</a>'
    })
    return s
  }

  function bindPreviewButton(el, btn) {
    el.addEventListener('click', function () {
      if (btn.go) {
        previewStep({ nodeKey: btn.go })
        return
      }
      if (btn.preview) {
        if (btn.preview.type === 'stub') {
          previewStep({ preview: btn.preview })
          return
        }
        if (btn.preview.type === 'go' && btn.preview.key) {
          previewStep({ nodeKey: btn.preview.key })
          return
        }
        if (btn.preview.type === 'action' && btn.preview.action) {
          const key = btn.preview.action === 'product_list' ? 'product_list' : btn.preview.action
          previewStep({ nodeKey: key })
          return
        }
        previewStep({ preview: btn.preview })
        return
      }
      if (btn.stub || btn.kind === 'link' || btn.url || btn.url_from) {
        const cap = document.getElementById('previewCaption')
        if (cap) {
          cap.innerHTML = formatCaptionHtml(
            (btn.kind === 'link' || btn.url || btn.url_from)
              ? (buttonLabel(btn) + '\n\n(Link opens in Telegram only)')
              : (buttonLabel(btn) + '\n\nThis step runs in the live bot only.')
          )
        }
        return
      }
      if (btn.callback) {
        previewStep({ preview: { type: 'stub', title: 'Callback: ' + btn.callback } })
      }
    })
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
        let label = buttonLabel(btn)
        if (btn.kind === 'link' || btn.url || btn.url_from) {
          label += ' ↗'
          b.classList.add('stub')
        } else if (btn.stub) {
          b.classList.add('stub')
        }
        b.textContent = label
        bindPreviewButton(b, btn)
        rowEl.appendChild(b)
      }
      kb.appendChild(rowEl)
    }
  }

  async function previewStep(payload) {
    const body = Object.assign({ draft: state.draft }, payload || {})
    const res = await fetch('/api/bot-flow/preview-step', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    if (!data.success) {
      setStatus(data.error || 'Preview failed', 'err')
      return
    }
    const title = document.getElementById('previewTitle')
    if (title) title.textContent = data.key || data.action || 'Preview'
    const cap = document.getElementById('previewCaption')
    if (cap) cap.innerHTML = formatCaptionHtml(data.caption || '')
    const mediaEl = document.getElementById('previewMedia')
    if (mediaEl) {
      if (data.media_url) {
        mediaEl.classList.remove('hidden')
        mediaEl.innerHTML = '<img src="' + escapeHtml(data.media_url) + '" alt="" onerror="this.parentElement.classList.add(\'hidden\')">'
      } else {
        mediaEl.classList.add('hidden')
        mediaEl.innerHTML = ''
      }
    }
    buildPreviewKeyboard(data.buttons || [])
  }

  function previewGoto(nodeKey) {
    return previewStep({ nodeKey: nodeKey })
  }

  function openPreview() {
    syncPositionsFromEditor()
    const modal = document.getElementById('previewModal')
    if (modal) modal.classList.remove('hidden')
    previewGoto(effectiveEntryKey() || 'welcome')
  }

  function closePreview() {
    const modal = document.getElementById('previewModal')
    if (modal) modal.classList.add('hidden')
  }

  function setStatusFromBump(data, okMessage) {
    if (data && data.reloadPending) {
      setStatus(data.warning || 'Saved, but the bot may not reload until the next publish or a restart.', 'warn')
      return
    }
    setStatus(okMessage, 'ok')
  }

  function isFlowEngineForced() {
    return state.envOverride === 'forced on' || state.envOverride === 'forced off'
  }

  function applyFlowEnabledUi() {
    const el = document.getElementById('flowEnabled')
    const note = document.getElementById('flowEnabledOverride')
    if (!el) return
    el.checked = !!state.enabled
    const forced = isFlowEngineForced()
    el.disabled = forced
    if (el.parentElement) el.parentElement.classList.toggle('is-forced', forced)
    if (note) {
      if (forced) {
        note.textContent = state.envOverride === 'forced on' ? 'Forced on by env' : 'Forced off by env'
        note.classList.remove('hidden')
      } else {
        note.textContent = ''
        note.classList.add('hidden')
      }
    }
  }

  async function toggleEnabled(checked) {
    if (isFlowEngineForced()) {
      applyFlowEnabledUi()
      setStatus('Flow engine is ' + state.envOverride + ' — the dashboard toggle cannot change it', 'warn')
      return
    }
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
      applyFlowEnabledUi()
      return
    }
    state.enabled = checked
    applyFlowEnabledUi()
    setStatusFromBump(data, 'Flow engine ' + (checked ? 'enabled' : 'disabled') + ' — bot reloads in ~10s')
  }

  function generateUniqueNodeKey(prefix = 'screen') {
    const existing = (state.draft.nodes || []).map((n) => n.key)
    const basePrefix = prefix === 'screen' ? 'screen.custom_' : 'action.custom_'
    let idx = 1
    while (existing.includes(basePrefix + idx)) {
      idx++
    }
    return basePrefix + idx
  }

  function getCanvasGeometry() {
    if (!editor || !editor.precanvas) return null
    const container = document.getElementById('drawflow')
    if (!container) return null
    return {
      containerRect: container.getBoundingClientRect(),
      precanvasRect: editor.precanvas.getBoundingClientRect(),
      zoom: editor.zoom || 1,
    }
  }

  function placementFromViewportCenter() {
    const geo = getCanvasGeometry()
    if (!geo) return { x: 150, y: 150 }
    return FlowBuilderPalette.viewportCenterPosition(geo.containerRect, geo.precanvasRect, geo.zoom)
  }

  function addPaletteNode(kind, pos) {
    if (!state.draft) return
    const x = pos && pos.x != null ? pos.x : pos && pos.pos_x
    const y = pos && pos.y != null ? pos.y : pos && pos.pos_y
    if (kind === 'action') {
      const key = generateUniqueNodeKey('action')
      const newNode = {
        key,
        kind: 'action',
        screen_key: null,
        action: 'product_list',
        pos_x: x,
        pos_y: y,
        buttons: [],
        description: 'Open product catalog',
      }
      applyCommand((draft) => FlowBuilderCommands.addNode(draft, newNode))
      renderCanvas()
      selectNodeByKey(key)
      setStatus('Added Action node: ' + key, 'ok')
      return
    }
    const key = generateUniqueNodeKey('screen')
    const newNode = {
      key,
      kind: 'screen',
      screen_key: key,
      body: 'Halo *{{first_name}}*!',
      pos_x: x,
      pos_y: y,
      media_url: null,
      media_type: 'photo',
      buttons: FlowBuilderCommands.defaultMessageButtons(effectiveEntryKey()),
      description: '',
    }
    applyCommand((draft) => FlowBuilderCommands.addNode(draft, newNode))
    renderCanvas()
    selectNodeByKey(key)
    setStatus('Added Message node: ' + key, 'ok')
  }

  const PALETTE_DRAG_THRESHOLD = 8
  let palettePointer = null
  let paletteGhost = null
  let skipPaletteClick = false
  let html5DropJustPlaced = false
  let ignoreCompatibilityMouse = false

  function addMessageNode() {
    if (skipPaletteClick) return
    addPaletteNode('message', placementFromViewportCenter())
  }

  function addActionNode() {
    if (skipPaletteClick) return
    addPaletteNode('action', placementFromViewportCenter())
  }

  function dropNodeAtClient(kind, clientX, clientY) {
    const geo = getCanvasGeometry()
    if (!geo) {
      addPaletteNode(kind, placementFromViewportCenter())
      return
    }
    const pos = FlowBuilderPalette.canvasPositionFromClient(clientX, clientY, geo.precanvasRect, geo.zoom)
    addPaletteNode(kind, pos)
  }

  function pointOverCanvas(clientX, clientY) {
    const canvas = document.getElementById('drawflow')
    if (!canvas) return false
    const el = document.elementFromPoint(clientX, clientY)
    return !!(el && (el === canvas || canvas.contains(el)))
  }

  function setCanvasDragOver(on) {
    const canvas = document.getElementById('drawflow')
    if (!canvas) return
    canvas.classList.toggle('is-drop-target', on)
    canvas.classList.toggle('is-drag-over', on)
  }

  function hidePaletteGhost() {
    if (paletteGhost && paletteGhost.parentNode) paletteGhost.parentNode.removeChild(paletteGhost)
    paletteGhost = null
  }

  function showPaletteGhost(item, clientX, clientY) {
    if (!paletteGhost) {
      paletteGhost = item.cloneNode(true)
      paletteGhost.removeAttribute('id')
      paletteGhost.classList.add('flow-palette-ghost')
      paletteGhost.setAttribute('aria-hidden', 'true')
      document.body.appendChild(paletteGhost)
    }
    paletteGhost.style.left = Math.round(clientX - 36) + 'px'
    paletteGhost.style.top = Math.round(clientY - 28) + 'px'
  }

  function endPalettePointer(place, clientX, clientY) {
    const session = palettePointer
    palettePointer = null
    FlowBuilderPalette.setActivePaletteKind(null)
    hidePaletteGhost()
    setCanvasDragOver(false)
    document.querySelectorAll('.flow-palette-item.is-dragging').forEach((el) => {
      el.classList.remove('is-dragging')
    })
    if (!session || !session.active) return
    skipPaletteClick = true
    setTimeout(function () { skipPaletteClick = false }, 0)
    if (!place || html5DropJustPlaced) return
    if (!pointOverCanvas(clientX, clientY)) return
    dropNodeAtClient(session.kind, clientX, clientY)
  }

  function startPalettePointer(item, kind, clientX, clientY, pointerId) {
    if (palettePointer) return
    if (kind !== 'message' && kind !== 'action') return
    html5DropJustPlaced = false
    palettePointer = {
      item: item,
      kind: kind,
      pointerId: pointerId,
      startX: clientX,
      startY: clientY,
      active: false,
    }
  }

  function movePalettePointer(clientX, clientY) {
    if (!palettePointer) return
    const dx = clientX - palettePointer.startX
    const dy = clientY - palettePointer.startY
    if (!palettePointer.active) {
      if ((dx * dx + dy * dy) < PALETTE_DRAG_THRESHOLD * PALETTE_DRAG_THRESHOLD) return
      palettePointer.active = true
      if (palettePointer.item) palettePointer.item.classList.add('is-dragging')
      FlowBuilderPalette.setActivePaletteKind(palettePointer.kind)
    }
    showPaletteGhost(palettePointer.item, clientX, clientY)
    setCanvasDragOver(pointOverCanvas(clientX, clientY))
  }

  function bindPaletteDrag() {
    document.querySelectorAll('.flow-palette-item').forEach((item) => {
      item.addEventListener('mousedown', function (ev) {
        if (ignoreCompatibilityMouse) return
        if (ev.button !== 0) return
        startPalettePointer(item, item.getAttribute('data-kind'), ev.clientX, ev.clientY, 'mouse')
      })
      item.addEventListener('pointerdown', function (ev) {
        if (ev.pointerType === 'mouse') {
          ignoreCompatibilityMouse = false
          return
        }
        if (ev.button != null && ev.button !== 0) return
        ignoreCompatibilityMouse = true
        startPalettePointer(item, item.getAttribute('data-kind'), ev.clientX, ev.clientY, ev.pointerId)
        try { item.setPointerCapture(ev.pointerId) } catch (err) { /* ignore */ }
      })
      item.addEventListener('dragstart', function (ev) {
        const kind = item.getAttribute('data-kind')
        FlowBuilderPalette.setPaletteDragData(ev.dataTransfer, kind)
        // Keep the mouse/pointer gesture; native HTML5 drag swallows mouseup
        // in automation and some browsers, so we cancel it and place on mouseup.
        ev.preventDefault()
      })
    })

    document.addEventListener('mousemove', function (ev) {
      if (!palettePointer || palettePointer.pointerId !== 'mouse') return
      if (palettePointer.active) ev.preventDefault()
      movePalettePointer(ev.clientX, ev.clientY)
    })
    document.addEventListener('mouseup', function (ev) {
      if (!palettePointer || palettePointer.pointerId !== 'mouse') return
      endPalettePointer(true, ev.clientX, ev.clientY)
    })
    document.addEventListener('pointermove', function (ev) {
      if (!palettePointer || palettePointer.pointerId === 'mouse') return
      if (palettePointer.pointerId !== ev.pointerId) return
      ev.preventDefault()
      movePalettePointer(ev.clientX, ev.clientY)
    })
    document.addEventListener('pointerup', function (ev) {
      if (!palettePointer || palettePointer.pointerId === 'mouse') return
      if (palettePointer.pointerId !== ev.pointerId) return
      endPalettePointer(true, ev.clientX, ev.clientY)
    })
    document.addEventListener('pointercancel', function (ev) {
      if (!palettePointer || palettePointer.pointerId === 'mouse') return
      if (palettePointer.pointerId !== ev.pointerId) return
      endPalettePointer(false, ev.clientX, ev.clientY)
    })

    const canvas = document.getElementById('drawflow')
    if (!canvas) return

    canvas.addEventListener('dragover', function (ev) {
      const fromPalette = FlowBuilderPalette.allowsPaletteDrop(ev.dataTransfer) ||
        !!FlowBuilderPalette.getActivePaletteKind()
      if (!fromPalette) return
      ev.preventDefault()
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy'
      canvas.classList.add('is-drag-over')
    })

    canvas.addEventListener('dragleave', function (ev) {
      if (!canvas.contains(ev.relatedTarget)) canvas.classList.remove('is-drag-over')
    })

    canvas.addEventListener('drop', function (ev) {
      ev.preventDefault()
      canvas.classList.remove('is-drag-over', 'is-drop-target')
      const resolved = FlowBuilderPalette.resolvePaletteDrop(ev, getCanvasGeometry())
      FlowBuilderPalette.setActivePaletteKind(null)
      hidePaletteGhost()
      if (!resolved) return
      html5DropJustPlaced = true
      skipPaletteClick = true
      setTimeout(function () {
        skipPaletteClick = false
        html5DropJustPlaced = false
      }, 0)
      addPaletteNode(resolved.kind, { x: resolved.pos_x, y: resolved.pos_y })
    })
  }

  let globalStringsCache = {}
  let globalStringsOriginal = {}

  async function openGlobalStringsDrawer() {
    const modal = document.getElementById('globalStringsModal')
    if (modal) modal.classList.remove('hidden')
    setStatus('Loading global strings…')
    try {
      const res = await fetch('/api/bot-copy')
      const data = await res.json()
      if (data.success && data.copy) {
        globalStringsCache = {}
        for (const [k, v] of Object.entries(data.copy)) {
          if (!k.startsWith('screen.')) globalStringsCache[k] = v
        }
        globalStringsOriginal = clone(globalStringsCache)
        renderGlobalStringsList()
        setStatus('Global strings loaded', 'ok')
      } else {
        setStatus(data.error || 'Failed to load copy', 'err')
      }
    } catch (err) {
      setStatus('Failed to fetch global copy', 'err')
    }
  }

  function closeGlobalStringsDrawer() {
    const modal = document.getElementById('globalStringsModal')
    if (modal) modal.classList.add('hidden')
  }

  function renderGlobalStringsList() {
    const container = document.getElementById('globalStringsList')
    const searchVal = (document.getElementById('globalStringsSearch').value || '').toLowerCase().trim()
    if (!container) return

    let html = '<table class="global-strings-table"><thead><tr><th>Key</th><th>String Body</th></tr></thead><tbody>'
    let count = 0
    for (const [k, v] of Object.entries(globalStringsCache)) {
      if (searchVal && !k.toLowerCase().includes(searchVal) && !String(v).toLowerCase().includes(searchVal)) continue
      html += '<tr>'
      html += '<td><code>' + escapeHtml(k) + '</code></td>'
      html += '<td><textarea class="global-string-input" data-key="' + escapeHtml(k) + '">' + escapeHtml(v) + '</textarea></td>'
      html += '</tr>'
      count++
    }
    html += '</tbody></table>'
    if (count === 0) html = '<p class="muted">No matching global strings found.</p>'
    container.innerHTML = html
    container.querySelectorAll('.global-string-input').forEach((inp) => {
      inp.addEventListener('input', function () {
        const key = inp.getAttribute('data-key')
        if (key) globalStringsCache[key] = inp.value
      })
    })
  }

  function collectVisibleGlobalStringEdits() {
    document.querySelectorAll('.global-string-input').forEach((inp) => {
      const key = inp.getAttribute('data-key')
      if (key) globalStringsCache[key] = inp.value
    })
  }

  async function saveGlobalStrings() {
    collectVisibleGlobalStringEdits()
    const updates = FlowBuilderCommands.diffStringMap(globalStringsOriginal, globalStringsCache)
    if (!Object.keys(updates).length) {
      setStatus('No changes to save', 'ok')
      return
    }
    if (!window.confirm('These Global Strings go live to all buyers within ~10 seconds. There is no Publish step. Save the changed strings now?')) {
      return
    }
    setStatus('Saving global strings…')
    try {
      const res = await fetch('/api/bot-copy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ copy: updates }),
      })
      const data = await res.json()
      if (data.success) {
        Object.assign(globalStringsOriginal, updates)
        closeGlobalStringsDrawer()
        setStatusFromBump(data, 'Global strings saved successfully!')
      } else {
        setStatus(data.error || 'Failed to save global strings', 'err')
      }
    } catch (err) {
      setStatus('Save failed', 'err')
    }
  }

  function renderEntryKeySelect() {
    const sel = document.getElementById('entryKeySelect')
    if (!sel || !state.draft) return
    sel.innerHTML = ''
    const nodes = state.draft.nodes || []
    const effective = effectiveEntryKey()
    for (const n of nodes) {
      const opt = document.createElement('option')
      opt.value = n.key
      opt.textContent = n.key
      if (n.key === effective) opt.selected = true
      sel.appendChild(opt)
    }
  }

  function bindEntryKeySelect() {
    const sel = document.getElementById('entryKeySelect')
    if (!sel) return
    sel.addEventListener('change', function () {
      if (!state.draft) return
      applyCommand((draft) => {
        draft.entry_key = sel.value
        return draft
      })
      renderCanvas()
      setStatus('Entry node set to ' + sel.value, 'ok')
    })
  }

  function closeAllMenus() {
    document.querySelectorAll('.flow-dropdown-menu').forEach((el) => el.classList.add('hidden'))
    document.querySelectorAll('.flow-dropdown > button[aria-expanded]').forEach((el) => {
      el.setAttribute('aria-expanded', 'false')
    })
    closeValidationList()
  }

  function bindDropdown(toggleId, menuId) {
    const toggle = document.getElementById(toggleId)
    const menu = document.getElementById(menuId)
    if (!toggle || !menu) return
    toggle.addEventListener('click', function (ev) {
      ev.stopPropagation()
      const willOpen = menu.classList.contains('hidden')
      closeAllMenus()
      if (willOpen) {
        menu.classList.remove('hidden')
        toggle.setAttribute('aria-expanded', 'true')
      }
    })
    menu.addEventListener('click', function (ev) {
      ev.stopPropagation()
    })
  }

  function bindToolbar() {
    bindDropdown('btnSaveMenu', 'flowSaveMenu')
    bindDropdown('btnOverflowMenu', 'flowOverflowMenu')
    document.addEventListener('click', closeAllMenus)
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') closeAllMenus()
    })

    document.getElementById('btnSaveDraft').addEventListener('click', function () {
      closeAllMenus()
      saveDraft()
    })
    document.getElementById('btnPublish').addEventListener('click', function () {
      closeAllMenus()
      publishDraft()
    })
    const validationToggle = document.getElementById('validationToggle')
    if (validationToggle) {
      validationToggle.addEventListener('click', function (ev) {
        ev.stopPropagation()
        const list = document.getElementById('validationList')
        if (!list) return
        const willOpen = list.classList.contains('hidden')
        closeAllMenus()
        if (willOpen) {
          list.classList.remove('hidden')
          validationToggle.setAttribute('aria-expanded', 'true')
        } else {
          closeValidationList()
        }
      })
    }
    document.addEventListener('click', closeValidationList)
    const flowPanel = document.getElementById('flowPanel')
    if (flowPanel) {
      flowPanel.addEventListener('input', refreshValidation)
      flowPanel.addEventListener('change', refreshValidation)
    }
    document.getElementById('btnPreview').addEventListener('click', openPreview)
    document.getElementById('previewClose').addEventListener('click', closePreview)
    document.getElementById('previewBackdrop').addEventListener('click', closePreview)

    const btnGlobal = document.getElementById('btnGlobalStrings')
    if (btnGlobal) {
      btnGlobal.addEventListener('click', function () {
        closeAllMenus()
        openGlobalStringsDrawer()
      })
    }
    const btnGlobalClose = document.getElementById('globalStringsClose')
    if (btnGlobalClose) btnGlobalClose.addEventListener('click', closeGlobalStringsDrawer)
    const btnGlobalBackdrop = document.getElementById('globalStringsBackdrop')
    if (btnGlobalBackdrop) btnGlobalBackdrop.addEventListener('click', closeGlobalStringsDrawer)
    const btnSaveGlobal = document.getElementById('btnSaveGlobalStrings')
    if (btnSaveGlobal) btnSaveGlobal.addEventListener('click', saveGlobalStrings)
    const searchInp = document.getElementById('globalStringsSearch')
    if (searchInp) searchInp.addEventListener('input', renderGlobalStringsList)

    const btnAddMsg = document.getElementById('btnAddMessageNode')
    if (btnAddMsg) btnAddMsg.addEventListener('click', addMessageNode)
    const btnAddAct = document.getElementById('btnAddActionNode')
    if (btnAddAct) btnAddAct.addEventListener('click', addActionNode)
    bindPaletteDrag()

    const btnZoomIn = document.getElementById('btnZoomIn')
    if (btnZoomIn) btnZoomIn.addEventListener('click', function () { if (editor) editor.zoom_in(); positionSelectionToolbar() })
    const btnZoomOut = document.getElementById('btnZoomOut')
    if (btnZoomOut) btnZoomOut.addEventListener('click', function () { if (editor) editor.zoom_out(); positionSelectionToolbar() })
    const btnFitView = document.getElementById('btnFitView')
    if (btnFitView) btnFitView.addEventListener('click', function () { if (editor) editor.zoom_reset(); positionSelectionToolbar() })

    const selectionToolbar = document.getElementById('selectionToolbar')
    if (selectionToolbar) {
      selectionToolbar.addEventListener('mousedown', function (ev) { ev.stopPropagation() })
      selectionToolbar.addEventListener('click', function (ev) { ev.stopPropagation() })
    }
    const btnDuplicateNode = document.getElementById('btnDuplicateNode')
    if (btnDuplicateNode) btnDuplicateNode.addEventListener('click', duplicateSelectedNode)
    const btnCopyNode = document.getElementById('btnCopyNode')
    if (btnCopyNode) btnCopyNode.addEventListener('click', copySelectedNode)
    const btnToolbarDeleteNode = document.getElementById('btnToolbarDeleteNode')
    if (btnToolbarDeleteNode) btnToolbarDeleteNode.addEventListener('click', requestDeleteSelectedNode)
    window.addEventListener('resize', positionSelectionToolbar)

    const btnUndo = document.getElementById('btnUndo')
    if (btnUndo) btnUndo.addEventListener('click', undoDraft)
    const btnRedo = document.getElementById('btnRedo')
    if (btnRedo) btnRedo.addEventListener('click', redoDraft)

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
    const loaded = clone(data.draft || { nodes: [], entry_key: 'welcome' })
    if (!Array.isArray(loaded.nodes)) loaded.nodes = []
    if (loaded.nodes.length && !loaded.nodes.some((n) => n.key === loaded.entry_key)) {
      loaded.entry_key = loaded.nodes[0].key
    }
    editorState.replaceDraft(loaded)
    state.draft = editorState.getDraft()
    state.publishedKeys = data.publishedKeys
    state.enabled = data.enabled
    state.envOverride = data.envOverride || false
    state.actions = data.actions || []
    state.flow = data.flow

    applyFlowEnabledUi()

    const nameEl = document.getElementById('flowName')
    if (nameEl && data.flow) {
      nameEl.textContent = data.flow.name || 'Untitled flow'
      nameEl.title = 'Flow: ' + (data.flow.name || 'Untitled') +
        ' · entry ' + (data.flow.entry_key || 'welcome') +
        (data.flow.draft_updated_at ? ' · draft ' + new Date(data.flow.draft_updated_at).toLocaleString() : '')
    } else if (nameEl) {
      nameEl.textContent = 'Untitled flow'
      nameEl.title = 'No active flow configured.'
    }

    const container = document.getElementById('drawflow')
    editor = new Drawflow(container)
    editor.reroute = true
    editor.editor_mode = 'edit'
    editor.start()
    bindEditorEvents()
    bindToolbar()
    bindEntryKeySelect()
    bindHistoryShortcuts()
    updateHistoryButtons()

    if (!state.draft.nodes.length) {
      setStatus('No flow nodes configured — drag Message or Action onto the canvas, or click to add', 'ok')
      renderEntryKeySelect()
      renderPanel()
      refreshValidation()
      return
    }

    renderCanvas()

    selectNodeByKey(effectiveEntryKey())
    refreshValidation()
    setStatus('Click a card to edit · Apply · Save draft · Preview', 'ok')
  }

  function bindHistoryShortcuts() {
    document.addEventListener('keydown', function (ev) {
      const action = FlowBuilderState.resolveShortcut(ev, {
        selectedKey: state.selectedKey,
        modalOpen: FlowBuilderState.isModalOrDialogActive({
          dialogs: document.querySelectorAll('[role="dialog"], dialog'),
          target: ev.target,
        }),
      })
      if (!action) return
      ev.preventDefault()
      if (action === 'undo') undoDraft()
      else if (action === 'redo') redoDraft()
      else if (action === 'copy') copySelectedNode()
      else if (action === 'paste') pasteClipboard()
      else if (action === 'duplicate') duplicateSelectedNode()
      else if (action === 'delete') requestDeleteSelectedNode()
    })
  }

  document.addEventListener('DOMContentLoaded', loadGraph)
})()
