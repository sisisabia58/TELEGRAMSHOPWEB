const test = require('node:test')
const assert = require('node:assert')

const jalurClient = require.resolve('../lib/supabase.js')
const jalurPricing = require.resolve('../lib/pricing.js')

function muatPricing(tiersRows = []) {
  delete require.cache[jalurPricing]
  require.cache[jalurClient] = {
    id: jalurClient,
    filename: jalurClient,
    loaded: true,
    exports: {
      from(tabel) {
        assert.equal(tabel, 'HargaTier')
        const st = { filter: {} }
        const b = {
          select() { return b },
          eq(col, val) { st.filter[col] = val; return b },
          order() { return b },
          then(res, rej) {
            let rows = tiersRows.slice()
            for (const [k, v] of Object.entries(st.filter)) {
              rows = rows.filter((r) => r[k] === v)
            }
            rows.sort((a, b) => a.min_qty - b.min_qty)
            return Promise.resolve({ data: rows, error: null }).then(res, rej)
          },
        }
        return b
      },
    },
  }
  return require(jalurPricing)
}

test.after(() => {
  delete require.cache[jalurClient]
  delete require.cache[jalurPricing]
})

test('resolveUnitPrice falls back to base when no tiers', () => {
  const pricing = muatPricing()
  const r = pricing.resolveUnitPrice(25000, 3, [])
  assert.deepEqual(r, { harga_satuan: 25000, subtotal: 75000, matched_min_qty: null })
})

test('resolveUnitPrice falls back when qty below all min_qty', () => {
  const pricing = muatPricing()
  const tiers = [{ min_qty: 5, harga: 20000 }, { min_qty: 10, harga: 18000 }]
  const r = pricing.resolveUnitPrice(25000, 4, tiers)
  assert.equal(r.harga_satuan, 25000)
  assert.equal(r.matched_min_qty, null)
  assert.equal(r.subtotal, 100000)
})

test('resolveUnitPrice picks highest min_qty <= qty', () => {
  const pricing = muatPricing()
  const tiers = [{ min_qty: 5, harga: 20000 }, { min_qty: 10, harga: 18000 }]
  assert.equal(pricing.resolveUnitPrice(25000, 5, tiers).harga_satuan, 20000)
  assert.equal(pricing.resolveUnitPrice(25000, 9, tiers).harga_satuan, 20000)
  assert.equal(pricing.resolveUnitPrice(25000, 10, tiers).harga_satuan, 18000)
  assert.equal(pricing.resolveUnitPrice(25000, 10, tiers).matched_min_qty, 10)
  assert.equal(pricing.resolveUnitPrice(25000, 10, tiers).subtotal, 180000)
})

test('resolveForVarian loads tiers and resolves', async () => {
  const pricing = muatPricing([
    { id: 't1', varian_id: 'v1', min_qty: 5, harga: 20000 },
  ])
  const r = await pricing.resolveForVarian({ id: 'v1', harga: 25000 }, 5)
  assert.equal(r.harga_satuan, 20000)
  assert.equal(r.subtotal, 100000)
})
