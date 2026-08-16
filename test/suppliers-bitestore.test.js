const test = require('node:test')
const assert = require('node:assert')

const bitestore = require('../lib/suppliers/bitestore')
const registry = require('../lib/suppliers')

const KREDENSIAL = { baseUrl: 'https://contoh.test', apiKey: 'bsk_test' }

test.after(() => bitestore.__setHttp(require('axios')))

// ---------------------------------------------------------------------------
// unwrapList — openapi.json tidak mendeklarasikan bentuk balasan, jadi
// normalisasi harus menerima array telanjang maupun amplop.
// ---------------------------------------------------------------------------

test('unwrapList menerima array telanjang', () => {
  assert.deepEqual(bitestore.unwrapList([{ id: 1 }]), [{ id: 1 }])
})

test('unwrapList menerima amplop yang umum dipakai', () => {
  for (const kunci of ['data', 'products', 'items', 'results', 'rows']) {
    assert.deepEqual(bitestore.unwrapList({ [kunci]: [{ id: 7 }] }), [{ id: 7 }], `amplop ${kunci}`)
  }
})

test('unwrapList mengembalikan array kosong untuk bentuk tak dikenal', () => {
  assert.deepEqual(bitestore.unwrapList(null), [])
  assert.deepEqual(bitestore.unwrapList(undefined), [])
  assert.deepEqual(bitestore.unwrapList('teks'), [])
  assert.deepEqual(bitestore.unwrapList({ entah: 1 }), [])
})

// ---------------------------------------------------------------------------
// normalizeProductRow
// ---------------------------------------------------------------------------

test('normalizeProductRow memetakan bentuk yang didokumentasikan', () => {
  const n = bitestore.normalizeProductRow({
    id: 42,
    name: 'Netflix Premium 1 Month',
    name_html: '<b>Netflix</b>',
    description: 'Akun sharing',
    price: 2.5,
    stock: 12,
    inStock: true,
    sold: 300,
    currency: 'usd',
  })
  assert.equal(n.externalId, '42')
  assert.equal(n.nama, 'Netflix Premium 1 Month')
  assert.equal(n.hargaAsal, 2.5)
  assert.equal(n.currency, 'USD')
  assert.equal(n.stok, 12)
  assert.equal(n.inStock, true)
  assert.equal(n.terjual, 300)
})

test('normalizeProductRow menerima harga berupa string', () => {
  assert.equal(bitestore.normalizeProductRow({ id: 1, price: '2.50' }).hargaAsal, 2.5)
  assert.equal(bitestore.normalizeProductRow({ id: 1, price: '$3.00' }).hargaAsal, 3)
  assert.equal(bitestore.normalizeProductRow({ id: 1, price: '' }).hargaAsal, 0)
  assert.equal(bitestore.normalizeProductRow({ id: 1, price: null }).hargaAsal, 0)
})

test('normalizeProductRow menerima nama field alternatif', () => {
  const n = bitestore.normalizeProductRow({ productId: 'abc', nama: 'Spotify', harga: 1.25, stok: 4 })
  assert.equal(n.externalId, 'abc')
  assert.equal(n.nama, 'Spotify')
  assert.equal(n.hargaAsal, 1.25)
  assert.equal(n.stok, 4)
})

test('normalizeProductRow menurunkan inStock dari jumlah stok kalau tidak ada', () => {
  assert.equal(bitestore.normalizeProductRow({ id: 1, stock: 5 }).inStock, true)
  assert.equal(bitestore.normalizeProductRow({ id: 1, stock: 0 }).inStock, false)
})

test('normalizeProductRow mempercayai inStock eksplisit', () => {
  // Penjual bisa saja punya stok tak terbatas yang dilaporkan stock: 0.
  assert.equal(bitestore.normalizeProductRow({ id: 1, stock: 0, inStock: true }).inStock, true)
  assert.equal(bitestore.normalizeProductRow({ id: 1, stock: 9, inStock: false }).inStock, false)
  assert.equal(bitestore.normalizeProductRow({ id: 1, stock: 0, in_stock: 'true' }).inStock, true)
})

test('normalizeProductRow menormalkan stok negatif atau pecahan', () => {
  assert.equal(bitestore.normalizeProductRow({ id: 1, stock: -5 }).stok, 0)
  assert.equal(bitestore.normalizeProductRow({ id: 1, stock: 3.9 }).stok, 3)
})

