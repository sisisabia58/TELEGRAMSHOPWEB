const test = require('node:test')
const assert = require('node:assert')

const jalurClient = require.resolve('../lib/supabase.js')
const jalurSettings = require.resolve('../lib/runtime-settings.js')
const jalurFx = require.resolve('../lib/fx.js')
const jalurStock = require.resolve('../lib/stock.js')
const jalurSourcing = require.resolve('../lib/sourcing.js')

// sourcing.js menarik supabase, stock, dan fx di tingkat modul. Untuk pengujian
// fungsi murni cukup stub minimal; tes berbasis DB memberi baris sendiri.
function muatSourcing({ supplierRows = [], ownCounts = {}, settings = {}, error = null } = {}) {
  for (const p of [jalurSourcing, jalurFx]) delete require.cache[p]

  require.cache[jalurClient] = {
    id: jalurClient, filename: jalurClient, loaded: true,
    exports: {
      from() {
        const b = {
          select() { return b },
          in() { return b },
          eq() { return b },
          order() { return b },
          range() { return b },
          upsert() { return Promise.resolve({ error: null }) },
          then(res, rej) {
            return Promise.resolve({ data: error ? null : supplierRows, error }).then(res, rej)
          },
        }
        return b
      },
    },
  }
  require.cache[jalurSettings] = {
    id: jalurSettings, filename: jalurSettings, loaded: true,
    exports: {
      get(key, fallback) {
        const v = settings[key]
        return v === undefined || v === null || v === '' ? fallback : v
      },
      bump: async () => 1,
    },
  }
  require.cache[jalurStock] = {
    id: jalurStock, filename: jalurStock, loaded: true,
    exports: {
      getStokCountByKode: async (kode) => ownCounts[String(kode).toLowerCase()] || 0,
      getStokCountsByKode: async (kodes) => {
        const out = {}
        for (const k of kodes || []) out[String(k).toLowerCase()] = ownCounts[String(k).toLowerCase()] || 0
        return out
      },
    },
  }
  return require(jalurSourcing)
}

test.after(() => {
  for (const p of [jalurClient, jalurSettings, jalurStock, jalurFx, jalurSourcing]) delete require.cache[p]
})

// Kurs bulat + tanpa buffer/pembulatan supaya angka di tes mudah dibaca:
// 1 USD = 10.000 IDR, margin 0.
const PRICING = { rate: 10000, marginPersen: 0, bufferPersen: 0, roundTo: 0 }

const VARIAN = { id: 'v1', kode: 'netflix-30d', harga: 50000, sumber: 'sendiri' }

function supplierRow(over = {}) {
  return {
    id: over.id || 'sp1',
    supplier_id: over.supplier_id || 's1',
    external_id: over.external_id || '100',
    varian_id: 'v1',
    harga_asal: 'harga_asal' in over ? over.harga_asal : 2.5,
    currency: 'USD',
    stok: over.stok ?? 10,
    in_stock: over.in_stock ?? true,
    is_available: over.is_available ?? true,
    supplier: { id: over.supplier_id || 's1', nama: over.nama || 'Seller A', prioritas: over.prioritas ?? 0, is_active: over.aktif ?? true },
  }
}

// ---------------------------------------------------------------------------
// buildOffers
// ---------------------------------------------------------------------------

test('buildOffers memasukkan stok sendiri sebagai penawaran biasa', () => {
  const s = muatSourcing()
  const offers = s.buildOffers({ varian: VARIAN, ownStokCount: 4, supplierRows: [], pricing: PRICING })
  assert.equal(offers.length, 1)
  assert.equal(offers[0].sumber, 'sendiri')
  assert.equal(offers[0].harga_satuan, 50000)
  assert.equal(offers[0].stok, 4)
})

test('buildOffers melewatkan stok sendiri kalau habis', () => {
  const s = muatSourcing()
  const offers = s.buildOffers({ varian: VARIAN, ownStokCount: 0, supplierRows: [], pricing: PRICING })
  assert.deepEqual(offers, [])
})

test('buildOffers mengonversi harga supplier ke rupiah', () => {
  const s = muatSourcing()
  const offers = s.buildOffers({
    varian: VARIAN, ownStokCount: 0, supplierRows: [supplierRow({ harga_asal: 2.5 })],
    pricing: { ...PRICING, marginPersen: 10 },
  })
  assert.equal(offers.length, 1)
  assert.equal(offers[0].sumber, 'supplier')
  assert.equal(offers[0].harga_satuan, 27500) // 2.5 x 10000 x 1.10
  assert.equal(offers[0].harga_asal, 2.5)
})

