const test = require('node:test')
const assert = require('node:assert')

const insightx = require('../lib/suppliers/insightx')
const registry = require('../lib/suppliers')

const KUNCI = 'sk_live_fake_bukan_kunci_asli'
const KREDENSIAL = { baseUrl: insightx.defaultBaseUrl, apiKey: KUNCI }

const GEMINI = {
  id: 14,
  name: 'Gemini Pro 18 Months',
  description_text: '18 Months Plan',
  price: 1.5,
  price_usdt: 1.5,
  base_price_usdt: 1,
  stock: 250,
  available: true,
  unlimited: false,
}

const BASE = 'https://api.insightxpro.store/api/v1'

function httpErr(status, data) {
  const err = new Error(`Request failed with status code ${status}`)
  err.response = { status, data }
  err.config = { headers: { Authorization: `Bearer ${KUNCI}` } }
  return err
}

test.before(() => {
  registry.__setLookup(async () => [{ address: '203.0.113.10', family: 4 }])
  delete process.env.INSIGHTX_API_KEY
})

test.after(() => {
  registry.__setLookup(null)
  insightx.__setHttp(require('axios'))
  delete process.env.INSIGHTX_API_KEY
})

test('normalizeProductRow memakai base_price_usdt, bukan harga jual yang di-pin', () => {
  const n = insightx.normalizeProductRow(GEMINI)
  assert.equal(n.externalId, '14')
  assert.equal(n.nama, 'Gemini Pro 18 Months')
  assert.equal(n.hargaAsal, 1)
  assert.equal(n.currency, 'USDT')
  assert.equal(n.stok, 250)
  assert.equal(n.inStock, true)
  assert.equal(n.takTerbatas, false)
  assert.equal(n.deskripsi, '18 Months Plan')
})

test('unlimited menjadi sentinel, available false tidak dijual', () => {
  const n = insightx.normalizeProductRow({
    id: 21,
    name: 'Link terbuka',
    base_price_usdt: 4,
    stock: 999999,
    available: true,
    unlimited: true,
  })
  assert.equal(n.hargaAsal, 4)
  assert.equal(n.stok, insightx.STOK_TAK_TERBATAS)
  assert.equal(n.inStock, true)
  assert.equal(n.takTerbatas, true)

  const habis = insightx.normalizeProductRow({
    ...GEMINI,
    stock: 0,
    available: false,
    unlimited: true,
  })
  assert.equal(habis.stok, 0)
  assert.equal(habis.inStock, false)
  assert.equal(habis.takTerbatas, false)
})

test('normalizeProductRow membuang baris tanpa id angka, tanpa harga, atau bukan USDT', () => {
  assert.equal(insightx.normalizeProductRow({ name: 'tanpa id', base_price_usdt: 1 }), null)
  assert.equal(insightx.normalizeProductRow({ id: 9, base_price_usdt: null, stock: 1, available: true }).hargaAsal, null)
  assert.equal(insightx.normalizeProductRow({ slug: 'bolt-pro', name: 'Bolt Pro', price: 19.5, stock: 3, available: true }), null)
  assert.equal(insightx.normalizeProductRow({ ...GEMINI, currency: 'USD' }), null)
  assert.equal(insightx.normalizeProductRow({ ...GEMINI, currency: 'EUR' }), null)
})

test('normalizeOrderResponse membaca order.codes di amplop Reseller API', () => {
  const r = insightx.normalizeOrderResponse({
    order: {
      order_id: 6782,
      id: 6782,
      product_id: 14,
      quantity: 2,
      status: 'completed',
      codes: ['KEY-A1904-8842', 'KEY-B8912-7719'],
      delivered_codes: ['KEY-A1904-8842', 'KEY-B8912-7719'],
    },
  })
  assert.equal(r.ok, true)
  assert.equal(r.orderId, '6782')
  assert.deepEqual(r.keys, ['KEY-A1904-8842', 'KEY-B8912-7719'])
  assert.equal(r.status, 'completed')
  assert.equal(r.placed, false)
})

