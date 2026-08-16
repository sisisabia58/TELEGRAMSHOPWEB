const test = require('node:test')
const assert = require('node:assert')

const jalurClient = require.resolve('../lib/supabase.js')
const jalurFulfillment = require.resolve('../lib/fulfillment.js')

// fulfillment.js menarik supabase di tingkat modul (untuk deps default), tapi
// setiap tes menyuntik deps-nya sendiri, jadi client-nya cukup diganti stub kosong.
function muatFulfillment() {
  delete require.cache[jalurFulfillment]
  require.cache[jalurClient] = {
    id: jalurClient, filename: jalurClient, loaded: true,
    exports: { from() { throw new Error('tes tidak boleh menyentuh database') } },
  }
  return require(jalurFulfillment)
}

test.after(() => {
  delete require.cache[jalurClient]
  delete require.cache[jalurFulfillment]
})

const VARIAN = { id: 'v1', kode: 'netflix-30d', harga: 50000, sumber: 'sendiri' }

function offerSendiri(over = {}) {
  return {
    sumber: 'sendiri', supplier_id: null, supplier_product_id: null, external_id: null,
    varian_id: 'v1', harga_satuan: over.harga ?? 50000, harga_asal: null, currency: 'IDR',
    stok: over.stok ?? 10, prioritas: 0,
  }
}

function offerSupplier(over = {}) {
  return {
    sumber: 'supplier',
    supplier_id: over.supplier_id || 's1',
    supplier_product_id: over.supplier_product_id || 'sp1',
    external_id: over.external_id || '100',
    varian_id: 'v1',
    harga_satuan: over.harga ?? 30000,
    harga_asal: over.harga_asal ?? 2.5,
    currency: 'USD',
    stok: over.stok ?? 10,
    prioritas: over.prioritas ?? 0,
  }
}

// Deps dasar: rankOffers asli dipinjam dari sourcing supaya urutan yang dites
// sama dengan yang dipakai produksi.
const sourcing = require('../lib/sourcing')

function buatDeps(over = {}) {
  const dicatat = []
  const deps = {
    rankOffers: (offers, qty) => sourcing.rankOffers(offers, qty),
    getOffers: async () => [],
    getStokForTransaction: async () => [],
    markStokTerjual: async () => {},
    getSupplier: async (id) => ({ id, nama: `Seller ${id}`, adapter: 'bitestore', base_url: 'x', api_key: 'k', is_active: true }),
    createOrder: async () => ({ ok: true, orderId: '1', keys: ['key-1'], status: 'completed' }),
    recordSupplierOrder: async (row) => { dicatat.push(row); return { id: `so-${dicatat.length}`, ...row } },
    ...over,
  }
  return { deps, dicatat }
}

// ---------------------------------------------------------------------------
// Jalur stok sendiri — harus persis seperti sebelum fase ini
// ---------------------------------------------------------------------------

test('memenuhi dari stok sendiri tanpa menyentuh supplier', async () => {
  const f = muatFulfillment()
  let supplierDipanggil = false
  const { deps } = buatDeps({
    getOffers: async () => [offerSendiri()],
    getStokForTransaction: async () => [{ id: 'st1', data: 'a@b:pw' }, { id: 'st2', data: 'c@d:pw' }],
    createOrder: async () => { supplierDipanggil = true; throw new Error('tidak boleh dipanggil') },
  })

  const r = await f.fulfill({ varian: VARIAN, qty: 2, trxid: 'TRX-1', deps })
  assert.equal(r.ok, true)
  assert.equal(r.sumber, 'sendiri')
  assert.deepEqual(r.lines, ['a@b:pw', 'c@d:pw'])
  assert.deepEqual(r.stokIds, ['st1', 'st2'])
  assert.equal(supplierDipanggil, false)
})

test('menandai baris stok sendiri sebagai terjual dengan trxid', async () => {
  const f = muatFulfillment()
  let ditandai = null
  const { deps } = buatDeps({
    getOffers: async () => [offerSendiri()],
    getStokForTransaction: async () => [{ id: 'st1', data: 'x' }],
    markStokTerjual: async (ids, trxid) => { ditandai = { ids, trxid } },
  })

  await f.fulfill({ varian: VARIAN, qty: 1, trxid: 'TRX-9', deps })
  assert.deepEqual(ditandai, { ids: ['st1'], trxid: 'TRX-9' })
})

test('stok sendiri yang ternyata kurang tidak dianggap berhasil', async () => {
  const f = muatFulfillment()
  const { deps } = buatDeps({
    getOffers: async () => [offerSendiri({ stok: 5 })],
    getStokForTransaction: async () => [{ id: 'st1', data: 'x' }], // cuma 1 dari 3 diminta
  })

  const r = await f.fulfill({ varian: VARIAN, qty: 3, trxid: 'TRX-2', deps })
  assert.equal(r.ok, false)
  assert.match(r.error, /stok sendiri kurang/)
})

