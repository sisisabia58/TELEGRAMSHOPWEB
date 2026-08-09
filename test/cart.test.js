const test = require('node:test')
const assert = require('node:assert')
const path = require('node:path')

// lib/cart.js sekarang menopang SELURUH alur pembelian, jadi logikanya diuji
// tanpa database: client Supabase disuntikkan lewat require cache sebelum
// lib/cart.js dimuat. Ini menguji pemetaan (null handling, bentuk data,
// semantik upsert/clear) — bukan koneksi database.

const jalurClient = require.resolve('../lib/supabase.js')
const jalurCart = require.resolve('../lib/cart.js')

// Client Supabase tiruan. Builder-nya thenable, jadi rantai apa pun bisa
// di-await di titik mana pun ia berhenti (.maybeSingle(), .not(), .eq(), dst).
function buatFake() {
  const rows = new Map()
  const fake = {
    rows,
    errorBerikut: null,
    tabelDipakai: [],
    from(tabel) {
      fake.tabelDipakai.push(tabel)
      const st = { mode: null, hitung: false, filter: {}, cartNotNull: false, payload: null }

      const hitungHasil = () => {
        if (fake.errorBerikut) {
          return { data: null, error: fake.errorBerikut, count: null }
        }
        const cocok = () => [...rows.values()].filter((r) => {
          for (const [k, v] of Object.entries(st.filter)) if (r[k] !== v) return false
          if (st.cartNotNull && (r.cart === null || r.cart === undefined)) return false
          return true
        })

        if (st.mode === 'upsert') {
          const p = st.payload
          const lama = rows.get(p.user_id) || { user_id: p.user_id, nav_stack: [], screen_key: null }
          rows.set(p.user_id, { ...lama, ...p })
          return { data: null, error: null }
        }
        if (st.mode === 'update') {
          for (const r of cocok()) rows.set(r.user_id, { ...r, ...st.payload })
          return { data: null, error: null }
        }
        if (st.mode === 'delete') {
          for (const r of cocok()) rows.delete(r.user_id)
          return { data: null, error: null }
        }
        if (st.hitung) return { data: null, error: null, count: cocok().length }
        return { data: cocok()[0] || null, error: null }
      }

      const b = {
        select(_cols, opts) { st.mode = 'select'; if (opts && opts.head) st.hitung = true; return b },
        upsert(payload) { st.mode = 'upsert'; st.payload = payload; return b },
        update(payload) { st.mode = 'update'; st.payload = payload; return b },
        delete() { st.mode = 'delete'; return b },
        eq(col, val) { st.filter[col] = val; return b },
        not(col, op, val) { if (col === 'cart' && op === 'is' && val === null) st.cartNotNull = true; return b },
        maybeSingle() { return b },
        limit() { return b },
        then(res, rej) { return Promise.resolve(hitungHasil()).then(res, rej) },
      }
      return b
    }
  }
  return fake
}

function muatCart() {
  const fake = buatFake()
  delete require.cache[jalurCart]
  require.cache[jalurClient] = { id: jalurClient, filename: jalurClient, loaded: true, exports: fake }
  const cart = require(jalurCart)
  return { cart, fake }
}

test.after(() => {
  delete require.cache[jalurClient]
  delete require.cache[jalurCart]
})

const CONTOH = {
  kode: 'netflix-1b',
  jumlah: 3,
  trxid: 'TRX-1',
  voucher: '',
  voucher_status: '',
  selectedStokIds: ['a1', 'b2']
}

test('keranjang kosong: exists false, get null', async () => {
  const { cart } = muatCart()
  assert.strictEqual(await cart.exists(111), false)
  assert.strictEqual(await cart.get(111), null)
})

test('save lalu get mengembalikan bentuk yang identik', async () => {
  const { cart } = muatCart()
  assert.strictEqual(await cart.save(111, CONTOH), true)
  // Bentuk harus persis sama seperti isi file JSON dulu — tanpa normalisasi,
  // tanpa field tambahan, tanpa field hilang.
  assert.deepStrictEqual(await cart.get(111), CONTOH)
  assert.strictEqual(await cart.exists(111), true)
})

test('save menimpa keranjang sebelumnya', async () => {
  const { cart } = muatCart()
  await cart.save(111, CONTOH)
  const diubah = { ...CONTOH, jumlah: 7, voucher: 'HEMAT10' }
  await cart.save(111, diubah)
  assert.deepStrictEqual(await cart.get(111), diubah)
})

test('clear mengosongkan cart TAPI barisnya tetap ada', async () => {
  const { cart, fake } = muatCart()
  await cart.save(111, CONTOH)
  assert.strictEqual(await cart.clear(111), true)

  assert.strictEqual(await cart.exists(111), false)
  assert.strictEqual(await cart.get(111), null)

  // Kolom untuk flow engine tidak boleh hilang hanya karena keranjang dibatalkan.
  assert.ok(fake.rows.has(111), 'baris BotSession terhapus, padahal seharusnya tetap ada')
  assert.deepStrictEqual(fake.rows.get(111).nav_stack, [])
})

test('clear pada user tanpa baris tidak error', async () => {
  const { cart } = muatCart()
  assert.strictEqual(await cart.clear(999), true)
})

test('keranjang antar user tidak saling bocor', async () => {
  const { cart } = muatCart()
  await cart.save(111, CONTOH)
  await cart.save(222, { ...CONTOH, kode: 'spotify-1b' })

  assert.strictEqual((await cart.get(111)).kode, 'netflix-1b')
  assert.strictEqual((await cart.get(222)).kode, 'spotify-1b')

  await cart.clear(111)
  assert.strictEqual(await cart.exists(111), false)
  assert.strictEqual(await cart.exists(222), true, 'clear satu user menghapus keranjang user lain')
})

test('userId kosong ditangani tanpa menyentuh database', async () => {
  const { cart, fake } = muatCart()
  assert.strictEqual(await cart.get(undefined), null)
  assert.strictEqual(await cart.exists(null), false)
  assert.strictEqual(await cart.save(0, CONTOH), false)
  assert.strictEqual(await cart.clear(undefined), false)
  assert.strictEqual(fake.tabelDipakai.length, 0, 'query terkirim padahal userId tidak valid')
})

test('error database dilaporkan sebagai null/false, bukan throw', async () => {
  // Pemanggil lama tidak punya penanganan error untuk operasi keranjang
  // (fs.existsSync mengembalikan false, bukan throw), jadi perilaku itu
  // dipertahankan supaya alur pembelian tidak pecah.
  const { cart, fake } = muatCart()
  fake.errorBerikut = { code: 'XX000', message: 'koneksi gagal' }

  assert.strictEqual(await cart.get(111), null)
  assert.strictEqual(await cart.exists(111), false)
  assert.strictEqual(await cart.save(111, CONTOH), false)
  assert.strictEqual(await cart.clear(111), false)
})

test('hanya tabel BotSession yang diakses', async () => {
  const { cart, fake } = muatCart()
  await cart.save(111, CONTOH)
  await cart.get(111)
  await cart.exists(111)
  await cart.clear(111)
  assert.deepStrictEqual([...new Set(fake.tabelDipakai)], ['BotSession'])
})
