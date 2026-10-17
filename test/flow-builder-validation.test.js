const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ejs = require('ejs')
const {
  collectDraftIssues,
  overlayNodePatch,
  nodeHighlightClass,
  saveBlocked,
  saveBlockTooltip,
  canvasPanToCenter,
  isHttpUrl,
} = require('../public/js/flow-builder/validation')
const { validateDraft, DEFAULT_FLOW_ACTIONS } = require('../lib/flow-draft')

const viewRoot = path.join(__dirname, '..', 'views')
const viewFile = path.join(viewRoot, 'settings-bot-flow.ejs')
const cssFile = path.join(__dirname, '..', 'public/css/flow-builder.css')
const jsFile = path.join(__dirname, '..', 'public/js/flow-builder.js')

const baseDraft = {
  entry_key: 'welcome',
  nodes: [
    {
      key: 'welcome',
      kind: 'screen',
      screen_key: 'screen.welcome',
      action: null,
      body: 'Hi {{first_name}}',
      pos_x: 0,
      pos_y: 0,
      media_url: null,
      media_type: 'photo',
      buttons: [[{ label: 'Go', go: 'product_list' }]],
      description: '',
    },
    {
      key: 'product_list',
      kind: 'action',
      screen_key: null,
      action: 'product_list',
      pos_x: 240,
      pos_y: 0,
      buttons: [[{ label: 'Back', go: 'welcome' }]],
      description: '',
    },
  ],
}

test('collectDraftIssues accepts a valid connected draft with no red errors (M6)', () => {
  const r = collectDraftIssues(baseDraft, { allowedActions: DEFAULT_FLOW_ACTIONS })
  assert.equal(r.ok, true)
  assert.equal(r.errors.length, 0)
  assert.equal(saveBlocked(r), false)
})

test('empty message body is a red error that blocks save (M6)', () => {
  const d = structuredClone(baseDraft)
  d.nodes[0].body = '   '
  const r = collectDraftIssues(d)
  assert.equal(r.ok, false)
  assert.ok(r.errors.some((e) => e.nodeKey === 'welcome' && e.field === 'body' && e.level === 'error'))
  assert.equal(nodeHighlightClass('welcome', r), 'is-error')
  assert.equal(saveBlocked(r), true)
  assert.match(saveBlockTooltip(r), /body/i)
})

test('fixing an empty body clears the red error without other changes (M6)', () => {
  const empty = structuredClone(baseDraft)
  empty.nodes[0].body = ''
  const broken = collectDraftIssues(empty)
  assert.equal(saveBlocked(broken), true)
  assert.equal(nodeHighlightClass('welcome', broken), 'is-error')

  const fixedDraft = overlayNodePatch(empty, 'welcome', { body: 'Welcome back' })
  const fixed = collectDraftIssues(fixedDraft)
  assert.equal(saveBlocked(fixed), false)
  assert.equal(nodeHighlightClass('welcome', fixed), '')
  assert.equal(fixed.errors.some((e) => e.field === 'body'), false)
})

test('unreachable node is a yellow warning and does not block save (M6)', () => {
  const d = structuredClone(baseDraft)
  d.nodes.push({
    key: 'orphan',
    kind: 'screen',
    screen_key: 'screen.orphan',
    body: 'Orphan screen',
    pos_x: 400,
    pos_y: 80,
    buttons: [[{ label: 'Home', go: 'welcome' }]],
    description: '',
  })
  const r = collectDraftIssues(d, { allowedActions: DEFAULT_FLOW_ACTIONS })
  assert.equal(r.ok, true)
  assert.equal(saveBlocked(r), false)
  assert.ok(r.warnings.some((w) => w.nodeKey === 'orphan' && w.code === 'unreachable'))
  assert.equal(nodeHighlightClass('orphan', r), 'is-warning')
  assert.equal(nodeHighlightClass('welcome', r), '')
})

