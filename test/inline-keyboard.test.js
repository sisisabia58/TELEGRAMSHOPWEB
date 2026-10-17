const test = require('node:test')
const assert = require('node:assert/strict')

const jalur = require.resolve('../lib/inline-keyboard.js')

function muat() {
  delete require.cache[jalur]
  return require(jalur)
}

test('sanitizeInlineKeyboard skips empty and invalid url buttons', () => {
  const { sanitizeInlineKeyboard } = muat()
  const rows = [
    [{ text: 'Stay', callback_data: 'ok' }, { text: 'CS', url: '' }],
    [{ text: 'Bad', url: 'javascript:alert(1)' }],
    [{ text: 'Ftp', url: 'ftp://example.com' }],
    [{ text: 'Bare', url: 't.me/shop' }],
    [{ text: 'Space', url: '   ' }],
    [{ text: 'Nullish', url: null }],
  ]
  const out = sanitizeInlineKeyboard(rows)
  assert.deepEqual(out, [[{ text: 'Stay', callback_data: 'ok' }]])
})

test('sanitizeInlineKeyboard keeps http, https and tg urls and drops empty rows', () => {
  const { sanitizeInlineKeyboard } = muat()
  const rows = [
    [{ text: 'Web', url: 'https://t.me/shop' }],
    [{ text: 'Http', url: 'http://example.com/help' }],
    [{ text: 'Tg', url: 'tg://resolve?domain=shopcs' }],
    [{ text: 'Empty', url: '' }],
  ]
  const out = sanitizeInlineKeyboard(rows)
  assert.equal(out.length, 3)
  assert.equal(out[0][0].url, 'https://t.me/shop')
  assert.equal(out[1][0].url, 'http://example.com/help')
  assert.equal(out[2][0].url, 'tg://resolve?domain=shopcs')
})

test('sanitizeInlineKeyboard trims valid urls', () => {
  const { sanitizeInlineKeyboard } = muat()
  const out = sanitizeInlineKeyboard([
    [{ text: 'CS', url: '  https://t.me/cs  ' }],
  ])
  assert.equal(out[0][0].url, 'https://t.me/cs')
})

test('isAllowedInlineUrl accepts http(s) and tg://, rejects tg: without slashes', () => {
  const { isAllowedInlineUrl } = muat()
  assert.equal(isAllowedInlineUrl('https://t.me/cs'), true)
  assert.equal(isAllowedInlineUrl('http://example.com/help'), true)
  assert.equal(isAllowedInlineUrl('tg://resolve?domain=shopcs'), true)
  assert.equal(isAllowedInlineUrl('TG://resolve?domain=shopcs'), true)
  assert.equal(isAllowedInlineUrl('tg:resolve?domain=shopcs'), false)
  assert.equal(isAllowedInlineUrl('ftp://example.com'), false)
  assert.equal(isAllowedInlineUrl('javascript:alert(1)'), false)
  assert.equal(isAllowedInlineUrl(''), false)
})

test('sanitizeInlineKeyboard skips tg: urls that lack the // prefix', () => {
  const { sanitizeInlineKeyboard } = muat()
  const out = sanitizeInlineKeyboard([
    [{ text: 'BadTg', url: 'tg:resolve?domain=shopcs' }],
    [{ text: 'Ok', callback_data: 'x' }],
  ])
  assert.deepEqual(out, [[{ text: 'Ok', callback_data: 'x' }]])
})

test('sanitizeInlineKeyboard warns once per skipped source, not every call', () => {
  const { sanitizeInlineKeyboard } = muat()
  const warnings = []
  const orig = console.warn
  console.warn = (...args) => warnings.push(args.map(String).join(' '))
  try {
    sanitizeInlineKeyboard([[{ text: 'CS', url: '' }]])
    sanitizeInlineKeyboard([[{ text: 'CS', url: '' }]])
    sanitizeInlineKeyboard([[{ text: 'CS', url: 'not-a-url' }]])
    assert.equal(warnings.length, 1)
    assert.match(warnings[0], /skipped URL button/i)
    assert.equal(warnings[0].includes('javascript:'), false)
  } finally {
    console.warn = orig
  }
})
