const test = require('node:test')
const assert = require('node:assert')
const pakasir = require('../pakasir.js')

test('createTransaction posts to transactioncreate/qris with correct body and returns payment', async () => {
  let captured = {}
  pakasir.__setHttp({
    post: async (url, body, opts) => {
      captured = { url, body, opts }
      return {
        data: {
          payment: {
            amount: 10000,
            fee: 1000,
            total_payment: 11000,
            payment_method: 'qris',
            payment_number: 'QRSTRING123',
            expired_at: '2026-01-01T00:00:00Z'
          }
        }
      }
    }
  })

  const pay = await pakasir.createTransaction({ orderId: 'INV1', amount: 10000 })

  assert.match(captured.url, /\/api\/transactioncreate\/qris$/)
  assert.strictEqual(captured.body.order_id, 'INV1')
  assert.strictEqual(captured.body.amount, 10000)
  assert.strictEqual(pay.total_payment, 11000)
  assert.strictEqual(pay.payment_number, 'QRSTRING123')
})

test('getTransactionStatus gets transactiondetail with query params and returns transaction', async () => {
  let captured = {}
  pakasir.__setHttp({
    get: async (url, opts) => {
      captured = { url, opts }
      return { data: { transaction: { order_id: 'INV1', amount: 10000, status: 'completed' } } }
    }
  })

  const trx = await pakasir.getTransactionStatus({ orderId: 'INV1', amount: 10000 })

  assert.match(captured.url, /\/api\/transactiondetail$/)
  assert.strictEqual(captured.opts.params.order_id, 'INV1')
  assert.strictEqual(captured.opts.params.amount, 10000)
  assert.strictEqual(trx.status, 'completed')
})

test('cancelTransaction posts to transactioncancel with order_id', async () => {
  let captured = {}
  pakasir.__setHttp({
    post: async (url, body) => {
      captured = { url, body }
      return { data: { ok: true } }
    }
  })

  await pakasir.cancelTransaction({ orderId: 'INV1', amount: 10000 })

  assert.match(captured.url, /\/api\/transactioncancel$/)
  assert.strictEqual(captured.body.order_id, 'INV1')
})