test('entry node is not flagged unreachable even with no inbound wires', () => {
  const d = structuredClone(baseDraft)
  d.nodes[0].buttons = [[{ label: 'Stay', callback: 'noop' }]]
  const r = collectDraftIssues(d, { allowedActions: DEFAULT_FLOW_ACTIONS })
  assert.equal(r.warnings.some((w) => w.nodeKey === 'welcome' && w.code === 'unreachable'), false)
})

test('message node with no buttons and no outbound link is a yellow dead-end warning', () => {
  const d = structuredClone(baseDraft)
  d.nodes[0].buttons = []
  const r = collectDraftIssues(d)
  assert.ok(r.warnings.some((w) => w.nodeKey === 'welcome' && w.code === 'dead_end'))
  assert.equal(saveBlocked(r), false)
})

test('action node without action is a red error', () => {
  const d = structuredClone(baseDraft)
  d.nodes[1].action = ''
  const r = collectDraftIssues(d)
  assert.ok(r.errors.some((e) => e.nodeKey === 'product_list' && e.field === 'action'))
  assert.equal(nodeHighlightClass('product_list', r), 'is-error')
  assert.equal(saveBlocked(r), true)
})

test('button with empty label is a red error on that button row', () => {
  const d = structuredClone(baseDraft)
  d.nodes[0].buttons = [[{ label: '  ', go: 'product_list' }]]
  const r = collectDraftIssues(d)
  const issue = r.errors.find((e) => e.field === 'label')
  assert.ok(issue)
  assert.equal(issue.nodeKey, 'welcome')
  assert.equal(issue.buttonIndex, 0)
  assert.equal(saveBlocked(r), true)
})

test('button label_key counts as a label', () => {
  const d = structuredClone(baseDraft)
  d.nodes[0].buttons = [[{ label_key: 'btn.welcome.0', go: 'product_list' }]]
  const r = collectDraftIssues(d, { allowedActions: DEFAULT_FLOW_ACTIONS })
  assert.equal(r.errors.some((e) => e.field === 'label'), false)
})

test('button not exactly one of go/callback/url_from/url is a red error', () => {
  const d = structuredClone(baseDraft)
  d.nodes[0].buttons = [[{ label: 'X', go: 'product_list', url: 'https://x.test' }]]
  const r = collectDraftIssues(d)
  const issue = r.errors.find((e) => e.code === 'button_mode')
  assert.ok(issue)
  assert.equal(issue.buttonIndex, 0)
  assert.match(issue.message, /welcome: button "X" needs exactly one of go\|callback\|url_from\|url/)
})

test('empty and whitespace-only go targets name the button', () => {
  const empty = structuredClone(baseDraft)
  empty.nodes[0].buttons = [[{ label: 'Menu', go: '' }]]
  const emptyIssue = collectDraftIssues(empty).errors.find((e) => e.code === 'empty_go')
  assert.ok(emptyIssue)
  assert.equal(emptyIssue.field, 'go')
  assert.equal(emptyIssue.buttonIndex, 0)
  assert.match(emptyIssue.message, /welcome: button "Menu" has an empty go target/)

  const blank = structuredClone(baseDraft)
  blank.nodes[0].buttons = [[{ label: 'Menu', go: '   ' }]]
  const blankIssue = collectDraftIssues(blank).errors.find((e) => e.code === 'empty_go')
  assert.ok(blankIssue)
  assert.match(blankIssue.message, /welcome: button "Menu" has an empty go target/)
  assert.equal(collectDraftIssues(blank).errors.some((e) => e.code === 'button_mode'), false)

  const unlabeled = structuredClone(baseDraft)
  unlabeled.nodes[0].buttons = [[], [{ go: '' }]]
  const unlabeledIssue = collectDraftIssues(unlabeled).errors.find((e) => e.code === 'empty_go')
  assert.ok(unlabeledIssue)
  assert.equal(unlabeledIssue.buttonIndex, 0)
  assert.match(unlabeledIssue.message, /welcome: button "row 2 col 1" has an empty go target/)
})

