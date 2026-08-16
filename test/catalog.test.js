const test = require('node:test')
const assert = require('node:assert')

const jalurClient = require.resolve('../lib/supabase.js')
const jalurStock = require.resolve('../lib/stock.js')
const jalurCatalog = require.resolve('../lib/catalog.js')
const jalurSourcing = require.resolve('../lib/sourcing.js')
const jalurFx = require.resolve('../lib/fx.js')
const jalurSettings = require.resolve('../lib/runtime-settings.js')

function buatFake({ products = [], variants = [], supplierProducts = [] } = {}) {
  const fake = {
    from(tabel) {
      const st = { tabel, filter: {}, inFilter: null, maybe: false, orderCol: null }
      const b = {
        select() { return b },
        eq(col, val) {
          st.filter[col] = val
          return b
        },
        in(col, vals) {
          st.inFilter = { col, vals }
          return b
        },
        order(col) {
          st.orderCol = col
          return b
        },
        maybeSingle() {
          st.maybe = true
          return b
        },
        then(res, rej) {
          const run = () => {
            if (st.tabel === 'Produk') {
              let rows = products.slice()
              for (const [k, v] of Object.entries(st.filter)) {
                rows = rows.filter((r) => r[k] === v)
              }
              return { data: st.maybe ? (rows[0] || null) : rows, error: null }
            }
            if (st.tabel === 'Varian') {
              let rows = variants.slice()
              for (const [k, v] of Object.entries(st.filter)) {
                if (k === 'kode') {
                  rows = rows.filter((r) => String(r.kode).toLowerCase() === String(v).toLowerCase())
                } else {
                  rows = rows.filter((r) => r[k] === v)
                }
              }
              if (st.inFilter) {
                rows = rows.filter((r) => st.inFilter.vals.includes(r[st.inFilter.col]))
              }
              return { data: st.maybe ? (rows[0] || null) : rows, error: null }
            }
            if (st.tabel === 'SupplierProduct') {
              let rows = supplierProducts.slice()
              if (st.inFilter) {
                rows = rows.filter((r) => st.inFilter.vals.includes(r[st.inFilter.col]))
              }
              for (const [k, v] of Object.entries(st.filter)) {
                rows = rows.filter((r) => r[k] === v)
              }
              return { data: rows, error: null }
            }
            return { data: st.maybe ? null : [], error: null }
          }
          return Promise.resolve(run()).then(res, rej)
        },
      }
      return b
    },
  }
  return fake
}

function muatCatalog(opts = {}) {
  const fake = buatFake(opts)
  const stockCounts = opts.stockCounts || {}
  // catalog -> sourcing -> {stock, fx} -> runtime-settings. SEMUANYA harus
  // dibuang dari cache, kalau tidak sourcing memegang stub stock dari
  // pemanggilan muatCatalog sebelumnya dan menjawab dengan data tes yang salah.
  for (const p of [jalurCatalog, jalurSourcing, jalurFx, jalurStock]) delete require.cache[p]

  require.cache[jalurClient] = { id: jalurClient, filename: jalurClient, loaded: true, exports: fake }
  require.cache[jalurSettings] = {
    id: jalurSettings, filename: jalurSettings, loaded: true,
    exports: {
      get: (key, fallback) => (opts.settings || {})[key] ?? fallback,
      bump: async () => 1,
    },
  }
  require.cache[jalurStock] = {
    id: jalurStock,
    filename: jalurStock,
    loaded: true,
    exports: {
      getStokCountsByKode: async (kodes) => {
        const out = Object.create(null)
        for (const k of kodes || []) {
          const key = String(k).toLowerCase()
          out[key] = stockCounts[key] ?? stockCounts[k] ?? 0
        }
        return out
      },
      getStokCountByKode: async (kode) => stockCounts[String(kode).toLowerCase()] || 0,
    },
  }
  return require(jalurCatalog)
}

test.after(() => {
  for (const p of [jalurClient, jalurStock, jalurCatalog, jalurSourcing, jalurFx, jalurSettings]) {
    delete require.cache[p]
  }
})

test('slugify lowercases and hyphenates', () => {
  const catalog = muatCatalog()
  assert.equal(catalog.slugify('Netflix Premium'), 'netflix-premium')
  assert.equal(catalog.slugify('  Spotify  '), 'spotify')
})

test('shouldSkipVariantPicker is true only for exactly one active variant', () => {
  const catalog = muatCatalog()
  assert.equal(catalog.shouldSkipVariantPicker([{ is_active: true }]), true)
  assert.equal(catalog.shouldSkipVariantPicker([{ is_active: true }, { is_active: true }]), false)
  assert.equal(catalog.shouldSkipVariantPicker([{ is_active: false }, { is_active: true }]), true)
  assert.equal(catalog.shouldSkipVariantPicker([]), false)
})

test('listProducts attaches variants and stok_count', async () => {
  const produkId = 'p1'
  const catalog = muatCatalog({
    products: [{ id: produkId, nama: 'Netflix', slug: 'netflix', is_active: true, urutan: 0, kategori: 'streaming' }],
    variants: [
      { id: 'v1', produk_id: produkId, label: '1 Bulan', kode: 'netflix-1b', harga: 25000, urutan: 1, is_active: true },
      { id: 'v2', produk_id: produkId, label: '3 Bulan', kode: 'netflix-3b', harga: 65000, urutan: 2, is_active: true },
    ],
    stockCounts: { 'netflix-1b': 5, 'netflix-3b': 0 },
  })
  const list = await catalog.listProducts({ withStock: true })
  assert.equal(list.length, 1)
  assert.equal(list[0].variants.length, 2)
  assert.equal(list[0].variants[0].stok_count, 5)
  assert.equal(list[0].variants[1].stok_count, 0)
})

