// test/notification-inbox.test.js
const test = require('node:test')
const assert = require('node:assert/strict')
const {
  buildDepositSummaryItem,
  buildLowStockItem,
  getNotificationHref,
  sortInboxItems,
  countActionable,
  computeInboxTotal,
} = require('../lib/notification-inbox')

test('buildDepositSummaryItem returns null when count is 0', () => {
  assert.strictEqual(buildDepositSummaryItem({ count: 0 }), null)
})

test('buildDepositSummaryItem builds summary row', () => {
  const item = buildDepositSummaryItem({ count: 2, latestAt: '2026-08-10T10:00:00.000Z' })
  assert.strictEqual(item.id, 'deposit-pending')
  assert.strictEqual(item.type, 'deposit_pending')
  assert.strictEqual(item.href, '/deposit?status=pending')
  assert.match(item.message, /2/)
})

test('buildLowStockItem builds variant row with stok link', () => {
  const item = buildLowStockItem({
    variant: { id: 'v1', label: '1 Month', kode: 'spotify-1m', produk: { id: 'p1', nama: 'Spotify' } },
    produkId: 'p1',
    stokCount: 0,
    threshold: 10,
  })
  assert.strictEqual(item.type, 'low_stock')
  assert.strictEqual(item.href, '/produk/p1/varian/v1/stok')
  assert.match(item.message, /0 item/)
})

test('getNotificationHref maps large_transaction to transaksi detail', () => {
  assert.strictEqual(
    getNotificationHref('large_transaction', { trx_uuid: 'abc-123' }),
    '/transaksi/abc-123'
  )
})

test('getNotificationHref maps deposit_pending with deposit_id to detail page', () => {
  assert.strictEqual(
    getNotificationHref('deposit_pending', { deposit_id: 'dep-42' }),
    '/deposit/dep-42'
  )
})

test('getNotificationHref maps deposit_pending without deposit_id to pending list', () => {
  assert.strictEqual(getNotificationHref('deposit_pending', {}), '/deposit?status=pending')
})

test('computeInboxTotal sums entity counts not panel rows', () => {
  assert.strictEqual(computeInboxTotal({ pendingCount: 2, lowStockCount: 7, largeTransactionCount: 0 }), 9)
})

test('sortInboxItems orders high priority first', () => {
  const sorted = sortInboxItems([
    { priority: 'medium', created_at: '2026-08-10T12:00:00.000Z' },
    { priority: 'high', created_at: '2026-08-10T11:00:00.000Z' },
  ])
  assert.strictEqual(sorted[0].priority, 'high')
})

test('countActionable returns item length', () => {
  assert.strictEqual(countActionable([{ id: 'a' }, { id: 'b' }]), 2)
})
