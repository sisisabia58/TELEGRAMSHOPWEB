const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ejs = require('ejs')
const {
  PASTE_OFFSET,
  generateCopyNodeKey,
  snapshotNodes,
  duplicateNodes,
  pasteNodes,
  createClipboard,
  entryDeleteMessage,
  toolbarPosition,
} = require('../public/js/flow-builder/clipboard')
const {
  cloneDraft,
  draftsEqual,
  createEditorState,
  effectiveEntryKey,
  shortcutFromEvent,
  shouldIgnoreShortcut,
  shouldHandleShortcut,
  isModalOrDialogActive,
  resolveShortcut,
} = require('../public/js/flow-builder/state')
const { deleteNode } = require('../public/js/flow-builder/commands')

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
      pos_x: 10,
      pos_y: 20,
      media_url: 'https://example.com/doc.pdf',
      media_type: 'document',
      buttons: [[{ label: 'Shop', go: 'product_list' }]],
      description: 'Start here',
    },
    {
      key: 'product_list',
      kind: 'action',
      screen_key: null,
      action: 'product_list',
      pos_x: 100,
      pos_y: 40,
      buttons: [[{ label: 'Back', go: 'welcome' }]],
      description: 'Catalog',
    },
    {
      key: 'saldo_menu',
      kind: 'screen',
      screen_key: 'screen.saldo_menu',
      action: null,
      body: 'Saldo',
      pos_x: 200,
      pos_y: 80,
      media_url: null,
      media_type: 'photo',
      buttons: [
        [{ label: 'Pay', go: 'product_list' }, { label: 'Home', go: 'welcome' }],
      ],
      description: '',
    },
  ],
}

function sessionFrom(draft) {
  const state = createEditorState()
  state.replaceDraft(draft)
  return state
}

function target(tagName, extra) {
  return Object.assign({ tagName, isContentEditable: false }, extra)
}

test('generateCopyNodeKey uses <key>_copy then _copy2 (M5)', () => {
  assert.equal(generateCopyNodeKey('welcome', ['welcome']), 'welcome_copy')
  assert.equal(generateCopyNodeKey('welcome', ['welcome', 'welcome_copy']), 'welcome_copy2')
  assert.equal(
    generateCopyNodeKey('welcome', ['welcome', 'welcome_copy', 'welcome_copy2']),
    'welcome_copy3'
  )
  assert.equal(generateCopyNodeKey('screen.custom_1', ['screen.custom_1']), 'screen.custom_1_copy')
})

test('duplicate creates a unique key, the same content, and a +40px offset (M5)', () => {
  const next = duplicateNodes(baseDraft, ['saldo_menu'])
  const original = baseDraft.nodes.find((n) => n.key === 'saldo_menu')
  const copy = next.nodes.find((n) => n.key === 'saldo_menu_copy')

  assert.ok(copy, 'duplicated node should exist')
  assert.equal(next.nodes.length, 4)
  assert.equal(copy.kind, original.kind)
  assert.equal(copy.body, original.body)
  assert.equal(copy.media_type, original.media_type)
  assert.equal(copy.description, original.description)
  assert.equal(copy.pos_x, original.pos_x + PASTE_OFFSET)
  assert.equal(copy.pos_y, original.pos_y + PASTE_OFFSET)
  assert.equal(copy.screen_key, 'screen.saldo_menu_copy')
  assert.equal(next.entry_key, 'welcome')
  assert.equal(baseDraft.nodes.length, 3, 'original draft is not mutated')
})

test('duplicate drops outbound go wires and remaps wires inside the selection', () => {
  const next = duplicateNodes(baseDraft, ['saldo_menu', 'product_list'])
  const saldoCopy = next.nodes.find((n) => n.key === 'saldo_menu_copy')
  const productCopy = next.nodes.find((n) => n.key === 'product_list_copy')

  assert.equal(saldoCopy.buttons[0][0].go, 'product_list_copy')
  assert.equal(saldoCopy.buttons[0][1].go, '', 'link to welcome is outside the selection')
  assert.equal(productCopy.buttons[0][0].go, '', 'link to welcome is outside the selection')
})

