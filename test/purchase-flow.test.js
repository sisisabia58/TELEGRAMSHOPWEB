const test = require('node:test')
const assert = require('node:assert')
const flow = require('../lib/purchase-flow')

const rupiah = (n) => `Rp${n}`

function netflixOffers() {
  return [
    { sumber: 'sendiri', supplier_id: null, supplier_product_id: null, supplier_nama: null, harga_satuan: 45000, stok: 2 },
    { sumber: 'supplier', supplier_id: 'sA', supplier_product_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', supplier_nama: 'Seller A', harga_satuan: 40000, stok: 4 },
    { sumber: 'supplier', supplier_id: 'sB', supplier_product_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', supplier_nama: 'Seller B', harga_satuan: 52000, stok: 6 },
    { sumber: 'supplier', supplier_id: 'sC', supplier_product_id: 'cccccccc-cccc-cccc-cccc-cccccccccccc', supplier_nama: 'Seller Habis', harga_satuan: 1000, stok: 0 },
  ]
}

test('stok produk menjumlah varian dan mengabaikan stok_count basi di baris produk', () => {
  // Bentuk yang dipakai bot sebelum perbaikan: Produk tidak punya kode,
  // getStokCount(p.kode) selalu 0, lalu tombol produk disembunyikan.
  const product = {
    nama: 'Netflix Family',
    slug: 'netflix-family',
    stok_count: 0,
    variants: [
      { label: '7 Hari', kode: 'netflix-7d', is_active: true, stok_count: 3, harga: 15000 },
      { label: '30 Hari', kode: 'netflix-30d', is_active: true, stok_count: 2, harga: 45000 },
      { label: '90 Hari', kode: 'netflix-90d', is_active: true, stok_count: 0, harga: 120000 },
    ],
  }
  assert.equal(flow.productDisplayedStock(product), 5)
  assert.equal(flow.productDisplayedStock({ nama: 'Spotify Solo', stok_count: 0, variants: [{ stok_count: 5, is_active: true }] }), 5)
  assert.equal(flow.productDisplayedStock({ nama: 'Canva Pro', stok_count: 0, variants: [{ stok_count: 0, is_active: true }] }), 0)
})

test('daftar tanpa varian (stok_count 0 dari Produk.kode) harus dimuat ulang dari katalog', () => {
  const broken = [
    { nama: 'SPOTIFY SOLO', stok_count: 0 },
    { nama: 'NETFLIX FAMILY', stok_count: 0 },
    { nama: 'CANVA PRO', stok_count: 0 },
  ]
  assert.equal(flow.hasAttachedVariants(broken), false)
  assert.equal(flow.hasAttachedVariants([{ nama: 'Netflix Family', variants: [{ stok_count: 5 }] }]), true)
})

test('stok durasi adalah gabungan semua penjual yang masih punya stok', () => {
  const variant = {
    label: '30 Hari',
    harga: 45000,
    stok_count: 2,
    offers: netflixOffers(),
  }
  assert.equal(flow.variantDisplayedStock(variant), 12, '2 sendiri + 4 Seller A + 6 Seller B')
  assert.equal(flow.combinedStock(variant.offers), 12)
  const line = flow.durationLine(variant, rupiah)
  assert.equal(line.inStock, true)
  assert.equal(line.stock, 12)
  assert.match(line.text, /Stok 12/)
  assert.doesNotMatch(line.text, /Stok 2\)/)
  assert.match(line.text, /mulai Rp40000/)
})

test('satu penjual tetap menampilkan harga dan stok seperti sebelumnya', () => {
  const variant = {
    label: '7 Hari',
    harga: 15000,
    harga_efektif: 15000,
    stok_count: 3,
    offers: [{ sumber: 'sendiri', harga_satuan: 15000, stok: 3 }],
  }
  const line = flow.durationLine(variant, rupiah)
  assert.equal(line.text, '*7 Hari* - Rp15000 (Stok 3)')
  assert.equal(flow.needsSellerPicker(variant.offers), false)
})

test('opsi pembeli diurutkan dari harga termurah tanpa nama supplier', () => {
  const options = flow.sellerOptions(netflixOffers())
  assert.equal(options.length, 3)
  assert.deepEqual(options.map((o) => o.label), ['Opsi 1', 'Opsi 2', 'Opsi 3'])
  assert.deepEqual(options.map((o) => o.harga_satuan), [40000, 45000, 52000])
  assert.deepEqual(options.map((o) => o.stok), [4, 2, 6])
  assert.equal(options[0].sumber, 'supplier')
  assert.equal(options[1].sumber, 'sendiri')
  assert.equal(flow.needsSellerPicker(netflixOffers()), true)
  assert.equal(flow.sellerCallbackData(options[0]), 'src:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
  assert.equal(flow.sellerCallbackData(options[1]), 'src:own')
  const teks = JSON.stringify(options)
  assert.equal(/hubx|insightx|seller a|seller b|stok sendiri/i.test(teks), false)
  assert.equal(Object.hasOwn(options[0], 'supplier_nama'), false)
  const termurah = flow.optionForPin(netflixOffers(), flow.pinFromOption(options[0]))
  assert.equal(termurah.label, 'Opsi 1')
  assert.equal(
    flow.buyerProductName('Google AI Plus — 1 Tahun (NW)', termurah.label),
    'Google AI Plus — 1 Tahun (NW) (Opsi 1)'
  )
  assert.equal(flow.optionForPin(netflixOffers(), null), null)
})

test('harga sama tidak mengurutkan opsi dari nama supplier', () => {
  const offers = [
    { sumber: 'supplier', supplier_product_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', supplier_nama: 'InsightX', harga_satuan: 100, stok: 1 },
    { sumber: 'supplier', supplier_product_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', supplier_nama: 'HubX', harga_satuan: 100, stok: 5 },
    { sumber: 'sendiri', supplier_nama: null, harga_satuan: 100, stok: 5 },
  ]
  const options = flow.sellerOptions(offers)
  assert.deepEqual(options.map((o) => o.label), ['Opsi 1', 'Opsi 2', 'Opsi 3'])
  assert.equal(options[0].sumber, 'sendiri')
  assert.equal(options[1].supplier_product_id, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
  assert.equal(options[2].stok, 1)
  assert.equal(options.some((o) => /hubx|insightx/i.test(o.label)), false)
})

test('pin penjual membatasi stok dan harga ke sumber yang dipilih', () => {
  const variant = { label: '30 Hari', harga: 45000, offers: netflixOffers(), stok_count: 12 }
  const sellerA = flow.applyPin(variant, flow.pinFromCallback('src:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'))
  assert.equal(sellerA.stok_count, 4)
  assert.equal(sellerA.harga_efektif, 40000)
  assert.equal(sellerA.stok_sendiri, 0)
  assert.equal(sellerA.offers.length, 1)

  const ownOption = flow.sellerOptions(netflixOffers()).find((o) => o.sumber === 'sendiri')
  const own = flow.applyPin(variant, flow.pinFromOption(ownOption))
  assert.equal(own.stok_count, 2)
  assert.equal(own.harga_efektif, 45000)
  assert.equal(own.stok_sendiri, 2)

  const missing = flow.applyPin(variant, { sumber: 'supplier', supplier_product_id: 'dddddddd-dddd-dddd-dddd-dddddddddddd' })
  assert.equal(missing.stok_count, 0)
  assert.equal(missing.harga_efektif, null)
})

test('balasan nomor dan nama memilih produk di urutan daftar', () => {
  const list = [
    { nama: 'Canva Pro', slug: 'canva-pro' },
    { nama: 'Netflix Family', slug: 'netflix-family' },
    { nama: 'Spotify Solo', slug: 'spotify-solo' },
  ]
  const byNumber = flow.matchProductQuery(list, '2')
  assert.equal(byNumber.product.slug, 'netflix-family')
  const byName = flow.matchProductQuery(list, 'NETFLIX FAMILY')
  assert.equal(byName.product.slug, 'netflix-family')
  const partial = flow.matchProductQuery(list, 'spotify')
  assert.equal(partial.product.slug, 'spotify-solo')
  assert.equal(flow.matchProductQuery(list, '9').outOfRange, true)
  assert.equal(flow.matchProductQuery(list, 'halo'), null)
})

test('laporan stok tidak memakai harga produk yang tidak ada', () => {
  const facts = flow.buyerStockFacts({
    nama: 'Netflix Family',
    slug: 'netflix-family',
    variants: [
      { label: '7 Hari', is_active: true, stok_count: 3, harga: 15000, terjual: 1 },
      { label: '30 Hari', is_active: true, stok_count: 2, harga: 45000, terjual: 4 },
    ],
  })
  assert.equal(facts.stok, 5)
  assert.equal(facts.terjual, 5)
  assert.equal(flow.formatHargaRange(facts.minHarga, facts.maxHarga, rupiah), 'Rp15000 – Rp45000')
  assert.equal(flow.formatHargaRange(null, null, rupiah), '—')
})
