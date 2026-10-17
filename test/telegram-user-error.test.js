const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const assert = require('node:assert/strict')

const jalurClient = require.resolve('../lib/supabase.js')
const jalurCopy = require.resolve('../lib/copy.js')
const jalurCallbackError = require.resolve('../lib/telegram-user-error.js')

function muatCopy() {
  delete require.cache[jalurCopy]
  require.cache[jalurClient] = {
    id: jalurClient,
    filename: jalurClient,
    loaded: true,
    exports: {
      from() {
        const b = {
          select() { return b },
          then(res, rej) {
            return Promise.resolve({ data: [], error: null }).then(res, rej)
          },
        }
        return b
      },
    },
  }
  return require(jalurCopy)
}

function muatCallbackError() {
  delete require.cache[jalurCallbackError]
  return require(jalurCallbackError)
}

test.after(() => {
  delete require.cache[jalurClient]
  delete require.cache[jalurCopy]
  delete require.cache[jalurCallbackError]
})

test('user-facing copy never interpolates raw error text', () => {
  const copy = muatCopy()
  const leak = 'ETELEGRAM: 400 Bad Request SECRET_STACK'
  for (const key of [
    'err.load_failed',
    'err.deposit_create_failed',
    'err.deposit_qris_create_failed',
  ]) {
    const body = copy.get(key, { error: leak })
    assert.equal(body.includes(leak), false, key)
    assert.equal(body.includes('SECRET_STACK'), false, key)
    assert.match(body, /kesalahan|coba lagi|hubungi/i)
  }
})

test('callback catch logs server-side and sends err.load_failed, not raw err', async () => {
  const copy = muatCopy()
  const { reportCallbackFailure } = muatCallbackError()
  const err = new Error('ETELEGRAM: 400 Bad Request SECRET_STACK')
  const sent = []
  const logs = []
  await reportCallbackFailure(err, {
    userId: 42,
    copy,
    send: async (id, text) => { sent.push({ id, text }) },
    log: (...args) => logs.push(args),
  })
  assert.equal(logs.length, 1)
  assert.equal(logs[0][0], '[callback]')
  assert.equal(logs[0][1], err)
  assert.equal(sent.length, 1)
  assert.equal(sent[0].id, 42)
  assert.equal(sent[0].text.includes(err.message), false)
  assert.equal(sent[0].text.includes('SECRET_STACK'), false)
  assert.match(sent[0].text, /kesalahan|coba lagi|hubungi/i)

  const src = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8')
  assert.equal(src.includes('⚠️ ERROR: ${err}'), false)
  assert.equal(src.includes('⚠️ ERROR: ${err.message}'), false)
  assert.match(src, /reportCallbackFailure/)
  assert.equal(src.includes("copy.get('err.deposit_create_failed', { error: err.message })"), false)
  assert.equal(src.includes("copy.get('err.deposit_qris_create_failed', { error: err.message })"), false)
})