test('respons test mode tidak menjadi stok sungguhan', () => {
  const r = insightx.normalizeOrderResponse({
    order: {
      order_id: 0,
      id: 0,
      status: 'completed',
      codes: ['TEST-A014-0001'],
      test: true,
    },
  })
  assert.equal(r.ok, false)
  assert.equal(r.status, 'test')
  assert.deepEqual(r.keys, [])
  assert.equal(r.placed, false)
})

test('status partial dengan kode tetap berhasil; tanpa kode ditandai placed', () => {
  const sebagian = insightx.normalizeOrderResponse({
    data: {
      id: 'ord-p',
      status: 'partial',
      items: [{ delivered: 'KODE-1' }, { delivered: '  ' }],
    },
  })
  assert.equal(sebagian.ok, true)
  assert.deepEqual(sebagian.keys, ['KODE-1'])
  assert.equal(sebagian.placed, false)

  const kosong = insightx.normalizeOrderResponse({
    data: { id: 'ord-kosong', status: 'completed', items: [] },
  })
  assert.equal(kosong.ok, false)
  assert.equal(kosong.placed, true)
  assert.deepEqual(kosong.keys, [])
})

test('riwayat tanpa field items tidak ditandai placed', () => {
  const r = insightx.normalizeOrderResponse({
    id: 'ord-meta',
    status: 'completed',
    quantity: 1,
    charged: 2,
  })
  assert.equal(r.ok, false)
  assert.equal(r.placed, false)
  assert.equal(r.orderId, 'ord-meta')
})

test('normalizeBalance membaca balance_usdt', () => {
  const b = insightx.normalizeBalance({
    balance_usdt: 148.25,
    key_prefix: 'isk_live_9f83',
    status: 'active',
    currency: 'USD',
  })
  assert.equal(b.usdt, 148.25)
  assert.equal(b.usd, 148.25)
  assert.equal(b.points, 0)
  assert.equal(b.currency, 'USDT')
  assert.equal(JSON.stringify(b).includes('isk_live_'), false)
})

test('listProducts mengirim Bearer ke Reseller API dan melewati baris yang tidak bisa dijual', async () => {
  let dilihat = null
  insightx.__setHttp({
    get: async (url, cfg) => {
      dilihat = { url, cfg }
      return {
        data: {
          products: [
            GEMINI,
            { id: 15, name: 'Habis', base_price_usdt: 1, stock: 0, available: false },
            { id: 16, name: 'Euro', base_price_usdt: 1, currency: 'EUR', stock: 3, available: true },
            { name: 'tanpa id', base_price_usdt: 1, stock: 1, available: true },
          ],
        },
      }
    },
  })

  const hasil = await insightx.listProducts(KREDENSIAL)
  assert.deepEqual(hasil.produk.map((p) => p.externalId), ['14', '15'])
  assert.equal(hasil.produk[1].stok, 0)
  assert.equal(hasil.skipped, 2)
  assert.equal(dilihat.cfg.headers.Authorization, `Bearer ${KUNCI}`)
  assert.equal(dilihat.cfg.headers['X-API-Key'], undefined)
  assert.equal(dilihat.cfg.maxRedirects, 0)
  assert.equal(dilihat.url, `${BASE}/products`)
})

test('createOrder mengirim product_id angka, quantity, dan idempotency_key', async () => {
  let dikirim = null
  insightx.__setHttp({
    post: async (url, body, cfg) => {
      dikirim = { url, body, cfg }
      return {
        data: {
          order: {
            id: 6782,
            order_id: 6782,
            status: 'completed',
            codes: ['user:pass'],
          },
        },
      }
    },
  })

  const r = await insightx.createOrder({
    ...KREDENSIAL,
    externalId: '14',
    quantity: 3,
    idempotencyKey: 'TRX-1-nouser-sup-ext-q3',
    maxPrice: 2,
  })
  assert.equal(r.ok, true)
  assert.deepEqual(r.keys, ['user:pass'])
  assert.deepEqual(dikirim.body, {
    product_id: 14,
    quantity: 3,
    idempotency_key: 'TRX-1-nouser-sup-ext-q3',
  })
  assert.equal(typeof dikirim.body.product_id, 'number')
  assert.equal(dikirim.body.product, undefined)
  assert.equal(dikirim.body.max_price, undefined)
  assert.equal(dikirim.cfg.headers.Authorization, `Bearer ${KUNCI}`)
  assert.equal(dikirim.cfg.headers['X-API-Key'], undefined)
  assert.equal(dikirim.cfg.headers['X-Test-Mode'], undefined)
  assert.equal(dikirim.url, `${BASE}/orders`)
})