test('null and non-object buttons are shape errors and do not throw', () => {
  const d = structuredClone(baseDraft)
  d.nodes[0].buttons = [[null, { label: 'Go', go: 'product_list' }], ['nope', undefined]]
  const r = collectDraftIssues(d, { allowedActions: DEFAULT_FLOW_ACTIONS })
  const shape = r.errors.filter((e) => e.code === 'button_shape')
  assert.deepEqual(shape.map((e) => e.buttonIndex), [0, 2, 3])
  assert.equal(shape[0].nodeKey, 'welcome')
  assert.equal(shape[0].field, 'buttons')
  assert.equal(shape[0].level, 'error')
  assert.match(shape[0].message, /welcome: button 1 must be an object/)
  assert.match(shape[1].message, /welcome: button 3 must be an object/)
  assert.match(shape[2].message, /welcome: button 4 must be an object/)
  assert.equal(r.errors.some((e) => e.buttonIndex === 0 && e.code !== 'button_shape'), false)
  assert.equal(r.errors.some((e) => e.buttonIndex === 1), false)
  assert.equal(saveBlocked(r), true)

  const js = fs.readFileSync(jsFile, 'utf8')
  const mode = js.slice(js.indexOf('function buttonMode'), js.indexOf('function goFlatIndices'))
  assert.match(mode, /if\s*\(\s*!btn\s*\|\|\s*typeof btn !== 'object'\s*\)\s*return ''/)
  const panel = js.slice(js.indexOf('function renderPanel'), js.indexOf('function readPanelPatch'))
  assert.match(panel, /if\s*\(\s*!btn\s*\|\|\s*typeof btn !== 'object'\s*\)\s*return/)
})

test('go target that does not exist is a red error', () => {
  const d = structuredClone(baseDraft)
  d.nodes[0].buttons = [[{ label: 'X', go: 'missing_node' }]]
  const r = collectDraftIssues(d)
  assert.ok(r.errors.some((e) => e.code === 'go_target' && /missing_node/.test(e.message)))
})

test('url that is not http(s) is a red error', () => {
  const d = structuredClone(baseDraft)
  d.nodes[0].buttons = [[{ label: 'Site', url: 'ftp://files.example' }]]
  const r = collectDraftIssues(d)
  assert.ok(r.errors.some((e) => e.field === 'url' && e.code === 'url_scheme'))
})

test('http(s) button urls are accepted', () => {
  const d = structuredClone(baseDraft)
  d.nodes[0].buttons = [[{ label: 'Site', url: 'https://example.com/shop' }]]
  const r = collectDraftIssues(d, { allowedActions: DEFAULT_FLOW_ACTIONS })
  assert.equal(r.errors.some((e) => e.code === 'url_scheme'), false)
})

test('non-empty media_url that is not http(s) is a red error', () => {
  const d = structuredClone(baseDraft)
  d.nodes[0].media_url = 'not-a-url'
  const r = collectDraftIssues(d)
  assert.ok(r.errors.some((e) => e.field === 'media_url'))
  assert.equal(saveBlocked(r), true)
})

test('empty media_url with default media_type is allowed (optional media)', () => {
  const d = structuredClone(baseDraft)
  d.nodes[0].media_url = null
  d.nodes[0].media_type = 'photo'
  const r = collectDraftIssues(d, { allowedActions: DEFAULT_FLOW_ACTIONS })
  assert.equal(r.errors.some((e) => e.field === 'media_url'), false)
})

test('duplicate keys and missing entry_key are red banner errors', () => {
  const dup = structuredClone(baseDraft)
  dup.nodes.push(structuredClone(dup.nodes[0]))
  const dupResult = collectDraftIssues(dup)
  assert.ok(dupResult.errors.some((e) => e.code === 'duplicate_keys'))
  assert.equal(saveBlocked(dupResult), true)

  const missing = structuredClone(baseDraft)
  delete missing.entry_key
  const missingResult = collectDraftIssues(missing)
  assert.ok(missingResult.errors.some((e) => e.code === 'entry_key'))
})

test('red highlight wins over yellow when a node has both', () => {
  const d = structuredClone(baseDraft)
  d.nodes.push({
    key: 'orphan',
    kind: 'screen',
    screen_key: 'screen.orphan',
    body: '',
    pos_x: 400,
    pos_y: 80,
    buttons: [],
    description: '',
  })
  const r = collectDraftIssues(d)
  assert.equal(nodeHighlightClass('orphan', r), 'is-error')
})