test('totalStock sums variant counts', async () => {
  const produkId = 'p1'
  const catalog = muatCatalog({
    products: [{ id: produkId, nama: 'Netflix', slug: 'netflix', is_active: true, urutan: 0 }],
    variants: [
      { id: 'v1', produk_id: produkId, kode: 'a', is_active: true, urutan: 1 },
      { id: 'v2', produk_id: produkId, kode: 'b', is_active: true, urutan: 2 },
    ],
    stockCounts: { a: 2, b: 3 },
  })
  assert.equal(await catalog.totalStock(produkId), 5)
})

// ---------------------------------------------------------------------------
// Kesadaran supplier (Fase 13). Sumber stok ketiga MENAMBAH dua yang lama.
// ---------------------------------------------------------------------------

const PENGATURAN_HARGA = {
  fx_usd_idr: 10000, reseller_margin_persen: 0, fx_buffer_persen: 0, reseller_rounding: 0,
}

function katalogNetflix(extra = {}) {
  return muatCatalog({
    products: [{ id: 'p1', nama: 'Netflix', slug: 'netflix', is_active: true, urutan: 0 }],
    variants: [{ id: 'v1', produk_id: 'p1', label: '30 Hari', kode: 'netflix-30d', harga: 50000, is_active: true, urutan: 1, sumber: 'sendiri' }],
    settings: PENGATURAN_HARGA,
    ...extra,
  })
}

test('varian tanpa penawaran supplier berperilaku persis seperti sebelumnya', async () => {
  const catalog = katalogNetflix({ stockCounts: { 'netflix-30d': 4 } })
  const [v] = (await catalog.listProducts())[0].variants
  assert.equal(v.stok_count, 4)
  assert.equal(v.stok_sendiri, 4)
  assert.equal(v.harga_efektif, 50000, 'harga kita sendiri')
  assert.equal(v.punya_supplier, false)
  assert.equal(catalog.hargaVarian(v), 50000)
})

test('stok supplier ditambahkan ke hitungan stok varian', async () => {
  const catalog = katalogNetflix({
    stockCounts: { 'netflix-30d': 2 },
    supplierProducts: [{
      id: 'sp1', supplier_id: 's1', external_id: '100', varian_id: 'v1',
      harga_asal: 2.5, currency: 'USD', stok: 7, in_stock: true, is_available: true,
      supplier: { id: 's1', nama: 'Seller A', prioritas: 0, is_active: true },
    }],
  })
  const [v] = (await catalog.listProducts())[0].variants
  assert.equal(v.stok_count, 9, '2 milik kita + 7 milik supplier')
  assert.equal(v.stok_sendiri, 2)
  assert.equal(v.punya_supplier, true)
})

test('harga_efektif memakai sumber termurah', async () => {
  const catalog = katalogNetflix({
    stockCounts: { 'netflix-30d': 2 },
    supplierProducts: [{
      id: 'sp1', supplier_id: 's1', external_id: '100', varian_id: 'v1',
      harga_asal: 2.5, currency: 'USD', stok: 7, in_stock: true, is_available: true,
      supplier: { id: 's1', nama: 'Seller A', prioritas: 0, is_active: true },
    }],
  })
  const [v] = (await catalog.listProducts())[0].variants
  assert.equal(v.harga_efektif, 25000, 'supplier 2.5 USD lebih murah dari 50000 kita')
  assert.equal(v.sumber_terbaik, 'supplier')
  assert.equal(catalog.hargaVarian(v), 25000)
})

test('stok sendiri yang lebih murah tetap menang', async () => {
  const catalog = muatCatalog({
    products: [{ id: 'p1', nama: 'Netflix', slug: 'netflix', is_active: true, urutan: 0 }],
    variants: [{ id: 'v1', produk_id: 'p1', label: '30 Hari', kode: 'netflix-30d', harga: 20000, is_active: true, urutan: 1, sumber: 'sendiri' }],
    settings: PENGATURAN_HARGA,
    stockCounts: { 'netflix-30d': 3 },
    supplierProducts: [{
      id: 'sp1', supplier_id: 's1', external_id: '100', varian_id: 'v1',
      harga_asal: 2.5, currency: 'USD', stok: 7, in_stock: true, is_available: true,
      supplier: { id: 's1', nama: 'Seller A', prioritas: 0, is_active: true },
    }],
  })
  const [v] = (await catalog.listProducts())[0].variants
  assert.equal(v.harga_efektif, 20000)
  assert.equal(v.sumber_terbaik, 'sendiri')
})

test('varian habis total memberi harga_efektif null dan hargaVarian jatuh ke harga dasar', async () => {
  const catalog = katalogNetflix({ stockCounts: {} })
  const [v] = (await catalog.listProducts())[0].variants
  assert.equal(v.stok_count, 0)
  assert.equal(v.harga_efektif, null)
  assert.equal(catalog.hargaVarian(v), 50000, 'layar "habis" tetap menampilkan angka')
})

test('hargaVarian aman untuk masukan kosong', () => {
  const catalog = muatCatalog()
  assert.equal(catalog.hargaVarian(null), 0)
  assert.equal(catalog.hargaVarian({}), 0)
  assert.equal(catalog.hargaVarian({ harga: 1234 }), 1234)
  assert.equal(catalog.hargaVarian({ harga: 1234, harga_efektif: 999 }), 999)
})
