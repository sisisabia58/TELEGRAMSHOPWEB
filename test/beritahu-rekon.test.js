const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const { formatrupiah } = require('../lib/format')
const { validateTelegramMarkdown } = require('../lib/telegram-markdown')

function extractFunction(src, name) {
  const start = src.indexOf(`async function ${name}`)
  assert.ok(start >= 0, `${name} missing from index.js`)
  const paren = src.indexOf('(', start)
  let depth = 0
  let i = paren
  for (; i < src.length; i++) {
    if (src[i] === '(') depth++
    else if (src[i] === ')') {
      depth--
      if (depth === 0) break
    }
  }
  const brace = src.indexOf('{', i)
  depth = 0
  for (i = brace; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') {
      depth--
      if (depth === 0) return src.slice(start, i + 1)
    }
  }
  throw new Error(`${name} is unclosed`)
}

test('beritahuRekonsiliasi uses retry-wrapped sendMessage for the buyer notice', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8')
  const rekon = extractFunction(src, 'beritahuRekonsiliasi')
  const send = extractFunction(src, 'sendMessage')

  assert.match(
    rekon,
    /await sendMessage\(\s*userId,\s*pesanPembeli,\s*\{\s*parse_mode:\s*'Markdown'\s*\}\s*\)/,
    'buyer notice must go through sendMessage, not bot.sendMessage'
  )
  assert.doesNotMatch(
    rekon,
    /bot\.sendMessage\(\s*userId/,
    'direct bot.sendMessage to the buyer drops the only recon notice on a transient error'
  )
  assert.match(
    send,
    /retryBotOperation/,
    'sendMessage is the retry wrapper already used by kembalikanSaldo'
  )
})

function extractSyncFunction(src, name) {
  const token = `\nfunction ${name}`
  const at = src.indexOf(token)
  if (at < 0) return ''
  const start = at + 1
  const paren = src.indexOf('(', start)
  let depth = 0
  let i = paren
  for (; i < src.length; i++) {
    if (src[i] === '(') depth++
    else if (src[i] === ')') {
      depth--
      if (depth === 0) break
    }
  }
  const brace = src.indexOf('{', i)
  depth = 0
  for (i = brace; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') {
      depth--
      if (depth === 0) return src.slice(start, i + 1)
    }
  }
  throw new Error(`${name} is unclosed`)
}

function loadBeritahuRekonsiliasi() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8')
  const helper = src.includes('\nfunction escapeTelegramMarkdown')
    ? extractSyncFunction(src, 'escapeTelegramMarkdown') + '\n'
    : ''
  const rekon = extractFunction(src, 'beritahuRekonsiliasi')
  const factory = new Function(
    'formatrupiah',
    'sendMessage',
    'bot',
    'channelContact',
    'console',
    `${helper}${rekon}\nreturn beritahuRekonsiliasi`
  )
  return function beritahu(args, { channelLog = '-100log' } = {}) {
    const sent = []
    const sendMessage = async (chatId, text, opts) => {
      sent.push({ via: 'sendMessage', chatId, text, opts })
    }
    const bot = {
      sendMessage: async (chatId, text, opts) => {
        sent.push({ via: 'bot.sendMessage', chatId, text, opts })
      },
    }
    const channelContact = { channelLog }
    const fn = factory(formatrupiah, sendMessage, bot, channelContact, console)
    return fn(args).then(() => sent)
  }
}

// Legacy Markdown escapes apply only outside entities. A value is safe when
// the notice is plain text, or when every `_ * [ \`` in it is escaped and the
// whole message still parses.
function assertTelegramAcceptsDynamic(text, opts, raw) {
  const mode = opts && opts.parse_mode
  const value = String(raw)
  if (mode == null || mode === '') {
    assert.equal(opts && Object.prototype.hasOwnProperty.call(opts, 'parse_mode') && opts.parse_mode != null, false)
    assert.ok(text.includes(value), 'plain-text notice keeps the original value')
    return
  }
  assert.equal(mode, 'Markdown')
  const escaped = value.replace(/([_*`\[])/g, '\\$1')
  assert.ok(text.includes(escaped), `escaped value missing from message:\n${text}`)
  if (!escaped.includes(value)) {
    assert.equal(text.includes(value), false, `raw Markdown value leaked:\n${text}`)
  }
  const check = validateTelegramMarkdown(text)
  assert.equal(check.ok, true, `${check.reason}\n${text}`)
}

test('beritahuRekonsiliasi keeps a Markdown-special product name acceptable to Telegram', async () => {
  const nama = 'Netflix_Premium *4K* [promo] `kode`'
  const trxid = 'TRX_1*2[a]'
  const alasan = 'Acme_Supplier: perlu rekonsiliasi manual: SupplierOrder_trx_id_key'
  const beritahu = loadBeritahuRekonsiliasi()
  const sent = await beritahu({
    userId: 99,
    harga: 15000,
    Data: { trxid, jumlah: 2, kode: 'kode_aman' },
    item: { nama },
    alasan,
  })

  const buyer = sent.find((m) => m.via === 'sendMessage')
  const log = sent.find((m) => m.via === 'bot.sendMessage')
  assert.ok(buyer, 'buyer sedang-dicek notice was sent')
  assert.ok(log, 'reconciliation channel notice was sent')

  for (const msg of [buyer, log]) {
    assertTelegramAcceptsDynamic(msg.text, msg.opts, nama)
    assertTelegramAcceptsDynamic(msg.text, msg.opts, trxid)
  }
  assertTelegramAcceptsDynamic(log.text, log.opts, alasan)
  assertTelegramAcceptsDynamic(log.text, log.opts, formatrupiah(15000))
})

test('beritahuRekonsiliasi escapes a Markdown-special product code when the name is missing', async () => {
  const kode = 'sku_netflix*family[promo]'
  const beritahu = loadBeritahuRekonsiliasi()
  const sent = await beritahu({
    userId: 99,
    harga: 15000,
    Data: { trxid: 'TRX1', jumlah: 1, kode },
    item: {},
    alasan: 'tidak diketahui',
  })

  const log = sent.find((m) => m.via === 'bot.sendMessage')
  assert.ok(log, 'reconciliation channel notice was sent')
  assertTelegramAcceptsDynamic(log.text, log.opts, kode)
})