test('duplicate of a single node is one undoable applyCommand step', () => {
  const state = sessionFrom(baseDraft)
  const before = cloneDraft(baseDraft)

  const after = state.applyCommand((draft) => duplicateNodes(draft, ['saldo_menu']))
  assert.equal(after.nodes.length, 4)
  assert.ok(after.nodes.some((n) => n.key === 'saldo_menu_copy'))
  assert.equal(state.canUndo(), true)

  const undone = state.undo()
  assert.ok(draftsEqual(undone, before))
  assert.deepEqual(undone, before)

  const redone = state.redo()
  assert.ok(redone.nodes.some((n) => n.key === 'saldo_menu_copy'))
  assert.equal(redone.nodes.find((n) => n.key === 'saldo_menu_copy').pos_x, 240)
})

test('paste without origin uses a +40px offset; paste at cursor uses origin', () => {
  const clip = snapshotNodes(baseDraft, ['product_list'])
  const offsetPaste = pasteNodes(baseDraft, clip)
  const pasted = offsetPaste.nodes.find((n) => n.key === 'product_list_copy')
  assert.equal(pasted.pos_x, 140)
  assert.equal(pasted.pos_y, 80)

  const atCursor = pasteNodes(baseDraft, clip, { origin: { x: 55, y: 66 } })
  const cursorNode = atCursor.nodes.find((n) => n.key === 'product_list_copy')
  assert.equal(cursorNode.pos_x, 55)
  assert.equal(cursorNode.pos_y, 66)
})

test('paste of several nodes keeps relative layout and internal wires', () => {
  const clip = snapshotNodes(baseDraft, ['saldo_menu', 'product_list'])
  const next = pasteNodes(baseDraft, clip, { origin: { x: 300, y: 400 } })
  const saldo = next.nodes.find((n) => n.key === 'saldo_menu_copy')
  const product = next.nodes.find((n) => n.key === 'product_list_copy')

  assert.equal(saldo.pos_x, 300)
  assert.equal(saldo.pos_y, 400)
  assert.equal(product.pos_x, 200)
  assert.equal(product.pos_y, 360)
  assert.equal(saldo.buttons[0][0].go, 'product_list_copy')
  assert.equal(saldo.buttons[0][1].go, '')
})

test('second paste of the same clipboard allocates the next unique key', () => {
  const clip = snapshotNodes(baseDraft, ['welcome'])
  const once = pasteNodes(baseDraft, clip)
  const twice = pasteNodes(once, clip)
  const keys = twice.nodes.map((n) => n.key)
  assert.ok(keys.includes('welcome_copy'))
  assert.ok(keys.includes('welcome_copy2'))
  assert.equal(twice.nodes.filter((n) => n.screen_key === 'screen.welcome_copy').length, 1)
  assert.equal(twice.nodes.filter((n) => n.screen_key === 'screen.welcome_copy2').length, 1)
})

test('paste of several nodes is a single undoable applyCommand step', () => {
  const state = sessionFrom(baseDraft)
  const before = cloneDraft(baseDraft)
  const clip = snapshotNodes(baseDraft, ['saldo_menu', 'product_list'])

  state.applyCommand((draft) => pasteNodes(draft, clip))
  assert.equal(state.getDraft().nodes.length, 5)
  assert.deepEqual(state.undo(), before)
})

test('in-memory clipboard copy does not mutate the draft', () => {
  const clipboard = createClipboard()
  const copied = clipboard.copy(snapshotNodes(baseDraft, ['welcome']))
  copied[0].body = 'changed'
  assert.equal(clipboard.peek()[0].body, 'Hi {{first_name}}')
  assert.equal(baseDraft.nodes[0].body, 'Hi {{first_name}}')
  assert.equal(clipboard.isEmpty(), false)
  clipboard.clear()
  assert.equal(clipboard.isEmpty(), true)
})