test('normalizeProductRow menolak baris tanpa id', () => {
  assert.equal(bitestore.normalizeProductRow({ name: 'Tanpa id' }), null)
  assert.equal(bitestore.normalizeProductRow({ id: '' }), null)
  assert.equal(bitestore.normalizeProductRow({ id: null }), null)
  assert.equal(bitestore.normalizeProductRow(null), null)
  assert.equal(bitestore.normalizeProductRow('teks'), null)
})

test('normalizeProductRow membuang produk file dan manual', () => {
  // Fase ini hanya menjual produk key instan; sisanya dihitung sebagai skipped.
  assert.equal(bitestore.normalizeProductRow({ id: 1, kind: 'file' }), null)
  assert.equal(bitestore.normalizeProductRow({ id: 1, kind: 'manual' }), null)
  assert.equal(bitestore.normalizeProductRow({ id: 1, type: 'pending' }), null)
  assert.equal(bitestore.normalizeProductRow({ id: 1, delivery_type: 'FILE' }), null)
})

test('normalizeProductRow menerima jenis instan yang dikenal dan yang tidak dinyatakan', () => {
  for (const kind of ['auto', 'static', 'account', 'keys', 'instant']) {
    assert.ok(bitestore.normalizeProductRow({ id: 1, kind }), `kind ${kind} harus diterima`)
  }
  assert.ok(bitestore.normalizeProductRow({ id: 1 }), 'tanpa kind harus diterima')
})

test('normalizeProductRow memberi nama pengganti kalau nama kosong', () => {
  assert.equal(bitestore.normalizeProductRow({ id: 9 }).nama, 'Produk 9')
})

// ---------------------------------------------------------------------------
// normalizeOrderResponse
// ---------------------------------------------------------------------------

test('normalizeOrderResponse mengambil key yang terkirim', () => {
  const r = bitestore.normalizeOrderResponse({
    ok: true, orderId: 77, deliveredKeys: ['a@b:pw', 'c@d:pw'], amount: 5, status: 'completed',
  })
  assert.equal(r.ok, true)
  assert.equal(r.orderId, '77')
  assert.deepEqual(r.keys, ['a@b:pw', 'c@d:pw'])
  assert.equal(r.status, 'completed')
})

test('normalizeOrderResponse menerima nama field alternatif', () => {
  assert.deepEqual(bitestore.normalizeOrderResponse({ delivered_keys: ['x'] }).keys, ['x'])
  assert.deepEqual(bitestore.normalizeOrderResponse({ keys: ['y'] }).keys, ['y'])
  assert.deepEqual(bitestore.normalizeOrderResponse({ data: { deliveredKeys: ['z'] } }).keys, ['z'])
})

test('normalizeOrderResponse menganggap pesanan tanpa key sebagai GAGAL', () => {
  // Kalau ok:true tapi tanpa isi, pembeli sudah bayar dan tidak menerima apa pun.
  assert.equal(bitestore.normalizeOrderResponse({ ok: true, orderId: 1, deliveredKeys: [] }).ok, false)
  assert.equal(bitestore.normalizeOrderResponse({ status: 'pending' }).ok, false)
  assert.equal(bitestore.normalizeOrderResponse({}).ok, false)
  assert.equal(bitestore.normalizeOrderResponse(null).ok, false)
})

test('normalizeOrderResponse membuang key kosong', () => {
  assert.deepEqual(bitestore.normalizeOrderResponse({ deliveredKeys: ['a', '', '  '] }).keys, ['a'])
})

// ---------------------------------------------------------------------------
// normalizeBalance
// ---------------------------------------------------------------------------

test('normalizeBalance membaca usd dan points', () => {
  assert.deepEqual(
    (({ usd, points }) => ({ usd, points }))(bitestore.normalizeBalance({ usd: 12.5, points: 1250 })),
    { usd: 12.5, points: 1250 }
  )
  assert.equal(bitestore.normalizeBalance({ data: { balance_usd: '3.25' } }).usd, 3.25)
  assert.equal(bitestore.normalizeBalance(null).usd, 0)
})

// ---------------------------------------------------------------------------
// HTTP lewat seam __setHttp
// ---------------------------------------------------------------------------

