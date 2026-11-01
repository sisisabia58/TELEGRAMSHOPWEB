const test = require('node:test')
const assert = require('node:assert')

const jalurClient = require.resolve('../lib/supabase.js')
const jalurSync = require.resolve('../lib/supplier-sync.js')
const jalurSuppliers = require.resolve('../lib/suppliers')

// File terpisah supaya penggantian require.cache tidak bentrok dengan tes
// supplier-sync lain (test runner menjalankan tes dalam satu file bersamaan).

function klienHitungKatalog(count) {
  const sapuan = []
  return {
    sapuan,
    from(table) {
      const state = { countQuery: false }
      const b = new Proxy({}, {
        get(_target, prop) {
          if (prop === 'then') {
            return (res, rej) => {
              const hasil = state.countQuery
                ? { count, error: null, data: null }
                : { data: [], error: null }
              return Promise.resolve(hasil).then(res, rej)
            }
          }
          if (prop === 'select') {
            return (_kolom, opsi) => {
              if (opsi && (opsi.count || opsi.head)) state.countQuery = true
              return b
            }
          }
          if (prop === 'update') {
            return (payload) => {
              if (payload && Object.prototype.hasOwnProperty.call(payload, 'is_available')) {
                sapuan.push({ table, is_available: payload.is_available })
              }
              return b
            }
          }
          return () => b
        },
      })
      return b
    },
  }
}

async function syncDenganHitungan(count) {
  const klien = klienHitungKatalog(count)
  delete require.cache[jalurSync]
  require.cache[jalurClient] = {
    id: jalurClient,
    filename: jalurClient,
    loaded: true,
    exports: { from: klien.from },
  }
  require.cache[jalurSuppliers] = {
    id: jalurSuppliers,
    filename: jalurSuppliers,
    loaded: true,
    exports: {
      getAdapter() {
        return {
          listProducts: async () => ({
            produk: [{
              externalId: 'p1',
              nama: 'Widget',
              deskripsi: '',
              hargaAsal: 1,
              currency: 'USD',
              stok: 1,
              inStock: true,
            }],
            skipped: 0,
            truncated: false,
          }),
        }
      },
      assertSafeOutbound: async (_adapter, url) => url,
    },
  }
  try {
    const sync = require(jalurSync)
    const laporan = await sync.syncSupplier({
      id: 'sup-1',
      nama: 'Seller',
      slug: 'seller',
      adapter: 'bitestore',
      base_url: 'https://supplier.example',
      api_key: 'k',
      is_active: true,
    })
    return { laporan, sapuan: klien.sapuan }
  } finally {
    delete require.cache[jalurSync]
    delete require.cache[jalurSuppliers]
    delete require.cache[jalurClient]
  }
}

test('count katalog null tetap null; nol yang diketahui tetap disapu', async () => {
  const kosong = await syncDenganHitungan(null)
  assert.equal(kosong.sapuan.length, 0, 'count null tidak boleh disapu seolah-olah 0')
  assert.ok(
    kosong.laporan.errors.some((e) => /tidak diketahui/.test(e)),
    `harus melaporkan jumlah tidak diketahui, dapat: ${kosong.laporan.errors.join(' | ')}`
  )

  const nol = await syncDenganHitungan(0)
  assert.deepEqual(nol.sapuan, [{ table: 'SupplierProduct', is_available: false }])
  assert.equal(nol.laporan.errors.some((e) => /sapuan ketersediaan dilewati/.test(e)), false)
})
