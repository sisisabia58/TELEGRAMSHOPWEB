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
  assert.match(saveBlockTooltip(r), /message text is empty/)
})

test('an invalid message body emits exactly one issue', () => {
  function bodyIssues(body) {
    const d = structuredClone(baseDraft)
    d.nodes[0].body = body
    return collectDraftIssues(d).errors.filter((e) => e.field === 'body')
  }

  const nonString = bodyIssues(12)
  assert.equal(nonString.length, 1)
  assert.equal(nonString[0].field, 'body')
  assert.equal(nonString[0].nodeKey, 'welcome')
  assert.equal(nonString[0].message, 'welcome: message text must be a string')

  for (const blank of ['', '   ']) {
    const issues = bodyIssues(blank)
    assert.equal(issues.length, 1, JSON.stringify(issues))
    assert.equal(issues[0].field, 'body')
    assert.equal(issues[0].nodeKey, 'welcome')
    assert.equal(issues[0].message, 'welcome: message text is empty')
  }
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
  assert.match(panel, /if\s*\(\s*!btn\s*\|\|\s*typeof btn !== 'object'\s*\)\s*\{/)
  assert.match(panel, /Invalid button entry/)
  assert.match(panel, /data-flat-index="' \+ idx \+ '"/)
  assert.match(panel, /class="btn-row-delete" data-delete="' \+ idx \+ '"/)
  const patchFn = js.slice(js.indexOf('function readPanelPatch'), js.indexOf('function applyPanelToDraft'))
  assert.match(patchFn, /const labelEl = row\.querySelector\('\.btn-label'\)/)
  assert.match(patchFn, /if\s*\(\s*!labelEl\s*\)\s*return/)
})

function extractArrowBlock(source, marker) {
  const start = source.indexOf(marker)
  if (start < 0) throw new Error('missing ' + marker)
  const open = source.indexOf('{', start)
  let end = endOfBalanced(source, open)
  let j = end
  while (source[j] === ' ' || source[j] === '\n' || source[j] === '\r' || source[j] === '\t') j++
  if (source[j] === ')') end = j + 1
  return source.slice(start, end)
}

function renderButtonRows(node) {
  const js = fs.readFileSync(jsFile, 'utf8')
  return new Function(
    'node',
    [
      "'use strict'",
      'function escapeHtml(s) {',
      '  return String(s || "")',
      '    .replace(/&/g, "&amp;")',
      '    .replace(/</g, "&lt;")',
      '    .replace(/>/g, "&gt;")',
      '    .replace(/"/g, "&quot;")',
      '}',
      extractFunction(js, 'flattenButtons'),
      extractFunction(js, 'buttonMode'),
      'let html = ""',
      'const flat = flattenButtons(node.buttons)',
      extractArrowBlock(js, 'flat.forEach((btn, idx) => {'),
      'return html',
    ].join('\n')
  )(node)
}

test('invalid button entries render a deletable placeholder and valid rows stay editable', () => {
  const html = renderButtonRows({
    buttons: [[null, { label: 'Go <shop>', go: 'product_list', label_key: 'btn.go' }], ['nope']],
  })
  const rows = html.split('<div class="sp-btn-row"').slice(1)
  assert.equal(rows.length, 3)

  assert.match(rows[0], /data-flat-index="0"/)
  assert.match(rows[0], /Invalid button entry/)
  assert.match(rows[0], /class="btn-row-delete" data-delete="0"/)
  assert.doesNotMatch(rows[0], /btn-label/)
  assert.doesNotMatch(rows[0], /btn-mode/)
  assert.doesNotMatch(rows[0], /btn-target/)

  assert.match(rows[1], /data-flat-index="1"/)
  assert.match(rows[1], /class="btn-label"/)
  assert.match(rows[1], /value="Go &lt;shop&gt;"/)
  assert.match(rows[1], /class="btn-row-delete" data-delete="1"/)
  assert.match(rows[1], /value="go" selected/)

  assert.match(rows[2], /data-flat-index="2"/)
  assert.match(rows[2], /Invalid button entry/)
  assert.match(rows[2], /data-delete="2"/)
  assert.doesNotMatch(rows[2], /btn-label/)
})

test('readPanelPatch skips placeholder rows and still rebuilds valid buttons', () => {
  const js = fs.readFileSync(jsFile, 'utf8')
  const list = new ButtonRowEl('sp-btn-list')
  list.id = 'panelButtonsBody'

  const invalid = new ButtonRowEl('sp-btn-row')
  invalid.setAttribute('data-flat-index', '0')
  invalid.appendChild(new ButtonRowEl('flow-panel-hint'))

  const valid = new ButtonRowEl('sp-btn-row')
  valid.setAttribute('data-flat-index', '1')
  const label = new ButtonRowEl('btn-label')
  label.value = ' Shop '
  const mode = new ButtonRowEl('btn-mode')
  mode.value = 'url'
  const target = new ButtonRowEl('btn-target')
  target.value = ' tg://user?id=7 '
  valid.appendChild(label)
  valid.appendChild(mode)
  valid.appendChild(target)
  list.appendChild(invalid)
  list.appendChild(valid)

  const document = {
    getElementById(id) {
      return id === 'panelButtonsBody' ? list : null
    },
  }
  const readPanelPatch = new Function(
    'document',
    "'use strict'\n" +
      extractFunction(js, 'flattenButtons') + '\n' +
      extractFunction(js, 'readPanelPatch') + '\n' +
      'return readPanelPatch\n'
  )(document)

  const node = {
    kind: 'screen',
    buttons: [[null, { label: 'Old', go: 'welcome', extra: 1 }]],
  }
  const patch = readPanelPatch(node)
  assert.equal(patch.buttons[0][0], null)
  assert.deepEqual(patch.buttons[0][1], { label: 'Shop', url: 'tg://user?id=7' })

  const onlyInvalid = new ButtonRowEl('sp-btn-row')
  onlyInvalid.setAttribute('data-flat-index', '0')
  const onlyList = new ButtonRowEl('sp-btn-list')
  onlyList.id = 'panelButtonsBody'
  onlyList.appendChild(onlyInvalid)
  const readOnly = new Function(
    'document',
    "'use strict'\n" +
      extractFunction(js, 'flattenButtons') + '\n' +
      extractFunction(js, 'readPanelPatch') + '\n' +
      'return readPanelPatch\n'
  )({
    getElementById(id) {
      return id === 'panelButtonsBody' ? onlyList : null
    },
  })
  const stringNode = { kind: 'action', buttons: [['nope']] }
  assert.deepEqual(readOnly(stringNode).buttons, [['nope']])
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

test('tg:// button urls are accepted and unsafe or non-telegram schemes are rejected', () => {
  const accepted = [
    'tg://user?id=42',
    'tg://resolve?domain=shop',
    'TG://msg?text=hi',
    '  https://t.me/shop  ',
    'http://example.com/path',
  ]
  for (const url of accepted) {
    const d = structuredClone(baseDraft)
    d.nodes[0].media_url = 'AgACAgIAAxkBAAIB'
    d.nodes[0].buttons = [[{ label: 'Open', url }]]
    const r = collectDraftIssues(d, { allowedActions: DEFAULT_FLOW_ACTIONS })
    assert.equal(r.errors.some((e) => e.code === 'url_scheme'), false, url)
    assert.equal(r.errors.some((e) => e.code === 'media_url'), false, url)
    assert.equal(saveBlocked(r), false, url + ' ' + r.errors.map((e) => e.message).join('; '))
    const v = validateDraft(d, { allowedActions: DEFAULT_FLOW_ACTIONS })
    assert.equal(v.ok, true, url + ' ' + v.errors.join('; '))
  }

  const rejected = [
    'javascript:alert(1)',
    'JAVASCRIPT:alert(1)',
    '  javascript:alert(1)',
    'data:text/html,hi',
    'ftp://files.example',
    'tg:',
    'tg://',
    'example.com',
  ]
  for (const url of rejected) {
    const d = structuredClone(baseDraft)
    d.nodes[0].buttons = [[{ label: 'Open', url }]]
    const r = collectDraftIssues(d)
    const issue = r.errors.find((e) => e.code === 'url_scheme')
    assert.ok(issue, url)
    assert.equal(issue.field, 'url')
    assert.match(issue.message, /url must be http\(s\) or tg:\/\//)
    const v = validateDraft(d)
    assert.equal(v.ok, false, url)
    assert.ok(v.errors.some((e) => /url must be http\(s\) or tg:\/\//.test(e)), url)
  }
})

test('telegram file ids and local paths are accepted media_url values', () => {
  for (const mediaUrl of ['AgACAgIAAxkBAAIB', './logo.jpg', '/var/bot/banner.png']) {
    const d = structuredClone(baseDraft)
    d.nodes[0].media_url = mediaUrl
    const r = collectDraftIssues(d, { allowedActions: DEFAULT_FLOW_ACTIONS })
    assert.equal(
      r.errors.some((e) => e.field === 'media_url' || e.code === 'media_url'),
      false,
      mediaUrl
    )
    assert.equal(saveBlocked(r), false, mediaUrl + ' ' + r.errors.map((e) => e.message).join('; '))
  }
})

test('button url validation still requires http(s) when media_url is a file id', () => {
  const d = structuredClone(baseDraft)
  d.nodes[0].media_url = 'AgACAgIAAxkBAAIB'
  d.nodes[0].buttons = [[{ label: 'Site', url: 'ftp://files.example' }]]
  const r = collectDraftIssues(d)
  assert.equal(r.errors.some((e) => e.code === 'media_url'), false)
  assert.ok(r.errors.some((e) => e.code === 'url_scheme'))
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

function extractFunction(source, name) {
  const start = source.indexOf('function ' + name + '(')
  if (start < 0) throw new Error('missing function ' + name)
  const open = source.indexOf('{', start)
  return source.slice(start, endOfBalanced(source, open))
}

class ButtonRowEl {
  constructor(className) {
    this.id = ''
    this.textContent = ''
    this.parentElement = null
    this.children = []
    this.attrs = {}
    this._classes = new Set()
    const classes = this._classes
    this.classList = {
      add(name) { classes.add(name) },
      remove(name) { classes.delete(name) },
      contains(name) { return classes.has(name) },
    }
    if (className) this.className = className
  }

  get className() {
    return Array.from(this._classes).join(' ')
  }

  set className(value) {
    this._classes.clear()
    String(value || '').split(/\s+/).filter(Boolean).forEach((name) => this._classes.add(name))
  }

  appendChild(child) {
    child.parentElement = this
    this.children.push(child)
    return child
  }

  remove() {
    const parent = this.parentElement
    if (!parent) return
    const idx = parent.children.indexOf(this)
    if (idx >= 0) parent.children.splice(idx, 1)
    this.parentElement = null
  }

  setAttribute(name, value) {
    this.attrs[name] = String(value)
  }

  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null
  }

  removeAttribute(name) {
    delete this.attrs[name]
  }

  matches(selector) {
    const cls = /^\.([A-Za-z0-9_-]+)/.exec(selector)
    if (!cls || !this.classList.contains(cls[1])) return false
    const attrRe = /\[([A-Za-z0-9_-]+)="([^"]*)"\]/g
    let match
    while ((match = attrRe.exec(selector))) {
      if (this.getAttribute(match[1]) !== match[2]) return false
    }
    return true
  }

  querySelectorAll(selector) {
    const found = []
    const walk = (el) => {
      for (const child of el.children) {
        if (child.matches(selector)) found.push(child)
        walk(child)
      }
    }
    walk(this)
    return found
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null
  }
}

function buttonControl(className, describedBy) {
  const el = new ButtonRowEl(className)
  if (describedBy) el.setAttribute('aria-describedby', describedBy)
  return el
}

function buttonRowDom() {
  const panel = new ButtonRowEl('flow-panel')
  panel.id = 'flowPanel'
  const row0Label = buttonControl('btn-label', 'label-hint')
  const row0Mode = buttonControl('btn-mode', 'mode-hint')
  const row0Target = buttonControl('btn-target')
  const row1Label = buttonControl('btn-label', 'row1-label-hint')
  const row1Mode = buttonControl('btn-mode')
  const row1Target = buttonControl('btn-target', 'target-hint extra')
  const row0 = new ButtonRowEl('sp-btn-row')
  row0.setAttribute('data-flat-index', '0')
  row0.appendChild(row0Label)
  row0.appendChild(row0Mode)
  row0.appendChild(row0Target)
  const row1 = new ButtonRowEl('sp-btn-row')
  row1.setAttribute('data-flat-index', '1')
  row1.appendChild(row1Label)
  row1.appendChild(row1Mode)
  row1.appendChild(row1Target)
  panel.appendChild(row0)
  panel.appendChild(row1)
  const document = {
    getElementById(id) {
      return id === 'flowPanel' ? panel : null
    },
    createElement() {
      return new ButtonRowEl()
    },
  }
  const state = { selectedKey: 'welcome' }
  const js = fs.readFileSync(jsFile, 'utf8')
  const applyPanelFieldErrors = new Function(
    'document',
    'state',
    "'use strict'\n" +
      extractFunction(js, 'insertFieldError') + '\n' +
      extractFunction(js, 'applyPanelFieldErrors') + '\n' +
      'return applyPanelFieldErrors\n'
  )(document, state)
  return {
    applyPanelFieldErrors,
    panel,
    row0,
    row1,
    row0Label,
    row0Mode,
    row0Target,
    row1Label,
    row1Mode,
    row1Target,
  }
}

function buttonRowErrors() {
  return {
    errors: [
      { nodeKey: 'welcome', field: 'label', buttonIndex: 0, message: 'welcome: button 1 needs a label' },
      { nodeKey: 'welcome', field: 'go', buttonIndex: 0, message: 'welcome: button Go has an empty go target' },
      { nodeKey: 'welcome', field: 'url', buttonIndex: 0, message: 'welcome: url must be http(s): nope' },
      { nodeKey: 'welcome', field: 'mode', buttonIndex: 1, message: 'welcome: button Next needs exactly one mode' },
      { nodeKey: 'other', field: 'label', buttonIndex: 0, message: 'other: button 1 needs a label' },
      { nodeKey: 'welcome', field: 'label', buttonIndex: 9, message: 'welcome: missing row' },
    ],
  }
}

test('button-row errors point aria-describedby at the matching control without replacing an existing description', () => {
  const dom = buttonRowDom()
  dom.applyPanelFieldErrors(buttonRowErrors())
  dom.applyPanelFieldErrors(buttonRowErrors())

  const row0Error = dom.row0.querySelector('.field-error')
  const row1Error = dom.row1.querySelector('.field-error')
  assert.ok(row0Error)
  assert.equal(row0Error.id, 'btn-row-0-error')
  assert.equal(
    row0Error.textContent,
    'welcome: button 1 needs a label; welcome: button Go has an empty go target; welcome: url must be http(s): nope'
  )
  assert.equal(dom.panel.querySelectorAll('.field-error').length, 2)
  assert.equal(dom.row0Label.getAttribute('aria-invalid'), 'true')
  assert.equal(dom.row0Label.getAttribute('aria-describedby'), 'label-hint btn-row-0-error')
  assert.equal(dom.row0Label.classList.contains('is-invalid'), true)
  assert.equal(dom.row0Target.getAttribute('aria-invalid'), 'true')
  assert.equal(dom.row0Target.getAttribute('aria-describedby'), 'btn-row-0-error')
  assert.equal(dom.row0Mode.getAttribute('aria-invalid'), null)
  assert.equal(dom.row0Mode.getAttribute('aria-describedby'), 'mode-hint')
  assert.equal(dom.row0.classList.contains('is-invalid'), true)

  assert.ok(row1Error)
  assert.equal(row1Error.id, 'btn-row-1-error')
  assert.equal(row1Error.textContent, 'welcome: button Next needs exactly one mode')
  assert.equal(dom.row1Mode.getAttribute('aria-invalid'), 'true')
  assert.equal(dom.row1Mode.getAttribute('aria-describedby'), 'btn-row-1-error')
  assert.equal(dom.row1Label.getAttribute('aria-invalid'), null)
  assert.equal(dom.row1Label.getAttribute('aria-describedby'), 'row1-label-hint')
  assert.equal(dom.row1Target.getAttribute('aria-invalid'), null)
  assert.equal(dom.row1Target.getAttribute('aria-describedby'), 'target-hint extra')
})

test('clearing button-row highlights removes the error association and keeps the previous aria-describedby', () => {
  const dom = buttonRowDom()
  dom.applyPanelFieldErrors(buttonRowErrors())
  dom.applyPanelFieldErrors({ errors: [] })

  assert.equal(dom.panel.querySelectorAll('.field-error').length, 0)
  assert.equal(dom.panel.querySelectorAll('.is-invalid').length, 0)
  assert.equal(dom.row0Label.getAttribute('aria-invalid'), null)
  assert.equal(dom.row0Label.getAttribute('aria-describedby'), 'label-hint')
  assert.equal(dom.row0Target.getAttribute('aria-invalid'), null)
  assert.equal(dom.row0Target.getAttribute('aria-describedby'), null)
  assert.equal(dom.row0Mode.getAttribute('aria-describedby'), 'mode-hint')
  assert.equal(dom.row1Mode.getAttribute('aria-invalid'), null)
  assert.equal(dom.row1Mode.getAttribute('aria-describedby'), null)
  assert.equal(dom.row1Label.getAttribute('aria-describedby'), 'row1-label-hint')
  assert.equal(dom.row1Target.getAttribute('aria-describedby'), 'target-hint extra')

  dom.applyPanelFieldErrors(buttonRowErrors())
  dom.applyPanelFieldErrors(null)
  assert.equal(dom.panel.querySelectorAll('.field-error').length, 0)
  assert.equal(dom.row0Label.getAttribute('aria-invalid'), null)
  assert.equal(dom.row0Label.getAttribute('aria-describedby'), 'label-hint')
  assert.equal(dom.row0Target.getAttribute('aria-describedby'), null)
  assert.equal(dom.row1Mode.getAttribute('aria-describedby'), null)
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

function extractFunction(source, name) {
  const marker = 'function ' + name + '('
  const start = source.indexOf(marker)
  if (start < 0) throw new Error('missing function ' + name)
  const open = source.indexOf('{', start)
  return source.slice(start, endOfBalanced(source, open))
}

function focusHarness(selectedKey) {
  const calls = []
  const state = { selectedKey }
  const focusValidationIssue = new Function('state', 'calls', [
    'function syncPanelIntoDraft() { calls.push("sync") }',
    'function selectNodeByKey(key) { calls.push("select:" + key) }',
    'function centerOnNode(key) { calls.push("center:" + key) }',
    'function closeValidationList() { calls.push("close") }',
    extractFunction(fs.readFileSync(jsFile, 'utf8'), 'focusValidationIssue'),
    'return focusValidationIssue',
  ].join('\n'))(state, calls)
  return { calls, focusValidationIssue }
}

test('focusValidationIssue syncs inspector edits before selecting a different node', () => {
  const { calls, focusValidationIssue } = focusHarness('welcome')
  focusValidationIssue({ nodeKey: 'product_list' })
  assert.deepEqual(calls, ['sync', 'select:product_list', 'center:product_list', 'close'])
})

test('focusValidationIssue skips selectNodeByKey when the issue node is already selected', () => {
  const { calls, focusValidationIssue } = focusHarness('welcome')
  focusValidationIssue({ nodeKey: 'welcome' })
  assert.deepEqual(calls, ['center:welcome', 'close'])
})

test('focusValidationIssue still closes the list when the issue has no node', () => {
  const { calls, focusValidationIssue } = focusHarness('welcome')
  focusValidationIssue({ message: 'entry_key required' })
  focusValidationIssue(null)
  assert.deepEqual(calls, ['close', 'close'])
})
