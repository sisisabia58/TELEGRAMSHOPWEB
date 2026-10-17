const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const jalurClient = require.resolve('../lib/supabase.js')
const jalurCopy = require.resolve('../lib/copy.js')
const jalurRuntime = require.resolve('../lib/runtime-settings.js')
const jalurSession = require.resolve('../lib/session.js')
const jalurFlow = require.resolve('../lib/flow.js')

function muatFlow({ nodes, entryKey = 'welcome', enabled = true } = {}) {
  delete require.cache[jalurFlow]
  const setScreenCalls = []
  require.cache[jalurClient] = {
    id: jalurClient,
    filename: jalurClient,
    loaded: true,
    exports: {
      from(tabel) {
        if (tabel === 'BotFlow') {
          const b = {
            select() { return b },
            eq() { return b },
            maybeSingle: async () => ({
              data: { id: 'flow1', entry_key: entryKey, is_active: true },
              error: null,
            }),
            then(res, rej) {
              return Promise.resolve({
                data: { id: 'flow1', entry_key: entryKey, is_active: true },
                error: null,
              }).then(res, rej)
            },
          }
          return b
        }
        if (tabel === 'BotFlowNode') {
          const b = {
            select() { return b },
            eq() { return b },
            then(res, rej) {
              return Promise.resolve({ data: nodes || [], error: null }).then(res, rej)
            },
          }
          return b
        }
        assert.fail('unexpected table ' + tabel)
      },
    },
  }
  require.cache[jalurCopy] = {
    id: jalurCopy, filename: jalurCopy, loaded: true,
    exports: {
      get(key, vars) {
        return `COPY:${key}:${vars && vars.first_name ? vars.first_name : ''}`
      },
    },
  }
  require.cache[jalurRuntime] = {
    id: jalurRuntime, filename: jalurRuntime, loaded: true,
    exports: {
      get(key, fallback) {
        if (key === 'flow_engine_enabled') return enabled
        return fallback
      },
    },
  }
  require.cache[jalurSession] = {
    id: jalurSession, filename: jalurSession, loaded: true,
    exports: {
      async setScreen(userId, screenKey, opts) {
        setScreenCalls.push({ userId, screenKey, opts })
        return true
      },
    },
  }
  const flow = require(jalurFlow)
  flow._setScreenCalls = setScreenCalls
  return flow
}

test.after(() => {
  for (const j of [jalurClient, jalurCopy, jalurRuntime, jalurSession, jalurFlow]) {
    delete require.cache[j]
  }
})

const sampleNodes = [
  {
    key: 'welcome',
    kind: 'screen',
    screen_key: 'screen.welcome',
    action: null,
    buttons: [
      [{ label_key: 'msg.menu_saldo', go: 'saldo_menu' }],
      [{ label: 'Channel', url_from: 'channel_store' }],
    ],
  },
  {
    key: 'saldo_menu',
    kind: 'screen',
    screen_key: 'screen.saldo_menu',
    action: null,
    buttons: [[{ label: 'Back', go: 'welcome' }]],
  },
  {
    key: 'product_list',
    kind: 'action',
    screen_key: null,
    action: 'product_list',
    buttons: [],
  },
]

test('buildKeyboard uses f: callbacks and url_from', () => {
  const flow = muatFlow({ nodes: sampleNodes })
  const kb = flow.buildKeyboard(sampleNodes[0], (n) => (n === 'channel_store' ? 'https://t.me/x' : ''))
  assert.equal(kb.inline_keyboard[0][0].callback_data, 'f:saldo_menu')
  assert.equal(kb.inline_keyboard[1][0].url, 'https://t.me/x')
})

test('legacyToKey maps daftarproduk', () => {
  const flow = muatFlow({ nodes: sampleNodes })
  assert.equal(flow.legacyToKey('daftarproduk'), 'product_list')
  assert.equal(flow.parseFlowCallback('f:welcome'), 'welcome')
  assert.equal(flow.parseFlowCallback('p:slug'), null)
})

test('goto screen returns caption and sets session', async () => {
  const flow = muatFlow({ nodes: sampleNodes })
  await flow.refresh()
  const result = await flow.goto(9, 'welcome', {
    vars: { first_name: 'Ada' },
    push: false,
    urlResolver: () => 'https://t.me/x',
  })
  assert.equal(result.type, 'screen')
  assert.match(result.caption, /COPY:screen\.welcome:Ada/)
  assert.equal(result.reply_markup.inline_keyboard[0][0].callback_data, 'f:saldo_menu')
})

test('goto action returns action name', async () => {
  const flow = muatFlow({ nodes: sampleNodes })
  await flow.refresh()
  const result = await flow.goto(9, 'product_list', { vars: {}, push: true })
  assert.equal(result.type, 'action')
  assert.equal(result.action, 'product_list')
})

