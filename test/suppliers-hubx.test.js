const test = require('node:test')
const assert = require('node:assert')

const hubx = require('../lib/suppliers/hubx')
const registry = require('../lib/suppliers')

const KUNCI = 'rsk_test_fake_bukan_kunci_asli'
const KREDENSIAL = { baseUrl: hubx.defaultBaseUrl, apiKey: KUNCI }

const SANDBOX = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'sandbox-test',
  name: 'Sandbox Test',
  price_usdt: 0.01,
  stock: 'unlimited',
  active: true,
  fulfillment_type: 'instant',
}

function httpErr(status, data) {
  const err = new Error(`Request failed with status code ${status}`)
  err.response = { status, data }
  err.config = { headers: { Authorization: `Bearer ${KUNCI}` } }
  return err
}

test.before(() => {
  registry.__setLookup(async () => [{ address: '203.0.113.10', family: 4 }])
  delete process.env.HUBX_API_KEY
})

test.after(() => {
  registry.__setLookup(null)
  hubx.__setHttp(require('axios'))
  hubx.__resetPoll()
  delete process.env.HUBX_API_KEY
})

test('normalizeProductRow memetakan katalog HubX dan stok unlimited', () => {
  const n = hubx.normalizeProductRow(SANDBOX)
  assert.equal(n.externalId, SANDBOX.id)
  assert.equal(n.nama, 'Sandbox Test')
  assert.equal(n.hargaAsal, 0.01)
  assert.equal(n.currency, 'USDT')
  assert.equal(n.stok, hubx.STOK_TAK_TERBATAS)
  assert.equal(n.inStock, true)
  assert.equal(n.takTerbatas, true)
  assert.match(n.deskripsi, /slug:sandbox-test/)
})

test('normalizeProductRow menerima stok angka dan harga string', () => {
  const n = hubx.normalizeProductRow({
    id: '3f2b',
    slug: 'gemini-pro-1m',
    name: 'Gemini Pro · 1 month',
    price_usdt: '3.50',
    stock: 42,
    active: true,
    fulfillment_type: 'manual',
  })
  assert.equal(n.hargaAsal, 3.5)
  assert.equal(n.stok, 42)
  assert.equal(n.inStock, true)
  assert.equal(n.takTerbatas, false)
  assert.match(n.deskripsi, /fulfillment:manual/)
})

test('normalizeProductRow membuang produk nonaktif dan tanpa harga', () => {
  assert.equal(hubx.normalizeProductRow({ ...SANDBOX, active: false }), null)
  assert.equal(hubx.normalizeProductRow({ id: 'x', price_usdt: null, stock: 1, active: true }).hargaAsal, null)
  assert.equal(hubx.normalizeProductRow({ name: 'tanpa id', price_usdt: 1 }), null)
})

test('normalizeOrderResponse memetakan items user:pass', () => {
  const r = hubx.normalizeOrderResponse({
    ok: true,
    order_id: '8f2c',
    status: 'delivered',
    items: ['SANDBOX-USER-1:SANDBOX-PASS-1', ' user2:pass2 '],
    idempotent_replay: false,
  })
  assert.equal(r.ok, true)
  assert.equal(r.orderId, '8f2c')
  assert.deepEqual(r.keys, ['SANDBOX-USER-1:SANDBOX-PASS-1', 'user2:pass2'])
  assert.equal(r.status, 'delivered')
  assert.equal(r.placed, false)
})

test('normalizeOrderResponse amplop GET /orders/:id dan objek item', () => {
  const r = hubx.normalizeOrderResponse({
    order: {
      id: 'ord-9',
      status: 'delivered',
      items: [{ user: 'ada', pass: 'rahasia' }, { code: 'KODE' }],
    },
  })
  assert.deepEqual(r.keys, ['ada:rahasia', 'KODE'])
  assert.equal(r.orderId, 'ord-9')
})

