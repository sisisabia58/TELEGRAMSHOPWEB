'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { startBotHarness, waitUntil } = require('./helpers/bot-harness')

test('failed readiness wait closes the fake Telegram server', { timeout: 15000 }, async () => {
  const flowBefore = process.env.FLOW_ENGINE_ENABLED
  const uncaughtBefore = process.listenerCount('uncaughtException')
  const rejectionBefore = process.listenerCount('unhandledRejection')

  await assert.rejects(
    () => startBotHarness({ flowEnabled: true, startupTimeoutMs: 0 }),
    /timeout waiting for/
  )
  assert.equal(process.env.FLOW_ENGINE_ENABLED, flowBefore)
  assert.equal(process.listenerCount('uncaughtException'), uncaughtBefore)
  assert.equal(process.listenerCount('unhandledRejection'), rejectionBefore)

  const harness = await startBotHarness({ flowEnabled: false, startupTimeoutMs: 8000 })
  try {
    assert.equal(process.listenerCount('uncaughtException'), uncaughtBefore + 1)
    assert.equal(process.listenerCount('unhandledRejection'), rejectionBefore + 1)
    assert.equal(typeof harness.bot, 'object')
    assert.ok(harness.api.server.listening)
  } finally {
    await harness.stop()
  }
  assert.equal(harness.api.server.listening, false)
  assert.equal(process.env.FLOW_ENGINE_ENABLED, flowBefore)
  assert.equal(process.listenerCount('uncaughtException'), uncaughtBefore)
  assert.equal(process.listenerCount('unhandledRejection'), rejectionBefore)
})

test('startBotHarness after stop binds a new bot to a new fake API server', { timeout: 20000 }, async () => {
  const flowBefore = process.env.FLOW_ENGINE_ENABLED
  const first = await startBotHarness({ flowEnabled: true })
  const firstServer = first.api.server
  const firstBot = first.bot
  await first.stop()
  assert.equal(firstServer.listening, false)
  assert.equal(process.env.FLOW_ENGINE_ENABLED, flowBefore)

  const second = await startBotHarness()
  try {
    const expectedFlow = flowBefore === 'true' || flowBefore === 'false' ? flowBefore : 'false'
    assert.equal(process.env.FLOW_ENGINE_ENABLED, expectedFlow)
    assert.notStrictEqual(second.api.server, firstServer)
    assert.notStrictEqual(second.bot, firstBot)
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