test('buildOffers membuang penawaran supplier yang tidak bisa dipakai', () => {
  const s = muatSourcing()
  const baris = [
    supplierRow({ id: 'a', stok: 0 }),
    supplierRow({ id: 'b', in_stock: false }),
    supplierRow({ id: 'c', is_available: false }),
    supplierRow({ id: 'd', aktif: false }),
    supplierRow({ id: 'e', harga_asal: null }),
  ]
  const offers = s.buildOffers({ varian: VARIAN, ownStokCount: 0, supplierRows: baris, pricing: PRICING })
  assert.deepEqual(offers, [], 'tidak ada satu pun yang layak ditawarkan')
})

test('buildOffers TIDAK PERNAH menawarkan harga yang gagal dihitung', () => {
  const s = muatSourcing()
  // Kurs rusak -> computeIdrPrice null. Menjual Rp 0 jauh lebih buruk daripada
  // tidak menawarkan sama sekali.
  const offers = s.buildOffers({
    varian: VARIAN, ownStokCount: 0, supplierRows: [supplierRow()],
    pricing: { ...PRICING, rate: 0 },
  })
  assert.deepEqual(offers, [])
})

test('buildOffers mengabaikan stok sendiri untuk varian bikinan sync', () => {
  const s = muatSourcing()
  const varianSync = { ...VARIAN, sumber: 'supplier', harga: 99999 }
  const offers = s.buildOffers({ varian: varianSync, ownStokCount: 5, supplierRows: [], pricing: PRICING })
  assert.deepEqual(offers, [], 'harga varian sync cuma cadangan tampilan, bukan penawaran')
})

test('buildOffers aman untuk masukan kosong atau rusak', () => {
  const s = muatSourcing()
  assert.deepEqual(s.buildOffers(), [])
  assert.deepEqual(s.buildOffers({ varian: null }), [])
  assert.deepEqual(s.buildOffers({ varian: VARIAN, ownStokCount: 1, supplierRows: [null, undefined], pricing: PRICING }).length, 1)
})

// ---------------------------------------------------------------------------
// pickBestOffer — inti aturan "otomatis ke termurah"
// ---------------------------------------------------------------------------

test('pickBestOffer memilih supplier termurah', () => {
  const s = muatSourcing()
  // Skenario yang diminta: dua penjual punya Netflix 30 hari, USD 2.5 vs 3.0.
  const offers = s.buildOffers({
    varian: VARIAN, ownStokCount: 0, pricing: PRICING,
    supplierRows: [
      supplierRow({ id: 'mahal', supplier_id: 's2', nama: 'Seller B', harga_asal: 3.0 }),
      supplierRow({ id: 'murah', supplier_id: 's1', nama: 'Seller A', harga_asal: 2.5 }),
    ],
  })
  const terbaik = s.pickBestOffer(offers, 1)
  assert.equal(terbaik.supplier_product_id, 'murah')
  assert.equal(terbaik.harga_satuan, 25000)
})

test('pickBestOffer memilih stok sendiri kalau lebih murah', () => {
  const s = muatSourcing()
  const offers = s.buildOffers({
    varian: { ...VARIAN, harga: 20000 }, ownStokCount: 3, pricing: PRICING,
    supplierRows: [supplierRow({ harga_asal: 2.5 })], // 25000
  })
  assert.equal(s.pickBestOffer(offers, 1).sumber, 'sendiri')
})

test('pickBestOffer memilih supplier kalau harga kita lebih mahal', () => {
  const s = muatSourcing()
  const offers = s.buildOffers({
    varian: { ...VARIAN, harga: 40000 }, ownStokCount: 3, pricing: PRICING,
    supplierRows: [supplierRow({ harga_asal: 2.5 })], // 25000
  })
  assert.equal(s.pickBestOffer(offers, 1).sumber, 'supplier')
})