test('delete of a non-start node is one undoable step and removes inbound buttons', () => {
  const state = sessionFrom(baseDraft)
  const before = cloneDraft(baseDraft)
  state.applyCommand((draft) => deleteNode(draft, 'product_list'))
  assert.equal(state.getDraft().nodes.some((n) => n.key === 'product_list'), false)
  assert.deepEqual(state.getDraft().nodes.find((n) => n.key === 'welcome').buttons, [])
  assert.deepEqual(state.undo(), before)
})

test('Delete on the Start node is refused with a message (M5)', () => {
  assert.equal(effectiveEntryKey(baseDraft), 'welcome')
  assert.match(entryDeleteMessage('welcome'), /Cannot delete the entry node \("welcome"\)/)
  assert.equal(entryDeleteMessage('welcome'), 'Cannot delete the entry node ("welcome"). Change the entry node before deleting.')
})

test('shortcutFromEvent maps copy, paste, duplicate, and delete, and ignores typing (M5)', () => {
  assert.equal(shortcutFromEvent({ ctrlKey: true, key: 'c', target: target('BODY') }), 'copy')
  assert.equal(shortcutFromEvent({ metaKey: true, key: 'v', target: target('DIV') }), 'paste')
  assert.equal(shortcutFromEvent({ ctrlKey: true, key: 'd', target: target('BODY') }), 'duplicate')
  assert.equal(shortcutFromEvent({ key: 'Delete', target: target('BODY') }), 'delete')
  assert.equal(shortcutFromEvent({ key: 'Backspace', target: target('BODY') }), 'delete')

  assert.equal(shortcutFromEvent({ ctrlKey: true, key: 'c', target: target('INPUT', { type: 'text' }) }), null)
  assert.equal(shortcutFromEvent({ ctrlKey: true, key: 'v', target: target('TEXTAREA') }), null)
  assert.equal(shortcutFromEvent({ ctrlKey: true, key: 'd', target: target('INPUT', { type: 'text' }) }), null)
  assert.equal(shortcutFromEvent({ key: 'Backspace', target: target('INPUT', { type: 'text' }) }), null)
  assert.equal(shortcutFromEvent({ key: 'Delete', target: target('TEXTAREA') }), null)
  assert.equal(shortcutFromEvent({ key: 'Backspace', target: target('DIV', { isContentEditable: true }) }), null)
  assert.equal(shouldIgnoreShortcut(target('SELECT')), true)
})

function dialogEl(opts) {
  opts = opts || {}
  const hiddenClass = !!opts.hiddenClass
  const host = opts.host || null
  return {
    tagName: opts.tagName || 'DIV',
    open: opts.open,
    hidden: !!opts.hidden,
    classList: { contains: (name) => name === 'hidden' && hiddenClass },
    getAttribute: (name) => (name === 'aria-hidden' ? (opts.ariaHidden != null ? String(opts.ariaHidden) : null) : null),
    closest: function () { return host },
  }
}

test('isModalOrDialogActive is true when a dialog is open or focused (a)', () => {
  assert.equal(isModalOrDialogActive({ dialogs: [dialogEl({ hiddenClass: true })] }), false)
  assert.equal(isModalOrDialogActive({ dialogs: [dialogEl()] }), true)
  assert.equal(isModalOrDialogActive({ dialogs: [dialogEl({ tagName: 'DIALOG', open: false })] }), false)
  assert.equal(isModalOrDialogActive({ dialogs: [dialogEl({ tagName: 'DIALOG', open: true })] }), true)
  assert.equal(isModalOrDialogActive({ dialogs: [dialogEl({ ariaHidden: true })] }), false)

  const openDialog = dialogEl()
  const focusedInDialog = dialogEl({ host: openDialog })
  assert.equal(isModalOrDialogActive({ dialogs: [], target: focusedInDialog }), true)

  const closedDialog = dialogEl({ hiddenClass: true })
  const focusedInClosed = dialogEl({ host: closedDialog })
  assert.equal(isModalOrDialogActive({ dialogs: [closedDialog], target: focusedInClosed }), false)
})