test('normalizeOrderResponse awaiting tanpa key ditandai placed', () => {
  const r = hubx.normalizeOrderResponse({
    ok: true,
    order_id: 'ord-wait',
    status: 'awaiting_manual_delivery',
    items: [],
  })
  assert.equal(r.ok, false)
  assert.equal(r.placed, true)
  assert.equal(r.status, 'awaiting_manual_delivery')
})

test('normalizeBalance membaca balance_usdt tanpa menganggapnya USD tersembunyi di nama field lain', () => {
  const b = hubx.normalizeBalance({ balance_usdt: '125.5000', currency: 'USDT' })
  assert.equal(b.usdt, 125.5)
  assert.equal(b.usd, 125.5)
  assert.equal(b.currency, 'USDT')
  assert.equal(b.points, 0)
})

test('listProducts mengirim Bearer dan melewati baris yang tidak bisa dijual', async () => {
  let dilihat = null
  hubx.__setHttp({
    get: async (url, cfg) => {
      dilihat = { url, cfg }
      return {
        data: {
          products: [
            SANDBOX,
            { id: 'live-1', name: 'Gemini', price_usdt: 3.5, stock: 42, active: true },
            { id: 'mati', name: 'Mati', price_usdt: 1, stock: 3, active: false },
            { id: 'tanpa-harga', name: 'Entah', stock: 3, active: true },
          ],
        },
      }
    },
  })

  const hasil = await hubx.listProducts(KREDENSIAL)
  assert.deepEqual(hasil.produk.map((p) => p.externalId), [SANDBOX.id, 'live-1'])
  assert.equal(hasil.skipped, 2)
  assert.equal(dilihat.cfg.headers.Authorization, `Bearer ${KUNCI}`)
  assert.equal(dilihat.cfg.headers['X-API-Key'], undefined)
  assert.equal(dilihat.cfg.maxRedirects, 0)
  assert.match(dilihat.url, /\/api\/public\/reseller\/v1\/products$/)
})

test('getProduct mengambil satu produk by slug', async () => {
  hubx.__setHttp({
    get: async (url) => {
      assert.match(url, /\/products\/sandbox-test$/)
      return { data: { product: SANDBOX } }
    },
  })
  const hasil = await hubx.getProduct({ ...KREDENSIAL, productId: 'sandbox-test' })
  assert.equal(hasil.product.externalId, SANDBOX.id)
  assert.equal(hasil.product.stok, hubx.STOK_TAK_TERBATAS)
})

test('createOrder terkirim langsung memetakan items dan tidak mem-poll', async () => {
  let gets = 0
  let dikirim = null
  hubx.__setHttp({
    post: async (url, body, cfg) => {
      dikirim = { url, body, cfg }
      return {
        data: {
          ok: true,
          order_id: 'ord-ok',
          status: 'delivered',
          items: ['SANDBOX-USER-1:SANDBOX-PASS-1'],
          total_usdt: 0.01,
          idempotent_replay: false,
        },
      }
    },
    get: async () => { gets++; return { data: {} } },
  })

  const r = await hubx.createOrder({
    ...KREDENSIAL,
    externalId: 'sandbox-test',
    quantity: 3,
    idempotencyKey: 'TRX-1-nouser-sup-ext-q3',
  })
  assert.equal(r.ok, true)
  assert.deepEqual(r.keys, ['SANDBOX-USER-1:SANDBOX-PASS-1'])
  assert.equal(gets, 0)
  assert.deepEqual(dikirim.body, {
    product_id: 'sandbox-test',
    quantity: 3,
    external_order_id: 'TRX-1-nouser-sup-ext-q3',
  })
  assert.equal(dikirim.cfg.headers.Authorization, `Bearer ${KUNCI}`)
})

