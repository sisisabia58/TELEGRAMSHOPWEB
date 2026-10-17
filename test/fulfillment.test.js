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
    // Klaim atomik: default-nya semua baris yang diminta berhasil diklaim.
    claimStok: async (ids) => ({ ok: true, rows: ids.map((id) => ({ id, data: `data-${id}` })) }),
    releaseStok: async () => {},
    getSupplier: async (id) => ({ id, nama: `Seller ${id}`, adapter: 'bitestore', base_url: 'x', api_key: 'k', is_active: true }),
    createOrder: async () => ({ ok: true, orderId: '1', keys: ['key-1'], status: 'completed' }),
    getOrder: async () => ({ ok: false, orderId: null, keys: [], status: 'unknown' }),
    recordSupplierOrder: async (row) => { dicatat.push(row); return { id: `so-${dicatat.length}`, ...row } },
    ...over,
  }
  return { deps, dicatat }
}

function httpErr(status, extra = {}) {
  const e = new Error(`Request failed with status code ${status}`)
  e.response = { status, ...extra }
  return e
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
    claimStok: async () => ({ ok: true, rows: [{ id: 'st1', data: 'a@b:pw' }, { id: 'st2', data: 'c@d:pw' }] }),
    createOrder: async () => { supplierDipanggil = true; throw new Error('tidak boleh dipanggil') },
  })

  const r = await f.fulfill({ varian: VARIAN, qty: 2, trxid: 'TRX-1', deps })
  assert.equal(r.ok, true)
  assert.equal(r.sumber, 'sendiri')
  assert.deepEqual(r.lines, ['a@b:pw', 'c@d:pw'])
  assert.deepEqual(r.stokIds, ['st1', 'st2'])
  assert.equal(supplierDipanggil, false)
})

test('mengklaim baris stok sendiri secara atomik dengan trxid', async () => {
  const f = muatFulfillment()
  let diklaim = null
  const { deps } = buatDeps({
    getOffers: async () => [offerSendiri()],
    getStokForTransaction: async () => [{ id: 'st1', data: 'x' }],
    claimStok: async (ids, trxid) => {
      diklaim = { ids, trxid }
      return { ok: true, rows: [{ id: 'st1', data: 'x' }] }
    },
  })

  await f.fulfill({ varian: VARIAN, qty: 1, trxid: 'TRX-9', deps })
  assert.deepEqual(diklaim, { ids: ['st1'], trxid: 'TRX-9' })
})

test('klaim sebagian dilepas lagi dan dianggap gagal', async () => {
  const f = muatFulfillment()
  // Dua pembeli berebut baris yang sama: kita cuma menang satu dari dua.
  // Mengirim 1 dari 2 yang dibayar lebih buruk daripada gagal dan refund.
  let dilepas = null
  const { deps } = buatDeps({
    getOffers: async () => [offerSendiri({ stok: 5 })],
    getStokForTransaction: async () => [{ id: 'st1', data: 'a' }, { id: 'st2', data: 'b' }],
    claimStok: async () => ({ ok: true, rows: [{ id: 'st1', data: 'a' }] }),
    releaseStok: async (ids) => { dilepas = ids },
  })

  const r = await f.fulfill({ varian: VARIAN, qty: 2, trxid: 'TRX-R', deps })
  assert.equal(r.ok, false)
  assert.match(r.error, /keburu diambil/)
  assert.deepEqual(dilepas, ['st1'], 'baris yang sempat dimenangkan harus dilepas lagi')
})

test('kegagalan klaim TIDAK dilaporkan sebagai berhasil', async () => {
  const f = muatFulfillment()
  // markStokTerjual yang lama menelan error dan mengembalikan undefined, jadi
  // update yang gagal tetap tampak sukses dan pembeli dianggap terlayani.
  const { deps } = buatDeps({
    getOffers: async () => [offerSendiri()],
    getStokForTransaction: async () => [{ id: 'st1', data: 'x' }],
    claimStok: async () => ({ ok: false, rows: [], error: 'koneksi putus' }),
  })

  const r = await f.fulfill({ varian: VARIAN, qty: 1, trxid: 'TRX-K', deps })
  assert.equal(r.ok, false)
  assert.match(r.error, /gagal klaim stok/)
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
})