test('pickBestOffer melewati penawaran yang stoknya kurang', () => {
  const s = muatSourcing()
  const offers = s.buildOffers({
    varian: VARIAN, ownStokCount: 0, pricing: PRICING,
    supplierRows: [
      supplierRow({ id: 'murah-tipis', harga_asal: 1.0, stok: 2 }),
      supplierRow({ id: 'mahal-tebal', supplier_id: 's2', harga_asal: 2.0, stok: 50 }),
    ],
  })
  assert.equal(s.pickBestOffer(offers, 2).supplier_product_id, 'murah-tipis')
  assert.equal(s.pickBestOffer(offers, 5).supplier_product_id, 'mahal-tebal', 'qty 5 tidak muat di stok 2')
})

test('pickBestOffer mengembalikan null kalau tidak ada yang cukup', () => {
  const s = muatSourcing()
  const offers = s.buildOffers({
    varian: VARIAN, ownStokCount: 1, pricing: PRICING,
    supplierRows: [supplierRow({ stok: 2 })],
  })
  assert.equal(s.pickBestOffer(offers, 99), null)
  assert.equal(s.pickBestOffer([], 1), null)
  assert.equal(s.pickBestOffer(null, 1), null)
})

test('pickBestOffer memakai prioritas sebagai penyeri saat harga sama', () => {
  const s = muatSourcing()
  const offers = s.buildOffers({
    varian: VARIAN, ownStokCount: 0, pricing: PRICING,
    supplierRows: [
      supplierRow({ id: 'b', supplier_id: 's2', harga_asal: 2.5, prioritas: 5 }),
      supplierRow({ id: 'a', supplier_id: 's1', harga_asal: 2.5, prioritas: 1 }),
    ],
  })
  assert.equal(s.pickBestOffer(offers, 1).supplier_product_id, 'a')
})

test('pada harga sama persis, stok sendiri menang atas supplier', () => {
  const s = muatSourcing()
  // Tanpa modal dan tanpa risiko API pihak ketiga.
  const offers = s.buildOffers({
    varian: { ...VARIAN, harga: 25000 }, ownStokCount: 5, pricing: PRICING,
    supplierRows: [supplierRow({ harga_asal: 2.5, prioritas: -99 })],
  })
  assert.equal(s.pickBestOffer(offers, 1).sumber, 'sendiri')
})

test('sumber termurah bisa BERBEDA antara qty 1 dan qty besar', () => {
  const s = muatSourcing()
  // Stok sendiri lebih murah tapi cuma 2 unit; supplier lebih mahal tapi banyak.
  // Kalau harga diambil dari pemenang qty=1 (stok sendiri) sementara yang
  // benar-benar mengirim adalah supplier, kita menagih di bawah modal.
  const offers = s.buildOffers({
    varian: { ...VARIAN, harga: 10000 }, ownStokCount: 2, pricing: PRICING,
    supplierRows: [supplierRow({ harga_asal: 1.5, stok: 10 })], // 15000
  })

  assert.equal(s.pickBestOffer(offers, 1).sumber, 'sendiri')
  assert.equal(s.pickBestOffer(offers, 1).harga_satuan, 10000)

  assert.equal(s.pickBestOffer(offers, 3).sumber, 'supplier')
  assert.equal(s.pickBestOffer(offers, 3).harga_satuan, 15000)
})

test('penawaran dengan harga TIDAK DIKETAHUI tidak pernah masuk daftar', () => {
  const s = muatSourcing()
  // harga_asal null berarti supplier tidak memberi tahu harganya. Kalau
  // diperlakukan sebagai 0, ia jadi penawaran termurah mutlak dan kita menjual
  // gratis barang yang modalnya tidak diketahui.
  const offers = s.buildOffers({
    varian: VARIAN, ownStokCount: 3, pricing: PRICING,
    supplierRows: [supplierRow({ harga_asal: null, stok: 99 })],
  })
  assert.equal(offers.length, 1)
  assert.equal(offers[0].sumber, 'sendiri')
  assert.equal(s.pickBestOffer(offers, 1).harga_satuan, 50000, 'bukan 0')
})

test('harga nol yang memang disengaja tetap boleh ditawarkan', () => {
  const s = muatSourcing()
  const offers = s.buildOffers({
    varian: VARIAN, ownStokCount: 0, pricing: PRICING,
    supplierRows: [supplierRow({ harga_asal: 0, stok: 5 })],
  })
  assert.equal(offers.length, 1)
  assert.equal(offers[0].harga_satuan, 0)
})

