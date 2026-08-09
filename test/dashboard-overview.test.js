const test = require('node:test')
const assert = require('node:assert')
const { summarizeStock, pickRecent, buildOverviewModel } = require('../lib/dashboard-overview')

test('summarizeStock counts out-of-stock and low-stock', () => {
  const r = summarizeStock([
    { id: '1', stok_count: 0, threshold: 5 },
    { id: '2', stok_count: 3, threshold: 5 },
    { id: '3', stok_count: 10, threshold: 5 },
  ])
  assert.equal(r.outOfStock.length, 1)
  assert.equal(r.lowStock.length, 1)
  assert.equal(r.lowStock[0].id, '2')
})

test('pickRecent limits and preserves order', () => {
  const rows = [{ id: 1 }, { id: 2 }, { id: 3 }]
  assert.deepEqual(pickRecent(rows, 2).map((x) => x.id), [1, 2])
})

test('buildOverviewModel wires draft notice', () => {
  const m = buildOverviewModel({
    pendingDeposits: [{ id: 'd1' }],
    variants: [{ id: '1', stok_count: 0, threshold: 2 }],
    todayRevenue: 1000,
    todayTxnCount: 2,
    recentTxns: [],
    flowDraftUpdatedAt: '2026-08-09T00:00:00Z',
  })
  assert.equal(m.pendingDeposits.length, 1)
  assert.ok(m.draftNotice)
  assert.match(m.draftNotice, /draft/i)
})
