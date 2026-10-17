'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  startBotHarness,
  setFlowEngine,
  flattenInline,
  keyboardButtons,
  USER_ID,
} = require('./helpers/bot-harness')

let harness

function captionOf(call) {
  return String(call.params.caption || call.params.text || '')
}

function lastOutgoing(method) {
  const list = harness.api.outgoing().filter((c) => c.method === method)
  return list[list.length - 1]
}

test.before(async () => {
  harness = await startBotHarness({ flowEnabled: false })
})

test.after(async () => {
  if (harness) await harness.stop()
})

test.beforeEach(async () => {
  setFlowEngine(false)
  harness.api.setFailCaptionEdits(false)
  // Drain a late /start sendMessage so it cannot leak into the next test's wait.
  await harness.api.waitIdle(200, 4000)
  harness.api.clearOutgoing()
})

test('a second startBotHarness() is rejected while one is already running', async () => {
  await assert.rejects(
    () => startBotHarness({ flowEnabled: false }),
    /already running/
  )
})

test('/start with flow engine off sends legacy welcome caption and inline keyboard', { timeout: 15000 }, async () => {
  setFlowEngine(false)
  harness.api.pushMessage('/start')

  const photo = await harness.api.waitForOutgoing((c) => (
    c.method === 'sendPhoto' && captionOf(c).includes('ENTRY Ada')
  ))
  assert.match(captionOf(photo), /bot=Test Shop/)
  assert.match(captionOf(photo), /users=1/)
  assert.match(captionOf(photo), /stock=2/)
  assert.match(captionOf(photo), /saldo=/)

  const buttons = flattenInline(photo)
  const callbacks = buttons.filter((b) => b.callback_data).map((b) => b.callback_data)
  assert.ok(callbacks.includes('daftarproduk'))
  assert.ok(callbacks.includes('kategori_menu'))
  assert.ok(callbacks.includes('riwayattransaksi'))
  assert.ok(callbacks.includes('caraorder'))
  assert.ok(callbacks.includes('saldomenu'))
  assert.ok(callbacks.includes('stok'))
  const urls = buttons.filter((b) => b.url).map((b) => b.url)
  assert.ok(urls.includes('https://t.me/testchannel'))
  assert.ok(urls.includes('https://t.me/testcs'))
})

test('/start always sends the reply-keyboard enable message', { timeout: 15000 }, async () => {
  harness.api.pushMessage('/start')
  const nav = await harness.api.waitForOutgoing((c) => (
    c.method === 'sendMessage' && captionOf(c).includes('navigasi cepat')
  ))
  const rows = keyboardButtons(nav)
  const labels = rows.flat()
  assert.ok(labels.some((t) => String(t).includes('Daftar Produk')))
  assert.ok(labels.some((t) => String(t).includes('Riwayat Transaksi')))
  assert.ok(labels.some((t) => String(t).includes('Saldo:')))
})

test("/start is ignored when it is not at the start of the message", { timeout: 15000 }, async () => {
  harness.api.pushMessage('hello /start')
  await harness.api.waitIdle(400, 4000)
  const unexpected = harness.api.outgoing().filter((c) => c.method !== 'setMyCommands')
  assert.equal(unexpected.length, 0, `expected no bot replies, got ${unexpected.map((c) => c.method + ':' + captionOf(c)).join(' | ')}`)
})

test('/start with payload and /start@BotName still trigger welcome', { timeout: 15000 }, async () => {
  harness.api.pushMessage('/start payload-here')
  await harness.api.waitForOutgoing((c) => c.method === 'sendPhoto' && captionOf(c).includes('ENTRY Ada'))
  harness.api.clearOutgoing()

  harness.api.pushMessage('/start@TestShopBot extra')
  await harness.api.waitForOutgoing((c) => c.method === 'sendPhoto' && captionOf(c).includes('ENTRY Ada'))
})

