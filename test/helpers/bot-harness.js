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
  const baseUrl = await api.listen()
  try {
    applyTestEnv(baseUrl)
    if (options.flowEnabled === true) process.env.FLOW_ENGINE_ENABLED = 'true'
    if (options.flowEnabled === false) process.env.FLOW_ENGINE_ENABLED = 'false'

    const supabase = createMemorySupabase(options.fixtures || defaultBotFixtures())
    evictHarnessModules()
    stubSupabase(supabase)

    const runtimeSettings = require('../../lib/runtime-settings')
    let releaseInitialRefresh = () => {}
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
        } finally {
          await api.close()
          if (activeHarness === harness) activeHarness = null
        }
      },
    }
    activeHarness = harness
    return harness
  } catch (err) {
    await cleanupFailedStart(botModule, api)
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