test('quantity bukan bilangan bulat positif dan product_id non-angka ditolak sebelum request', async () => {
  let terkirim = false
  insightx.__setHttp({
    post: async () => { terkirim = true; return { data: {} } },
  })
  await assert.rejects(
    () => insightx.createOrder({ ...KREDENSIAL, externalId: '14', quantity: 0, idempotencyKey: 'k' }),
    (e) => e.response?.status === 400 && /positif/.test(e.message),
  )
  await assert.rejects(
    () => insightx.createOrder({ ...KREDENSIAL, externalId: '14', quantity: 1.5, idempotencyKey: 'k' }),
    (e) => e.response?.status === 400,
  )
  await assert.rejects(
    () => insightx.createOrder({ ...KREDENSIAL, externalId: 'gemini-18-months', quantity: 1, idempotencyKey: 'k' }),
    /product_id/,
  )
  assert.equal(terkirim, false)
})

test('kunci kosong tidak mengirim request', async () => {
  let terkirim = false
  insightx.__setHttp({
    get: async () => { terkirim = true; return { data: {} } },
    post: async () => { terkirim = true; return { data: {} } },
  })
  delete process.env.INSIGHTX_API_KEY
  const kosong = { baseUrl: insightx.defaultBaseUrl, apiKey: '   ' }
  await assert.rejects(() => insightx.listProducts(kosong), /belum diautentikasi/)
  await assert.rejects(() => insightx.getBalance(kosong), (e) => e.response?.status === 401)
  await assert.rejects(() => insightx.testConnection(kosong), /belum diautentikasi/)
  await assert.rejects(() => insightx.createOrder({ ...kosong, externalId: '14', idempotencyKey: 'k' }), /belum diautentikasi/)
  assert.equal(terkirim, false)
})

test('api_key baris mengalahkan INSIGHTX_API_KEY; env dipakai kalau baris kosong', async () => {
  const auth = []
  insightx.__setHttp({
    get: async (_url, cfg) => {
      auth.push(cfg.headers.Authorization)
      return { data: { ok: true, data: { products: [] } } }
    },
  })
  process.env.INSIGHTX_API_KEY = 'sk_live_dari_env_palsu'
  await insightx.listProducts({ baseUrl: insightx.defaultBaseUrl, apiKey: '' })
  await insightx.listProducts({ baseUrl: insightx.defaultBaseUrl, apiKey: 'sk_live_dari_baris_palsu' })
  assert.deepEqual(auth, [
    'Bearer sk_live_dari_env_palsu',
    'Bearer sk_live_dari_baris_palsu',
  ])
})

test('402, 409, dan 404 dilempar tanpa membawa header Authorization', async () => {
  for (const [status, code] of [[402, 'insufficient_balance'], [409, 'out_of_stock'], [409, 'price_changed'], [404, 'product_not_found']]) {
    insightx.__setHttp({
      post: async () => { throw httpErr(status, { ok: false, error: { code, message: 'ditolak' } }) },
    })
    await assert.rejects(
      () => insightx.createOrder({ ...KREDENSIAL, externalId: '14', idempotencyKey: 'k' }),
      (e) => {
        assert.equal(e.response.status, status)
        assert.equal(e.response.data.error.code, code)
        assert.equal(e.config, undefined)
        assert.equal(JSON.stringify(e).includes(KUNCI), false)
        assert.equal(e.message, `HTTP ${status}: ${code}: ditolak`)
        return true
      },
    )
  }
})

