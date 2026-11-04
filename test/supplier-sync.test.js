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

test('pilihIdHilang memakai external id, bukan stempel waktu atau mata uang', () => {
  const sync = muatSync()
  const baris = [
    { id: 'a', external_id: '78', is_available: true, last_seen_at: 'T2', currency: 'USDT' },
    { id: 'b', external_id: '76', is_available: true, last_seen_at: 'T2', currency: 'USDT' },
    { id: 'c', external_id: 'slug-lama', is_available: true, last_seen_at: 'T0', currency: 'USD' },
    { id: 'd', external_id: 'sudah-hilang', is_available: false, last_seen_at: 'T0', currency: 'USDT' },
  ]

  // Aturan lama: last_seen_at <> stempel putaran ini. Kalau penulis lain
  // menimpa stempel jadi T2, SEMUA baris yang baru diambil ikut tersapu.
  const hilangLama = baris.filter((r) => r.last_seen_at !== 'T1').map((r) => r.id)
  assert.deepEqual(hilangLama, ['a', 'b', 'c', 'd'])

  // Id angka 78 dan teks "78" adalah penawaran yang sama. USDT tidak dibuang.
  assert.deepEqual(sync.pilihIdHilang(baris, [78, '76']), ['c'])
})

// Klien palsu. Upsert menyimpan last_seen_at milik "penulis lain", persis
// seperti cron yang menstempel baris yang sama sebelum sapuan dashboard jalan.
function klienTumpangTindih(tabel) {
  function cocok(row, filters) {
    for (const [op, kolom, nilai] of filters) {
      if (op === 'eq' && row[kolom] !== nilai) return false
      if (op === 'neq' && row[kolom] === nilai) return false
      if (op === 'in' && !nilai.includes(row[kolom])) return false
      if (op === 'not' && (row[kolom] === nilai || row[kolom] === undefined)) return false
    }
    return true
  }

  function jalankan(ctx) {
    const nama = ctx.table
    const rows = tabel[nama] || (tabel[nama] = [])
    if (ctx.op === 'upsert') {
      for (const masuk of ctx.payload) {
        const kunci = String(masuk.external_id)
        let ada = rows.find((r) => r.supplier_id === masuk.supplier_id && String(r.external_id) === kunci)
        if (!ada) {
          ada = { id: `baru-${kunci}`, varian_id: null, mapping_mode: 'unmapped' }
          rows.push(ada)
        }
        Object.assign(ada, masuk, { external_id: kunci, last_seen_at: 'DITIMPA-PENULIS-LAIN' })
      }
      return { data: null, error: ctx.paksaError || null }
    }
    if (ctx.op === 'update') {
      for (const row of rows) {
        if (cocok(row, ctx.filters)) Object.assign(row, ctx.payload)
      }
      return { data: null, error: null }
    }
    let hasil = rows.filter((r) => cocok(r, ctx.filters))
    if (ctx.order) {
      hasil = [...hasil].sort((a, b) => String(a[ctx.order.col]).localeCompare(String(b[ctx.order.col])))
    }
    if (ctx.range) hasil = hasil.slice(ctx.range[0], ctx.range[1] + 1)
    if (nama === 'SupplierProduct') {
      hasil = hasil.map((r) => {
        const varian = (tabel.Varian || []).find((v) => v.id === r.varian_id)
        return varian
          ? { ...r, varian: { id: varian.id, harga: varian.harga, sumber: varian.sumber } }
          : { ...r, varian: null }
      })
    }
    return { data: hasil, error: null }
  }

  function from(table) {
    const ctx = { table, op: 'select', filters: [], order: null, range: null, payload: null, paksaError: null }
    const b = {
      select() { ctx.op = 'select'; return b },
      upsert(rows, _opsi) { ctx.op = 'upsert'; ctx.payload = rows; return b },
      update(nilai) { ctx.op = 'update'; ctx.payload = nilai; return b },
      eq(k, v) { ctx.filters.push(['eq', k, v]); return b },
      neq(k, v) { ctx.filters.push(['neq', k, v]); return b },
      in(k, v) { ctx.filters.push(['in', k, v]); return b },
      not(k, _op, v) { ctx.filters.push(['not', k, v]); return b },
      order(col, opsi) { ctx.order = { col, opsi }; return b },
      range(dari, sampai) { ctx.range = [dari, sampai]; return b },
      then(res, rej) { return Promise.resolve(jalankan(ctx)).then(res, rej) },
    }
    return b
  }
  return { from }
}

