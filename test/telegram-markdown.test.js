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
  // Documented close / escape / reopen, because \\ is not an escape inside an entity.
  assert.equal(validateTelegramMarkdown('*2*\\**2=4*').ok, true)
  assert.equal(validateTelegramMarkdown('_snake_\\__case_').ok, true)
})

test('folds {{placeholders}} so names with underscores are not italic delimiters', () => {
  assert.equal(validateTelegramMarkdown('Hi {{first_name}}').ok, true)
  assert.equal(validateTelegramMarkdown('*{{nama_bot}}*').ok, true)
})

test('reads bold and italic interiors literally', () => {
  assert.equal(validateTelegramMarkdown('*bold _italic_*').ok, true)
  assert.equal(validateTelegramMarkdown('*Hubungi @cs_toko*').ok, true)
  assert.equal(validateTelegramMarkdown('_lihat [di sini]_').ok, true)
})

test('rejects unbalanced Markdown entities and empty delimiters', () => {
  assert.equal(validateTelegramMarkdown('*bold').ok, false)
  assert.match(validateTelegramMarkdown('*bold').reason, /unbalanced Markdown \*/)
  assert.equal(validateTelegramMarkdown('_italic').ok, false)
  assert.equal(validateTelegramMarkdown('`code').ok, false)
  assert.equal(validateTelegramMarkdown('```pre').ok, false)
  // The first * closes at the next *, so the trailing _ is left open.
  const crossed = validateTelegramMarkdown('*a _b* c_')
  assert.equal(crossed.ok, false)
  assert.match(crossed.reason, /unbalanced Markdown _/)
  assert.equal(validateTelegramMarkdown('**').ok, false)
  assert.match(validateTelegramMarkdown('**').reason, /empty Markdown bold/)
  assert.equal(validateTelegramMarkdown('__').ok, false)
  assert.match(validateTelegramMarkdown('__').reason, /empty Markdown italic/)
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