test('createOrder menolak tanpa idempotencyKey dan tidak mengirim request', async () => {
  let terkirim = false
  insightx.__setHttp({ post: async () => { terkirim = true; return { data: {} } } })
  await assert.rejects(
    () => insightx.createOrder({ ...KREDENSIAL, externalId: 'gemini-18-months' }),
    /idempotencyKey/,
  )
  assert.equal(terkirim, false)
})

test('panggilan keluar menolak host di luar allowlist dan tidak mengirim kunci', async () => {
  let terkirim = false
  insightx.__setHttp({
    get: async () => { terkirim = true; return { data: {} } },
    post: async () => { terkirim = true; return { data: {} } },
  })
  const jahat = { baseUrl: 'https://penyerang.example.com/api/v1', apiKey: KUNCI }
  await assert.rejects(() => insightx.listProducts(jahat))
  await assert.rejects(() => insightx.getBalance(jahat))
  await assert.rejects(() => insightx.getOrder({ ...jahat, orderId: '1' }))
  await assert.rejects(() => insightx.testConnection(jahat))
  await assert.rejects(() => insightx.createOrder({ ...jahat, externalId: '14', idempotencyKey: 'k' }))
  assert.equal(terkirim, false)
})

test('base URL kosong dan host storefront lama memakai Reseller API', () => {
  const r = registry.validateBaseUrl('insightx', '')
  assert.equal(r.ok, true)
  assert.equal(r.value, BASE)
  assert.equal(registry.validateBaseUrl('insightx', 'https://insightxpro.com/api/v1').value, BASE)
  assert.equal(registry.validateBaseUrl('insightx', 'https://www.insightxpro.com/api/v1/').value, BASE)
  assert.equal(registry.validateBaseUrl('insightx', 'https://api.insightxpro.store').value, BASE)
  assert.equal(registry.validateBaseUrl('insightx', 'https://api.insightxpro.store/api/v1/products').value, BASE)
  assert.equal(registry.validateBaseUrl('insightx', 'https://insightxpro.com.evil.com/api/v1').ok, false)
  assert.equal(registry.validateBaseUrl('insightx', 'https://api.insightxpro.store.evil.com/api/v1').ok, false)
})

test('testConnection mengembalikan saldo USDT dan baris mentah', async () => {
  const dilihat = []
  insightx.__setHttp({
    get: async (url) => {
      dilihat.push(url)
      if (url.endsWith('/balance')) {
        return { data: { balance_usdt: 10, key_prefix: 'isk_live_abcd', status: 'active' } }
      }
      return { data: { products: [GEMINI] } }
    },
  })
  const r = await insightx.testConnection({
    baseUrl: 'https://insightxpro.com/api/v1',
    apiKey: KUNCI,
  })
  assert.equal(r.ok, true)
  assert.equal(r.balance.usdt, 10)
  assert.equal(r.balance.usd, 10)
  assert.equal(r.balance.currency, 'USDT')
  assert.equal(r.balance.points, 0)
  assert.equal(r.sampleCount, 1)
  assert.equal(r.sampleRaw.id, 14)
  assert.equal(r.sampleNormalized.currency, 'USDT')
  assert.equal(r.sampleNormalized.hargaAsal, 1)
  assert.deepEqual(dilihat, [`${BASE}/balance`, `${BASE}/products`])
})

test('listOrders dan getOrder memakai path yang didokumentasikan', async () => {
  const dilihat = []
  insightx.__setHttp({
    get: async (url) => {
      dilihat.push(url)
      if (url.endsWith('/orders/6782')) {
        return {
          data: {
            order: {
              id: 6782,
              order_id: 6782,
              status: 'completed',
              codes: ['kode'],
            },
          },
        }
      }
      return {
        data: {
          orders: [{ id: 6782, order_id: 6782, status: 'completed', quantity: 1 }],
        },
      }
    },
  })
  const daftar = await insightx.listOrders(KREDENSIAL)
  assert.equal(daftar.length, 1)
  assert.equal(daftar[0].orderId, '6782')
  assert.equal(daftar[0].placed, false)
  const satu = await insightx.getOrder({ ...KREDENSIAL, orderId: '6782' })
  assert.equal(satu.ok, true)
  assert.deepEqual(satu.keys, ['kode'])
  assert.deepEqual(dilihat, [
    `${BASE}/orders`,
    `${BASE}/orders/6782`,
  ])
})

