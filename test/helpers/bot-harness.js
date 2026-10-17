'use strict'

const path = require('node:path')
const { createFakeTelegram } = require('./fake-telegram')
const { createMemorySupabase, defaultBotFixtures } = require('./memory-supabase')

const USER_ID = 4242
const ROOT = path.join(__dirname, '..', '..')

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

async function startBotHarness(options = {}) {
  const api = createFakeTelegram({ userId: USER_ID, firstName: 'Ada' })
  const baseUrl = await api.listen()
  applyTestEnv(baseUrl)
  if (options.flowEnabled === true) process.env.FLOW_ENGINE_ENABLED = 'true'
  if (options.flowEnabled === false) process.env.FLOW_ENGINE_ENABLED = 'false'

  const supabase = createMemorySupabase(options.fixtures || defaultBotFixtures())
  stubSupabase(supabase)

  const botModule = require('../../index.js')
  const runtimeSettings = require('../../lib/runtime-settings')
  const copy = require('../../lib/copy')
  const flow = require('../../lib/flow')
  const fx = require('../../lib/fx')
  fx.__setHttp({
    get: async () => { throw new Error('fx blocked in bot harness') },
  })

  await waitUntil(
    () => runtimeSettings.isReady() && copy.isReady() && flow.isReady(),
    8000,
    'runtime/copy/flow ready'
  )
  await waitUntil(
    () => api.calls.some((c) => c.method === 'getUpdates' || c.method === 'setMyCommands'),
    8000,
    'telegram polling'
  )

  return {
    api,
    supabase,
    db: supabase._db,
    bot: botModule.bot,
    stopBot: botModule.stopBot,
    flow,
    copy,
    runtimeSettings,
    async stop() {
      if (typeof botModule.stopBot === 'function') {
        await botModule.stopBot()
      }
      await api.close()
    },
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
}
