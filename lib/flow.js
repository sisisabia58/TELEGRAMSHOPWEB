const supabase = require('./supabase')
const copy = require('./copy')
const runtimeSettings = require('./runtime-settings')
const session = require('./session')

const ACTIONS = [
  'product_list',
  'product_card',
  'kategori_menu',
  'stok',
  'riwayat',
  'deposit_menu',
  'noop',
]

const LEGACY_ALIASES = {
  daftarproduk: 'product_list',
  saldomenu: 'saldo_menu',
  caraorder: 'cara_order',
  kembaliawal: 'welcome',
  kategori_menu: 'kategori_menu',
  stok: 'stok',
  riwayattransaksi: 'riwayat',
}

let flowMeta = { id: null, entry_key: 'welcome' }
let nodesByKey = Object.create(null)
let ready = false

function isEnabled() {
  if (process.env.FLOW_ENGINE_ENABLED === 'true') return true
  if (process.env.FLOW_ENGINE_ENABLED === 'false') return false
  return runtimeSettings.get('flow_engine_enabled', false) === true
}

function getEntryKey() {
  return flowMeta.entry_key || 'welcome'
}

function getNode(key) {
  return nodesByKey[key] || null
}

function legacyToKey(callbackData) {
  if (!callbackData) return null
  if (Object.prototype.hasOwnProperty.call(LEGACY_ALIASES, callbackData)) {
    return LEGACY_ALIASES[callbackData]
  }
  return null
}

function parseFlowCallback(data) {
  if (!data || typeof data !== 'string') return null
  if (!data.startsWith('f:')) return null
  const key = data.slice(2)
  return key || null
}

function buttonLabel(btn) {
  if (btn.label_key) return copy.get(btn.label_key)
  return String(btn.label || '•')
}

function buildKeyboard(node, urlResolver) {
  const rows = Array.isArray(node?.buttons) ? node.buttons : []
  const inline_keyboard = []
  for (const row of rows) {
    if (!Array.isArray(row)) continue
    const out = []
    for (const btn of row) {
      if (!btn || typeof btn !== 'object') continue
      const text = buttonLabel(btn)
      if (btn.go) {
        out.push({ text, callback_data: `f:${btn.go}` })
      } else if (btn.callback) {
        const cb = String(btn.callback)
        if (Buffer.byteLength(cb, 'utf8') <= 64) out.push({ text, callback_data: cb })
      } else if (btn.url_from && typeof urlResolver === 'function') {
        const url = urlResolver(btn.url_from)
        if (url) out.push({ text, url })
      } else if (btn.url) {
        out.push({ text, url: String(btn.url) })
      }
    }
    if (out.length) inline_keyboard.push(out)
  }
  return { inline_keyboard }
}

async function refresh() {
  try {
    const { data: flow, error: flowErr } = await supabase
      .from('BotFlow')
      .select('id, entry_key, is_active')
      .eq('is_active', true)
      .maybeSingle()
    if (flowErr) {
      console.error('[flow] refresh flow:', flowErr.message)
      return false
    }
    if (!flow) {
      nodesByKey = Object.create(null)
      flowMeta = { id: null, entry_key: 'welcome' }
      ready = true
      return true
    }
    const { data: nodes, error: nodeErr } = await supabase
      .from('BotFlowNode')
      .select('key, kind, screen_key, action, buttons, description, media_url, media_type')
      .eq('flow_id', flow.id)
    if (nodeErr) {
      console.error('[flow] refresh nodes:', nodeErr.message)
      return false
    }
    const next = Object.create(null)
    for (const n of nodes || []) {
      if (n && n.key) next[n.key] = n
    }
    nodesByKey = next
    flowMeta = { id: flow.id, entry_key: flow.entry_key || 'welcome' }
    ready = true
    return true
  } catch (e) {
    console.error('[flow] refresh:', e.message)
    return false
  }
}

function isReady() {
  return ready
}

async function goto(userId, nodeKey, ctx = {}) {
  const node = getNode(nodeKey)
  if (!node) return { type: 'error', message: `unknown node: ${nodeKey}` }

  const push = ctx.push !== undefined
    ? !!ctx.push
    : nodeKey !== getEntryKey()
  await session.setScreen(userId, nodeKey, { push: nodeKey === getEntryKey() ? false : push })

  if (node.kind === 'action') {
    const action = ACTIONS.includes(node.action) ? node.action : null
    if (!action) return { type: 'error', message: `invalid action on ${nodeKey}` }
    return { type: 'action', node, action }
  }

  if (node.kind !== 'screen' || !node.screen_key) {
    return { type: 'error', message: `invalid screen node: ${nodeKey}` }
  }

  const caption = copy.get(node.screen_key, ctx.vars || {})
  const reply_markup = buildKeyboard(node, ctx.urlResolver)
  return { type: 'screen', node, caption, reply_markup }
}

async function dispatchFlowScreen(bot, chatId, node, messageId, bodyText, extraOpts = {}) {
  const keyboard = buildKeyboard(node, extraOpts.urlResolver)
  const parse_mode = 'Markdown'

  if (node && node.media_url) {
    if (messageId) {
      try {
        return await bot.editMessageCaption(bodyText, {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: keyboard,
          parse_mode,
        })
      } catch (err) {
        return await bot.sendPhoto(chatId, node.media_url, {
          caption: bodyText,
          reply_markup: keyboard,
          parse_mode,
        })
      }
    } else {
      return await bot.sendPhoto(chatId, node.media_url, {
        caption: bodyText,
        reply_markup: keyboard,
        parse_mode,
      })
    }
  } else {
    if (messageId) {
      return await bot.editMessageText(bodyText, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: keyboard,
        parse_mode,
      })
    } else {
      return await bot.sendMessage(chatId, bodyText, {
        reply_markup: keyboard,
        parse_mode,
      })
    }
  }
}

module.exports = {
  ACTIONS,
  LEGACY_ALIASES,
  refresh,
  isReady,
  isEnabled,
  getEntryKey,
  getNode,
  legacyToKey,
  parseFlowCallback,
  buildKeyboard,
  goto,
  dispatchFlowScreen,
}