test('isEnabled reads runtime setting', () => {
  const on = muatFlow({ nodes: sampleNodes, enabled: true })
  assert.equal(on.isEnabled(), true)
  delete require.cache[jalurFlow]
  const off = muatFlow({ nodes: sampleNodes, enabled: false })
  assert.equal(off.isEnabled(), false)
})

test('isEnabled uses the same FLOW_ENGINE_ENABLED override as flowEngineFlagState', () => {
  const { effectiveFlowEngineEnabled } = require('../lib/flow-engine-flag')
  const prev = process.env.FLOW_ENGINE_ENABLED
  try {
    process.env.FLOW_ENGINE_ENABLED = 'true'
    delete require.cache[jalurFlow]
    const forcedOn = muatFlow({ nodes: sampleNodes, enabled: false })
    assert.equal(forcedOn.isEnabled(), true)
    assert.equal(forcedOn.isEnabled(), effectiveFlowEngineEnabled(false, 'true'))

    process.env.FLOW_ENGINE_ENABLED = 'false'
    delete require.cache[jalurFlow]
    const forcedOff = muatFlow({ nodes: sampleNodes, enabled: true })
    assert.equal(forcedOff.isEnabled(), false)
    assert.equal(forcedOff.isEnabled(), effectiveFlowEngineEnabled(true, 'false'))
  } finally {
    if (prev === undefined) delete process.env.FLOW_ENGINE_ENABLED
    else process.env.FLOW_ENGINE_ENABLED = prev
    delete require.cache[jalurFlow]
  }
})

function recordingBot({ editCaptionThrows = false, editMediaThrows = false } = {}) {
  const calls = []
  return {
    calls,
    sendPhoto: async (chatId, photo, opts) => {
      calls.push({ method: 'sendPhoto', chatId, media: photo, opts })
    },
    sendDocument: async (chatId, document, opts) => {
      calls.push({ method: 'sendDocument', chatId, media: document, opts })
    },
    sendVideo: async (chatId, video, opts) => {
      calls.push({ method: 'sendVideo', chatId, media: video, opts })
    },
    sendMessage: async (chatId, text, opts) => {
      calls.push({ method: 'sendMessage', chatId, text, opts })
    },
    editMessageCaption: async (caption, opts) => {
      if (editCaptionThrows) throw new Error('cannot edit caption')
      calls.push({ method: 'editMessageCaption', caption, opts })
    },
    editMessageMedia: async (media, opts) => {
      if (editMediaThrows) throw new Error('cannot edit media')
      calls.push({ method: 'editMessageMedia', media, opts })
    },
    editMessageText: async (text, opts) => {
      calls.push({ method: 'editMessageText', text, opts })
    },
  }
}

function mediaNode(media_type, media_url) {
  return {
    key: 'welcome',
    kind: 'screen',
    screen_key: 'screen.welcome',
    media_url,
    media_type,
    buttons: [[{ label: 'Next', go: 'saldo_menu' }]],
  }
}

function assertMediaSend(bot, method, mediaUrl, caption) {
  assert.strictEqual(bot.calls.length, 1)
  assert.strictEqual(bot.calls[0].method, method)
  assert.strictEqual(bot.calls[0].chatId, 12345)
  assert.strictEqual(bot.calls[0].media, mediaUrl)
  assert.strictEqual(bot.calls[0].opts.caption, caption)
  assert.strictEqual(bot.calls[0].opts.parse_mode, 'Markdown')
  assert.equal(bot.calls[0].opts.reply_markup.inline_keyboard[0][0].callback_data, 'f:saldo_menu')
}

test('dispatchFlowScreen selects sendPhoto when media_url is present', async () => {
  const flow = muatFlow({ nodes: sampleNodes })
  let dispatchedMethod = null
  let dispatchedPayload = null
  const mockBot = {
    sendPhoto: async (chatId, photo, opts) => {
      dispatchedMethod = 'sendPhoto'
      dispatchedPayload = { chatId, photo, opts }
    },
    sendMessage: async (chatId, text, opts) => {
      dispatchedMethod = 'sendMessage'
      dispatchedPayload = { chatId, text, opts }
    },
  }
  const photoNode = {
    key: 'welcome',
    kind: 'screen',
    screen_key: 'screen.welcome',
    media_url: 'https://example.com/logo.jpg',
    media_type: 'photo',
    buttons: [],
  }

  await flow.dispatchFlowScreen(mockBot, 12345, photoNode, null, 'Welcome Text')
  assert.strictEqual(dispatchedMethod, 'sendPhoto')
  assert.strictEqual(dispatchedPayload.photo, 'https://example.com/logo.jpg')
  assert.strictEqual(dispatchedPayload.opts.caption, 'Welcome Text')
})

