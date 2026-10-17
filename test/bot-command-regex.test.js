const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const assert = require('node:assert/strict')

// Same form as PR #52 (cursor/bot-test-harness-b3e3):
// /^\/cmd(?:@\w+)?(?:\s|$)/
const COMMANDS = [
  'start',
  'listuser',
  'getid',
  'saldo',
  'deposit',
  'riwayatdeposit',
  'rekap',
  'stok',
]

function commandRe(name) {
  return new RegExp(`^\\/${name}(?:@\\w+)?(?:\\s|$)`)
}

test('command regex matches /cmd, /cmd payload, and /cmd@BotName only', () => {
  for (const name of COMMANDS) {
    const re = commandRe(name)
    assert.equal(re.test(`/${name}`), true, `/${name}`)
    assert.equal(re.test(`/${name} payload`), true, `/${name} payload`)
    assert.equal(re.test(`/${name}@BotName`), true, `/${name}@BotName`)
    assert.equal(re.test(`/${name}@BotName extra`), true, `/${name}@BotName extra`)
    assert.equal(re.test(`hello /${name}`), false, `hello /${name}`)
    assert.equal(re.test(` /${name}`), false, `leading space /${name}`)
    assert.equal(re.test(`/${name}ing`), false, `/${name}ing`)
  }
  const start = commandRe('start')
  assert.equal(start.test('/starting'), false)
  assert.equal(commandRe('deposit').test('/riwayatdeposit'), false)
})

test('index.js uses the PR #52 anchored onText form for each command', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8')
  for (const name of COMMANDS) {
    const needle = `bot.onText(/^\\/${name}(?:@\\w+)?(?:\\s|$)/,`
    assert.equal(
      src.includes(needle),
      true,
      `index.js must register ${needle}`
    )
    assert.equal(
      src.includes(`bot.onText(/\\/${name}/,`),
      false,
      `index.js must not keep unanchored /${name}`
    )
  }
})