test('clicking an issue exposes nodeKey so the editor can centre that node (M6)', () => {
  const d = structuredClone(baseDraft)
  d.nodes[0].body = ''
  const r = collectDraftIssues(d)
  const item = r.errors.find((e) => e.nodeKey === 'welcome')
  assert.ok(item)
  const pan = canvasPanToCenter(
    { width: 800, height: 600 },
    { x: 100, y: 80, width: 240, height: 120 },
    1
  )
  assert.equal(pan.canvas_x, 800 / 2 - (100 + 240 / 2))
  assert.equal(pan.canvas_y, 600 / 2 - (80 + 120 / 2))
})

test('canvasPanToCenter scales the viewport-to-node offset for a centred origin', () => {
  const pan = canvasPanToCenter(
    { width: 1000, height: 800 },
    { x: 50, y: 50, width: 200, height: 100 },
    2
  )
  const midX = 50 + 200 / 2
  const midY = 50 + 100 / 2
  assert.equal(pan.canvas_x, (1000 / 2 - midX) * 2)
  assert.equal(pan.canvas_y, (800 / 2 - midY) * 2)

  const zoomedOut = canvasPanToCenter(
    { width: 1000, height: 800 },
    { x: 50, y: 50, width: 200, height: 100 },
    0.5
  )
  assert.equal(zoomedOut.canvas_x, (1000 / 2 - midX) * 0.5)
  assert.equal(zoomedOut.canvas_y, (800 / 2 - midY) * 0.5)

  const fallback = canvasPanToCenter(
    { width: 1000, height: 800 },
    { x: 50, y: 50, width: 200, height: 100 },
    0
  )
  assert.equal(fallback.canvas_x, 1000 / 2 - midX)
  assert.equal(fallback.canvas_y, 800 / 2 - midY)
})

test('isHttpUrl accepts http and https only', () => {
  assert.equal(isHttpUrl('https://cdn.example/a.png'), true)
  assert.equal(isHttpUrl('http://localhost:3000/x'), true)
  assert.equal(isHttpUrl('ftp://x'), false)
  assert.equal(isHttpUrl('example.com'), false)
  assert.equal(isHttpUrl(''), false)
})

test('validateDraft error strings stay in parity with collectDraftIssues (M6)', () => {
  const d = structuredClone(baseDraft)
  d.nodes[0].body = ''
  d.nodes[0].buttons = [[{ label: 'X', go: 'nope' }]]
  d.nodes[1].action = ''
  const issues = collectDraftIssues(d, { allowedActions: DEFAULT_FLOW_ACTIONS })
  const v = validateDraft(d, { allowedActions: DEFAULT_FLOW_ACTIONS })
  assert.deepEqual(v.errors, issues.errors.map((e) => e.message))
  assert.equal(v.ok, issues.ok)
})

test('Bot Flow page renders the top-bar validation list (M6)', async () => {
  const html = await ejs.renderFile(viewFile, {
    title: 'Bot Flow - Test',
    namaBot: 'Test Bot',
    username: 'tester',
    req: { session: { role: 'admin' } },
    currentPage: 'settings-bot-flow',
    pageTitle: 'Bot Flow',
  }, { views: [viewRoot] })

  assert.match(html, /id="validationList"/)
  assert.match(html, /id="validationToggle"/)
  assert.match(html, /id="validationErrorBadge"/)
  assert.match(html, /id="validationWarnBadge"/)
  assert.match(html, /flow-builder\/validation\.js/)
})

test('flow-builder CSS styles red/yellow node outlines and inspector field errors (M6)', () => {
  const css = fs.readFileSync(cssFile, 'utf8')
  assert.match(css, /\.drawflow-node\.is-error\b/)
  assert.match(css, /\.drawflow-node\.is-warning\b/)
  assert.match(css, /\.flow-validation-list\b/)
  assert.match(css, /\.field-error\b/)
  assert.match(css, /\.sp-btn-row\.is-invalid\b/)
})

