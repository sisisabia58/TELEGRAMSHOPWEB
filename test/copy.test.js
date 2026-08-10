const test = require('node:test')
const assert = require('node:assert')

const jalurClient = require.resolve('../lib/supabase.js')
const jalurCopy = require.resolve('../lib/copy.js')

function muatCopy(rows = []) {
  delete require.cache[jalurCopy]
  require.cache[jalurClient] = {
    id: jalurClient,
    filename: jalurClient,
    loaded: true,
    exports: {
      from(tabel) {
        assert.equal(tabel, 'BotCopy')
        const b = {
          select() { return b },
          then(res, rej) {
            return Promise.resolve({ data: rows, error: null }).then(res, rej)
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

test('render replaces {{vars}} and missing becomes empty', () => {
  const copy = muatCopy()
  assert.equal(copy.render('Halo {{nama}}!', { nama: 'Wisnu' }), 'Halo Wisnu!')
  assert.equal(copy.render('X{{missing}}Y', {}), 'XY')
})

test('get uses DEFAULTS when cache empty', () => {
  const copy = muatCopy()
  const body = copy.get('msg.reply_nav_enabled')
  assert.match(body, /navigasi cepat/i)
})

test('get prefers DB body after refresh', async () => {
  const copy = muatCopy([
    { key: 'msg.reply_nav_enabled', body: 'CUSTOM NAV' },
  ])
  await copy.refresh()
  assert.equal(copy.get('msg.reply_nav_enabled'), 'CUSTOM NAV')
})

test('get renders vars on DB body', async () => {
  const copy = muatCopy([
    { key: 'screen.welcome', body: 'Hi {{first_name}} @ {{nama_bot}}' },
  ])
  await copy.refresh()
  assert.equal(
    copy.get('screen.welcome', { first_name: 'A', nama_bot: 'Shop' }),
    'Hi A @ Shop'
  )
})

test('get unknown key returns fallback or key', () => {
  const copy = muatCopy()
  assert.equal(copy.get('no.such', {}, 'FALL'), 'FALL')
  assert.equal(copy.get('no.such'), 'no.such')
})

test('err and btn defaults exist and render vars', () => {
  const copy = muatCopy()
  assert.match(copy.get('err.stock_insufficient', { count: 3 }), /3/)
  assert.match(copy.get('err.voucher_not_found', { kode: 'ABC' }), /ABC/)
  assert.equal(copy.get('btn.konfirmasi'), '✅ Konfirmasi')
  assert.match(
    copy.get('err.retired_command', { dashboard_line: '\n\n🔗 https://dash.example' }),
    /dash\.example/
  )
})

test('unknown err key falls back', () => {
  const copy = muatCopy()
  assert.equal(copy.get('err.does_not_exist', {}, 'fallback'), 'fallback')
})