test('pickBestOffer menormalkan qty yang aneh', () => {
  const s = muatSourcing()
  const offers = s.buildOffers({ varian: VARIAN, ownStokCount: 1, pricing: PRICING })
  for (const qty of [0, -3, null, undefined, 'x', 1.7]) {
    assert.ok(s.pickBestOffer(offers, qty), `qty ${qty} harus diperlakukan sebagai 1`)
  }
})

// ---------------------------------------------------------------------------
// rankOffers / summarize
// ---------------------------------------------------------------------------

test('rankOffers mengurutkan termurah dulu untuk failover', () => {
  const s = muatSourcing()
  const offers = s.buildOffers({
    varian: VARIAN, ownStokCount: 0, pricing: PRICING,
    supplierRows: [
      supplierRow({ id: 'c', supplier_id: 's3', harga_asal: 3.0 }),
      supplierRow({ id: 'a', supplier_id: 's1', harga_asal: 1.0 }),
      supplierRow({ id: 'b', supplier_id: 's2', harga_asal: 2.0 }),
    ],
  })
  assert.deepEqual(s.rankOffers(offers, 1).map((o) => o.supplier_product_id), ['a', 'b', 'c'])
})

test('summarize memberi harga efektif dan stok gabungan', () => {
  const s = muatSourcing()
  const offers = s.buildOffers({
    varian: { ...VARIAN, harga: 40000 }, ownStokCount: 3, pricing: PRICING,
    supplierRows: [supplierRow({ harga_asal: 2.5, stok: 7 })],
  })
  const r = s.summarize(offers)
  assert.equal(r.harga_efektif, 25000, 'yang termurah yang ditampilkan')
  assert.equal(r.stok_total, 10, '3 milik kita + 7 milik supplier')
  assert.equal(r.sumber_terbaik, 'supplier')
  assert.equal(r.punya_supplier, true)
})

test('summarize untuk varian tanpa penawaran sama sekali', () => {
  const s = muatSourcing()
  const r = s.summarize([])
  assert.equal(r.harga_efektif, null)
  assert.equal(r.stok_total, 0)
  assert.equal(r.punya_supplier, false)
})

// ---------------------------------------------------------------------------
// Pembungkus database
// ---------------------------------------------------------------------------

test('summarizeVariants menggabungkan stok sendiri dan supplier per varian', async () => {
  const s = muatSourcing({
    ownCounts: { 'netflix-30d': 2 },
    supplierRows: [supplierRow({ stok: 5, harga_asal: 2.5 })],
    settings: { fx_usd_idr: 10000, reseller_margin_persen: 0, fx_buffer_persen: 0, reseller_rounding: 0 },
  })
  const hasil = await s.summarizeVariants([VARIAN])
  assert.equal(hasil.v1.stok_total, 7)
  assert.equal(hasil.v1.harga_efektif, 25000)
})

test('summarizeVariants tetap jalan kalau query supplier gagal', async () => {
  // Supplier tidak boleh menjatuhkan katalog: tanpa baris supplier, semuanya
  // kembali ke perilaku stok-sendiri yang lama.
  const s = muatSourcing({
    ownCounts: { 'netflix-30d': 2 },
    error: { message: 'boom' },
    settings: { fx_usd_idr: 10000, reseller_margin_persen: 0, fx_buffer_persen: 0, reseller_rounding: 0 },
  })
  const hasil = await s.summarizeVariants([VARIAN])
  assert.equal(hasil.v1.stok_total, 2)
  assert.equal(hasil.v1.harga_efektif, 50000)
  assert.equal(hasil.v1.punya_supplier, false)
})

test('summarizeVariants aman untuk daftar kosong', async () => {
  const s = muatSourcing()
  assert.deepEqual(await s.summarizeVariants([]), Object.create(null))
  assert.deepEqual(await s.summarizeVariants(null), Object.create(null))
})

test('getOffersForVarian menggabungkan kedua sumber', async () => {
  const s = muatSourcing({
    ownCounts: { 'netflix-30d': 3 },
    supplierRows: [supplierRow({ harga_asal: 2.5 })],
    settings: { fx_usd_idr: 10000, reseller_margin_persen: 0, fx_buffer_persen: 0, reseller_rounding: 0 },
  })
  const offers = await s.getOffersForVarian(VARIAN)
  assert.equal(offers.length, 2)
  assert.deepEqual(offers.map((o) => o.sumber).sort(), ['sendiri', 'supplier'])
})