test('registry mendaftarkan insightx', () => {
  assert.equal(registry.getAdapter('insightx'), insightx)
  assert.equal(registry.getAdapter('INSIGHTX'), insightx)
  const baris = registry.listAdapters().find((a) => a.key === 'insightx')
  assert.equal(baris.label, 'InsightX Pro')
  assert.equal(baris.defaultBaseUrl, BASE)
  assert.match(baris.authHint, /Bearer/)
  assert.match(baris.authHint, /api\.insightxpro\.store/)
  assert.match(baris.authHint, /USDT/)
  assert.match(baris.authHint, /isk_live_/)
  assert.match(baris.authHint, /isk_test_/)
  assert.equal(baris.keyPlaceholder, 'isk_live_…')
})

test('tempelan Bearer, Authorization, kutip, dan spasi tidak dibungkus dua kali', async () => {
  const auth = []
  insightx.__setHttp({
    get: async (_url, cfg) => {
      auth.push(cfg.headers.Authorization)
      assert.equal(cfg.headers['X-API-Key'], undefined)
      return { data: { ok: true, data: { products: [] } } }
    },
  })
  const kotor = [
    'Bearer sk_live_dari_baris_palsu',
    'bearer   sk_live_dari_baris_palsu',
    'Bearer Bearer sk_live_dari_baris_palsu',
    'Authorization: Bearer sk_live_dari_baris_palsu',
    '"sk_live_dari_baris_palsu"',
    "'sk_live_dari_baris_palsu'",
    '  sk_live_dari_baris_palsu\n',
    'sk_live_\u200Bdari_baris_palsu',
    'sk_live_dari_baris_palsu\r\n',
  ]
  for (const apiKey of kotor) {
    await insightx.listProducts({ baseUrl: insightx.defaultBaseUrl, apiKey })
  }
  assert.deepEqual(auth, kotor.map(() => 'Bearer sk_live_dari_baris_palsu'))
})

test('hanya kata Bearer tidak mengirim request', async () => {
  let terkirim = false
  insightx.__setHttp({
    get: async () => { terkirim = true; return { data: {} } },
  })
  delete process.env.INSIGHTX_API_KEY
  await assert.rejects(
    () => insightx.getBalance({ baseUrl: insightx.defaultBaseUrl, apiKey: 'Bearer   ' }),
    /api_key kosong/,
  )
  assert.equal(terkirim, false)
})

test('isk_live_ tidak dipotong pada sk_live_ yang ada di dalamnya', () => {
  assert.equal(insightx.normalizeApiKey('isk_live_abc123'), 'isk_live_abc123')
  assert.equal(insightx.normalizeApiKey('Bearer isk_live_abc123'), 'isk_live_abc123')
  assert.equal(insightx.normalizeApiKey('isk_live_FOO'), 'isk_live_FOO')
  assert.equal(registry.normalizeStoredApiKey('insightx', 'isk_live_abc123'), 'isk_live_abc123')
  assert.equal(registry.normalizeStoredApiKey('insightx', 'Bearer isk_live_abc123'), 'isk_live_abc123')
})

