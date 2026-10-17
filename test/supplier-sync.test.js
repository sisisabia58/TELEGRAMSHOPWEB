const test = require('node:test')
const assert = require('node:assert')

const jalurClient = require.resolve('../lib/supabase.js')
const jalurSync = require.resolve('../lib/supplier-sync.js')

function muatSync() {
  delete require.cache[jalurSync]
  require.cache[jalurClient] = {
    id: jalurClient,
    filename: jalurClient,
    loaded: true,
    exports: {
      from() { throw new Error('tes fetchAllRows tidak boleh menyentuh database') },
    },
  }
  return require(jalurSync)
}

test.after(() => {
  delete require.cache[jalurClient]
  delete require.cache[jalurSync]
})

function buatQueryBerhalaman(halaman) {
  const panggilan = []
  let i = 0
  const buatQuery = () => {
    const b = {
      order(kolom, opsi) {
        b._order = { kolom, opsi }
        return b
      },
      range(dari, sampai) {
        panggilan.push({ order: b._order, dari, sampai })
        return b
      },
      then(res, rej) {
        const data = halaman[i++] || []
        return Promise.resolve({ data, error: null }).then(res, rej)
      },
    }
    return b
  }
  return { buatQuery, panggilan }
}

test('fetchAllRows mengambil semua halaman berurutan berdasarkan id', async () => {
  const sync = muatSync()
  const halaman = [
    [{ id: '1' }, { id: '2' }],
    [{ id: '3' }],
  ]
  const { buatQuery, panggilan } = buatQueryBerhalaman(halaman)

  const { data, error } = await sync.fetchAllRows(buatQuery, 2)

  assert.equal(error, null)
  assert.deepEqual(data.map((r) => r.id), ['1', '2', '3'])
  assert.equal(panggilan.length, 2)
  assert.deepEqual(panggilan[0], {
    order: { kolom: 'id', opsi: { ascending: true } },
    dari: 0,
    sampai: 1,
  })
  assert.deepEqual(panggilan[1], {
    order: { kolom: 'id', opsi: { ascending: true } },
    dari: 2,
    sampai: 3,
  })
})

test('fetchAllRows mengembalikan error halaman tanpa memotong sisa katalog diam-diam', async () => {
  const sync = muatSync()
  let n = 0
  const buatQuery = () => {
    const b = {
      order() { return b },
      range() { return b },
      then(res, rej) {
        n++
        if (n === 1) {
          return Promise.resolve({ data: [{ id: '1' }, { id: '2' }], error: null }).then(res, rej)
        }
        return Promise.resolve({ data: null, error: { message: 'timeout' } }).then(res, rej)
      },
    }
    return b
  }

  const { data, error } = await sync.fetchAllRows(buatQuery, 2)
  assert.equal(data, null)
  assert.equal(error.message, 'timeout')
})