test('dispatchFlowScreen selects sendDocument for document media and does not sendPhoto', async () => {
  const flow = muatFlow({ nodes: sampleNodes })
  const bot = recordingBot()
  const node = mediaNode('document', 'https://example.com/catalog.pdf')

  await flow.dispatchFlowScreen(bot, 12345, node, null, 'Catalog PDF')

  assertMediaSend(bot, 'sendDocument', 'https://example.com/catalog.pdf', 'Catalog PDF')
  assert.equal(bot.calls.some((c) => c.method === 'sendPhoto'), false)
})

test('dispatchFlowScreen selects sendVideo for video media and does not sendPhoto', async () => {
  const flow = muatFlow({ nodes: sampleNodes })
  const bot = recordingBot()
  const node = mediaNode('video', 'https://example.com/intro.mp4')

  await flow.dispatchFlowScreen(bot, 12345, node, null, 'Intro video')

  assertMediaSend(bot, 'sendVideo', 'https://example.com/intro.mp4', 'Intro video')
  assert.equal(bot.calls.some((c) => c.method === 'sendPhoto'), false)
})

test('dispatchFlowScreen photo node still uses sendPhoto', async () => {
  const flow = muatFlow({ nodes: sampleNodes })
  const bot = recordingBot()
  const node = mediaNode('photo', 'https://example.com/logo.jpg')

  await flow.dispatchFlowScreen(bot, 12345, node, null, 'Welcome Text')

  assertMediaSend(bot, 'sendPhoto', 'https://example.com/logo.jpg', 'Welcome Text')
})

test('dispatchFlowScreen inherited-name media_type falls back to sendPhoto', async () => {
  const flow = muatFlow({ nodes: sampleNodes })
  const bot = recordingBot()
  const node = mediaNode('constructor', 'https://example.com/logo.jpg')

  await flow.dispatchFlowScreen(bot, 12345, node, null, 'Welcome Text')

  assertMediaSend(bot, 'sendPhoto', 'https://example.com/logo.jpg', 'Welcome Text')
})

test('dispatchFlowScreen edit-fallback uses sendDocument for document media', async () => {
  const flow = muatFlow({ nodes: sampleNodes })
  const bot = recordingBot({ editCaptionThrows: true, editMediaThrows: true })
  const node = mediaNode('document', 'https://example.com/catalog.pdf')

  await flow.dispatchFlowScreen(bot, 12345, node, 88, 'Catalog PDF')

  assertMediaSend(bot, 'sendDocument', 'https://example.com/catalog.pdf', 'Catalog PDF')
  assert.equal(bot.calls.some((c) => c.method === 'sendPhoto'), false)
})

test('dispatchFlowScreen edit-fallback uses sendVideo for video media', async () => {
  const flow = muatFlow({ nodes: sampleNodes })
  const bot = recordingBot({ editCaptionThrows: true, editMediaThrows: true })
  const node = mediaNode('video', 'https://example.com/intro.mp4')

  await flow.dispatchFlowScreen(bot, 12345, node, 88, 'Intro video')

  assertMediaSend(bot, 'sendVideo', 'https://example.com/intro.mp4', 'Intro video')
  assert.equal(bot.calls.some((c) => c.method === 'sendPhoto'), false)
})

test('dispatchFlowScreen edit-fallback uses sendPhoto for photo media', async () => {
  const flow = muatFlow({ nodes: sampleNodes })
  const bot = recordingBot({ editCaptionThrows: true, editMediaThrows: true })
  const node = mediaNode('photo', 'https://example.com/logo.jpg')

  await flow.dispatchFlowScreen(bot, 12345, node, 88, 'Welcome Text')

  assertMediaSend(bot, 'sendPhoto', 'https://example.com/logo.jpg', 'Welcome Text')
})

function startMsg(userId = 9) {
  return {
    message_id: 77,
    from: { id: userId, first_name: 'Ada' },
    chat: { id: userId },
  }
}

function callbackQuery(userId = 9) {
  return {
    id: 'cbq-1',
    from: { id: userId, first_name: 'Ada' },
    message: { message_id: 88, chat: { id: userId } },
  }
}

function assertEditMedia(bot, type, mediaUrl, caption, messageId = 88) {
  assert.equal(bot.calls.length, 1)
  assert.equal(bot.calls[0].method, 'editMessageMedia')
  assert.equal(bot.calls[0].media.type, type)
  assert.equal(bot.calls[0].media.media, mediaUrl)
  assert.equal(bot.calls[0].media.caption, caption)
  assert.equal(bot.calls[0].media.parse_mode, 'Markdown')
  assert.equal(bot.calls[0].opts.chat_id, 12345)
  assert.equal(bot.calls[0].opts.message_id, messageId)
  assert.equal(bot.calls[0].opts.reply_markup.inline_keyboard[0][0].callback_data, 'f:saldo_menu')
}

