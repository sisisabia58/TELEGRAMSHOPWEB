const test = require('node:test')
const assert = require('node:assert')

const jalurClient = require.resolve('../lib/supabase.js')
const jalurStock = require.resolve('../lib/stock.js')

function buatFake(rows) {
  return {
    from(tabel) {
      assert.equal(tabel, 'Stok')
      const st = { filter: {}, head: false }
      const b = {
        select(_c, opts) {
          if (opts && opts.head) st.head = true
          return b
        },
        eq(col, val) {
          st.filter[col] = val
          return b
        },
        in() { return b },
        order() { return b },
        limit() { return b },
        then(res, rej) {
          let matched = rows.filter((r) => {
            for (const [k, v] of Object.entries(st.filter)) {
              if (String(r[k]).toLowerCase() !== String(v).toLowerCase() && r[k] !== v) return false
            }
            return true
          })
          if (st.head) {
            return Promise.resolve({ data: null, error: null, count: matched.length }).then(res, rej)
          }
          return Promise.resolve({ data: matched, error: null }).then(res, rej)
        },
      }
      return b
    },
  }
}

function muat(rows) {
  delete require.cache[jalurStock]
  require.cache[jalurClient] = {
    id: jalurClient,
    filename: jalurClient,
    loaded: true,
    exports: buatFake(rows),
  }
  return require(jalurStock)
}

test.after(() => {
  delete require.cache[jalurClient]
  delete require.cache[jalurStock]
})

test('getStokCountByKode filters varian_kode', async () => {
  const stock = muat([
    { id: 1, varian_kode: 'netflix-1b', status: 'tersedia' },
    { id: 2, varian_kode: 'netflix-1b', status: 'terjual' },
  ])
  assert.equal(await stock.getStokCountByKode('netflix-1b'), 1)
})

test('getStokCountByVarianId filters varian_id', async () => {
  const stock = muat([
    { id: 1, varian_id: 'v1', varian_kode: 'a', status: 'tersedia' },
    { id: 2, varian_id: 'v1', varian_kode: 'a', status: 'tersedia' },
  ])
  assert.equal(await stock.getStokCountByVarianId('v1'), 2)
})
