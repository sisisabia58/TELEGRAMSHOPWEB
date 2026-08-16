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
    let html = '<div class="sp-card ' + kindClass + '" data-node-key="' + escapeHtml(node.key) + '">'
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

  function selectNodeByKey(key) {
    if (!key || !state.draft) return
    state.selectedKey = key
    renderPanel()
    const id = keyToId.get(key)
    if (id == null || !editor) return
    document.querySelectorAll('.drawflow-node.selected').forEach((n) => n.classList.remove('selected'))
    const el = document.getElementById('node-' + id)
    if (el) el.classList.add('selected')
  }

  function renderCanvas() {
    if (!editor || !state.draft) return
    const keepKey = state.selectedKey
    editor.clear()
    keyToId.clear()
    idToKey.clear()
    goOutputFlatIndices.clear()

    for (const node of state.draft.nodes) {
      const inputs = 1
      const outputs = Math.max(countGoOutputs(node), node.kind === 'action' ? 0 : 0)
      const id = editor.addNode(
        node.key,
        inputs,
        outputs,
        Number(node.pos_x) || 40,
        Number(node.pos_y) || 40,
        node.kind === 'screen' ? 'flow-node-screen' : 'flow-node-action',
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
    }
  }

  function getNode(key) {
    return (state.draft.nodes || []).find((n) => n.key === key)
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
      .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank">$1</a>')
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
        '<strong>Edit panel</strong>' +
        'Click a <em>Message</em> or <em>Action</em> card on the canvas to edit its text and buttons here.' +
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

    let html = '<div class="flow-panel-head">'
    html += '<div class="sp-kind ' + kindClass + '">' + kindLabel + '</div>'
    html += '<h2>' + escapeHtml(node.key) + '</h2>'
    html += '</div><div class="flow-panel-body">'

    if (node.kind === 'screen') {
      html += '<div class="field"><label>Media URL (Image / Banner)</label>'
      html += '<input type="url" id="panelMediaUrl" placeholder="https://example.com/image.jpg" value="' + escapeHtml(node.media_url || '') + '">'
      if (node.media_url) {
        html += '<div class="media-thumb-preview"><img src="' + escapeHtml(node.media_url) + '" alt="Media preview" onerror="this.style.display=\'none\'"></div>'
      }
      html += '</div>'

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
      html += '<div class="field"><label>Action</label><input type="text" class="readonly" readonly value="' + escapeHtml(node.action || '') + '"></div>'
      html += '<p class="flow-panel-hint">Action nodes open live catalog tools. Preview them with the Preview button. Kind cannot be changed here.</p>'
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
    html += '<button type="button" id="panelApply" class="btn-apply">Apply</button>'
    html += '</div>'

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
        if (!node.buttons) node.buttons = []
        const newIdx = flattenButtons(node.buttons).length
        const label = 'Button ' + (newIdx + 1)
        node.buttons.push([{ label, go: '' }])
        renderPanel()
      })
    }

    panel.querySelectorAll('.btn-row-delete').forEach((btn) => {
      btn.addEventListener('click', function () {
        const idx = Number(btn.getAttribute('data-delete'))
        const flat = flattenButtons(node.buttons)
        flat.splice(idx, 1)
        node.buttons = flat.map((b) => [b])
        renderPanel()
      })
    })

    panel.querySelectorAll('.btn-row-move').forEach((btn) => {
      btn.addEventListener('click', function () {
        const idx = Number(btn.getAttribute('data-idx'))
        const dir = btn.getAttribute('data-move')
        const flat = flattenButtons(node.buttons)
        const targetIdx = dir === 'up' ? idx - 1 : idx + 1
        if (targetIdx >= 0 && targetIdx < flat.length) {
          const temp = flat[idx]
          flat[idx] = flat[targetIdx]
          flat[targetIdx] = temp
          node.buttons = flat.map((b) => [b])
          renderPanel()
        }
      })
    })

    document.getElementById('panelApply').addEventListener('click', applyPanelToDraft)
  }

  function applyPanelToDraft() {
    const key = state.selectedKey
    const node = getNode(key)
    if (!node) return

    const descEl = document.getElementById('panelDescription')
    if (descEl) node.description = descEl.value

    if (node.kind === 'screen') {
      const mediaEl = document.getElementById('panelMediaUrl')
      if (mediaEl) node.media_url = mediaEl.value.trim() || null
      const bodyEl = document.getElementById('panelBody')
      if (bodyEl) node.body = bodyEl.value
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
      node.buttons = rebuilt
    }

    const outputs = countGoOutputs(node)
    const prevOutputs = (goOutputFlatIndices.get(key) || []).length
    if (outputs !== prevOutputs) {
      renderCanvas()
    } else {
      const id = keyToId.get(key)
      if (id != null) {
        editor.updateNodeDataFromId(id, { key: node.key })
        refreshNodeDom(id, node)
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
      const resolved = resolveNodeId(id)
      const key = resolved != null ? idToKey.get(resolved) : null
      const node = getNode(key)
      const info = editor.getNodeFromId(resolved)
      if (node && info) {
        node.pos_x = info.pos_x
        node.pos_y = info.pos_y
      }
    })

    editor.on('connectionCreated', function (info) {
      const fromKey = idToKey.get(resolveNodeId(info.output_id)) || idToKey.get(info.output_id)
      const toKey = idToKey.get(resolveNodeId(info.input_id)) || idToKey.get(info.input_id)
      if (!fromKey || !toKey) return
      const outNum = parseInt(String(info.output_class).replace('output_', ''), 10)
      const flatList = goOutputFlatIndices.get(fromKey) || []
      const flatIdx = flatList[outNum - 1]
      if (flatIdx === undefined) return
      state.draft = applyWire(state.draft, fromKey, flatIdx, toKey)
      if (state.selectedKey === fromKey) renderPanel()
      setStatus('Connected ' + fromKey + ' → ' + toKey, 'ok')
    })

    editor.on('connectionRemoved', function (info) {
      const fromKey = idToKey.get(resolveNodeId(info.output_id)) || idToKey.get(info.output_id)
      if (!fromKey) return
      const outNum = parseInt(String(info.output_class).replace('output_', ''), 10)
      const flatList = goOutputFlatIndices.get(fromKey) || []
      const flatIdx = flatList[outNum - 1]
      if (flatIdx === undefined) return
      state.draft = clearWire(state.draft, fromKey, flatIdx)
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
    return btn.text || btn.label || btn.label_key || 'Button'
  }

  function formatCaptionHtml(caption) {
    let s = escapeHtml(caption || '')
    s = s.replace(/\*([^*\n]+)\*/g, '<strong>$1</strong>')
    s = s.replace(/_([^_\n]+)_/g, '<em>$1</em>')
    s = s.replace(/~([^~\n]+)~/g, '<s>$1</s>')
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
    buildPreviewKeyboard(data.buttons || [])
  }

  function previewGoto(nodeKey) {
    return previewStep({ nodeKey: nodeKey })
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
      meta.textContent = 'Flow: ' + data.flow.name + ' · entry ' + (data.flow.entry_key || 'welcome') +
        (data.flow.draft_updated_at ? ' · draft ' + new Date(data.flow.draft_updated_at).toLocaleString() : '')
    } else if (meta) {
      meta.textContent = 'No active flow configured.'
    }

    if (!state.draft || !state.draft.nodes || !state.draft.nodes.length) {
      setStatus('No flow nodes to display', 'err')
      renderPanel()
      return
    }

    const container = document.getElementById('drawflow')
    editor = new Drawflow(container)
    editor.reroute = true
    editor.editor_mode = 'edit'
    editor.start()
    bindEditorEvents()
    renderCanvas()
    bindToolbar()

    const entry = state.draft.entry_key || 'welcome'
    selectNodeByKey(keyToId.has(entry) ? entry : state.draft.nodes[0].key)
    setStatus('Click a card to edit · Apply · Save draft · Preview', 'ok')
  }

  document.addEventListener('DOMContentLoaded', loadGraph)
})()
