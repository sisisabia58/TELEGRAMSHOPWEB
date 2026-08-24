const test = require('node:test')
const assert = require('node:assert')
const {
  validateDraft,
  draftFromPublished,
  applyWire,
  publishPlan,
  diffPublishPlan,
  DEFAULT_FLOW_ACTIONS,
} = require('../lib/flow-draft')

const KEYS = ['welcome', 'product_list', 'saldo_menu']

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

test('validateDraft accepts new custom screen node key', () => {
  const d = structuredClone(baseDraft)
  d.nodes.push({
    key: 'screen.custom_1',
    kind: 'screen',
    screen_key: 'screen.custom_1',
    body: 'Custom',
    pos_x: 0,
    pos_y: 0,
    buttons: [],
    description: '',
  })
  const r = validateDraft(d, { allowedActions: DEFAULT_FLOW_ACTIONS })
  assert.equal(r.ok, true, r.errors.join('; '))
})

test('validateDraft rejects missing entry_key', () => {
  const d = structuredClone(baseDraft)
  delete d.entry_key
  const r = validateDraft(d)
  assert.equal(r.ok, false)
  assert.ok(r.errors.some((e) => e === 'entry_key required'))
})

test('validateDraft rejects entry_key not in nodes', () => {
  const d = structuredClone(baseDraft)
  d.entry_key = 'missing_node'
  const r = validateDraft(d)
  assert.equal(r.ok, false)
  assert.ok(r.errors.some((e) => /entry_key missing from nodes/.test(e)))
})

test('validateDraft rejects go target that does not exist', () => {
  const d = structuredClone(baseDraft)
  d.nodes[0].buttons = [[{ label: 'X', go: 'missing_node' }]]
  const r = validateDraft(d)
  assert.equal(r.ok, false)
  assert.ok(r.errors.some((e) => /missing_node/.test(e)))
})

test('validateDraft rejects unknown action', () => {
  const d = structuredClone(baseDraft)
  d.nodes[1].action = 'not_a_real_action'
  const r = validateDraft(d)
  assert.equal(r.ok, false)
  assert.ok(r.errors.some((e) => /action/i.test(e)))
})

test('diffPublishPlan emits nodeDeletes for removed published keys', () => {
  const d = structuredClone(baseDraft)
  d.nodes = d.nodes.filter((n) => n.key !== 'saldo_menu')
  const diff = diffPublishPlan(d, KEYS, ['screen.welcome', 'screen.saldo_menu'])
  assert.deepEqual(diff.nodeDeletes, ['saldo_menu'])
  assert.equal(diff.nodeUpserts.length, 2)
})

test('diffPublishPlan emits copyInserts for new screen_key', () => {
  const d = structuredClone(baseDraft)
  d.nodes.push({
    key: 'screen.custom_1',
    kind: 'screen',
    screen_key: 'screen.custom_1',
    body: 'Hello custom',
    pos_x: 10,
    pos_y: 10,
    buttons: [],
    description: 'Custom info screen',
  })
  const diff = diffPublishPlan(d, KEYS, ['screen.welcome', 'screen.saldo_menu'])
  assert.equal(diff.copyInserts.length, 1)
  assert.deepEqual(diff.copyInserts[0], {
    key: 'screen.custom_1',
    body: 'Hello custom',
    description: 'Custom info screen',
  })
  assert.ok(!diff.copyUpserts.some((c) => c.key === 'screen.custom_1'))
})

test('diffPublishPlan emits copyUpserts for existing screen keys', () => {
  const diff = diffPublishPlan(baseDraft, KEYS, ['screen.welcome', 'screen.saldo_menu'])
  assert.ok(diff.copyUpserts.some((c) => c.key === 'screen.welcome' && c.body === 'Hi {{first_name}}'))
})

test('diffPublishPlan sets entryKey from draft', () => {
  const d = structuredClone(baseDraft)
  d.entry_key = 'product_list'
  const diff = diffPublishPlan(d, KEYS, [])
  assert.equal(diff.entryKey, 'product_list')
})

test('validateDraft rejects button with multiple modes', () => {
  const d = structuredClone(baseDraft)
  d.nodes[0].buttons = [[{ label: 'X', go: 'product_list', url: 'https://x' }]]
  const r = validateDraft(d, KEYS)
  assert.equal(r.ok, false)
})

test('draftFromPublished hydrates body from copy map', () => {
  const nodes = [
    { key: 'welcome', kind: 'screen', screen_key: 'screen.welcome', action: null, buttons: [], description: '', pos_x: 1, pos_y: 2 },
    { key: 'product_list', kind: 'action', screen_key: null, action: 'product_list', buttons: [], description: '', pos_x: 3, pos_y: 4 },
  ]
  const d = draftFromPublished(nodes, { 'screen.welcome': 'BODY' }, 'welcome')
  assert.equal(d.nodes.find((n) => n.key === 'welcome').body, 'BODY')
  assert.equal(d.entry_key, 'welcome')
})

test('applyWire updates go target by flat button index', () => {
  const next = applyWire(baseDraft, 'welcome', 0, 'saldo_menu')
  assert.equal(next.nodes[0].buttons[0][0].go, 'saldo_menu')
  assert.equal(baseDraft.nodes[0].buttons[0][0].go, 'product_list')
})

test('publishPlan emits node patches and copy bodies', () => {
  const plan = publishPlan(baseDraft)
  assert.equal(plan.nodes.length, 3)
  assert.deepEqual(
    plan.copies.find((c) => c.key === 'screen.welcome'),
    { key: 'screen.welcome', body: 'Hi {{first_name}}' }
  )
  assert.ok(!plan.copies.some((c) => c.key == null))
})

test('draftFromPublished and publishPlan preserve media_url and media_type', () => {
  const nodes = [
    {
      key: 'welcome',
      kind: 'screen',
      screen_key: 'screen.welcome',
      pos_x: 0,
      pos_y: 0,
      buttons: [],
      media_url: 'https://example.com/banner.png',
      media_type: 'photo',
    },
  ]
  const copyByKey = { 'screen.welcome': 'Halo!' }
  const draft = draftFromPublished(nodes, copyByKey, 'welcome')
  assert.strictEqual(draft.nodes[0].media_url, 'https://example.com/banner.png')
  assert.strictEqual(draft.nodes[0].media_type, 'photo')

  const plan = publishPlan(draft)
  assert.strictEqual(plan.nodes[0].media_url, 'https://example.com/banner.png')
  assert.strictEqual(plan.nodes[0].media_type, 'photo')
})

test('reorderButtons and generateButtonLabelKey maintain valid button rows', () => {
  const { reorderButtonRow, generateButtonLabelKey } = require('../lib/flow-draft')
  const buttons = [
    [{ label: 'B1', go: 'step1' }],
    [{ label: 'B2', go: 'step2' }],
  ]
  const reordered = reorderButtonRow(buttons, 0, 1)
  assert.strictEqual(reordered[0][0].label, 'B2')
  assert.strictEqual(reordered[1][0].label, 'B1')

  const labelKey = generateButtonLabelKey('screen.welcome', 0)
  assert.strictEqual(labelKey, 'btn.welcome.0')
})