test('awaiting_manual_delivery di-poll sampai delivered', async () => {
  const tidur = []
  hubx.__setPoll({
    attempts: 4,
    baseMs: 10,
    maxMs: 40,
    sleep: async (ms) => { tidur.push(ms) },
  })
  let gets = 0
  hubx.__setHttp({
    post: async () => ({
      data: {
        ok: true,
        order_id: 'ord-manual',
        status: 'awaiting_manual_delivery',
        items: [],
        idempotent_replay: true,
      },
    }),
    get: async (url) => {
      gets++
      assert.match(url, /\/orders\/ord-manual$/)
      if (gets < 3) {
        return { data: { order: { id: 'ord-manual', status: 'awaiting_manual_delivery', items: [] } } }
      }
      return {
        data: {
          order: {
            id: 'ord-manual',
            status: 'delivered',
            items: ['SANDBOX-USER-2:SANDBOX-PASS-2'],
          },
        },
      }
    },
  })

  const r = await hubx.createOrder({
    ...KREDENSIAL,
    externalId: SANDBOX.id,
    quantity: 1,
    idempotencyKey: 'TRX-poll',
  })
  assert.equal(r.ok, true)
  assert.equal(r.orderId, 'ord-manual')
  assert.deepEqual(r.keys, ['SANDBOX-USER-2:SANDBOX-PASS-2'])
  assert.equal(r.idempotentReplay, true)
  assert.equal(gets, 3)
  assert.deepEqual(tidur, [10, 20, 40])
})

test('poll yang habis tetap awaiting dan placed supaya tidak dibeli dua kali', async () => {
  let gets = 0
  hubx.__setPoll({ attempts: 2, baseMs: 0, maxMs: 0, sleep: async () => {} })
  hubx.__setHttp({
    post: async () => ({
      data: { ok: true, order_id: 'ord-tunggu', status: 'awaiting_manual_delivery', items: [] },
    }),
    get: async () => {
      gets++
      return { data: { order: { id: 'ord-tunggu', status: 'awaiting_manual_delivery', items: [] } } }
    },
  })

  const r = await hubx.createOrder({
    ...KREDENSIAL, externalId: 'gemini-pro-1m', quantity: 1, idempotencyKey: 'TRX-habis',
  })
  assert.equal(r.ok, false)
  assert.equal(r.placed, true)
  assert.equal(r.status, 'awaiting_manual_delivery')
  assert.equal(r.orderId, 'ord-tunggu')
  assert.deepEqual(r.keys, [])
  assert.equal(gets, 2)
})

test('kunci kosong tidak mengirim request', async () => {
  let terkirim = false
  hubx.__setHttp({
    get: async () => { terkirim = true; return { data: {} } },
    post: async () => { terkirim = true; return { data: {} } },
  })
  delete process.env.HUBX_API_KEY
  const kosong = { baseUrl: hubx.defaultBaseUrl, apiKey: '   ' }
  await assert.rejects(() => hubx.listProducts(kosong), /belum diautentikasi/)
  await assert.rejects(() => hubx.getBalance(kosong), (e) => e.response?.status === 401)
  await assert.rejects(() => hubx.createOrder({ ...kosong, externalId: 'sandbox-test', idempotencyKey: 'k' }))
  assert.equal(terkirim, false)
})

test('api_key baris mengalahkan HUBX_API_KEY; env dipakai kalau baris kosong', async () => {
  const auth = []
  hubx.__setHttp({
    get: async (_url, cfg) => {
      auth.push(cfg.headers.Authorization)
      return { data: { products: [] } }
    },
  })
  process.env.HUBX_API_KEY = 'rsk_test_dari_env_palsu'
  await hubx.listProducts({ baseUrl: hubx.defaultBaseUrl, apiKey: '' })
  await hubx.listProducts({ baseUrl: hubx.defaultBaseUrl, apiKey: 'rsk_test_dari_baris_palsu' })
  assert.deepEqual(auth, [
    'Bearer rsk_test_dari_env_palsu',
    'Bearer rsk_test_dari_baris_palsu',
  ])
})

