const test = require('node:test')
const assert = require('node:assert/strict')
const {
  HISTORY_LIMIT,
  cloneDraft,
  draftsEqual,
  createEditorState,
  effectiveEntryKey,
  shouldIgnoreShortcut,
  shortcutFromEvent,
} = require('../public/js/flow-builder/state')
const {
  addNode,
  deleteNode,
  deleteNodes,
  moveNode,
  applyWire,
  clearWire,
  patchNode,
  inboundGoCount,
  defaultMessageButtons,
  diffStringMap,
} = require('../public/js/flow-builder/commands')

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
      pos_x: 100,
      pos_y: 0,
      buttons: [],
      description: '',
    },
    {
      key: 'saldo_menu',
      kind: 'screen',
      screen_key: 'screen.saldo_menu',
      action: null,
      body: 'Saldo',
      pos_x: 100,
      pos_y: 100,
      buttons: [[{ label: 'Back', go: 'welcome' }]],
      description: '',
    },
  ],
}

function sessionFrom(draft, options) {
  const state = createEditorState(options)
  state.replaceDraft(draft)
  return state
}

function target(tagName, extra) {
  return Object.assign({ tagName, isContentEditable: false }, extra)
}

test('HISTORY_LIMIT is 50', () => {
  assert.equal(HISTORY_LIMIT, 50)
})

test('cloneDraft is a deep copy', () => {
  const copy = cloneDraft(baseDraft)
  assert.deepEqual(copy, baseDraft)
  copy.nodes[0].body = 'changed'
  copy.nodes[0].buttons[0][0].go = 'elsewhere'
  assert.equal(baseDraft.nodes[0].body, 'Hi {{first_name}}')
  assert.equal(baseDraft.nodes[0].buttons[0][0].go, 'product_list')
})

test('add, delete, move, connect, disconnect and Apply undo/redo match prior draft JSON', () => {
  const state = sessionFrom(baseDraft)
  const original = cloneDraft(baseDraft)

  const added = {
    key: 'screen.custom_1',
    kind: 'screen',
    screen_key: 'screen.custom_1',
    body: 'Custom',
    pos_x: 40,
    pos_y: 40,
    media_url: null,
    media_type: 'photo',
    buttons: [[{ label: 'Menu', go: 'welcome' }]],
    description: '',
  }

  const afterAdd = state.applyCommand((draft) => addNode(draft, added))
  assert.equal(afterAdd.nodes.length, 4)
  assert.equal(afterAdd.nodes.at(-1).key, 'screen.custom_1')
  assert.ok(!draftsEqual(state.getDraft(), original))

  const afterDelete = state.applyCommand((draft) => deleteNode(draft, 'screen.custom_1'))
  assert.equal(afterDelete.nodes.length, 3)
  assert.ok(!afterDelete.nodes.some((n) => n.key === 'screen.custom_1'))

  const afterMove = state.applyCommand((draft) => moveNode(draft, 'welcome', 55, 66))
  assert.equal(afterMove.nodes[0].pos_x, 55)
  assert.equal(afterMove.nodes[0].pos_y, 66)

  const afterConnect = state.applyCommand((draft) => applyWire(draft, 'welcome', 0, 'saldo_menu'))
  assert.equal(afterConnect.nodes[0].buttons[0][0].go, 'saldo_menu')
  assert.equal(afterConnect.nodes[0].buttons[0][0].callback, undefined)

  const afterDisconnect = state.applyCommand((draft) => clearWire(draft, 'welcome', 0))
  assert.equal(afterDisconnect.nodes[0].buttons[0][0].go, '')

  const afterApply = state.applyCommand((draft) => patchNode(draft, 'welcome', {
    body: 'Updated welcome',
    description: 'Applied from inspector',
    buttons: [[{ label: 'Shop', go: 'product_list' }]],
  }))
  assert.equal(afterApply.nodes[0].body, 'Updated welcome')
  assert.equal(afterApply.nodes[0].description, 'Applied from inspector')
  assert.equal(afterApply.nodes[0].buttons[0][0].label, 'Shop')

  const snapshots = [
    afterApply,
    afterDisconnect,
    afterConnect,
    afterMove,
    afterDelete,
    afterAdd,
    original,
  ]

  for (let i = 1; i < snapshots.length; i++) {
    const undone = state.undo()
    assert.ok(draftsEqual(undone, snapshots[i]), 'undo step ' + i + ' should deep-equal prior draft')
    assert.deepEqual(undone, snapshots[i])
  }

  assert.equal(state.canUndo(), false)

  for (let i = snapshots.length - 2; i >= 0; i--) {
    const redone = state.redo()
    assert.ok(draftsEqual(redone, snapshots[i]), 'redo step should restore later draft')
    assert.deepEqual(redone, snapshots[i])
  }

  assert.equal(state.canRedo(), false)
})