test('SIS-58: navigating to a photo screen uses editMessageMedia, not caption-only', async () => {
  const flow = muatFlow({ nodes: sampleNodes })
  const bot = recordingBot()
  const node = mediaNode('photo', 'https://example.com/promo.jpg')

  await flow.dispatchFlowScreen(bot, 12345, node, 88, 'Promo')

  assertEditMedia(bot, 'photo', 'https://example.com/promo.jpg', 'Promo')
  assert.equal(bot.calls.some((c) => c.method === 'editMessageCaption'), false)
})

test('SIS-58: navigating to a document screen uses editMessageMedia type document', async () => {
  const flow = muatFlow({ nodes: sampleNodes })
  const bot = recordingBot()
  const node = mediaNode('document', 'https://example.com/catalog.pdf')

  await flow.dispatchFlowScreen(bot, 12345, node, 88, 'Catalog PDF')

  assertEditMedia(bot, 'document', 'https://example.com/catalog.pdf', 'Catalog PDF')
  assert.equal(bot.calls.some((c) => c.method === 'editMessageCaption'), false)
})

test('SIS-58: same media_url keeps editMessageCaption', async () => {
  const flow = muatFlow({ nodes: sampleNodes })
  const bot = recordingBot()
  const url = 'https://example.com/logo.jpg'
  const node = mediaNode('photo', url)

  flow.rememberMessageMedia(12345, 88, node)
  await flow.dispatchFlowScreen(bot, 12345, node, 88, 'Same photo', {
    currentMediaUrl: url,
    currentMediaType: 'photo',
  })

  assert.equal(bot.calls.length, 1)
  assert.equal(bot.calls[0].method, 'editMessageCaption')
  assert.equal(bot.calls[0].caption, 'Same photo')
  assert.equal(bot.calls.some((c) => c.method === 'editMessageMedia'), false)
})

test('SIS-58: editMessageMedia failure falls back to sendDocument', async () => {
  const flow = muatFlow({ nodes: sampleNodes })
  const bot = recordingBot({ editMediaThrows: true })
  const node = mediaNode('document', 'https://example.com/catalog.pdf')

  await flow.dispatchFlowScreen(bot, 12345, node, 88, 'Catalog PDF')

  assertMediaSend(bot, 'sendDocument', 'https://example.com/catalog.pdf', 'Catalog PDF')
})

test('SIS-55: product_list action on /start runs with message context instead of requiring a callback', () => {
  const flow = muatFlow({ nodes: sampleNodes })
  const result = flow.resolveFlowAction('product_list', { msg: startMsg() })
  assert.equal(result.type, 'run')
  assert.equal(result.action, 'product_list')
  assert.equal(result.query.from.id, 9)
  assert.equal(result.query.message.message_id, null)
  assert.equal(result.query.message.chat.id, 9)
  assert.equal(result.query.id, null)
})

test('SIS-55: kategori_menu, stok and riwayat also run from /start message context', () => {
  const flow = muatFlow({ nodes: sampleNodes })
  for (const action of ['kategori_menu', 'stok', 'riwayat']) {
    const result = flow.resolveFlowAction(action, { msg: startMsg() })
    assert.equal(result.type, 'run', action)
    assert.equal(result.action, action)
  }
})

