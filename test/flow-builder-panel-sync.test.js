const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const FlowBuilderCommands = require('../public/js/flow-builder/commands')
const FlowBuilderState = require('../public/js/flow-builder/state')

const jsFile = path.join(__dirname, '..', 'public/js/flow-builder.js')
const jsSource = fs.readFileSync(jsFile, 'utf8')

function endOfBalanced(source, openIndex) {
  let depth = 0
  let quote = null
  for (let i = openIndex; i < source.length; i++) {
    const ch = source[i]
    if (quote) {
      if (ch === '\\') {
        i++
        continue
      }
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === '\'' || ch === '`') {
      quote = ch
      continue
    }
    if (ch === '/' && source[i + 1] === '/') {
      const nl = source.indexOf('\n', i)
      if (nl < 0) return source.length
      i = nl
      continue
    }
    if (ch === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2)
      if (end < 0) throw new Error('unterminated comment')
      i = end + 1
      continue
    }
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return i + 1
    }
  }
  throw new Error('unbalanced brace')
}

function extractFromBrace(source, marker) {
  const start = source.indexOf(marker)
  if (start < 0) throw new Error('missing marker: ' + marker)
  const open = source.indexOf('{', start)
  if (open < 0) throw new Error('missing brace after ' + marker)
  let end = endOfBalanced(source, open)
  let j = end
  while (source[j] === ' ' || source[j] === '\n' || source[j] === '\r' || source[j] === '\t') j++
  if (source[j] === ')') end = j + 1
  return source.slice(start, end)
}

function extractFunction(source, name) {
  return extractFromBrace(source, 'function ' + name + '(')
}

class MiniEl {
  constructor(id) {
    this.id = id
    this.value = ''
    this.selectionStart = 0
    this.selectionEnd = 0
    this.parentElement = null
    this.children = []
    this.attrs = {}
    this._classes = new Set()
    this._listeners = { capture: Object.create(null), bubble: Object.create(null) }
    const classes = this._classes
    this.classList = {
      add(name) { classes.add(name) },
      remove(name) { classes.delete(name) },
      toggle(name) {
        if (classes.has(name)) {
          classes.delete(name)
          return false
        }
        classes.add(name)
        return true
      },
      contains(name) { return classes.has(name) },
    }
  }

  appendChild(child) {
    child.parentElement = this
    this.children.push(child)
    return child
  }

  setAttribute(name, value) {
    this.attrs[name] = String(value)
  }

  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null
  }

  addEventListener(type, fn, opts) {
    const capture = opts === true || (opts && opts.capture)
    const bucket = capture ? 'capture' : 'bubble'
    if (!this._listeners[bucket][type]) this._listeners[bucket][type] = []
    this._listeners[bucket][type].push(fn)
  }

  dispatchEvent(event) {
    const path = []
    let node = this
    while (node) {
      path.push(node)
      node = node.parentElement
    }
    const invoke = (el, phase) => {
      const list = (el._listeners[phase] && el._listeners[phase][event.type]) || []
      for (const fn of list.slice()) fn.call(el, event)
    }
    for (let i = path.length - 1; i >= 1; i--) invoke(path[i], 'capture')
    invoke(this, 'capture')
    invoke(this, 'bubble')
    if (event.bubbles) {
      for (let i = 1; i < path.length; i++) invoke(path[i], 'bubble')
    }
    return true
  }

  querySelectorAll(selector) {
    const found = []
    const walk = (el) => {
      for (const child of el.children) {
        found.push(child)
        walk(child)
      }
    }
    walk(this)
    if (selector.charAt(0) === '.') {
      const name = selector.slice(1)
      return found.filter((el) => el.classList.contains(name))
    }
    return []
  }

  focus() {}

  setSelectionRange(start, end) {
    this.selectionStart = start
    this.selectionEnd = end
  }
}

function createDocument() {
  const byId = new Map()
  const document = {
    getElementById(id) {
      return byId.get(id) || null
    },
  }
  const panel = new MiniEl('flowPanel')
  const body = new MiniEl('panelBody')
  const apply = new MiniEl('panelApply')
  const toggle = new MiniEl('btnVarToggle')
  const dropup = new MiniEl('varDropup')
  const bold = new MiniEl('btnFmtBold')
  const variable = new MiniEl('varFirstName')
  bold.classList.add('btn-fmt')
  bold.setAttribute('data-fmt', 'bold')
  variable.classList.add('var-item')
  variable.setAttribute('data-var', '{{first_name}}')
  panel.appendChild(body)
  panel.appendChild(apply)
  panel.appendChild(toggle)
  panel.appendChild(dropup)
  panel.appendChild(bold)
  panel.appendChild(variable)
  for (const el of [panel, body, apply, toggle, dropup, bold, variable]) byId.set(el.id, el)
  return { document, panel, body, dropup, bold, variable }
}

