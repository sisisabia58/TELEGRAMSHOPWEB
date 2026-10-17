const test = require('node:test')
const assert = require('node:assert')

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

function recordingBot({ editCaptionThrows = false } = {}) {
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

test('dispatchFlowScreen edit-fallback uses sendDocument for document media', async () => {
  const flow = muatFlow({ nodes: sampleNodes })
  const bot = recordingBot({ editCaptionThrows: true })
  const node = mediaNode('document', 'https://example.com/catalog.pdf')

  await flow.dispatchFlowScreen(bot, 12345, node, 88, 'Catalog PDF')

  assertMediaSend(bot, 'sendDocument', 'https://example.com/catalog.pdf', 'Catalog PDF')
  assert.equal(bot.calls.some((c) => c.method === 'sendPhoto'), false)
})

test('dispatchFlowScreen edit-fallback uses sendVideo for video media', async () => {
  const flow = muatFlow({ nodes: sampleNodes })
  const bot = recordingBot({ editCaptionThrows: true })
  const node = mediaNode('video', 'https://example.com/intro.mp4')

  await flow.dispatchFlowScreen(bot, 12345, node, 88, 'Intro video')

  assertMediaSend(bot, 'sendVideo', 'https://example.com/intro.mp4', 'Intro video')
  assert.equal(bot.calls.some((c) => c.method === 'sendPhoto'), false)
})

test('dispatchFlowScreen edit-fallback uses sendPhoto for photo media', async () => {
  const flow = muatFlow({ nodes: sampleNodes })
  const bot = recordingBot({ editCaptionThrows: true })
  const node = mediaNode('photo', 'https://example.com/logo.jpg')

  await flow.dispatchFlowScreen(bot, 12345, node, 88, 'Welcome Text')

  assertMediaSend(bot, 'sendPhoto', 'https://example.com/logo.jpg', 'Welcome Text')
})

