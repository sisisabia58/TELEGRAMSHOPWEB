const test = require('node:test')
const assert = require('node:assert')

const insightx = require('../lib/suppliers/insightx')
const registry = require('../lib/suppliers')

const KUNCI = 'sk_live_fake_bukan_kunci_asli'
const KREDENSIAL = { baseUrl: insightx.defaultBaseUrl, apiKey: KUNCI }

const GEMINI = {
  id: '22222222-2222-4222-8222-222222222222',
  slug: 'gemini-18-months',
  name: 'Gemini 18 Months',
  price: 2,
  list_price: 2.5,
  reseller_price: true,
  currency: 'USD',
  stock: 6,
  in_stock: true,
}

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

test('normalizeProductRow memakai price USD, bukan list_price', () => {
  const n = insightx.normalizeProductRow(GEMINI)
  assert.equal(n.externalId, GEMINI.id)
  assert.equal(n.nama, 'Gemini 18 Months')
  assert.equal(n.hargaAsal, 2)
  assert.equal(n.currency, 'USD')
  assert.equal(n.stok, 6)
  assert.equal(n.inStock, true)
  assert.equal(n.takTerbatas, false)
  assert.match(n.deskripsi, /slug:gemini-18-months/)
  assert.match(n.deskripsi, /harga:reseller/)
  assert.equal(n.deskripsi.includes('2.5'), false)
})

test('stok null dan in_stock true menjadi sentinel, bukan nol', () => {
  const n = insightx.normalizeProductRow({
    id: 'tanpa-hitung',
    slug: 'notion-business',
    name: 'Notion business',
    price: '4.00',
    list_price: 4,
    reseller_price: false,
    currency: 'USD',
    stock: null,
    in_stock: true,
  })
  assert.equal(n.hargaAsal, 4)
  assert.equal(n.stok, insightx.STOK_TAK_TERBATAS)
  assert.equal(n.inStock, true)
  assert.equal(n.takTerbatas, true)
  assert.match(n.deskripsi, /list:4/)
})

test('stok null dan in_stock false tidak dijual', () => {
  const n = insightx.normalizeProductRow({
    ...GEMINI,
    stock: null,
    in_stock: false,
  })
  assert.equal(n.stok, 0)
  assert.equal(n.inStock, false)
  assert.equal(n.takTerbatas, false)
})

test('normalizeProductRow membuang baris tanpa id, tanpa harga, atau bukan USD', () => {
  assert.equal(insightx.normalizeProductRow({ name: 'tanpa id', price: 1, currency: 'USD' }), null)
  assert.equal(insightx.normalizeProductRow({ id: 'x', price: null, stock: 1, currency: 'USD' }).hargaAsal, null)
  assert.equal(insightx.normalizeProductRow({ ...GEMINI, currency: 'USDT' }), null)
  assert.equal(insightx.normalizeProductRow({ ...GEMINI, currency: 'EUR' }), null)
})

test('slug dipakai sebagai externalId kalau id tidak ada', () => {
  const n = insightx.normalizeProductRow({ slug: 'bolt-pro', name: 'Bolt Pro', price: 19.5, currency: 'USD', stock: 3, in_stock: true })
  assert.equal(n.externalId, 'bolt-pro')
})

