const test = require('node:test')
const assert = require('node:assert')
const bulk = require('../lib/bulk')

test('normalizeCatalogRow requires produk_nama, varian fields, harga', () => {
  const bad = bulk.normalizeCatalogRow({ produk_nama: 'X' })
  assert.equal(bad.ok, false)

  const good = bulk.normalizeCatalogRow({
    produk_nama: 'Netflix',
    deskripsi: 'desc',
    snk: 'snk',
    varian_label: '7 Hari',
    varian_kode: 'Netflix-7D',
    harga: '15000',
  })
  assert.equal(good.ok, true)
  assert.equal(good.value.slug, 'netflix')
  assert.equal(good.value.varian.kode, 'netflix-7d')
  assert.equal(good.value.varian.harga, 15000)
  assert.equal(good.value.kategori, 'umum')
})

test('groupCatalogRows groups variants under one slug', () => {
  const { products, failures } = bulk.groupCatalogRows([
    {
      produk_nama: 'Netflix', deskripsi: 'd', snk: 's',
      varian_label: '7d', varian_kode: 'netflix-7d', harga: 15000,
    },
    {
      produk_nama: 'Netflix', deskripsi: 'ignored', snk: 'ignored',
      varian_label: '1b', varian_kode: 'netflix-1b', harga: 45000,
    },
  ])
  assert.equal(failures.length, 0)
  assert.equal(products.length, 1)
  assert.equal(products[0].variants.length, 2)
  assert.equal(products[0].deskripsi, 'd')
})

test('groupCatalogRows reports duplicate kode in file as failure', () => {
  const { failures } = bulk.groupCatalogRows([
    {
      produk_nama: 'A', deskripsi: 'd', snk: 's',
      varian_label: '1', varian_kode: 'same', harga: 1,
    },
    {
      produk_nama: 'B', deskripsi: 'd', snk: 's',
      varian_label: '2', varian_kode: 'same', harga: 2,
    },
  ])
  assert.ok(failures.some((f) => /duplikat/i.test(f.error)))
})

test('parseStockLines splits on newlines and commas', () => {
  assert.deepEqual(bulk.parseStockLines('a:b\nc:d, e:f\n'), ['a:b', 'c:d', 'e:f'])
})

test('normalizeTierRow enforces min_qty >= 2', () => {
  assert.equal(bulk.normalizeTierRow({ varian_kode: 'x', min_qty: 1, harga: 10 }).ok, false)
  const r = bulk.normalizeTierRow({ varian_kode: 'X', min_qty: 5, harga: '12000' })
  assert.equal(r.ok, true)
  assert.equal(r.value.varian_kode, 'x')
  assert.equal(r.value.min_qty, 5)
  assert.equal(r.value.harga, 12000)
})

test('computeNewHarga percentage and fixed', () => {
  assert.equal(bulk.computeNewHarga(10000, 'percentage', 10).harga, 11000)
  assert.equal(bulk.computeNewHarga(10000, 'fixed', -2500).harga, 7500)
  assert.equal(bulk.computeNewHarga(1000, 'fixed', -2000).ok, false)
})