test('Idempotency-Key TIDAK berubah saat urutan penawaran berubah', async () => {
  const f = muatFulfillment()
  // Inti masalahnya: kunci berbasis indeks berubah begitu ada penawaran lebih
  // murah muncul di depan, sehingga percobaan ulang membeli DUA KALI ke penjual
  // yang sama. Identitas penawaranlah yang harus menentukan kunci.
  const murah = offerSupplier({ supplier_id: 'baru', supplier_product_id: 'spX', external_id: '999', harga: 10000 })
  const lama = offerSupplier({ supplier_id: 's1', external_id: '100', harga: 30000 })

  const kunci = []
  const buat = async (_s, args) => {
    kunci.push({ ext: args.externalId, key: args.idempotencyKey })
    return { ok: true, orderId: '1', keys: ['k'], status: 'completed' }
  }

  const { deps: d1 } = buatDeps({ getOffers: async () => [lama], createOrder: buat })
  await f.fulfill({ varian: VARIAN, qty: 1, trxid: 'TRX-Z', deps: d1 })

  // Putaran kedua: penawaran lebih murah muncul, jadi `lama` bukan lagi indeks 0.
  const { deps: d2 } = buatDeps({
    getOffers: async () => [murah, lama],
    createOrder: async (s, args) => {
      if (args.externalId === '999') throw httpErr(409)
      return buat(s, args)
    },
  })
  await f.fulfill({ varian: VARIAN, qty: 1, trxid: 'TRX-Z', deps: d2 })

  const untukLama = kunci.filter((k) => k.ext === '100')
  assert.equal(untukLama.length, 2)
  assert.equal(untukLama[0].key, untukLama[1].key, 'penawaran yang sama harus tetap memakai kunci yang sama')
})

test('kunci berbeda untuk penjual, produk, dan jumlah yang berbeda', async () => {
  const f = muatFulfillment()
  const a = { supplier_id: 's1', external_id: '100' }
  const b = { supplier_id: 's2', external_id: '100' }
  const c = { supplier_id: 's1', external_id: '200' }

  assert.notEqual(f.idempotencyKey('T', a, 1), f.idempotencyKey('T', b, 1))
  assert.notEqual(f.idempotencyKey('T', a, 1), f.idempotencyKey('T', c, 1))
  assert.notEqual(f.idempotencyKey('T', a, 1), f.idempotencyKey('T', a, 2))
  assert.notEqual(f.idempotencyKey('T1', a, 1), f.idempotencyKey('T2', a, 1))
  assert.equal(f.idempotencyKey('T', a, 1), f.idempotencyKey('T', a, 1))
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
  const kunci = []
  const { deps, dicatat } = buatDeps({
    getOffers: async () => [
      offerSupplier({ supplier_id: 'murah', external_id: 'A', harga: 20000 }),
      offerSupplier({ supplier_id: 'mahal', external_id: 'B', harga: 30000 }),
    ],
    createOrder: async (supplier, args) => {
      dicoba.push(supplier.id)
      kunci.push(args.idempotencyKey)
      if (supplier.id === 'murah') throw httpErr(502)
      return { ok: true, orderId: '2', keys: ['dari-mahal'], status: 'completed' }
    },
  })

  const r = await f.fulfill({ varian: VARIAN, qty: 1, trxid: 'TRX-6', deps })
  // 502 tidak membuktikan penjual menolak: retry sekali dengan kunci yang sama,
  // lalu berhenti. Pindah ke penjual kedua bisa membeli dua kali.
  assert.equal(r.ok, false)
  assert.deepEqual(dicoba, ['murah', 'murah'], 'retry ke penjual yang sama, bukan failover')
  assert.equal(kunci[0], kunci[1], 'retry memakai Idempotency-Key yang sama')
  assert.equal(r.attempts.length, 1)
  assert.match(r.error, /rekonsiliasi/)
  assert.equal(dicatat.length, 1)
  assert.equal(dicatat[0].status, 'failed')
  assert.match(dicatat[0].error, /perlu rekonsiliasi manual/)
})

