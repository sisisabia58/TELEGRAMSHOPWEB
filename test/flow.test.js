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
      async setScreen() { return true },
    },
  }
  return require(jalurFlow)
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

function assertEditMedia(bot, type, mediaUrl, caption) {
  assert.equal(bot.calls.length, 1)
  assert.equal(bot.calls[0].method, 'editMessageMedia')
  assert.equal(bot.calls[0].media.type, type)
  assert.equal(bot.calls[0].media.media, mediaUrl)
  assert.equal(bot.calls[0].media.caption, caption)
  assert.equal(bot.calls[0].media.parse_mode, 'Markdown')
  assert.equal(bot.calls[0].opts.chat_id, 12345)
  assert.equal(bot.calls[0].opts.message_id, 88)
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
  assert.equal(result.query.message.message_id, 77)
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