test('listProducts mengirim X-API-Key dan menghitung baris yang dilewati', async () => {
  const dilihat = []
  bitestore.__setHttp({
    get: async (url, cfg) => {
      dilihat.push({ url, cfg })
      return {
        data: [
          { id: 1, name: 'Netflix 30 Hari', price: 2.5, stock: 3 },
          { id: 2, name: 'Ebook', price: 1, stock: 1, kind: 'file' },
          { name: 'tanpa id' },
        ],
      }
    },
  })

  const hasil = await bitestore.listProducts(KREDENSIAL)
  assert.equal(hasil.produk.length, 1)
  assert.equal(hasil.produk[0].externalId, '1')
  assert.equal(hasil.skipped, 2)
  assert.equal(dilihat[0].cfg.headers['X-API-Key'], 'bsk_test')
  assert.equal(dilihat[0].cfg.params.live, 1)
  assert.match(dilihat[0].url, /\/v1\/products$/)
})

test('listProducts berhenti di halaman terakhir yang tidak penuh', async () => {
  let panggilan = 0
  bitestore.__setHttp({
    get: async () => {
      panggilan++
      return { data: [{ id: panggilan, price: 1, stock: 1 }] }
    },
  })
  await bitestore.listProducts(KREDENSIAL)
  assert.equal(panggilan, 1, 'halaman pendek berarti selesai')
})

test('createOrder mengirim Idempotency-Key dan body yang benar', async () => {
  let dikirim = null
  bitestore.__setHttp({
    post: async (url, body, cfg) => {
      dikirim = { url, body, cfg }
      return { data: { ok: true, orderId: 5, deliveredKeys: ['k1', 'k2'], status: 'completed' } }
    },
  })

  const r = await bitestore.createOrder({ ...KREDENSIAL, externalId: 42, quantity: 2, idempotencyKey: 'TRX-1-0' })
  assert.equal(r.ok, true)
  assert.deepEqual(r.keys, ['k1', 'k2'])
  assert.deepEqual(dikirim.body, { productId: '42', quantity: 2 })
  assert.equal(dikirim.cfg.headers['Idempotency-Key'], 'TRX-1-0')
  assert.equal(dikirim.cfg.headers['X-API-Key'], 'bsk_test')
})

test('createOrder melempar saat saldo dompet kurang (402)', async () => {
  const err = new Error('Request failed with status code 402')
  err.response = { status: 402, data: { detail: 'insufficient balance' } }
  bitestore.__setHttp({ post: async () => { throw err } })

  await assert.rejects(
    () => bitestore.createOrder({ ...KREDENSIAL, externalId: 1, idempotencyKey: 'k' }),
    /402/
  )
})

test('createOrder melempar saat fulfillment gagal (502)', async () => {
  const err = new Error('Request failed with status code 502')
  err.response = { status: 502 }
  bitestore.__setHttp({ post: async () => { throw err } })

  await assert.rejects(
    () => bitestore.createOrder({ ...KREDENSIAL, externalId: 1, idempotencyKey: 'k' }),
    /502/
  )
})

test('testConnection mengembalikan saldo plus baris mentah pertama', async () => {
  bitestore.__setHttp({
    get: async (url) => {
      if (url.endsWith('/v1/balance')) return { data: { usd: 7.5, points: 750 } }
      return { data: { products: [{ id: 3, name: 'Contoh', price: '1.50', stock: 2 }] } }
    },
  })

  const r = await bitestore.testConnection(KREDENSIAL)
  assert.equal(r.ok, true)
  assert.equal(r.balance.usd, 7.5)
  assert.equal(r.sampleCount, 1)
  assert.equal(r.sampleRaw.id, 3, 'baris MENTAH ikut dikembalikan untuk verifikasi bentuk API')
  assert.equal(r.sampleNormalized.hargaAsal, 1.5)
})

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

test('registry menemukan adapter berdasarkan key', () => {
  assert.equal(registry.getAdapter('bitestore'), bitestore)
  assert.equal(registry.getAdapter('BITESTORE'), bitestore)
  assert.equal(registry.getAdapter('entah'), null)
  assert.equal(registry.getAdapter(null), null)
})

test('registry menyediakan daftar adapter untuk dropdown dashboard', () => {
  const daftar = registry.listAdapters()
  assert.ok(daftar.length >= 1)
  assert.ok(daftar.every((a) => a.key && a.label && a.defaultBaseUrl))
})

test('setiap adapter memenuhi kontrak yang sama', () => {
  for (const adapter of Object.values(registry.ADAPTERS)) {
    for (const fn of ['listProducts', 'getBalance', 'createOrder', 'getOrder', 'testConnection']) {
      assert.equal(typeof adapter[fn], 'function', `${adapter.key} harus punya ${fn}()`)
    }
  }
})