function screenDraft(body) {
  return {
    entry_key: 'welcome',
    nodes: [
      {
        key: 'welcome',
        kind: 'screen',
        screen_key: 'screen.welcome',
        action: null,
        body: body,
        pos_x: 0,
        pos_y: 0,
        media_url: null,
        media_type: 'photo',
        buttons: [[{ label: 'Go', go: 'next' }]],
        description: '',
      },
    ],
  }
}

const harnessFactory = new Function(
  'document',
  'state',
  'editorState',
  'FlowBuilderCommands',
  'editor',
  'keyToId',
  'goOutputFlatIndices',
  [
    "'use strict'",
    'let panelDirty = false',
    'function setStatus() {}',
    'function updateHistoryButtons() {}',
    'function refreshValidation() {}',
    'function selectNodeByKey() {}',
    'function renderCanvas() {}',
    'function refreshNodeDom() {}',
    extractFunction(jsSource, 'applyFormatting'),
    extractFunction(jsSource, 'insertVariable'),
    extractFunction(jsSource, 'flattenButtons'),
    extractFunction(jsSource, 'buttonMode'),
    extractFunction(jsSource, 'goFlatIndices'),
    extractFunction(jsSource, 'countGoOutputs'),
    extractFunction(jsSource, 'getNode'),
    extractFunction(jsSource, 'readPanelPatch'),
    extractFunction(jsSource, 'applyCommand'),
    extractFunction(jsSource, 'syncPanelIntoDraft'),
    extractFunction(jsSource, 'applyPanelToDraft'),
    'const panel = document.getElementById(\'flowPanel\')',
    extractFromBrace(jsSource, 'panel.querySelectorAll(\'.btn-fmt\')'),
    extractFromBrace(jsSource, 'const varToggle = document.getElementById(\'btnVarToggle\')'),
    extractFromBrace(jsSource, 'const flowPanel = document.getElementById(\'flowPanel\')'),
    'return {',
    '  syncPanelIntoDraft: syncPanelIntoDraft,',
    '  isPanelDirty: function () { return panelDirty },',
    '}',
  ].join('\n')
)

function boot(bodyText, selectionStart, selectionEnd) {
  const dom = createDocument()
  dom.body.value = bodyText
  dom.body.selectionStart = selectionStart
  dom.body.selectionEnd = selectionEnd
  const editorState = FlowBuilderState.createEditorState()
  editorState.replaceDraft(screenDraft(bodyText))
  const state = {
    draft: editorState.getDraft(),
    selectedKey: 'welcome',
  }
  const api = harnessFactory(
    dom.document,
    state,
    editorState,
    FlowBuilderCommands,
    {
      updateNodeDataFromId() {},
      updateConnectionNodes() {},
    },
    new Map(),
    new Map()
  )
  assert.equal(api.isPanelDirty(), false)
  api.syncPanelIntoDraft()
  assert.equal(state.draft.nodes[0].body, bodyText)
  assert.equal(editorState.canUndo(), false)
  return { dom, state, editorState, api }
}

test('bold toolbar formatting marks the inspector dirty and syncs into the draft', () => {
  const { dom, state, editorState, api } = boot('Hello', 0, 5)
  dom.bold.dispatchEvent(new Event('click'))
  assert.equal(dom.body.value, '*Hello*')
  assert.equal(api.isPanelDirty(), true)
  api.syncPanelIntoDraft()
  assert.equal(state.draft.nodes[0].body, '*Hello*')
  assert.equal(api.isPanelDirty(), false)
  assert.equal(editorState.canUndo(), true)
})

test('variable-picker insert marks the inspector dirty and syncs into the draft', () => {
  const { dom, state, editorState, api } = boot('Hello', 5, 5)
  dom.variable.dispatchEvent(new Event('click'))
  assert.equal(dom.body.value, 'Hello{{first_name}}')
  assert.equal(dom.dropup.classList.contains('hidden'), true)
  assert.equal(api.isPanelDirty(), true)
  api.syncPanelIntoDraft()
  assert.equal(state.draft.nodes[0].body, 'Hello{{first_name}}')
  assert.equal(api.isPanelDirty(), false)
  assert.equal(editorState.canUndo(), true)
})