test('shouldHandleShortcut skips node actions in a modal and without a selection (a)(b)', () => {
  assert.equal(shouldHandleShortcut('copy', { modalOpen: true, selectedKey: 'welcome' }), false)
  assert.equal(shouldHandleShortcut('paste', { modalOpen: true, selectedKey: 'welcome' }), false)
  assert.equal(shouldHandleShortcut('duplicate', { modalOpen: true, selectedKey: 'welcome' }), false)
  assert.equal(shouldHandleShortcut('delete', { modalOpen: true, selectedKey: 'welcome' }), false)
  assert.equal(shouldHandleShortcut('undo', { modalOpen: true, selectedKey: 'welcome' }), true)
  assert.equal(shouldHandleShortcut('redo', { modalOpen: true }), true)

  assert.equal(shouldHandleShortcut('copy', { selectedKey: null }), false)
  assert.equal(shouldHandleShortcut('duplicate', { selectedKey: '' }), false)
  assert.equal(shouldHandleShortcut('delete', {}), false)
  assert.equal(shouldHandleShortcut('paste', { selectedKey: null }), true)
  assert.equal(shouldHandleShortcut('copy', { selectedKey: 'welcome' }), true)
  assert.equal(shouldHandleShortcut(null, { selectedKey: 'welcome' }), false)
})

test('resolveShortcut does not perform node shortcuts while a modal is open (a)', () => {
  const copy = { ctrlKey: true, key: 'c', target: target('BODY') }
  const paste = { metaKey: true, key: 'v', target: target('DIV') }
  const duplicate = { ctrlKey: true, key: 'd', target: target('BODY') }
  const del = { key: 'Delete', target: target('BODY') }
  const opts = { modalOpen: true, selectedKey: 'welcome' }

  assert.equal(resolveShortcut(copy, opts), null)
  assert.equal(resolveShortcut(paste, opts), null)
  assert.equal(resolveShortcut(duplicate, opts), null)
  assert.equal(resolveShortcut(del, opts), null)
  assert.equal(resolveShortcut({ ctrlKey: true, key: 'z', target: target('BODY') }, opts), 'undo')
})

test('resolveShortcut ignores copy, duplicate, and delete when no node is selected (b)', () => {
  const none = { selectedKey: null }
  assert.equal(resolveShortcut({ ctrlKey: true, key: 'c', target: target('BODY') }, none), null)
  assert.equal(resolveShortcut({ ctrlKey: true, key: 'd', target: target('BODY') }, none), null)
  assert.equal(resolveShortcut({ key: 'Delete', target: target('BODY') }, none), null)
  assert.equal(resolveShortcut({ key: 'Backspace', target: target('BODY') }, none), null)
  assert.equal(resolveShortcut({ ctrlKey: true, key: 'v', target: target('BODY') }, none), 'paste')
  assert.equal(resolveShortcut({ ctrlKey: true, key: 'z', target: target('BODY') }, none), 'undo')
  assert.equal(resolveShortcut({ ctrlKey: true, key: 'c', target: target('BODY') }, { selectedKey: 'welcome' }), 'copy')
})

test('resolveShortcut returns null instead of a handled action when the shortcut will not run (c)', () => {
  const copyText = { ctrlKey: true, key: 'c', target: target('BODY') }
  assert.equal(resolveShortcut(copyText, { selectedKey: null }), null)
  assert.equal(resolveShortcut(copyText, { modalOpen: true, selectedKey: 'welcome' }), null)
  assert.equal(resolveShortcut({
    ctrlKey: true,
    key: 'c',
    target: target('INPUT', { type: 'text' }),
  }, { selectedKey: 'welcome' }), null)
  assert.equal(resolveShortcut(copyText, { selectedKey: 'welcome' }), 'copy')
  assert.equal(resolveShortcut({ ctrlKey: true, key: 'v', target: target('BODY') }, { selectedKey: 'welcome' }), 'paste')
})

