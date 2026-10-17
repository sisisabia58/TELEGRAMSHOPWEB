const test = require('node:test')
const assert = require('node:assert/strict')
const {
  HISTORY_LIMIT,
  cloneDraft,
  draftsEqual,
  createEditorState,
  shouldIgnoreShortcut,
  shortcutFromEvent,
} = require('../public/js/flow-builder/state')
const {
  addNode,
  deleteNode,
  moveNode,
  applyWire,
  clearWire,
  patchNode,
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

test('deleteNode clears inbound go wires', () => {
  const state = sessionFrom(baseDraft)
  state.applyCommand((draft) => deleteNode(draft, 'product_list'))
  const welcome = state.getDraft().nodes.find((n) => n.key === 'welcome')
  assert.equal(welcome.buttons[0][0].go, '')
  state.undo()
  assert.equal(state.getDraft().nodes.find((n) => n.key === 'welcome').buttons[0][0].go, 'product_list')
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
})

test('shouldIgnoreShortcut treats select as a field', () => {
  assert.equal(shouldIgnoreShortcut(target('SELECT')), true)
  assert.equal(shouldIgnoreShortcut(target('BUTTON')), false)
})