test('/start with flow engine on renders entry vars and go/callback/url/url_from buttons', { timeout: 15000 }, async () => {
  setFlowEngine(true)
  harness.api.pushMessage('/start')

  const photo = await harness.api.waitForOutgoing((c) => (
    c.method === 'sendPhoto' && captionOf(c).includes('ENTRY Ada')
  ))
  assert.match(captionOf(photo), /bot=Test Shop/)
  assert.match(captionOf(photo), /users=1/)
  assert.match(captionOf(photo), /sold=0/)
  assert.match(captionOf(photo), /stock=2/)

  const buttons = flattenInline(photo)
  const byLabel = Object.fromEntries(buttons.map((b) => [b.text, b]))
  assert.equal(byLabel.Info.callback_data, 'f:info')
  assert.equal(byLabel.Raw.callback_data, 'raw_ping')
  assert.equal(byLabel.Docs.url, 'https://example.com/docs')
  assert.equal(byLabel.Channel.url, 'https://t.me/testchannel')
  assert.equal(byLabel.Foto.callback_data, 'f:photo_screen')
  assert.equal(byLabel.File.callback_data, 'f:doc_screen')
  assert.equal(byLabel.Produk.callback_data, 'f:product_list')
})

test('go button navigates by editing the caption in place', { timeout: 15000 }, async () => {
  setFlowEngine(true)
  harness.api.pushMessage('/start')
  const photo = await harness.api.waitForOutgoing((c) => (
    c.method === 'sendPhoto' && captionOf(c).includes('ENTRY Ada')
  ))
  harness.api.clearOutgoing()

  harness.api.pushCallback('f:info', { message_id: photo.result.message_id })
  const edited = await harness.api.waitForOutgoing((c) => (
    c.method === 'editMessageCaption' && captionOf(c).includes('INFO Ada')
  ))
  assert.equal(edited.params.chat_id, USER_ID)
  assert.equal(edited.params.message_id, photo.result.message_id)
  assert.ok(flattenInline(edited).some((b) => b.callback_data === 'f:welcome'))
})

test('media screens send photo vs document when caption edit cannot be used', { timeout: 15000 }, async () => {
  setFlowEngine(true)
  harness.api.setFailCaptionEdits(true)
  harness.api.pushMessage('/start')
  const welcome = await harness.api.waitForOutgoing((c) => (
    c.method === 'sendPhoto' && captionOf(c).includes('ENTRY Ada')
  ))
  harness.api.clearOutgoing()

  harness.api.pushCallback('f:photo_screen', { message_id: welcome.result.message_id })
  const photo = await harness.api.waitForOutgoing((c) => (
    c.method === 'sendPhoto' && (c.params.photo === 'https://cdn.example/banner.jpg' || captionOf(c) === 'PHOTO_SCREEN')
  ))
  assert.equal(photo.params.photo, 'https://cdn.example/banner.jpg')
  assert.equal(captionOf(photo), 'PHOTO_SCREEN')

  harness.api.clearOutgoing()
  harness.api.pushCallback('f:doc_screen', { message_id: photo.result.message_id })
  const doc = await harness.api.waitForOutgoing((c) => c.method === 'sendDocument')
  assert.equal(doc.params.document, 'https://cdn.example/file.pdf')
  assert.equal(captionOf(doc), 'DOC_SCREEN')
})

test('action node product_list opens the product catalog', { timeout: 15000 }, async () => {
  setFlowEngine(true)
  harness.api.pushMessage('/start')
  const welcome = await harness.api.waitForOutgoing((c) => (
    c.method === 'sendPhoto' && captionOf(c).includes('ENTRY Ada')
  ))
  harness.api.clearOutgoing()

  harness.api.pushCallback('f:product_list', { message_id: welcome.result.message_id })
  const catalog = await harness.api.waitForOutgoing((c) => (
    /LIST PRODUCT|Netflix/i.test(captionOf(c))
  ))
  assert.match(captionOf(catalog), /Netflix/i)
  assert.ok(
    harness.api.outgoing().some((c) => c.method === 'answerCallbackQuery' || c.method === 'deleteMessage' || c.method === 'sendPhoto' || c.method === 'editMessageCaption')
  )
})

test('reply keyboard Daftar Produk opens the product list', { timeout: 15000 }, async () => {
  harness.api.pushMessage('📦 Daftar Produk')
  const catalog = await harness.api.waitForOutgoing((c) => (
    c.method === 'sendPhoto' && /LIST PRODUCT|Netflix/i.test(captionOf(c))
  ))
  assert.match(captionOf(catalog), /Netflix/i)
})