test('isk_live_ panjang 41 dikenali dan Bearer tidak digandakan', async () => {
  // Prod Test setelah #63: panjang 41, bentuk tidak dikenal. isk_live_ = 9
  // karakter, sisa 32 adalah rahasia. sk_live_ tidak cocok dengan awalan itu.
  const badan = 'x'.repeat(32)
  const kunci = `isk_live_${badan}`
  assert.equal(kunci.length, 41)
  let auth = null
  let url = null
  insightx.__setHttp({
    get: async (dipanggil, cfg) => {
      auth = cfg.headers.Authorization
      url = dipanggil
      assert.equal(cfg.headers['X-API-Key'], undefined)
      throw httpErr(401, { error: 'invalid or missing API key' })
    },
  })
  await assert.rejects(
    () => insightx.getBalance({ baseUrl: insightx.defaultBaseUrl, apiKey: `Bearer ${kunci}` }),
    (e) => {
      assert.equal(auth, `Bearer ${kunci}`)
      assert.equal(url, `${BASE}/balance`)
      assert.match(e.message, /HTTP 401: invalid or missing API key/)
      assert.match(e.message, /kunci terkirim panjang 41, bentuk isk_live_/)
      assert.equal(e.message.includes('xxx'), false)
      assert.equal(e.message.includes('tidak dikenal'), false)
      return true
    },
  )

  await assert.rejects(
    () => insightx.getBalance({ baseUrl: insightx.defaultBaseUrl, apiKey: 'Authorization: Bearer ISK_TEST_palsu' }),
    (e) => {
      assert.match(e.message, /bentuk isk_test_/)
      assert.equal(e.message.includes('ISK_TEST_palsu'), false)
      return true
    },
  )
  assert.equal(auth, 'Bearer ISK_TEST_palsu')
  assert.equal(
    registry.normalizeStoredApiKey('insightx', '  Bearer isk_live_dari_baris_palsu  '),
    'isk_live_dari_baris_palsu',
  )
})

test('401 InsightX menampilkan code dan message tanpa rahasia', async () => {
  insightx.__setHttp({
    get: async () => {
      throw httpErr(401, {
        ok: false,
        error: { code: 'unauthorized', message: `Invalid or missing API key. ${KUNCI}` },
      })
    },
  })
  await assert.rejects(
    () => insightx.getBalance(KREDENSIAL),
    (e) => {
      assert.equal(e.response.status, 401)
      assert.equal(e.response.data.error.code, 'unauthorized')
      assert.equal(e.config, undefined)
      assert.match(e.message, /^HTTP 401: unauthorized: Invalid or missing API key\. \[redacted\]/)
      assert.match(e.message, new RegExp(`kunci terkirim panjang ${KUNCI.length}, bentuk sk_live_`))
      assert.equal(e.message.includes(KUNCI), false)
      assert.equal(e.message.includes('fake_bukan'), false)
      return true
    },
  )
})

test('formatSupplierError tidak menggandakan HTTP 401', () => {
  const upstream = new Error('HTTP 401: unauthorized: Invalid or missing API key.')
  upstream.response = { status: 401, data: { ok: false, error: { code: 'unauthorized' } } }
  assert.equal(registry.formatSupplierError(upstream), upstream.message)
  assert.equal(registry.formatSupplierError(upstream, { sep: ' — ' }), upstream.message)

  const polos = new Error('gagal jaringan')
  assert.equal(registry.formatSupplierError(polos), 'gagal jaringan')
  const tanpaPesan = new Error('timeout')
  tanpaPesan.response = { status: 504 }
  assert.equal(registry.formatSupplierError(tanpaPesan), 'HTTP 504: timeout')
  assert.equal(registry.formatSupplierError(tanpaPesan, { sep: ' — ' }), 'HTTP 504 — timeout')
})

test('normalizeStoredApiKey hanya membuang Bearer untuk insightx', () => {
  assert.equal(registry.normalizeStoredApiKey('insightx', '  Bearer sk_live_dari_baris_palsu  '), 'sk_live_dari_baris_palsu')
  assert.equal(registry.normalizeStoredApiKey('hubx', '  Bearer rsk_test_palsu  '), 'Bearer rsk_test_palsu')
  assert.equal(registry.normalizeStoredApiKey('insightx', null), '')
  assert.equal(registry.normalizeStoredApiKey('insightx', ['sk_live_x']), '')
})
