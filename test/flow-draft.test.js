const test = require('node:test')
const assert = require('node:assert')
const {
  validateDraft,
  draftFromPublished,
  applyWire,
  publishPlan,
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

test('validateDraft rejects unknown key', () => {
  const d = structuredClone(baseDraft)
  d.nodes.push({ key: 'nope', kind: 'screen', screen_key: 'x', buttons: [], pos_x: 0, pos_y: 0 })
  const r = validateDraft(d, KEYS)
  assert.equal(r.ok, false)
  assert.ok(r.errors.some((e) => /unknown key/i.test(e)))
})

test('validateDraft rejects missing published key', () => {
  const d = structuredClone(baseDraft)
  d.nodes = d.nodes.filter((n) => n.key !== 'saldo_menu')
  const r = validateDraft(d, KEYS)
  assert.equal(r.ok, false)
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