test('history keeps 50 steps and drops the oldest', () => {
  const state = sessionFrom(baseDraft)
  const first = cloneDraft(baseDraft)

  for (let i = 1; i <= HISTORY_LIMIT + 1; i++) {
    state.applyCommand((draft) => moveNode(draft, 'welcome', i, 0))
  }

  assert.equal(state.getDraft().nodes[0].pos_x, HISTORY_LIMIT + 1)

  for (let i = 0; i < HISTORY_LIMIT; i++) {
    state.undo()
  }

  assert.equal(state.canUndo(), false)
  assert.equal(state.getDraft().nodes[0].pos_x, 1)
  assert.ok(!draftsEqual(state.getDraft(), first), 'the 51st-oldest snapshot is discarded')
})

test('a new action clears the redo stack', () => {
  const state = sessionFrom(baseDraft)
  state.applyCommand((draft) => moveNode(draft, 'welcome', 10, 20))
  state.applyCommand((draft) => moveNode(draft, 'welcome', 30, 40))
  state.undo()
  assert.equal(state.canRedo(), true)
  assert.equal(state.getDraft().nodes[0].pos_x, 10)

  state.applyCommand((draft) => moveNode(draft, 'welcome', 99, 99))
  assert.equal(state.canRedo(), false)
  assert.equal(state.redo(), state.getDraft())
  assert.equal(state.getDraft().nodes[0].pos_x, 99)
})

test('no-op applyCommand does not push history', () => {
  const state = sessionFrom(baseDraft)
  const before = cloneDraft(state.getDraft())
  state.applyCommand((draft) => draft)
  assert.equal(state.canUndo(), false)
  assert.deepEqual(state.getDraft(), before)
})

test('deleteNode removes inbound go buttons, drops empty rows, and undo restores them', () => {
  const draft = structuredClone(baseDraft)
  draft.nodes[0].buttons = [
    [{ label: 'Shop', go: 'product_list' }, { label: 'Saldo', go: 'saldo_menu' }],
    [{ label: 'Also shop', go: 'product_list' }],
  ]
  const state = sessionFrom(draft)
  assert.equal(inboundGoCount(state.getDraft(), 'product_list'), 2)

  const after = state.applyCommand((d) => deleteNode(d, 'product_list'))
  const welcome = after.nodes.find((n) => n.key === 'welcome')
  assert.deepEqual(welcome.buttons, [[{ label: 'Saldo', go: 'saldo_menu' }]])
  assert.ok(!after.nodes.some((n) => n.key === 'product_list'))
  assert.equal(inboundGoCount(after, 'product_list'), 0)

  state.undo()
  const restored = state.getDraft().nodes.find((n) => n.key === 'welcome')
  assert.equal(restored.buttons[0][0].go, 'product_list')
  assert.equal(restored.buttons[0][1].go, 'saldo_menu')
  assert.equal(restored.buttons[1][0].go, 'product_list')
  assert.ok(state.getDraft().nodes.some((n) => n.key === 'product_list'))
})

test('deleteNode does not leave empty go targets', () => {
  const state = sessionFrom(baseDraft)
  const after = state.applyCommand((draft) => deleteNode(draft, 'product_list'))
  const welcome = after.nodes.find((n) => n.key === 'welcome')
  assert.deepEqual(welcome.buttons, [])
  const dangling = []
  for (const node of after.nodes) {
    for (const row of node.buttons || []) {
      for (const btn of row || []) {
        if (btn.go === '') dangling.push(node.key)
      }
    }
  }
  assert.deepEqual(dangling, [])
})

