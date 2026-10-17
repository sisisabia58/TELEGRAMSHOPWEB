const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

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
