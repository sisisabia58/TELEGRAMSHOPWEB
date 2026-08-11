// lib/notification-inbox.js
'use strict'

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 }

function buildDepositSummaryItem({ count, latestAt = new Date().toISOString() }) {
  if (!count || count <= 0) return null
  return {
    id: 'deposit-pending',
    type: 'deposit_pending',
    title: 'Deposit pending',
    message: `${count} deposit menunggu review`,
    href: '/deposit?status=pending',
    priority: 'high',
    created_at: latestAt,
    is_read: false,
  }
}

function buildLowStockItem({ variant, produkId, stokCount, threshold }) {
  const produkNama = variant.produk?.nama || 'Produk'
  const pid = produkId || variant.produk?.id
  return {
    id: `low-stock-${variant.id}`,
    type: 'low_stock',
    title: 'Stok menipis',
    message: `${produkNama} — ${variant.label} (${variant.kode}): ${stokCount} item (ambang ${threshold})`,
    href: pid ? `/produk/${pid}/varian/${variant.id}/stok` : '/stok',
    priority: 'high',
    created_at: new Date().toISOString(),
    is_read: false,
    data: {
      varian_id: variant.id,
      varian_kode: variant.kode,
      produk_id: pid,
      stok_count: stokCount,
      threshold,
    },
  }
}

function getNotificationHref(type, data = {}) {
  data = data || {}
  if (type === 'deposit_pending' && data.deposit_id) {
    return `/deposit/${data.deposit_id}`
  }
  if (type === 'deposit_pending') return '/deposit?status=pending'
  if (type === 'low_stock' && data.produk_id && data.varian_id) {
    return `/produk/${data.produk_id}/varian/${data.varian_id}/stok`
  }
  if (type === 'large_transaction' && data.trx_uuid) {
    return `/transaksi/${data.trx_uuid}`
  }
  return '/'
}

function inboxItemKey(item) {
  if (!item) return ''
  if (item.type === 'deposit_pending') {
    if (item.data?.deposit_id) return `deposit-${item.data.deposit_id}`
    return 'deposit-pending'
  }
  if (item.type === 'low_stock') {
    return item.id || `low-stock-${item.data?.varian_id || ''}`
  }
  if (item.type === 'large_transaction') {
    return item.id || `trx-${item.data?.trx_uuid || ''}`
  }
  return String(item.id || '')
}

function computeInboxTotal({ pendingCount = 0, lowStockCount = 0, largeTransactionCount = 0 }) {
  return pendingCount + lowStockCount + largeTransactionCount
}

function sortInboxItems(items) {
  return [...items].sort((a, b) => {
    const pr = (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9)
    if (pr !== 0) return pr
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  })
}

function countActionable(items) {
  return items.length
}

module.exports = {
  buildDepositSummaryItem,
  buildLowStockItem,
  getNotificationHref,
  inboxItemKey,
  sortInboxItems,
  countActionable,
  computeInboxTotal,
}
