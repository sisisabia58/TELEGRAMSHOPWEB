const path = require('node:path')
const test = require('node:test')
const assert = require('node:assert/strict')
const ejs = require('ejs')

const viewRoot = path.join(__dirname, '..', 'views')

const baseLocals = {
  title: 'Hint test',
  namaBot: 'Test Bot',
  username: 'tester',
  req: { session: { role: 'admin' } },
  topbarExtra: '',
}

test('channel-contact settings shows a CS hint when the link is empty', async () => {
  const html = await ejs.renderFile(
    path.join(viewRoot, 'settings-channel-contact.ejs'),
    {
      ...baseLocals,
      currentPage: 'settings-channel-contact',
      pageTitle: 'Channel & Contact',
      settings: {
        channelLog: '',
        channelStore: '',
        cs: '',
        feedChannel: '',
        feedStockEnabled: true,
        feedPurchaseEnabled: true,
      },
    },
    { views: [viewRoot] }
  )
  assert.match(html, /alert-warning/)
  assert.match(html, /Customer Service belum diisi/i)
  assert.match(html, /disembunyikan/i)
})

test('channel-contact settings hides the CS hint when a link is set', async () => {
  const html = await ejs.renderFile(
    path.join(viewRoot, 'settings-channel-contact.ejs'),
    {
      ...baseLocals,
      currentPage: 'settings-channel-contact',
      pageTitle: 'Channel & Contact',
      settings: {
        channelLog: '',
        channelStore: 'https://t.me/shop',
        cs: 'https://t.me/cs',
        feedChannel: '',
        feedStockEnabled: true,
        feedPurchaseEnabled: true,
      },
    },
    { views: [viewRoot] }
  )
  assert.equal(html.includes('Customer Service belum diisi'), false)
})

test('Flow Builder shows a CS hint when the link is missing', async () => {
  const html = await ejs.renderFile(
    path.join(viewRoot, 'settings-bot-flow.ejs'),
    {
      ...baseLocals,
      currentPage: 'settings-bot-flow',
      pageTitle: 'Bot Flow',
      csMissing: true,
    },
    { views: [viewRoot] }
  )
  assert.match(html, /alert-warning/)
  assert.match(html, /Customer Service belum diisi/i)
  assert.match(html, /\/settings\/channel-contact/)
})

test('Flow Builder hides the CS hint when the link is set', async () => {
  const html = await ejs.renderFile(
    path.join(viewRoot, 'settings-bot-flow.ejs'),
    {
      ...baseLocals,
      currentPage: 'settings-bot-flow',
      pageTitle: 'Bot Flow',
      csMissing: false,
    },
    { views: [viewRoot] }
  )
  assert.equal(html.includes('Customer Service belum diisi'), false)
})