test('SIS-55: empty kategori_menu from /start sends err.no_products as a message', () => {
  const indexSrc = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8')
  const start = indexSrc.indexOf('async function openKategoriMenu')
  const end = indexSrc.indexOf('\nasync function openStokBuyer', start)
  const fn = indexSrc.slice(start, end)
  assert.ok(start >= 0, 'openKategoriMenu is present')
  const emptyStart = fn.indexOf('if (!Produk || Produk.length === 0)')
  const emptyEnd = fn.indexOf('\n  const kategoriCount', emptyStart)
  const empty = fn.slice(emptyStart, emptyEnd)
  assert.ok(emptyStart >= 0 && emptyEnd > emptyStart, 'empty-product branch is present')

  assert.match(empty, /if \(query\.id\)/)
  assert.match(empty, /answerCallbackQuerySafe\(bot,\s*query\.id/)
  assert.match(empty, /err\.no_products/)
  assert.match(empty, /else \{/)
  assert.match(empty, /sendMessage\(query\.from\.id,\s*copy\.get\('err\.no_products'\)/)
})

test('SIS-55: product_card as /start entry falls back to legacy welcome', () => {
  const flow = muatFlow({ nodes: sampleNodes })
  const result = flow.resolveFlowAction('product_card', { msg: startMsg() })
  assert.equal(result.type, 'fallback')
  assert.equal(flow.resolveFlowAction('noop', { msg: startMsg() }).type, 'fallback')
})

test('SIS-55: action without query or message falls back instead of showing nothing', () => {
  const flow = muatFlow({ nodes: sampleNodes })
  assert.equal(flow.resolveFlowAction('product_list', {}).type, 'fallback')
})

test('SIS-59: deposit_menu action from a button runs the top-up flow', () => {
  const flow = muatFlow({ nodes: sampleNodes })
  const result = flow.resolveFlowAction('deposit_menu', { query: callbackQuery() })
  assert.equal(result.type, 'run')
  assert.equal(result.action, 'deposit_menu')
  assert.equal(result.query.id, 'cbq-1')
})

test('SIS-59: deposit_menu as /start entry also runs with message context', () => {
  const flow = muatFlow({ nodes: sampleNodes })
  const result = flow.resolveFlowAction('deposit_menu', { msg: startMsg() })
  assert.equal(result.type, 'run')
  assert.equal(result.action, 'deposit_menu')
  assert.equal(result.query.id, null)
  assert.equal(result.query.message.message_id, null)
  assert.equal(result.query.message.chat.id, 9)
})

test('SIS-59: noop from a button answers the callback query', () => {
  const flow = muatFlow({ nodes: sampleNodes })
  const result = flow.resolveFlowAction('noop', { query: callbackQuery() })
  assert.equal(result.type, 'answer')
  assert.equal(result.query.id, 'cbq-1')
})

test('SIS-59: product_card from a button answers with a short notice', () => {
  const flow = muatFlow({ nodes: sampleNodes })
  const result = flow.resolveFlowAction('product_card', { query: callbackQuery() })
  assert.equal(result.type, 'notice')
  assert.match(result.text, /produk/i)
  assert.equal(result.query.id, 'cbq-1')
})

test('SIS-59: editor picker omits product_card but runtime allowlist still accepts it', () => {
  const flow = muatFlow({ nodes: sampleNodes })
  assert.ok(flow.ACTIONS.includes('product_card'))
  assert.ok(flow.ACTIONS.includes('deposit_menu'))
  assert.ok(flow.ACTIONS.includes('noop'))
  assert.ok(!flow.PICKER_ACTIONS.includes('product_card'))
  assert.ok(flow.PICKER_ACTIONS.includes('deposit_menu'))
  assert.deepEqual(
    flow.actionPickerOptions(['product_list', 'stok'], 'product_card'),
    ['product_card', 'product_list', 'stok'],
  )
  const dashboardSrc = fs.readFileSync(path.join(__dirname, '../dashboard.js'), 'utf8')
  assert.match(dashboardSrc, /FLOW_PICKER_ACTIONS = FLOW_ACTIONS\.filter/)
  assert.match(dashboardSrc, /actions:\s*FLOW_PICKER_ACTIONS/)
  assert.match(dashboardSrc, /allowedActions:\s*FLOW_ACTIONS/)
  const builderSrc = fs.readFileSync(path.join(__dirname, '../public/js/flow-builder.js'), 'utf8')
  assert.match(builderSrc, /actionChoices\.unshift\(node\.action\)/)
  const indexSrc = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8')
  assert.match(indexSrc, /flow\.resolveFlowAction\(result\.action/)
  assert.match(indexSrc, /case 'deposit_menu':/)
  assert.match(indexSrc, /if \(!ok\) \{/)
})

function actionNode(key, action) {
  return {
    key,
    kind: 'action',
    screen_key: null,
    action,
    buttons: [],
  }
}

test('flowCallbackNeedsCustomAnswer is true for handlers that answer the query themselves', async () => {
  const flow = muatFlow({
    nodes: [
      ...sampleNodes,
      actionNode('deposit_menu', 'deposit_menu'),
      actionNode('noop', 'noop'),
      actionNode('product_card', 'product_card'),
      actionNode('kategori_menu', 'kategori_menu'),
      actionNode('stok', 'stok'),
      actionNode('riwayat', 'riwayat'),
    ],
  })
  await flow.refresh()

  assert.equal(flow.flowCallbackNeedsCustomAnswer(flow.getNode('deposit_menu')), true)
  assert.equal(flow.flowCallbackNeedsCustomAnswer(flow.getNode('noop')), true)
  assert.equal(flow.flowCallbackNeedsCustomAnswer(flow.getNode('product_card')), true)
  assert.equal(flow.flowCallbackNeedsCustomAnswer(flow.getNode('product_list')), false)
  assert.equal(flow.flowCallbackNeedsCustomAnswer(flow.getNode('kategori_menu')), false)
  assert.equal(flow.flowCallbackNeedsCustomAnswer(flow.getNode('stok')), false)
  assert.equal(flow.flowCallbackNeedsCustomAnswer(flow.getNode('riwayat')), false)
  assert.equal(flow.flowCallbackNeedsCustomAnswer(flow.getNode('welcome')), false)
  assert.equal(flow.flowCallbackNeedsCustomAnswer(null), false)
})

test('flow callback wrapper skips the first answer for deposit_menu', () => {
  const indexSrc = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8')
  const handlerStart = indexSrc.indexOf('if (flow.isEnabled())')
  const handlerEnd = indexSrc.indexOf('if (cmd.startsWith(\'bulan_\')', handlerStart)
  const handlerSrc = indexSrc.slice(handlerStart, handlerEnd)
  assert.match(handlerSrc, /flow\.flowCallbackNeedsCustomAnswer\(node\)/)
  assert.doesNotMatch(handlerSrc, /node\.action === 'deposit_menu'/)
})

test('mediaOptsForScreen returns previous screen media identity', async () => {
  const flow = muatFlow({
    nodes: [
      {
        key: 'welcome',
        kind: 'screen',
        screen_key: 'screen.welcome',
        action: null,
        media_url: 'https://example.com/logo.jpg',
        media_type: 'photo',
        buttons: [],
      },
      {
        key: 'catalog',
        kind: 'screen',
        screen_key: 'screen.catalog',
        action: null,
        media_url: 'https://example.com/catalog.pdf',
        media_type: 'document',
        buttons: [],
      },
      actionNode('product_list', 'product_list'),
    ],
  })
  await flow.refresh()

  assert.deepEqual(flow.mediaOptsForScreen('welcome'), {
    currentMediaUrl: 'https://example.com/logo.jpg',
    currentMediaType: 'photo',
  })
  assert.deepEqual(flow.mediaOptsForScreen('catalog'), {
    currentMediaUrl: 'https://example.com/catalog.pdf',
    currentMediaType: 'document',
  })
  assert.deepEqual(flow.mediaOptsForScreen('product_list'), {})
  assert.deepEqual(flow.mediaOptsForScreen('welcome_missing'), {})
  assert.deepEqual(flow.mediaOptsForScreen(null), {})
})

test('dispatchFlow uses per-message media identity, not the last navigated screen', () => {
  const indexSrc = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8')
  const dispatchStart = indexSrc.indexOf('async function dispatchFlow')
  const dispatchEnd = indexSrc.indexOf('\nbot.on("callback_query"', dispatchStart)
  const dispatchSrc = indexSrc.slice(dispatchStart, dispatchEnd)
  assert.ok(dispatchStart >= 0, 'dispatchFlow is present')
  assert.match(dispatchSrc, /mediaOptsForMessage\(/)
  assert.doesNotMatch(dispatchSrc, /mediaOptsForScreen\(/)
  assert.doesNotMatch(dispatchSrc, /session\.getNav\(/)

  const handleStart = indexSrc.indexOf('async function handleFlowResult')
  const handleSrc = indexSrc.slice(handleStart, dispatchStart)
  assert.match(handleSrc, /dispatchFlowScreen\(/)
  assert.match(handleSrc, /currentMediaUrl/)
  assert.match(handleSrc, /currentMediaType/)
})

test('SIS-58: different current media still uses editMessageMedia', async () => {
  const flow = muatFlow({ nodes: sampleNodes })
  const bot = recordingBot()
  const node = mediaNode('photo', 'https://example.com/promo.jpg')

  await flow.dispatchFlowScreen(bot, 12345, node, 88, 'Promo', {
    currentMediaUrl: 'https://example.com/old.jpg',
    currentMediaType: 'photo',
  })

  assertEditMedia(bot, 'photo', 'https://example.com/promo.jpg', 'Promo')
  assert.equal(bot.calls.some((c) => c.method === 'editMessageCaption'), false)
})

test('goto does not store noop or product_card as the current screen', async () => {
  const flow = muatFlow({
    nodes: [
      ...sampleNodes,
      actionNode('noop', 'noop'),
      actionNode('product_card', 'product_card'),
    ],
  })
  await flow.refresh()

  const noopResult = await flow.goto(9, 'noop', { vars: {}, push: true })
  assert.equal(noopResult.type, 'action')
  assert.equal(noopResult.action, 'noop')
  assert.equal(flow._setScreenCalls.some((c) => c.screenKey === 'noop'), false)

  const cardResult = await flow.goto(9, 'product_card', { vars: {}, push: true })
  assert.equal(cardResult.type, 'action')
  assert.equal(cardResult.action, 'product_card')
  assert.equal(flow._setScreenCalls.some((c) => c.screenKey === 'product_card'), false)
})

test('goto still stores navigating screens and run-actions as the current screen', async () => {
  const flow = muatFlow({ nodes: sampleNodes })
  await flow.refresh()

  await flow.goto(9, 'welcome', { vars: {}, push: false })
  assert.deepEqual(flow._setScreenCalls[0], {
    userId: 9,
    screenKey: 'welcome',
    opts: { push: false },
  })

  await flow.goto(9, 'product_list', { vars: {}, push: true })
  assert.deepEqual(flow._setScreenCalls[1], {
    userId: 9,
    screenKey: 'product_list',
    opts: { push: true },
  })
})

test('dispatchFlowScreen uses stored media for that message, not session extraOpts', async () => {
  const flow = muatFlow({ nodes: sampleNodes })
  const bot = recordingBot()
  const welcome = mediaNode('photo', 'https://example.com/welcome.jpg')
  const screenB = mediaNode('photo', 'https://example.com/screen-b.jpg')

  flow.rememberMessageMedia(12345, 22, welcome)
  await flow.dispatchFlowScreen(bot, 12345, screenB, 22, 'Screen B', {
    currentMediaUrl: screenB.media_url,
    currentMediaType: 'photo',
  })

  assertEditMedia(bot, 'photo', 'https://example.com/screen-b.jpg', 'Screen B', 22)
  assert.equal(bot.calls.some((c) => c.method === 'editMessageCaption'), false)
})

test('dispatchFlowScreen uses editMessageMedia when this message media is unknown', async () => {
  const flow = muatFlow({ nodes: sampleNodes })
  const bot = recordingBot()
  const screenB = mediaNode('photo', 'https://example.com/screen-b.jpg')

  await flow.dispatchFlowScreen(bot, 12345, screenB, 33, 'Screen B', {
    currentMediaUrl: screenB.media_url,
    currentMediaType: 'photo',
  })

  assertEditMedia(bot, 'photo', 'https://example.com/screen-b.jpg', 'Screen B', 33)
  assert.equal(bot.calls.some((c) => c.method === 'editMessageCaption'), false)
})

test('dispatchFlowScreen caption-edits only when this message already has the same media', async () => {
  const flow = muatFlow({ nodes: sampleNodes })
  const bot = recordingBot()
  const url = 'https://example.com/logo.jpg'
  const node = mediaNode('photo', url)

  flow.rememberMessageMedia(12345, 88, node)
  await flow.dispatchFlowScreen(bot, 12345, node, 88, 'Same photo')

  assert.equal(bot.calls.length, 1)
  assert.equal(bot.calls[0].method, 'editMessageCaption')
  assert.equal(bot.calls[0].caption, 'Same photo')
  assert.equal(bot.calls.some((c) => c.method === 'editMessageMedia'), false)
})

test('after an unknown-message media edit, the next same-media call caption-edits', async () => {
  const flow = muatFlow({ nodes: sampleNodes })
  const node = mediaNode('photo', 'https://example.com/logo.jpg')

  const first = recordingBot()
  await flow.dispatchFlowScreen(first, 12345, node, 88, 'First')
  assert.equal(first.calls[0].method, 'editMessageMedia')

  const second = recordingBot()
  await flow.dispatchFlowScreen(second, 12345, node, 88, 'Second')
  assert.equal(second.calls[0].method, 'editMessageCaption')
  assert.equal(second.calls[0].caption, 'Second')
})

test('two flow messages keep independent media identity', async () => {
  const flow = muatFlow({ nodes: sampleNodes })
  const welcome = mediaNode('photo', 'https://example.com/welcome.jpg')
  const screenB = mediaNode('photo', 'https://example.com/screen-b.jpg')
  flow.rememberMessageMedia(12345, 11, screenB)
  flow.rememberMessageMedia(12345, 22, welcome)

  const botOnB = recordingBot()
  await flow.dispatchFlowScreen(botOnB, 12345, screenB, 11, 'Still B')
  assert.equal(botOnB.calls[0].method, 'editMessageCaption')

  const botOnWelcome = recordingBot()
  await flow.dispatchFlowScreen(botOnWelcome, 12345, screenB, 22, 'Screen B')
  assertEditMedia(botOnWelcome, 'photo', 'https://example.com/screen-b.jpg', 'Screen B', 22)
})

test('dispatchFlowScreen remembers sent media by the returned message_id', async () => {
  const flow = muatFlow({ nodes: sampleNodes })
  const bot = recordingBot()
  bot.sendPhoto = async (chatId, photo, opts) => {
    bot.calls.push({ method: 'sendPhoto', chatId, media: photo, opts })
    return { message_id: 101 }
  }
  const node = mediaNode('photo', 'https://example.com/welcome.jpg')

  await flow.dispatchFlowScreen(bot, 12345, node, null, 'Welcome')

  assert.deepEqual(flow.mediaOptsForMessage(12345, 101), {
    currentMediaUrl: 'https://example.com/welcome.jpg',
    currentMediaType: 'photo',
  })
  assert.deepEqual(flow.mediaOptsForMessage(12345, 99), {})
})

function sliceFn(src, startNeedle, endNeedle) {
  const start = src.indexOf(startNeedle)
  const end = src.indexOf(endNeedle, start)
  assert.ok(start >= 0 && end > start, `${startNeedle} .. ${endNeedle}`)
  return src.slice(start, end)
}

test('answerCallbackQuerySafe resolves when Telegram rejects the answer', async () => {
  const flow = muatFlow({ nodes: sampleNodes })
  let answers = 0
  const bot = {
    async answerCallbackQuery(id, extra) {
      answers += 1
      assert.equal(id, 'cbq-1')
      assert.ok(extra === undefined || extra.show_alert === true)
      throw new Error('Bad Request: query is too old and response timeout expired or query ID is invalid')
    },
  }

  await flow.answerCallbackQuerySafe(bot, 'cbq-1')
  await flow.answerCallbackQuerySafe(bot, 'cbq-1', { text: 'notice', show_alert: true })
  await flow.answerCallbackQuerySafe(bot, null)
  await flow.answerCallbackQuerySafe({ }, 'cbq-1')

  assert.equal(answers, 2)
})

test('product_list, kategori_menu, stok, and deposit_menu handler answers are non-fatal', () => {
  const indexSrc = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8')
  const productPage = sliceFn(indexSrc, 'async function sendProductPage', 'async function sendProductCard')
  const kategori = sliceFn(indexSrc, 'async function openKategoriMenu', 'async function openStokBuyer')
  const stok = sliceFn(indexSrc, 'async function openStokBuyer', 'async function openRiwayat')
  const productList = sliceFn(indexSrc, 'async function openProductList', 'async function openKategoriMenu')
  const riwayat = sliceFn(indexSrc, 'async function openRiwayat', 'function depositMenuPayload')
  const deposit = sliceFn(indexSrc, 'async function openDepositMenu', 'async function handleFlowResult')
  const wrapper = sliceFn(indexSrc, 'if (flow.isEnabled())', 'if (cmd.startsWith(\'bulan_\')')

  assert.match(productPage, /flow\.answerCallbackQuerySafe\(/)
  assert.doesNotMatch(productPage, /await bot\.answerCallbackQuery\(/)
  assert.match(kategori, /flow\.answerCallbackQuerySafe\(/)
  assert.doesNotMatch(kategori, /await bot\.answerCallbackQuery\(/)
  assert.match(stok, /flow\.answerCallbackQuerySafe\(/)
  assert.doesNotMatch(stok, /await bot\.answerCallbackQuery\(/)
  assert.equal((stok.match(/flow\.answerCallbackQuerySafe\(/g) || []).length, 2)
  assert.match(deposit, /if \(query\.id\) await flow\.answerCallbackQuerySafe\(bot, query\.id\)/)
  assert.doesNotMatch(deposit, /await bot\.answerCallbackQuery\(/)
  const answerAt = deposit.indexOf('answerCallbackQuerySafe')
  const editAt = deposit.indexOf('editMessageCaption')
  assert.ok(answerAt >= 0 && editAt > answerAt, 'deposit answer must not sit after the menu edit')

  const emptyList = productList.slice(
    productList.indexOf('if (!Produk || Produk.length === 0)'),
    productList.indexOf('const ProdukWithStok'),
  )
  assert.doesNotMatch(emptyList, /answerCallbackQuery/)
  assert.doesNotMatch(riwayat, /answerCallbackQuery/)
  assert.match(wrapper, /flow\.flowCallbackNeedsCustomAnswer\(node\)/)
  assert.match(wrapper, /answerCallbackQuery\(query\.id\)\.catch\(/)
})

test('synthetic /start context sends a new screen instead of editing the user message', () => {
  const indexSrc = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8')
  const productList = sliceFn(indexSrc, 'async function openProductList', 'async function openKategoriMenu')
  const productPage = sliceFn(indexSrc, 'async function sendProductPage', 'async function sendProductCard')
  const kategori = sliceFn(indexSrc, 'async function openKategoriMenu', 'async function openStokBuyer')
  const stok = sliceFn(indexSrc, 'async function openStokBuyer', 'async function openRiwayat')
  const riwayat = sliceFn(indexSrc, 'async function openRiwayat', 'function depositMenuPayload')
  const deposit = sliceFn(indexSrc, 'async function openDepositMenu', 'async function handleFlowResult')
  const editOrSend = sliceFn(indexSrc, 'async function editOrSendBannerMessage', 'async function generateQRBuffer')

  assert.match(productList, /if \(query\.message && query\.message\.message_id\) \{\s*await bot\.deleteMessage/)
  assert.match(productPage, /if \(msgId\) \{/)
  assert.match(productPage, /await sendBannerMessage\(chatId, text, \{ reply_markup \}\)/)

  assert.match(kategori, /editOrSendBannerMessage\(query\.from\.id, query\.message\.message_id/)
  assert.match(editOrSend, /if \(messageId\) \{/)
  assert.match(editOrSend, /return await sendBannerMessage\(chatId, captionText, options\)/)

  assert.doesNotMatch(stok, /message_id|deleteMessage|editMessageCaption|editOrSendBannerMessage/)
  assert.match(stok, /bot\.sendMessage\(query\.from\.id/)

  assert.match(riwayat, /if \(query\.message && query\.message\.message_id\)/)
  assert.match(riwayat, /await sendPage\(Trx, query\.from\.id, 0\)/)

  assert.match(deposit, /if \(!msgId\) \{\s*await sendBannerMessage\(query\.from\.id, text, \{ reply_markup \}\)/)
  assert.match(deposit, /if \(msgId\) await bot\.deleteMessage\(chatId, msgId\)/)
})