test('normalizeOrderResponse membaca items[].delivered di amplop data', () => {
  const r = insightx.normalizeOrderResponse({
    ok: true,
    data: {
      id: 'ord-1',
      status: 'completed',
      quantity: 1,
      unit_price: 2,
      currency: 'USD',
      items: [{ order_number: 'IX-1042', delivered: 'email:pass / code' }],
    },
  })
  assert.equal(r.ok, true)
  assert.equal(r.orderId, 'ord-1')
  assert.deepEqual(r.keys, ['email:pass / code'])
  assert.equal(r.status, 'completed')
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

test('normalizeBalance membaca data.balance USD', () => {
  const b = insightx.normalizeBalance({ ok: true, data: { balance: '42.50', currency: 'USD' } })
  assert.equal(b.usd, 42.5)
  assert.equal(b.points, 0)
  assert.equal(b.currency, 'USD')
  assert.equal(b.usdt, undefined)
})

test('listProducts mengirim Bearer, membuka amplop data.products, dan melewati baris yang tidak bisa dijual', async () => {
  let dilihat = null
  insightx.__setHttp({
    get: async (url, cfg) => {
      dilihat = { url, cfg }
      return {
        data: {
          ok: true,
          data: {
            products: [
              GEMINI,
              { id: 'habis', name: 'Habis', price: 1, currency: 'USD', stock: 0, in_stock: false },
              { id: 'eur', name: 'Euro', price: 1, currency: 'EUR', stock: 3, in_stock: true },
              { name: 'tanpa id', price: 1, currency: 'USD', stock: 1, in_stock: true },
            ],
          },
        },
      }
    },
  })

  const hasil = await insightx.listProducts(KREDENSIAL)
  assert.deepEqual(hasil.produk.map((p) => p.externalId), [GEMINI.id, 'habis'])
  assert.equal(hasil.produk[1].stok, 0)
  assert.equal(hasil.skipped, 2)
  assert.equal(dilihat.cfg.headers.Authorization, `Bearer ${KUNCI}`)
  assert.equal(dilihat.cfg.headers['X-API-Key'], undefined)
  assert.equal(dilihat.cfg.maxRedirects, 0)
  assert.equal(dilihat.url, 'https://insightxpro.com/api/v1/products')
})

test('createOrder mengirim product, quantity, dan max_price tanpa idempotency di body', async () => {
  let dikirim = null
  insightx.__setHttp({
    post: async (url, body, cfg) => {
      dikirim = { url, body, cfg }
      return {
        data: {
          ok: true,
          data: {
            id: 'ord-ok',
            status: 'completed',
            items: [{ order_number: 'IX-1', delivered: 'user:pass' }],
          },
        },
      }
    },
  })

  const r = await insightx.createOrder({
    ...KREDENSIAL,
    externalId: 'gemini-18-months',
    quantity: 3,
    idempotencyKey: 'TRX-1-nouser-sup-ext-q3',
    maxPrice: 2,
  })
  assert.equal(r.ok, true)
  assert.deepEqual(r.keys, ['user:pass'])
  assert.deepEqual(dikirim.body, {
    product: 'gemini-18-months',
    quantity: 3,
    max_price: 2,
  })
  assert.equal(dikirim.body.external_order_id, undefined)
  assert.equal(dikirim.body.idempotencyKey, undefined)
  assert.equal(dikirim.cfg.headers.Authorization, `Bearer ${KUNCI}`)
  assert.equal(dikirim.cfg.headers['Idempotency-Key'], undefined)
  assert.equal(dikirim.url, 'https://insightxpro.com/api/v1/orders')
})

test('createOrder tanpa maxPrice tidak mengirim field max_price', async () => {
  let body = null
  insightx.__setHttp({
    post: async (_url, b) => {
      body = b
      return { data: { data: { id: '1', status: 'completed', items: [{ delivered: 'x' }] } } }
    },
  })
  await insightx.createOrder({
    ...KREDENSIAL,
    externalId: GEMINI.id,
    quantity: 1,
    idempotencyKey: 'k',
  })
  assert.equal(Object.prototype.hasOwnProperty.call(body, 'max_price'), false)
})

test('quantity di luar 1-50 ditolak sebelum request', async () => {
  let terkirim = false
  insightx.__setHttp({
    post: async () => { terkirim = true; return { data: {} } },
  })
  await assert.rejects(
    () => insightx.createOrder({ ...KREDENSIAL, externalId: 'x', quantity: 51, idempotencyKey: 'k' }),
    (e) => e.response?.status === 400 && /1-50/.test(e.message),
  )
  await assert.rejects(
    () => insightx.createOrder({ ...KREDENSIAL, externalId: 'x', quantity: 0, idempotencyKey: 'k' }),
    (e) => e.response?.status === 400,
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
  await assert.rejects(() => insightx.createOrder({ ...kosong, externalId: 'gemini-18-months', idempotencyKey: 'k' }))
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
      () => insightx.createOrder({ ...KREDENSIAL, externalId: 'gemini-18-months', idempotencyKey: 'k' }),
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
  await assert.rejects(() => insightx.createOrder({ ...jahat, externalId: 'x', idempotencyKey: 'k' }))
  assert.equal(terkirim, false)
})

test('base URL kosong memakai API publik InsightX', () => {
  const r = registry.validateBaseUrl('insightx', '')
  assert.equal(r.ok, true)
  assert.equal(r.value, 'https://insightxpro.com/api/v1')
  assert.equal(registry.validateBaseUrl('insightx', 'https://www.insightxpro.com/api/v1').ok, false)
  assert.equal(registry.validateBaseUrl('insightx', 'https://insightxpro.com.evil.com/api/v1').ok, false)
})

test('testConnection mengembalikan saldo USD dan baris mentah', async () => {
  insightx.__setHttp({
    get: async (url) => {
      if (url.endsWith('/balance')) {
        return { data: { ok: true, data: { balance: 10, currency: 'USD' } } }
      }
      return { data: { ok: true, data: { products: [GEMINI] } } }
    },
  })
  const r = await insightx.testConnection(KREDENSIAL)
  assert.equal(r.ok, true)
  assert.equal(r.balance.usd, 10)
  assert.equal(r.balance.currency, 'USD')
  assert.equal(r.balance.points, 0)
  assert.equal(r.sampleCount, 1)
  assert.equal(r.sampleRaw.slug, 'gemini-18-months')
  assert.equal(r.sampleNormalized.currency, 'USD')
  assert.equal(r.sampleNormalized.hargaAsal, 2)
})

test('listOrders dan getOrder memakai path yang didokumentasikan', async () => {
  const dilihat = []
  insightx.__setHttp({
    get: async (url) => {
      dilihat.push(url)
      if (url.endsWith('/orders/ord-9')) {
        return {
          data: {
            ok: true,
            data: { id: 'ord-9', status: 'completed', items: [{ delivered: 'kode' }] },
          },
        }
      }
      return {
        data: {
          ok: true,
          data: { orders: [{ id: 'ord-1', status: 'completed', quantity: 1 }] },
        },
      }
    },
  })
  const daftar = await insightx.listOrders(KREDENSIAL)
  assert.equal(daftar.length, 1)
  assert.equal(daftar[0].orderId, 'ord-1')
  assert.equal(daftar[0].placed, false)
  const satu = await insightx.getOrder({ ...KREDENSIAL, orderId: 'ord-9' })
  assert.equal(satu.ok, true)
  assert.deepEqual(satu.keys, ['kode'])
  assert.deepEqual(dilihat, [
    'https://insightxpro.com/api/v1/orders',
    'https://insightxpro.com/api/v1/orders/ord-9',
  ])
})

test('registry mendaftarkan insightx', () => {
  assert.equal(registry.getAdapter('insightx'), insightx)
  assert.equal(registry.getAdapter('INSIGHTX'), insightx)
  const baris = registry.listAdapters().find((a) => a.key === 'insightx')
  assert.equal(baris.label, 'InsightX Pro')
  assert.equal(baris.defaultBaseUrl, 'https://insightxpro.com/api/v1')
  assert.match(baris.authHint, /Bearer/)
  assert.match(baris.authHint, /USD/)
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
  insightx.__setHttp({
    get: async (_url, cfg) => {
      auth = cfg.headers.Authorization
      throw httpErr(401, { ok: false, error: { code: 'unauthorized', message: 'Invalid or missing API key.' } })
    },
  })
  await assert.rejects(
    () => insightx.getBalance({ baseUrl: insightx.defaultBaseUrl, apiKey: `Bearer ${kunci}` }),
    (e) => {
      assert.equal(auth, `Bearer ${kunci}`)
      assert.match(e.message, /HTTP 401: unauthorized: Invalid or missing API key\./)
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