test('402 dan 409 dilempar tanpa membawa header Authorization', async () => {
  for (const status of [402, 409, 403]) {
    hubx.__setHttp({
      post: async () => { throw httpErr(status, { error: 'ditolak' }) },
    })
    await assert.rejects(
      () => hubx.createOrder({ ...KREDENSIAL, externalId: 'sandbox-test', idempotencyKey: 'k' }),
      (e) => {
        assert.equal(e.response.status, status)
        assert.equal(e.config, undefined)
        assert.equal(JSON.stringify(e).includes(KUNCI), false)
        assert.match(e.message, new RegExp(String(status)))
        return true
      },
    )
  }
})

test('createOrder menolak tanpa idempotencyKey dan tidak mengirim request', async () => {
  let terkirim = false
  hubx.__setHttp({ post: async () => { terkirim = true; return { data: {} } } })
  await assert.rejects(
    () => hubx.createOrder({ ...KREDENSIAL, externalId: 'sandbox-test' }),
    /idempotencyKey/,
  )
  assert.equal(terkirim, false)
})

test('panggilan keluar menolak host di luar allowlist dan tidak mengirim kunci', async () => {
  let terkirim = false
  hubx.__setHttp({
    get: async () => { terkirim = true; return { data: {} } },
    post: async () => { terkirim = true; return { data: {} } },
  })
  const jahat = { baseUrl: 'https://penyerang.example.com/api/public/reseller/v1', apiKey: KUNCI }
  await assert.rejects(() => hubx.listProducts(jahat))
  await assert.rejects(() => hubx.getBalance(jahat))
  await assert.rejects(() => hubx.getOrder({ ...jahat, orderId: '1' }))
  await assert.rejects(() => hubx.testConnection(jahat))
  await assert.rejects(() => hubx.createOrder({ ...jahat, externalId: 'x', idempotencyKey: 'k' }))
  assert.equal(terkirim, false)
})

test('testConnection mengembalikan saldo USDT dan baris mentah sandbox', async () => {
  hubx.__setHttp({
    get: async (url) => {
      if (url.endsWith('/balance')) return { data: { balance_usdt: '10.0000', currency: 'USDT' } }
      return { data: { products: [SANDBOX] } }
    },
  })
  const r = await hubx.testConnection(KREDENSIAL)
  assert.equal(r.ok, true)
  assert.equal(r.balance.usdt, 10)
  assert.equal(r.balance.currency, 'USDT')
  assert.equal(r.sampleCount, 1)
  assert.equal(r.sampleRaw.slug, 'sandbox-test')
  assert.equal(r.sampleNormalized.currency, 'USDT')
  assert.equal(r.sampleNormalized.stok, hubx.STOK_TAK_TERBATAS)
})

test('listOrders menormalkan daftar terbaru', async () => {
  hubx.__setHttp({
    get: async (url) => {
      assert.match(url, /\/orders$/)
      return {
        data: {
          orders: [{
            id: 'ord-1',
            external_order_id: 'trx',
            status: 'refunded',
            total_usdt: 3.5,
          }],
        },
      }
    },
  })
  const daftar = await hubx.listOrders(KREDENSIAL)
  assert.equal(daftar.length, 1)
  assert.equal(daftar[0].orderId, 'ord-1')
  assert.equal(daftar[0].status, 'refunded')
  assert.equal(daftar[0].ok, false)
  assert.equal(daftar[0].placed, false)
})

test('registry mendaftarkan hubx', () => {
  assert.equal(registry.getAdapter('hubx'), hubx)
  assert.equal(registry.getAdapter('HUBX'), hubx)
  const baris = registry.listAdapters().find((a) => a.key === 'hubx')
  assert.equal(baris.label, 'HubX Store')
  assert.match(baris.defaultBaseUrl, /open-greeting-glow-production\.up\.railway\.app\/api\/public\/reseller\/v1$/)
  assert.match(baris.authHint, /Bearer/)
})