test('deleteNodes strips inbound buttons for every key as one undo step', () => {
  const draft = structuredClone(baseDraft)
  draft.nodes[0].buttons = [
    [{ label: 'Shop', go: 'product_list' }, { label: 'Saldo', go: 'saldo_menu' }],
    [{ label: 'Also shop', go: 'product_list' }],
  ]
  draft.nodes.push({
    key: 'extra',
    kind: 'screen',
    body: 'Extra',
    pos_x: 200,
    pos_y: 0,
    buttons: [[{ label: 'Both', go: 'product_list' }, { label: 'Home', go: 'welcome' }]],
  })
  const state = sessionFrom(draft)
  assert.equal(inboundGoCount(state.getDraft(), ['product_list', 'saldo_menu']), 4)

  const after = state.applyCommand((d) => deleteNodes(d, ['product_list', 'saldo_menu']))
  assert.ok(!after.nodes.some((n) => n.key === 'product_list' || n.key === 'saldo_menu'))
  const welcome = after.nodes.find((n) => n.key === 'welcome')
  const extra = after.nodes.find((n) => n.key === 'extra')
  assert.deepEqual(welcome.buttons, [])
  assert.deepEqual(extra.buttons, [[{ label: 'Home', go: 'welcome' }]])
  assert.equal(inboundGoCount(after, ['product_list', 'saldo_menu']), 0)

  state.undo()
  assert.deepEqual(state.getDraft(), draft)
})

test('defaultMessageButtons targets the current entry, or none', () => {
  assert.deepEqual(defaultMessageButtons('welcome'), [[{ label: 'Menu', go: 'welcome' }]])
  assert.deepEqual(defaultMessageButtons('screen.home'), [[{ label: 'Menu', go: 'screen.home' }]])
  assert.deepEqual(defaultMessageButtons(null), [])
  assert.deepEqual(defaultMessageButtons(''), [])
  assert.deepEqual(defaultMessageButtons(undefined), [])
})

test('diffStringMap posts only keys whose values changed', () => {
  const original = { 'btn.ok': 'OK', 'err.x': 'Nope', 'msg.hi': 'Hi' }
  const current = { 'btn.ok': 'OK', 'err.x': 'Changed', 'msg.hi': 'Hi' }
  assert.deepEqual(diffStringMap(original, current), { 'err.x': 'Changed' })
  assert.deepEqual(diffStringMap(original, original), {})
  assert.deepEqual(diffStringMap(original, { 'btn.ok': 'OK', 'err.x': 'Nope', 'msg.hi': 'Hi', 'new.key': 'N' }), {
    'new.key': 'N',
  })
})

test('replaceDraft loads a session without undo history', () => {
  const state = sessionFrom(baseDraft)
  state.applyCommand((draft) => moveNode(draft, 'welcome', 1, 1))
  state.replaceDraft(baseDraft)
  assert.equal(state.canUndo(), false)
  assert.equal(state.canRedo(), false)
  assert.deepEqual(state.getDraft(), baseDraft)
})

test('undo history is per session', () => {
  const a = sessionFrom(baseDraft)
  const b = sessionFrom(baseDraft)
  a.applyCommand((draft) => moveNode(draft, 'welcome', 8, 8))
  assert.equal(a.canUndo(), true)
  assert.equal(b.canUndo(), false)
})