test('toolbarPosition places the toolbar above the selected node', () => {
  const wrap = { left: 100, top: 50, width: 800, height: 600 }
  const node = { left: 300, top: 200, width: 240, height: 160 }
  const pos = toolbarPosition(node, wrap, { width: 200, height: 36 }, { gap: 8 })
  assert.equal(pos.left, 220)
  assert.equal(pos.top, 106)
})

test('Bot Flow page renders the selection toolbar (M5)', async () => {
  const html = await ejs.renderFile(viewFile, {
    title: 'Bot Flow - Test',
    namaBot: 'Test Bot',
    username: 'tester',
    req: { session: { role: 'admin' } },
    currentPage: 'settings-bot-flow',
    pageTitle: 'Bot Flow',
  }, { views: [viewRoot] })

  assert.match(html, /id="selectionToolbar"/)
  assert.match(html, /id="btnDuplicateNode"/)
  assert.match(html, /id="btnCopyNode"/)
  assert.match(html, /id="btnToolbarDeleteNode"/)
  assert.match(html, /flow-builder\/clipboard\.js/)
  assert.match(html, />Duplicate</)
  assert.match(html, />Copy</)
  assert.match(html, />Delete</)
})

test('flow-builder CSS styles the selection toolbar above the node', () => {
  const css = fs.readFileSync(cssFile, 'utf8')
  assert.match(css, /\.flow-selection-toolbar\b/)
  assert.match(css, /\.flow-selection-toolbar\[hidden\]/)
})

test('flow-builder JS wires toolbar, shortcuts, and applyCommand clipboard actions (M5)', () => {
  const js = fs.readFileSync(jsFile, 'utf8')
  assert.match(js, /FlowBuilderClipboard/)
  assert.match(js, /positionSelectionToolbar/)
  assert.match(js, /duplicateNodes/)
  assert.match(js, /pasteNodes/)
  assert.match(js, /entryDeleteMessage/)
  assert.match(js, /btnDuplicateNode/)
  assert.match(js, /btnCopyNode/)
  assert.match(js, /btnToolbarDeleteNode/)
  assert.match(js, /selectNodeByKey\([\s\S]{0,200}positionSelectionToolbar/)
  assert.match(js, /action === 'copy'/)
  assert.match(js, /action === 'paste'/)
  assert.match(js, /action === 'duplicate'/)
  assert.match(js, /action === 'delete'/)
  assert.match(js, /applyCommand\(\(draft\) => FlowBuilderClipboard/)
  assert.match(js, /requestDeleteSelectedNode/)
  assert.match(js, /inboundGoCount/)
  assert.match(js, /deleteNodes/)
})

test('flow-builder JS preventDefaults shortcuts only after resolveShortcut accepts them (a)(b)(c)', () => {
  const js = fs.readFileSync(jsFile, 'utf8')
  const match = js.match(/function bindHistoryShortcuts\(\) \{[\s\S]*?\n  \}/)
  assert.ok(match, 'bindHistoryShortcuts should exist')
  const handler = match[0]
  assert.match(handler, /FlowBuilderState\.resolveShortcut\(/)
  assert.match(handler, /isModalOrDialogActive/)
  const resolveAt = handler.indexOf('resolveShortcut')
  const guardAt = handler.search(/if\s*\(\s*!action\s*\)\s*return/)
  const preventAt = handler.indexOf('preventDefault')
  assert.ok(resolveAt !== -1 && guardAt !== -1 && preventAt !== -1)
  assert.ok(resolveAt < guardAt, 'resolveShortcut should run before the action guard')
  assert.ok(guardAt < preventAt, 'preventDefault should run only after the unhandled-action return')
})
