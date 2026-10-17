'use strict'

const path = require('node:path')
const { createFakeTelegram } = require('./fake-telegram')
const { createMemorySupabase, defaultBotFixtures } = require('./memory-supabase')

const USER_ID = 4242
const ROOT = path.join(__dirname, '..', '..')

let activeHarness = null

const HARNESS_RELOAD_MODULES = [
  'index.js',
  'settings.js',
  'pakasir.js',
  'lib/runtime-settings.js',
  'lib/copy.js',
  'lib/flow.js',
  'lib/fx.js',
  'lib/session.js',
  'lib/cart.js',
  'lib/catalog.js',
  'lib/pricing.js',
  'lib/sourcing.js',
  'lib/fulfillment.js',
  'lib/supplier-sync.js',
  'lib/stock.js',
  'lib/retired-commands.js',
]

function evictHarnessModules() {
  for (const rel of HARNESS_RELOAD_MODULES) {
    try {
      delete require.cache[require.resolve('../../' + rel)]
    } catch (_) { /* not loaded yet */ }
  }
}

function isTelegramFatal(err) {
  const code = err && err.code
  const name = err && err.name
  const msg = String((err && err.message) || err || '')
  return code === 'EFATAL' || code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'ECONNRESET'
    || name === 'RequestError'
    || msg.includes('ECONNREFUSED')
    || msg.includes('EFATAL')
}

function onHarnessUnhandledRejection(err) {
  if (isTelegramFatal(err)) return
  console.error('unhandledRejection:', err && err.message ? err.message : err)
  process.exitCode = 1
}

function onHarnessUncaughtException(err) {
  if (isTelegramFatal(err)) return
  // node:test already handled this exception. Rethrowing here exits the
  // child with code 7 and skips the remaining files.
  console.error('uncaughtException:', err && err.message ? err.message : err)
  process.exitCode = 1
}

function attachHarnessRejectionGuard() {
  if (attachHarnessRejectionGuard.installed) return
  attachHarnessRejectionGuard.installed = true
  process.on('unhandledRejection', onHarnessUnhandledRejection)
  process.on('uncaughtException', onHarnessUncaughtException)
}

function detachHarnessRejectionGuard() {
  if (!attachHarnessRejectionGuard.installed) return
  process.removeListener('unhandledRejection', onHarnessUnhandledRejection)
  process.removeListener('uncaughtException', onHarnessUncaughtException)
  attachHarnessRejectionGuard.installed = false
}

function captureFlowEngineEnv() {
  return Object.prototype.hasOwnProperty.call(process.env, 'FLOW_ENGINE_ENABLED')
    ? process.env.FLOW_ENGINE_ENABLED
    : undefined
}

function restoreFlowEngineEnv(previous) {
  if (previous === undefined) delete process.env.FLOW_ENGINE_ENABLED
  else process.env.FLOW_ENGINE_ENABLED = previous
}

function releaseHarnessSideEffects(previousFlowEngine) {
  delete process.env.BOT_TEST_FORCE_SETTINGS_POLL
  delete process.env.BOT_TEST_SKIP_TELEGRAM_POLL
  // applyTestEnv leaves an explicit true/false in place, so a start that set
  // FLOW_ENGINE_ENABLED=true would otherwise leak into the next default start.
  restoreFlowEngineEnv(previousFlowEngine)
  detachHarnessRejectionGuard()
}

function applyTestEnv(apiBaseUrl) {
  process.env.BOT_TEST_HARNESS = '1'
  process.env.TOKEN_BOT = process.env.TOKEN_BOT || '123456:TESTTOKEN'
  process.env.NAMA_BOT = process.env.NAMA_BOT || 'Test Shop'
  process.env.CHANNEL_STORE = process.env.CHANNEL_STORE || 'https://t.me/testchannel'
  process.env.CS = process.env.CS || 'https://t.me/testcs'
  process.env.IMAGE_PATH = process.env.IMAGE_PATH || path.join(ROOT, 'logo.jpg')
  process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost'
  process.env.SUPABASE_KEY = process.env.SUPABASE_KEY || 'dummy'
  process.env.PAKASIR_PROJECT = ''
  process.env.PAKASIR_API_KEY = ''
  process.env.TELEGRAM_API_URL = apiBaseUrl
  if (process.env.FLOW_ENGINE_ENABLED !== 'true' && process.env.FLOW_ENGINE_ENABLED !== 'false') {
    process.env.FLOW_ENGINE_ENABLED = 'false'
  }
}

function stubSupabase(client) {
  const supabasePath = require.resolve('../../lib/supabase.js')
  require.cache[supabasePath] = {
    id: supabasePath,
    filename: supabasePath,
    loaded: true,
    exports: client,
  }
  return supabasePath
}

async function waitUntil(fn, timeoutMs, label) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return
    await new Promise((r) => setTimeout(r, 25))
  }
  throw new Error(`timeout waiting for ${label}`)
}

