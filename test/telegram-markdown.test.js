const test = require('node:test')
const assert = require('node:assert/strict')
const { validateTelegramMarkdown } = require('../lib/telegram-markdown')

test('accepts plain text and balanced Telegram Markdown entities', () => {
  assert.equal(validateTelegramMarkdown('Halo').ok, true)
  assert.equal(validateTelegramMarkdown('Halo, *{{first_name}}*').ok, true)
  assert.equal(validateTelegramMarkdown('_italic_ and `code`').ok, true)
  assert.equal(validateTelegramMarkdown('```pre formatted```').ok, true)
  assert.equal(validateTelegramMarkdown('[CS](https://t.me/example)').ok, true)
  assert.equal(validateTelegramMarkdown('price is 2\\*2').ok, true)
})

test('folds {{placeholders}} so names with underscores are not italic delimiters', () => {
  assert.equal(validateTelegramMarkdown('Hi {{first_name}}').ok, true)
  assert.equal(validateTelegramMarkdown('*{{nama_bot}}*').ok, true)
})

test('rejects unbalanced and nested Markdown entities', () => {
  assert.equal(validateTelegramMarkdown('*bold').ok, false)
  assert.match(validateTelegramMarkdown('*bold').reason, /unbalanced Markdown \*/)
  assert.equal(validateTelegramMarkdown('_italic').ok, false)
  assert.equal(validateTelegramMarkdown('`code').ok, false)
  assert.equal(validateTelegramMarkdown('```pre').ok, false)
  assert.equal(validateTelegramMarkdown('*bold _italic_*').ok, false)
  assert.match(validateTelegramMarkdown('*bold _italic_*').reason, /nested/)
  assert.equal(validateTelegramMarkdown('**').ok, false)
})

test('rejects incomplete or empty Markdown links', () => {
  const open = validateTelegramMarkdown('[no close')
  assert.equal(open.ok, false)
  assert.match(open.reason, /link/)
  assert.equal(validateTelegramMarkdown('[label](').ok, false)
  assert.equal(validateTelegramMarkdown('[](https://t.me/x)').ok, false)
  assert.equal(validateTelegramMarkdown('[label]()').ok, false)
})

test('rejects non-string input', () => {
  assert.equal(validateTelegramMarkdown(null).ok, false)
  assert.equal(validateTelegramMarkdown(12).ok, false)
})
