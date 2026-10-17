'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { startBotHarness, waitUntil } = require('./helpers/bot-harness')

test('failed readiness wait closes the fake Telegram server', { timeout: 15000 }, async () => {
  await assert.rejects(
    () => startBotHarness({ startupTimeoutMs: 0 }),
    /timeout waiting for/
  )

  const harness = await startBotHarness({ flowEnabled: false, startupTimeoutMs: 8000 })
  try {
    assert.equal(typeof harness.bot, 'object')
    assert.ok(harness.api.server.listening)
  } finally {
    await harness.stop()
  }
  assert.equal(harness.api.server.listening, false)
})

test('startBotHarness after stop binds a new bot to a new fake API server', { timeout: 20000 }, async () => {
  const first = await startBotHarness({ flowEnabled: false })
  const firstPort = first.api.server.address().port
  await first.stop()
  assert.equal(first.api.server.listening, false)

  const second = await startBotHarness({ flowEnabled: false })
  try {
    const secondPort = second.api.server.address().port
    assert.notEqual(secondPort, firstPort)
    assert.ok(second.api.server.listening)
    second.api.pushMessage('/start')
    const photo = await second.api.waitForOutgoing((c) => c.method === 'sendPhoto')
    assert.match(String(photo.params.caption || ''), /ENTRY Ada/)
  } finally {
    await second.stop()
  }
})

test('stopBot during pending settings refresh does not start settings polling', { timeout: 15000 }, async () => {
  const harness = await startBotHarness({ flowEnabled: false, holdInitialRefresh: true })
  try {
    await waitUntil(
      () => harness.api.calls.some((c) => c.method === 'getUpdates' || c.method === 'setMyCommands'),
      8000,
      'telegram polling during held refresh'
    )

    let startPollingCalls = 0
    const originalStartPolling = harness.runtimeSettings.startPolling
    harness.runtimeSettings.startPolling = function (...args) {
      startPollingCalls += 1
      return originalStartPolling.apply(this, args)
    }

    await harness.stopBot()
    harness.releaseInitialRefresh()

    await waitUntil(
      () => harness.copy.isReady() && harness.flow.isReady(),
      8000,
      'copy/flow ready after held refresh'
    )
    assert.equal(startPollingCalls, 0)
  } finally {
    await harness.stop()
  }
})