test('turun ke penawaran berikutnya kalau yang termurah ditolak 4xx', async () => {
  const f = muatFulfillment()
  const dicoba = []
  const { deps } = buatDeps({
    getOffers: async () => [
      offerSupplier({ supplier_id: 'murah', external_id: 'A', harga: 20000 }),
      offerSupplier({ supplier_id: 'mahal', external_id: 'B', harga: 30000 }),
    ],
    createOrder: async (supplier) => {
      dicoba.push(supplier.id)
      if (supplier.id === 'murah') throw httpErr(402)
      return { ok: true, orderId: '2', keys: ['dari-mahal'], status: 'completed' }
    },
  })

  const r = await f.fulfill({ varian: VARIAN, qty: 1, trxid: 'TRX-6B', deps })
  assert.equal(r.ok, true)
  assert.deepEqual(r.lines, ['dari-mahal'])
  assert.deepEqual(dicoba, ['murah', 'mahal'], '4xx = ditolak pasti, boleh mundur')
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
  const dicoba = []
  const { deps, dicatat } = buatDeps({
    getOffers: async () => [
      offerSupplier({ supplier_id: 'a', harga: 10000 }),
      offerSupplier({ supplier_id: 'b', harga: 20000 }),
    ],
    createOrder: async (supplier) => {
      dicoba.push(supplier.id)
      throw new Error('ETIMEDOUT')
    },
  })

  const r = await f.fulfill({ varian: VARIAN, qty: 1, trxid: 'TRX-8', deps })
  assert.equal(r.ok, false)
  assert.deepEqual(dicoba, ['a', 'a'], 'timeout = retry sekali, bukan pindah penjual')
  assert.equal(r.attempts.length, 1)
  assert.match(r.error, /rekonsiliasi/)
  assert.match(dicatat[0].error, /ETIMEDOUT/)
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
      if (kunci.length === 1) throw httpErr(409)
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

test('idempotencyKey aman dipakai sebagai header HTTP', () => {
  const f = muatFulfillment()
  const k = f.idempotencyKey('TRX-1', { supplier_id: 's 1', external_id: 'a/b' }, 2, 42)
  assert.match(k, /^[A-Za-z0-9_-]+$/, 'hanya karakter aman untuk header')
  assert.ok(k.includes('TRX-1'))
  assert.ok(k.includes('42'))
})

test('idempotencyKey membedakan pembeli, tetap stabil untuk pembeli yang sama', () => {
  const f = muatFulfillment()
  const offer = { supplier_id: 's1', external_id: '100' }
  assert.notEqual(
    f.idempotencyKey('TRX-MS', offer, 1, 11),
    f.idempotencyKey('TRX-MS', offer, 1, 22),
    'dua pembeli dengan trxid sama tidak boleh memakai kunci yang sama'
  )
  assert.equal(
    f.idempotencyKey('TRX-MS', offer, 1, 11),
    f.idempotencyKey('TRX-MS', offer, 1, 11),
    'percobaan ulang pembeli yang sama harus memakai kunci yang sama'
  )
})

test('percobaan ulang mengirim Idempotency-Key yang sama termasuk userId', async () => {
  const f = muatFulfillment()
  const kunci = []
  const { deps } = buatDeps({
    getOffers: async () => [offerSupplier()],
    createOrder: async (_s, args) => {
      kunci.push(args.idempotencyKey)
      return { ok: true, orderId: '1', keys: ['k'], status: 'completed' }
    },
  })

  await f.fulfill({ varian: VARIAN, qty: 1, trxid: 'TRX-U', userId: 99, deps })
  await f.fulfill({ varian: VARIAN, qty: 1, trxid: 'TRX-U', userId: 99, deps })
  assert.equal(kunci.length, 2)
  assert.equal(kunci[0], kunci[1])
  assert.match(kunci[0], /99/)
})

test('failover TIDAK membeli dari supplier yang lebih mahal dari yang ditagih', async () => {
  const f = muatFulfillment()
  const dicoba = []
  const { deps } = buatDeps({
    getOffers: async () => [
      offerSupplier({ supplier_id: 'murah', external_id: 'A', harga: 20000 }),
      offerSupplier({ supplier_id: 'mahal', external_id: 'B', harga: 30000 }),
    ],
    createOrder: async (supplier) => {
      dicoba.push(supplier.id)
      if (supplier.id === 'murah') throw httpErr(409)
      return { ok: true, orderId: '2', keys: ['jangan'], status: 'completed' }
    },
  })

  const r = await f.fulfill({
    varian: VARIAN, qty: 1, trxid: 'TRX-MAHAL', hargaSatuan: 20000, deps,
  })
  assert.equal(r.ok, false, 'lebih mahal dari yang ditagih = gagal, lalu refund')
  assert.deepEqual(dicoba, ['murah'], 'supplier mahal tidak boleh dipanggil')
  assert.equal(r.attempts.length, 2)
  assert.equal(r.attempts[0].ok, false)
  assert.equal(r.attempts[1].ok, false)
  assert.equal(r.attempts[1].supplier_id, 'mahal')
  assert.match(r.attempts[1].error, /di atas yang ditagih/)
  assert.match(r.error, /di atas yang ditagih/)
})

test('stok sendiri dipakai dulu meski supplier lebih murah', async () => {
  const f = muatFulfillment()
  let supplierDipanggil = false
  const { deps } = buatDeps({
    getOffers: async () => [
      offerSupplier({ supplier_id: 'murah', harga: 20000 }),
      offerSendiri({ harga: 50000 }),
    ],
    getStokForTransaction: async () => [{ id: 'st1', data: 'akun' }],
    claimStok: async () => ({ ok: true, rows: [{ id: 'st1', data: 'akun' }] }),
    createOrder: async () => {
      supplierDipanggil = true
      throw new Error('supplier tidak boleh dipanggil selama stok sendiri cukup')
    },
  })

  const r = await f.fulfill({
    varian: VARIAN, qty: 1, trxid: 'TRX-SENDIRI', hargaSatuan: 20000, deps,
  })
  assert.equal(r.ok, true)
  assert.equal(r.sumber, 'sendiri')
  assert.deepEqual(r.lines, ['akun'])
  assert.equal(supplierDipanggil, false, 'alokasi: stok sendiri dulu, baru supplier')
})

test('supplier dengan harga sama dengan yang ditagih tetap dicoba', async () => {
  const f = muatFulfillment()
  const dicoba = []
  const { deps } = buatDeps({
    getOffers: async () => [
      offerSupplier({ supplier_id: 'a', harga: 20000 }),
      offerSupplier({ supplier_id: 'b', harga: 20000 }),
    ],
    createOrder: async (supplier) => {
      dicoba.push(supplier.id)
      if (supplier.id === 'a') throw httpErr(409)
      return { ok: true, orderId: '2', keys: ['ok'], status: 'completed' }
    },
  })

  const r = await f.fulfill({
    varian: VARIAN, qty: 1, trxid: 'TRX-SAMA-HARGA', hargaSatuan: 20000, deps,
  })
  assert.equal(r.ok, true)
  assert.deepEqual(dicoba, ['a', 'b'])
})

test('502 lalu retry yang berhasil tetap memakai kunci yang sama', async () => {
  const f = muatFulfillment()
  const kunci = []
  let n = 0
  const { deps, dicatat } = buatDeps({
    getOffers: async () => [offerSupplier()],
    createOrder: async (_s, args) => {
      kunci.push(args.idempotencyKey)
      n++
      if (n === 1) throw httpErr(502)
      return { ok: true, orderId: '9', keys: ['dari-retry'], status: 'completed' }
    },
  })

  const r = await f.fulfill({ varian: VARIAN, qty: 1, trxid: 'TRX-RETRY', deps })
  assert.equal(r.ok, true)
  assert.deepEqual(r.lines, ['dari-retry'])
  assert.equal(kunci[0], kunci[1])
  assert.equal(dicatat[0].status, 'ok')
})

test('502 yang masih gelap diselesaikan lewat getOrder', async () => {
  const f = muatFulfillment()
  let getDipanggil = null
  const { deps, dicatat } = buatDeps({
    getOffers: async () => [
      offerSupplier({ supplier_id: 'murah', harga: 20000 }),
      offerSupplier({ supplier_id: 'mahal', harga: 30000 }),
    ],
    createOrder: async () => {
      throw httpErr(502, { data: { id: 'ord-77' } })
    },
    getOrder: async (supplier, args) => {
      getDipanggil = { supplier: supplier.id, ...args }
      return { ok: true, orderId: 'ord-77', keys: ['dari-get'], status: 'completed' }
    },
  })

  const r = await f.fulfill({ varian: VARIAN, qty: 1, trxid: 'TRX-GET', deps })
  assert.equal(r.ok, true)
  assert.deepEqual(r.lines, ['dari-get'])
  assert.equal(getDipanggil.orderId, 'ord-77')
  assert.equal(getDipanggil.supplier, 'murah')
  assert.equal(dicatat[0].status, 'ok')
  assert.equal(dicatat[0].external_order_id, 'ord-77')
})

test('hasil ambigu TIDAK boleh di-refund otomatis', () => {
  const f = muatFulfillment()
  assert.equal(f.harusRefund({ ok: true }), false)
  assert.equal(f.harusRefund({ ok: false, error: 'stok habis' }), true)
  assert.equal(
    f.harusRefund({ ok: false, stopFailover: true, error: `${f.REKON_PREFIX}: HTTP 502` }),
    false,
    'timeout/5xx yang masih gelap ditahan untuk rekonsiliasi, bukan dikembalikan'
  )
  assert.equal(f.perluRekonsiliasi({ ok: false, stopFailover: true }), true)
  assert.equal(f.perluRekonsiliasi({ ok: false, error: 'HTTP 409' }), false)
})

test('markRefunded tidak menimpa jejak yang perlu rekonsiliasi', async () => {
  const f = muatFulfillment()
  const filter = []
  const client = {
    from(tabel) {
      assert.equal(tabel, 'SupplierOrder')
      const b = {
        update() { return b },
        eq() { return b },
        not(kolom, op, nilai) {
          filter.push({ kolom, op, nilai })
          return b
        },
        then(res, rej) {
          return Promise.resolve({ error: null }).then(res, rej)
        },
      }
      return b
    },
  }

  await f.markRefunded('TRX-REKON', { supabase: client })
  assert.equal(filter.length, 1)
  assert.equal(filter[0].kolom, 'error')
  assert.match(String(filter[0].nilai), /perlu rekonsiliasi manual/)
})