test('hidden attribute hides .flow-validation despite display:flex', () => {
  const css = fs.readFileSync(cssFile, 'utf8')
  const block = css.slice(css.indexOf('.flow-validation {'), css.indexOf('.flow-validation-toggle'))
  assert.match(block, /display:\s*flex/)
  assert.match(block, /\.flow-validation\[hidden\]\s*\{[^}]*display:\s*none/)
})

test('inspector field errors set and clear aria-invalid and aria-describedby', () => {
  const js = fs.readFileSync(jsFile, 'utf8')
  const insert = js.slice(js.indexOf('function insertFieldError'), js.indexOf('function applyPanelFieldErrors'))
  assert.match(insert, /setAttribute\(\s*'aria-invalid'\s*,\s*'true'\s*\)/)
  assert.match(insert, /err\.id\s*=\s*\(el\.id\s*\|\|\s*'field'\)\s*\+\s*'-error'/)
  assert.match(insert, /setAttribute\(\s*'aria-describedby'\s*,\s*err\.id\s*\)/)
  const clear = js.slice(js.indexOf('function applyPanelFieldErrors'), js.indexOf('function updateSaveButtons'))
  const reset = clear.slice(0, clear.indexOf('const key = state.selectedKey'))
  assert.match(reset, /removeAttribute\(\s*'aria-invalid'\s*\)/)
  assert.match(reset, /removeAttribute\(\s*'aria-describedby'\s*\)/)
})

test('syncPanelIntoDraft applies the inspector only after a real edit', () => {
  const js = fs.readFileSync(jsFile, 'utf8')
  assert.match(js, /let panelDirty = false/)
  const sync = js.slice(js.indexOf('function syncPanelIntoDraft'), js.indexOf('async function saveDraft'))
  assert.match(sync, /if\s*\(\s*!panelDirty\s*\)\s*return/)
  assert.ok(sync.indexOf('!panelDirty') < sync.indexOf('readPanelPatch'))
  assert.match(sync, /patchChangesNode\(node, patch\)/)
  const render = js.slice(js.indexOf('function renderPanel'), js.indexOf('function readPanelPatch'))
  assert.match(render, /panelDirty = false/)
  const apply = js.slice(js.indexOf('function applyPanelToDraft'), js.indexOf('function bindEditorEvents'))
  assert.match(apply, /panelDirty = false/)
  const bind = js.slice(js.indexOf('const flowPanel = document.getElementById(\'flowPanel\')'), js.indexOf('document.getElementById(\'btnPreview\')'))
  assert.match(bind, /addEventListener\(\s*'input'[\s\S]*panelDirty = true/)
  assert.match(bind, /addEventListener\(\s*'change'[\s\S]*panelDirty = true/)
  const validation = js.slice(js.indexOf('function validationDraft'), js.indexOf('function applyNodeHighlights'))
  assert.match(validation, /if\s*\(\s*!panelDirty\s*\)\s*return state\.draft/)
  assert.ok(validation.indexOf('!panelDirty') < validation.indexOf('readPanelPatch'))
})

test('flow-builder JS highlights nodes, gates Save/Publish, and centres on list click (M6)', () => {
  const js = fs.readFileSync(jsFile, 'utf8')
  assert.match(js, /FlowBuilderValidation/)
  assert.match(js, /collectDraftIssues/)
  assert.match(js, /refreshValidation/)
  assert.match(js, /is-error/)
  assert.match(js, /is-warning/)
  assert.match(js, /btnSaveDraft/)
  assert.match(js, /btnPublish/)
  assert.match(js, /canvasPanToCenter/)
  assert.match(js, /validationList/)
  assert.match(js, /overlayNodePatch/)
  const sync = js.slice(js.indexOf('function syncPanelIntoDraft'), js.indexOf('async function saveDraft'))
  assert.match(sync, /patchChangesNode\(node, patch\)/)
  assert.ok(sync.indexOf('patchChangesNode') < sync.lastIndexOf('applyPanelToDraft()'))
})
