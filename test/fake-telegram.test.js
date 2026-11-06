'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { createFakeTelegram } = require('./helpers/fake-telegram')

test('waitIdle returns once there is nothing pending and output is quiet', async () => {
  const api = createFakeTelegram()
  await api.waitIdle(20, 500)
})

test('waitIdle throws on timeout with the pending count and outgoing calls', async () => {
  const api = createFakeTelegram()
  api.pushMessage('/start')
  api.calls.push({
    method: 'sendMessage',
    params: { text: 'late reply that should be visible in the timeout' },
    result: {},
    at: Date.now(),
  })

  await assert.rejects(
    () => api.waitIdle(30, 80),
    (err) => {
      assert.match(err.message, /timeout waiting for Telegram idle/)
      assert.match(err.message, /pending=1/)
      assert.match(err.message, /sendMessage:late reply/)
      return true
    }
  )
})