async function stopHarnessBot(botModule) {
  if (!botModule) return
  const bot = botModule.bot
  const polling = bot && bot._polling
  // node-telegram-bot-api's stopPolling() is a no-op until the first getUpdates
  // is in flight. Abort the poller so a request that starts after stop cannot
  // reschedule itself via setTimeout.
  if (polling) {
    polling._abort = true
    clearTimeout(polling._pollingTimeout)
  }
  if (typeof botModule.stopBot === 'function') {
    try { await botModule.stopBot() } catch (_) { /* ignore */ }
  }
  if (bot && typeof bot.stopPolling === 'function') {
    try { await bot.stopPolling({ cancel: true }) } catch (_) { /* ignore */ }
  }
  if (polling) {
    polling._abort = true
    polling._lastRequest = null
    clearTimeout(polling._pollingTimeout)
  }
}

async function cleanupFailedStart(botModule, api) {
  await stopHarnessBot(botModule)
  try { await api.close() } catch (_) { /* ignore */ }
}

async function startBotHarness(options = {}) {
  if (activeHarness) {
    throw new Error('startBotHarness() already running in this process; call stop() first')
  }

  const api = createFakeTelegram({ userId: USER_ID, firstName: 'Ada' })
  const startupTimeoutMs = options.startupTimeoutMs == null ? 8000 : options.startupTimeoutMs
  let botModule = null
  let releaseInitialRefresh = () => {}
  const baseUrl = await api.listen()
  const previousFlowEngine = captureFlowEngineEnv()
  try {
    applyTestEnv(baseUrl)
    attachHarnessRejectionGuard()
    if (options.flowEnabled === true) process.env.FLOW_ENGINE_ENABLED = 'true'
    if (options.flowEnabled === false) process.env.FLOW_ENGINE_ENABLED = 'false'
    if (options.holdInitialRefresh) {
      process.env.BOT_TEST_FORCE_SETTINGS_POLL = '1'
      process.env.BOT_TEST_SKIP_TELEGRAM_POLL = '1'
    } else {
      delete process.env.BOT_TEST_FORCE_SETTINGS_POLL
      delete process.env.BOT_TEST_SKIP_TELEGRAM_POLL
    }

    const supabase = createMemorySupabase(options.fixtures || defaultBotFixtures())
    evictHarnessModules()
    stubSupabase(supabase)

    const runtimeSettings = require('../../lib/runtime-settings')
    if (options.holdInitialRefresh) {
      const originalRefresh = runtimeSettings.refresh
      let releaseHeldRefresh
      const heldRefresh = new Promise((resolve) => { releaseHeldRefresh = resolve })
      let holdingFirstRefresh = true
      runtimeSettings.refresh = async function (...args) {
        if (holdingFirstRefresh) {
          holdingFirstRefresh = false
          await heldRefresh
        }
        return originalRefresh.apply(this, args)
      }
      releaseInitialRefresh = () => { releaseHeldRefresh() }
    }

    botModule = require('../../index.js')
    if (botModule.bot && typeof botModule.bot.on === 'function') {
      botModule.bot.on('error', (err) => {
        if (!isTelegramFatal(err)) {
          console.error('bot error:', err && err.message ? err.message : err)
        }
      })
    }
    const copy = require('../../lib/copy')
    const flow = require('../../lib/flow')
    const fx = require('../../lib/fx')
    fx.__setHttp({
      get: async () => { throw new Error('fx blocked in bot harness') },
    })

    if (!options.holdInitialRefresh) {
      await waitUntil(
        () => runtimeSettings.isReady() && copy.isReady() && flow.isReady(),
        startupTimeoutMs,
        'runtime/copy/flow ready'
      )
      await waitUntil(
        () => api.calls.some((c) => c.method === 'getUpdates' || c.method === 'setMyCommands'),
        startupTimeoutMs,
        'telegram polling'
      )
    }

    const harness = {
      api,
      supabase,
      db: supabase._db,
      bot: botModule.bot,
      stopBot: botModule.stopBot,
      flow,
      copy,
      runtimeSettings,
      releaseInitialRefresh,
      async stop() {
        try {
          await stopHarnessBot(botModule)
          releaseInitialRefresh()
        } finally {
          try {
            await api.close()
          } finally {
            releaseHarnessSideEffects(previousFlowEngine)
            if (activeHarness === harness) activeHarness = null
          }
        }
      },
    }
    activeHarness = harness
    return harness
  } catch (err) {
    try {
      try { releaseInitialRefresh() } catch (_) { /* ignore */ }
      await cleanupFailedStart(botModule, api)
    } finally {
      releaseHarnessSideEffects(previousFlowEngine)
    }
    throw err
  }
}

function setFlowEngine(enabled) {
  process.env.FLOW_ENGINE_ENABLED = enabled ? 'true' : 'false'
}

function inlineButtons(call) {
  return (((call.params.reply_markup || {}).inline_keyboard) || [])
}

function keyboardButtons(call) {
  return (((call.params.reply_markup || {}).keyboard) || [])
}

function flattenInline(call) {
  return inlineButtons(call).flat()
}

module.exports = {
  USER_ID,
  startBotHarness,
  setFlowEngine,
  inlineButtons,
  keyboardButtons,
  flattenInline,
  waitUntil,
}