test('shortcutFromEvent maps undo/redo combos and ignores typing', () => {
  assert.equal(shortcutFromEvent({ ctrlKey: true, key: 'z', target: target('BODY') }), 'undo')
  assert.equal(shortcutFromEvent({ metaKey: true, key: 'z', target: target('DIV') }), 'undo')
  assert.equal(shortcutFromEvent({ ctrlKey: true, shiftKey: true, key: 'Z', target: target('BODY') }), 'redo')
  assert.equal(shortcutFromEvent({ metaKey: true, shiftKey: true, key: 'z', target: target('BODY') }), 'redo')
  assert.equal(shortcutFromEvent({ ctrlKey: true, key: 'y', target: target('BODY') }), 'redo')
  assert.equal(shortcutFromEvent({ key: 'z', target: target('BODY') }), null)
  assert.equal(shortcutFromEvent({ ctrlKey: true, key: 'z', target: target('TEXTAREA') }), null)
  assert.equal(shortcutFromEvent({ ctrlKey: true, key: 'z', target: target('INPUT', { type: 'text' }) }), null)
  assert.equal(shortcutFromEvent({ ctrlKey: true, key: 'z', target: target('DIV', { isContentEditable: true }) }), null)
  assert.equal(shortcutFromEvent({ ctrlKey: true, key: 'z', target: target('INPUT', { type: 'checkbox' }) }), 'undo')
  assert.equal(shortcutFromEvent({ ctrlKey: true, key: 'c', target: target('BODY') }), 'copy')
  assert.equal(shortcutFromEvent({ metaKey: true, key: 'v', target: target('BODY') }), 'paste')
  assert.equal(shortcutFromEvent({ ctrlKey: true, key: 'd', target: target('BODY') }), 'duplicate')
  assert.equal(shortcutFromEvent({ key: 'Delete', target: target('BODY') }), 'delete')
  assert.equal(shortcutFromEvent({ key: 'Backspace', target: target('BODY') }), 'delete')
  assert.equal(shortcutFromEvent({ key: 'Backspace', target: target('INPUT', { type: 'text' }) }), null)
  assert.equal(shortcutFromEvent({ ctrlKey: true, key: 'c', target: target('TEXTAREA') }), null)
})

test('shouldIgnoreShortcut treats select as a field', () => {
  assert.equal(shouldIgnoreShortcut(target('SELECT')), true)
  assert.equal(shouldIgnoreShortcut(target('BUTTON')), false)
})

test('effectiveEntryKey returns the configured key when it matches a node', () => {
  assert.equal(effectiveEntryKey(baseDraft), 'welcome')
  assert.equal(effectiveEntryKey({
    entry_key: 'product_list',
    nodes: baseDraft.nodes,
  }), 'product_list')
})

test('effectiveEntryKey falls back to the first node when entry_key is missing from nodes', () => {
  assert.equal(effectiveEntryKey({
    entry_key: 'welcome',
    nodes: [{ key: 'screen.custom_1' }, { key: 'action.custom_1' }],
  }), 'screen.custom_1')
})

test('effectiveEntryKey returns null when there are no nodes', () => {
  assert.equal(effectiveEntryKey(null), null)
  assert.equal(effectiveEntryKey(undefined), null)
  assert.equal(effectiveEntryKey({ entry_key: 'welcome', nodes: [] }), null)
})

test('effectiveEntryKey treats a missing entry_key as welcome, then the first node', () => {
  assert.equal(effectiveEntryKey({ nodes: [{ key: 'welcome' }, { key: 'other' }] }), 'welcome')
  assert.equal(effectiveEntryKey({ nodes: [{ key: 'screen.custom_1' }] }), 'screen.custom_1')
})

test('addNode persists entry_key when adding the first node', () => {
  const empty = { entry_key: 'welcome', nodes: [] }
  const next = addNode(empty, { key: 'screen.custom_1', kind: 'screen', body: 'Hi' })
  assert.equal(next.entry_key, 'screen.custom_1')
  assert.equal(empty.entry_key, 'welcome')
})

test('addNode replaces an invalid entry_key with the added node', () => {
  const draft = { entry_key: 'welcome', nodes: [{ key: 'existing' }] }
  const next = addNode(draft, { key: 'screen.custom_2', kind: 'screen' })
  assert.equal(next.entry_key, 'screen.custom_2')
})

test('addNode keeps a valid entry_key', () => {
  const next = addNode(baseDraft, { key: 'screen.custom_1', kind: 'screen' })
  assert.equal(next.entry_key, 'welcome')
})

test('undo of first-node add restores the previous entry_key', () => {
  const state = sessionFrom({ entry_key: 'welcome', nodes: [] })
  state.applyCommand((draft) => addNode(draft, { key: 'screen.custom_1', kind: 'screen' }))
  assert.equal(state.getDraft().entry_key, 'screen.custom_1')
  state.undo()
  assert.equal(state.getDraft().entry_key, 'welcome')
  assert.equal(state.getDraft().nodes.length, 0)
})