function muatSyncDengan(klien, katalog) {
  const jalurSuppliers = require.resolve('../lib/suppliers/index.js')
  delete require.cache[jalurSync]
  require.cache[jalurClient] = {
    id: jalurClient,
    filename: jalurClient,
    loaded: true,
    exports: klien,
  }
  require.cache[jalurSuppliers] = {
    id: jalurSuppliers,
    filename: jalurSuppliers,
    loaded: true,
    exports: {
      getAdapter() {
        return {
          async listProducts() {
            return { produk: katalog, skipped: 0 }
          },
        }
      },
      async assertSafeOutbound() { return 'https://api.insightxpro.store/api/v1' },
      formatSupplierError(e) { return e.message || 'gagal' },
    },
  }
  return require(jalurSync)
}

test('sync InsightX tidak menandai baris yang baru diambil sebagai hilang walau stempel waktu tertimpa', async () => {
  const supplierId = 'cf2a106b-e39f-409d-a8ef-aa74dfaa73d7'
  const tabel = {
    SupplierProduct: [
      {
        id: 'p78', supplier_id: supplierId, external_id: '78', nama: 'Adobe Express 1 Year',
        harga_asal: 0.5, currency: 'USDT', stok: 2999, in_stock: true,
        is_available: true, varian_id: 'v78', mapping_mode: 'auto', last_seen_at: 'T-lama',
      },
      {
        id: 'p76', supplier_id: supplierId, external_id: '76', nama: 'Airtable',
        harga_asal: 5, currency: 'USDT', stok: 9, in_stock: true,
        is_available: true, varian_id: 'v76', mapping_mode: 'auto', last_seen_at: 'T-lama',
      },
      {
        id: 'p-lama', supplier_id: supplierId, external_id: 'slug-storefront', nama: 'Produk lama',
        harga_asal: 1, currency: 'USD', stok: 1, in_stock: true,
        is_available: true, varian_id: 'v-lama', mapping_mode: 'auto', last_seen_at: 'T-lama',
      },
    ],
    Varian: [
      { id: 'v78', harga: 9500, sumber: 'supplier', label: 'Adobe', kode: 'ix-78', produk_id: 'prod' },
      { id: 'v76', harga: 9500, sumber: 'supplier', label: 'Airtable', kode: 'ix-76', produk_id: 'prod' },
      { id: 'v-lama', harga: 9500, sumber: 'supplier', label: 'Lama', kode: 'ix-lama', produk_id: 'prod' },
    ],
    Supplier: [{ id: supplierId }],
  }
  // id angka (bukan string) + currency USDT, seperti Reseller API.
  const katalog = [
    { externalId: 78, nama: 'Adobe Express 1 Year', deskripsi: '', hargaAsal: 0.5, currency: 'USDT', stok: 2999, inStock: true },
    { externalId: 76, nama: 'Airtable', deskripsi: '', hargaAsal: 5, currency: 'USDT', stok: 9, inStock: true },
  ]
  const sync = muatSyncDengan(klienTumpangTindih(tabel), katalog)
  const laporan = await sync.syncSupplier({
    id: supplierId,
    nama: 'InsightX',
    slug: 'insightx',
    adapter: 'insightx',
    base_url: 'https://api.insightxpro.store/api/v1',
    api_key: 'isk_test_bukan_kunci',
  })

  assert.deepEqual(laporan.errors, [])
  assert.equal(laporan.fetched, 2)
  assert.equal(laporan.upserted, 2)
  assert.equal(laporan.matched, 2)
  assert.equal(laporan.created, 0)
  assert.equal(laporan.skipped, 0)

  const byId = Object.fromEntries(tabel.SupplierProduct.map((r) => [r.id, r]))
  assert.equal(byId.p78.is_available, true)
  assert.equal(byId.p76.is_available, true)
  assert.equal(byId.p78.currency, 'USDT')
  assert.equal(byId.p78.external_id, '78')
  assert.equal(byId['p-lama'].is_available, false)
  assert.equal(byId.p78.varian_id, 'v78')
  assert.equal(byId.p78.mapping_mode, 'auto')
})
