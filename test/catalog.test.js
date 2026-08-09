const test = require('node:test')
const assert = require('node:assert')

const jalurClient = require.resolve('../lib/supabase.js')
const jalurStock = require.resolve('../lib/stock.js')
const jalurCatalog = require.resolve('../lib/catalog.js')

function buatFake({ products = [], variants = [], stockCounts = {} } = {}) {
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

function muatCatalog(opts) {
  const fake = buatFake(opts)
  delete require.cache[jalurCatalog]
  delete require.cache[jalurStock]
  require.cache[jalurClient] = { id: jalurClient, filename: jalurClient, loaded: true, exports: fake }
  require.cache[jalurStock] = {
    id: jalurStock,
    filename: jalurStock,
    loaded: true,
    exports: {
      getStokCountsByKode: async (kodes) => {
        const out = Object.create(null)
        for (const k of kodes) {
          const key = String(k).toLowerCase()
          out[key] = opts.stockCounts?.[key] ?? opts.stockCounts?.[k] ?? 0
        }
        return out
      },
      getStokCountByKode: async (kode) => opts.stockCounts?.[String(kode).toLowerCase()] || 0,
    },
  }
  return require(jalurCatalog)
}

test.after(() => {
  delete require.cache[jalurClient]
  delete require.cache[jalurStock]
  delete require.cache[jalurCatalog]
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