// ---------------------------------------------------------------------------
// Jalur supplier
// ---------------------------------------------------------------------------

test('memesan ke supplier dan mengembalikan key sebagai isi kiriman', async () => {
  const f = muatFulfillment()
  let dipesan = null
  const { deps, dicatat } = buatDeps({
    getOffers: async () => [offerSupplier()],
    createOrder: async (supplier, args) => {
      dipesan = { supplier: supplier.id, ...args }
      return { ok: true, orderId: '555', keys: ['k1', 'k2'], status: 'completed' }
    },
  })

  const r = await f.fulfill({ varian: VARIAN, qty: 2, trxid: 'TRX-3', userId: 42, hargaSatuan: 30000, deps })
  assert.equal(r.ok, true)
  assert.equal(r.sumber, 'supplier')
  assert.deepEqual(r.lines, ['k1', 'k2'])
  assert.equal(dipesan.externalId, '100')
  assert.equal(dipesan.quantity, 2)

  assert.equal(dicatat.length, 1)
  assert.equal(dicatat[0].status, 'ok')
  assert.equal(dicatat[0].modal_asal, 2.5, 'modal dicatat untuk laporan untung-rugi')
  assert.equal(dicatat[0].jual_idr, 60000, 'harga satuan x qty')
  assert.equal(dicatat[0].external_order_id, '555')
  assert.deepEqual(dicatat[0].delivered, ['k1', 'k2'])
})

test('memakai Idempotency-Key yang stabil dari trxid', async () => {
  const f = muatFulfillment()
  const kunci = []
  const { deps } = buatDeps({
    getOffers: async () => [offerSupplier()],
    createOrder: async (_s, args) => {
      kunci.push(args.idempotencyKey)
      return { ok: true, orderId: '1', keys: ['k'], status: 'completed' }
    },
  })

  await f.fulfill({ varian: VARIAN, qty: 1, trxid: 'TRX-SAMA', deps })
  await f.fulfill({ varian: VARIAN, qty: 1, trxid: 'TRX-SAMA', deps })
  assert.equal(kunci[0], kunci[1], 'trxid yang sama harus menghasilkan kunci yang sama')
  assert.equal(kunci[0], f.idempotencyKey('TRX-SAMA', 0))
})

test('pesanan supplier tanpa key dianggap GAGAL', async () => {
  const f = muatFulfillment()
  // Pembeli sudah dipotong saldonya; "berhasil" tanpa isi adalah kerugian diam.
  const { deps, dicatat } = buatDeps({
    getOffers: async () => [offerSupplier()],
    createOrder: async () => ({ ok: false, orderId: '7', keys: [], status: 'pending' }),
  })

  const r = await f.fulfill({ varian: VARIAN, qty: 1, trxid: 'TRX-4', deps })
  assert.equal(r.ok, false)
  assert.match(r.error, /tidak ada key/)
  assert.equal(dicatat[0].status, 'failed')
})

test('supplier nonaktif dilewati', async () => {
  const f = muatFulfillment()
  const { deps } = buatDeps({
    getOffers: async () => [offerSupplier()],
    getSupplier: async (id) => ({ id, nama: 'Mati', is_active: false }),
  })

  const r = await f.fulfill({ varian: VARIAN, qty: 1, trxid: 'TRX-5', deps })
  assert.equal(r.ok, false)
  assert.match(r.error, /nonaktif/)
})

// ---------------------------------------------------------------------------
// Failover — alasan utama modul ini ada
// ---------------------------------------------------------------------------

test('turun ke penawaran berikutnya kalau yang termurah gagal', async () => {
  const f = muatFulfillment()
  const dicoba = []
  const { deps } = buatDeps({
    getOffers: async () => [
      offerSupplier({ supplier_id: 'murah', external_id: 'A', harga: 20000 }),
      offerSupplier({ supplier_id: 'mahal', external_id: 'B', harga: 30000 }),
    ],
    createOrder: async (supplier, args) => {
      dicoba.push(supplier.id)
      if (supplier.id === 'murah') {
        const e = new Error('Request failed')
        e.response = { status: 502 }
        throw e
      }
      return { ok: true, orderId: '2', keys: ['dari-mahal'], status: 'completed' }
    },
  })

  const r = await f.fulfill({ varian: VARIAN, qty: 1, trxid: 'TRX-6', deps })
  assert.equal(r.ok, true)
  assert.deepEqual(r.lines, ['dari-mahal'])
  assert.deepEqual(dicoba, ['murah', 'mahal'], 'termurah dicoba lebih dulu, lalu mundur')
  assert.equal(r.attempts.length, 2)
  assert.equal(r.attempts[0].ok, false)
  assert.equal(r.attempts[1].ok, true)
})

