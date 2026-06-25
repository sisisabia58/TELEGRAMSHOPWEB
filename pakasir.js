// Pakasir payment gateway client
// Docs: https://pakasir.com/p/docs
const axios = require('axios')
const { Pakasir } = require('./settings.js')

let http = axios // swappable for tests via __setHttp

function base() {
  return (Pakasir.baseUrl || 'https://app.pakasir.com').replace(/\/$/, '')
}

// Create a transaction and obtain the QR string / VA number.
// Returns the `payment` object:
//   { project, order_id, amount, fee, total_payment, payment_method, payment_number, expired_at }
async function createTransaction({ orderId, amount, method = 'qris' }) {
  const { data } = await http.post(
    `${base()}/api/transactioncreate/${method}`,
    { project: Pakasir.project, order_id: orderId, amount, api_key: Pakasir.apiKey },
    { timeout: 30000, headers: { 'Content-Type': 'application/json' } }
  )
  return data.payment
}

// Authoritative status check. Returns the `transaction` object:
//   { amount, order_id, project, status, payment_method, completed_at }
// status is 'completed' once paid.
async function getTransactionStatus({ orderId, amount }) {
  const { data } = await http.get(`${base()}/api/transactiondetail`, {
    params: { project: Pakasir.project, amount, order_id: orderId, api_key: Pakasir.apiKey },
    timeout: 30000
  })
  return data.transaction
}

// Cancel a pending transaction (best-effort).
async function cancelTransaction({ orderId, amount }) {
  const { data } = await http.post(
    `${base()}/api/transactioncancel`,
    { project: Pakasir.project, order_id: orderId, amount, api_key: Pakasir.apiKey },
    { timeout: 30000, headers: { 'Content-Type': 'application/json' } }
  )
  return data
}

// Sandbox-only: simulate a successful payment to test the webhook/polling.
async function simulatePayment({ orderId, amount }) {
  const { data } = await http.post(
    `${base()}/api/paymentsimulation`,
    { project: Pakasir.project, order_id: orderId, amount, api_key: Pakasir.apiKey },
    { timeout: 30000, headers: { 'Content-Type': 'application/json' } }
  )
  return data
}

module.exports = {
  createTransaction,
  getTransactionStatus,
  cancelTransaction,
  simulatePayment,
  __setHttp: (m) => { http = m }
}
