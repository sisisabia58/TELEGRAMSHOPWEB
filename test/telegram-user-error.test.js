const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const assert = require('node:assert/strict')

const jalurClient = require.resolve('../lib/supabase.js')
const jalurCopy = require.resolve('../lib/copy.js')

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

test.after(() => {
  delete require.cache[jalurClient]
  delete require.cache[jalurCopy]
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

test('callback catch logs server-side and sends err.load_failed, not raw err', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8')
  assert.equal(src.includes('⚠️ ERROR: ${err}'), false)
  assert.equal(src.includes('⚠️ ERROR: ${err.message}'), false)
  assert.match(src, /copy\.get\('err\.load_failed'\)/)
  assert.equal(src.includes("copy.get('err.deposit_create_failed', { error: err.message })"), false)
  assert.equal(src.includes("copy.get('err.deposit_qris_create_failed', { error: err.message })"), false)
})