test('turun dari stok sendiri yang kosong ke supplier', async () => {
  const f = muatFulfillment()
  const { deps } = buatDeps({
    getOffers: async () => [offerSendiri({ harga: 20000, stok: 5 }), offerSupplier({ harga: 30000 })],
    getStokForTransaction: async () => [], // baris sudah diambil pembeli lain
    createOrder: async () => ({ ok: true, orderId: '3', keys: ['cadangan'], status: 'completed' }),
  })

  const r = await f.fulfill({ varian: VARIAN, qty: 1, trxid: 'TRX-7', deps })
  assert.equal(r.ok, true)
  assert.equal(r.sumber, 'supplier')
  assert.deepEqual(r.lines, ['cadangan'])
})

test('gagal bersih kalau SEMUA sumber gagal', async () => {
  const f = muatFulfillment()
  const { deps } = buatDeps({
    getOffers: async () => [
      offerSupplier({ supplier_id: 'a', harga: 10000 }),
      offerSupplier({ supplier_id: 'b', harga: 20000 }),
    ],
    createOrder: async () => { throw new Error('ETIMEDOUT') },
  })

  const r = await f.fulfill({ varian: VARIAN, qty: 1, trxid: 'TRX-8', deps })
  assert.equal(r.ok, false)
  assert.equal(r.attempts.length, 2)
  assert.match(r.error, /ETIMEDOUT/)
})

test('setiap percobaan dapat kunci idempotensi berbeda', async () => {
  const f = muatFulfillment()
  const kunci = []
  const { deps } = buatDeps({
    getOffers: async () => [
      offerSupplier({ supplier_id: 'a', harga: 10000 }),
      offerSupplier({ supplier_id: 'b', harga: 20000 }),
    ],
    createOrder: async (_s, args) => {
      kunci.push(args.idempotencyKey)
      if (kunci.length === 1) throw new Error('gagal')
      return { ok: true, orderId: '1', keys: ['k'], status: 'completed' }
    },
  })

  await f.fulfill({ varian: VARIAN, qty: 1, trxid: 'TRX-X', deps })
  // Kalau kuncinya sama, penjual kedua akan memantulkan hasil percobaan pertama.
  assert.notEqual(kunci[0], kunci[1])
})

// ---------------------------------------------------------------------------
// Penjagaan
// ---------------------------------------------------------------------------

test('mengembalikan kegagalan kalau tidak ada penawaran sama sekali', async () => {
  const f = muatFulfillment()
  const { deps } = buatDeps({ getOffers: async () => [] })
  const r = await f.fulfill({ varian: VARIAN, qty: 1, trxid: 'TRX-A', deps })
  assert.equal(r.ok, false)
  assert.match(r.error, /habis/)
})

test('mengembalikan kegagalan kalau qty melebihi semua stok', async () => {
  const f = muatFulfillment()
  const { deps } = buatDeps({ getOffers: async () => [offerSendiri({ stok: 2 }), offerSupplier({ stok: 3 })] })
  const r = await f.fulfill({ varian: VARIAN, qty: 10, trxid: 'TRX-B', deps })
  assert.equal(r.ok, false)
})

test('tidak pernah melempar saat pembacaan sumber gagal', async () => {
  const f = muatFulfillment()
  const { deps } = buatDeps({ getOffers: async () => { throw new Error('db mati') } })
  const r = await f.fulfill({ varian: VARIAN, qty: 1, trxid: 'TRX-C', deps })
  assert.equal(r.ok, false)
  assert.match(r.error, /db mati/)
})

test('menolak varian yang tidak valid', async () => {
  const f = muatFulfillment()
  const { deps } = buatDeps()
  assert.equal((await f.fulfill({ varian: null, trxid: 'T', deps })).ok, false)
  assert.equal((await f.fulfill({ varian: {}, trxid: 'T', deps })).ok, false)
})

test('kegagalan pencatatan audit tidak membatalkan pengiriman yang berhasil', async () => {
  const f = muatFulfillment()
  const { deps } = buatDeps({
    getOffers: async () => [offerSupplier()],
    recordSupplierOrder: async () => null, // seolah insert gagal
  })

  const r = await f.fulfill({ varian: VARIAN, qty: 1, trxid: 'TRX-D', deps })
  assert.equal(r.ok, true, 'pembeli sudah bayar dan key sudah di tangan — tetap kirim')
  assert.deepEqual(r.lines, ['key-1'])
})

test('idempotencyKey berbentuk trxid-indeks', () => {
  const f = muatFulfillment()
  assert.equal(f.idempotencyKey('TRX-1', 0), 'TRX-1-0')
  assert.equal(f.idempotencyKey('TRX-1', 3), 'TRX-1-3')
})
