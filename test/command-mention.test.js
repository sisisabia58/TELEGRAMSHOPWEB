const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const assert = require('node:assert/strict')

const {
  commandMention,
  commandAddressesBot,
  createBotUsernameCache,
  installCommandMentionGuard,
} = require('../lib/command-mention')

function fakeBot() {
  const listeners = []
  return {
    listeners,
    onText(regexp, callback) {
      listeners.push({ regexp, callback })
    },
  }
}

test('commandMention reads only a suffix glued to the command', () => {
  assert.equal(commandMention('/getid'), null)
  assert.equal(commandMention('/getid payload'), null)
  assert.equal(commandMention('/getid@AnotherBot'), 'AnotherBot')
  assert.equal(commandMention('/getid@AnotherBot extra'), 'AnotherBot')
  assert.equal(commandMention('hello /getid@AnotherBot'), null)
})

test('commandAddressesBot allows a bare command and this bot, ignores others', () => {
  assert.equal(commandAddressesBot('/getid', 'ShopBot'), true)
  assert.equal(commandAddressesBot('/getid payload', 'ShopBot'), true)
  assert.equal(commandAddressesBot('/getid@ShopBot', 'ShopBot'), true)
  assert.equal(commandAddressesBot('/getid@shopbot extra', '@ShopBot'), true)
  assert.equal(commandAddressesBot('/getid@AnotherBot', 'ShopBot'), false)
  assert.equal(commandAddressesBot('/listuser@AnotherBot', ''), false)
  assert.equal(commandAddressesBot('/saldo', ''), true)
})

test('createBotUsernameCache calls getMe once and retries after failure', async () => {
  let calls = 0
  const getCached = createBotUsernameCache(async () => {
    calls += 1
    if (calls === 1) throw new Error('network')
    return { username: '@ShopBot' }
  })
  const first = getCached()
  const concurrent = getCached()
  assert.equal(await first, '')
  assert.equal(await concurrent, '')
  assert.equal(await getCached(), 'ShopBot')
  assert.equal(await getCached(), 'ShopBot')
  assert.equal(calls, 2)
})

test('mention guard skips other usernames and still runs bare and own commands', async () => {
  const bot = fakeBot()
  let reads = 0
  installCommandMentionGuard(bot, async () => {
    reads += 1
    return 'ShopBot'
  })
  const ran = []
  const pattern = /^\/getid(?:@\w+)?(?:\s|$)/
  bot.onText(pattern, async (msg, match) => {
    ran.push({ text: msg.text, matched: match[0] })
  })
  bot.onText(/^\/saldo(?:@\w+)?(?:\s|$)/, async (msg) => {
    ran.push({ text: msg.text, matched: 'saldo' })
  })

  async function deliver(text) {
    for (const listener of bot.listeners) {
      const match = listener.regexp.exec(text)
      if (match) await listener.callback({ text }, match)
    }
  }

  await deliver('/getid@AnotherBot')
  await deliver('/saldo@AnotherBot')
  await deliver('/getid')
  await deliver('/getid@ShopBot')
  await deliver('/getid@shopbot extra')

  assert.deepEqual(ran, [
    { text: '/getid', matched: '/getid' },
    { text: '/getid@ShopBot', matched: '/getid@ShopBot' },
    { text: '/getid@shopbot extra', matched: '/getid@shopbot ' },
  ])
  assert.equal(reads, 4)
})

test('mention guard ignores @mentions when getMe fails, then accepts this bot', async () => {
  const bot = fakeBot()
  let username = ''
  installCommandMentionGuard(bot, async () => username)
  const ran = []
  bot.onText(/^\/getid(?:@\w+)?(?:\s|$)/, async (msg) => {
    ran.push(msg.text)
  })
  const listener = bot.listeners[0]
  async function deliver(text) {
    const match = listener.regexp.exec(text)
    if (match) await listener.callback({ text }, match)
  }
  await deliver('/getid')
  await deliver('/getid@ShopBot')
  username = 'ShopBot'
  await deliver('/getid@ShopBot')
  await deliver('/getid@AnotherBot')
  assert.deepEqual(ran, ['/getid', '/getid@ShopBot'])
})

test('index.js installs the shared mention guard before any onText handler', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8')
  const guardAt = src.indexOf('installCommandMentionGuard(')
  const onTextAt = src.indexOf('bot.onText(')
  assert.ok(guardAt > -1)
  assert.ok(onTextAt > guardAt)
  assert.equal(src.includes('createBotUsernameCache(() => bot.getMe())'), true)
})
