const test = require('node:test')
const assert = require('node:assert')

const jalurClient = require.resolve('../lib/supabase.js')
const jalurSettings = require.resolve('../lib/runtime-settings.js')
const jalurFx = require.resolve('../lib/fx.js')

// fx.js menarik supabase + runtime-settings di tingkat modul, jadi keduanya
// diganti lewat require.cache sebelum modul dimuat (pola sama seperti
// test/pricing.test.js).
function muatFx({ settings = {}, upserts = [] } = {}) {
  delete require.cache[jalurFx]
  require.cache[jalurClient] = {
    id: jalurClient,
    filename: jalurClient,
    loaded: true,
    exports: {
      from() {
        return {
          upsert(row) {
            upserts.push(row)
            return Promise.resolve({ error: null })
          },
        }
      },
    },
  }
  require.cache[jalurSettings] = {
    id: jalurSettings,
    filename: jalurSettings,
    loaded: true,
    exports: {
      get(key, fallback) {
        const v = settings[key]
        return v === undefined || v === null || v === '' ? fallback : v
      },
      bump: async () => 1,
    },
  }
  return require(jalurFx)
}

test.after(() => {
  delete require.cache[jalurClient]
  delete require.cache[jalurSettings]
  delete require.cache[jalurFx]
})

const OPSI = { rate: 16000, marginPersen: 10, bufferPersen: 0, roundTo: 0 }

test('computeIdrPrice menerapkan kurs dan margin', () => {
  const fx = muatFx()
  // 2.5 × 16000 = 40000, +10% margin = 44000
  assert.equal(fx.computeIdrPrice(2.5, OPSI), 44000)
})

test('computeIdrPrice menerapkan buffer sebelum margin', () => {
  const fx = muatFx()
  // 2.5 × 16000 × 1.02 × 1.10 = 44880
  assert.equal(fx.computeIdrPrice(2.5, { ...OPSI, bufferPersen: 2 }), 44880)
})

test('computeIdrPrice membulatkan KE ATAS ke kelipatan roundTo', () => {
  const fx = muatFx()
  // 2.5 × 16000 × 1.02 × 1.10 = 44880 -> 45000
  assert.equal(fx.computeIdrPrice(2.5, { ...OPSI, bufferPersen: 2, roundTo: 500 }), 45000)
  // Nilai yang sudah pas kelipatan tidak boleh ikut naik
  assert.equal(fx.computeIdrPrice(2.5, { ...OPSI, roundTo: 500 }), 44000)
  assert.equal(fx.computeIdrPrice(2.5, { ...OPSI, roundTo: 1000 }), 44000)
})

test('computeIdrPrice tidak pernah membulatkan ke bawah di bawah modal', () => {
  const fx = muatFx()
  const roundTo = 1000
  for (const usd of [0.11, 0.37, 1.03, 2.99, 7.77]) {
    const kasar = usd * 16000 * 1.1
    const hasil = fx.computeIdrPrice(usd, { ...OPSI, roundTo })
    assert.ok(hasil >= kasar, `${usd}: ${hasil} harus >= ${kasar}`)
    assert.equal(hasil % roundTo, 0, `${usd}: ${hasil} harus kelipatan ${roundTo}`)
  }
})

test('computeIdrPrice tidak menambah rupiah nyasar dari derau floating point', () => {
  const fx = muatFx()
  // 2.5 x 10000 x 1.1 = 27500.000000000004 dalam aritmetika biner; tanpa
  // pembersihan, Math.ceil menaikkannya jadi 27501.
  assert.equal(fx.computeIdrPrice(2.5, { rate: 10000, marginPersen: 10, bufferPersen: 0, roundTo: 0 }), 27500)
  assert.equal(fx.computeIdrPrice(1.1, { rate: 10000, marginPersen: 0, bufferPersen: 0, roundTo: 0 }), 11000)
  assert.equal(fx.computeIdrPrice(0.29, { rate: 100000, marginPersen: 0, bufferPersen: 0, roundTo: 0 }), 29000)
  // Sama untuk jalur pembulatan: nilai yang persis kelipatan tidak boleh naik.
  assert.equal(fx.computeIdrPrice(2.5, { rate: 10000, marginPersen: 10, bufferPersen: 0, roundTo: 500 }), 27500)
})

test('computeIdrPrice mengembalikan bilangan bulat', () => {
  const fx = muatFx()
  const hasil = fx.computeIdrPrice(1.337, { ...OPSI, bufferPersen: 2.5 })
  assert.ok(Number.isInteger(hasil), `${hasil} harus bilangan bulat`)
})

test('computeIdrPrice memperlakukan roundTo <= 0 sebagai tanpa pembulatan', () => {
  const fx = muatFx()
  assert.equal(fx.computeIdrPrice(1, { ...OPSI, roundTo: 0 }), 17600)
  assert.equal(fx.computeIdrPrice(1, { ...OPSI, roundTo: -5 }), 17600)
})

test('computeIdrPrice mengembalikan null untuk input tak masuk akal', () => {
  const fx = muatFx()
  assert.equal(fx.computeIdrPrice(null, OPSI), null)
  assert.equal(fx.computeIdrPrice(undefined, OPSI), null)
  assert.equal(fx.computeIdrPrice('abc', OPSI), null)
  assert.equal(fx.computeIdrPrice(NaN, OPSI), null)
  assert.equal(fx.computeIdrPrice(Infinity, OPSI), null)
  assert.equal(fx.computeIdrPrice(-1, OPSI), null)
})

test('computeIdrPrice mengembalikan null kalau kurs tidak valid', () => {
  const fx = muatFx()
  assert.equal(fx.computeIdrPrice(2.5, { ...OPSI, rate: 0 }), null)
  assert.equal(fx.computeIdrPrice(2.5, { ...OPSI, rate: -1 }), null)
  assert.equal(fx.computeIdrPrice(2.5, { ...OPSI, rate: NaN }), null)
})

test('computeIdrPrice memperlakukan harga nol sebagai nol, bukan null', () => {
  const fx = muatFx()
  assert.equal(fx.computeIdrPrice(0, OPSI), 0)
})

test('computeIdrPrice memakai default kalau opsi tidak diberikan', () => {
  const fx = muatFx()
  assert.equal(typeof fx.computeIdrPrice(1), 'number')
  assert.ok(fx.computeIdrPrice(1) > 0)
})

test('getPricingConfig membaca pengaturan runtime dan jatuh ke default', () => {
  const fx = muatFx({
    settings: { fx_usd_idr: 17000, reseller_margin_persen: 25 },
  })
  const cfg = fx.getPricingConfig()
  assert.equal(cfg.rate, 17000)
  assert.equal(cfg.marginPersen, 25)
  assert.equal(cfg.bufferPersen, fx.DEFAULTS.bufferPersen)
  assert.equal(cfg.roundTo, fx.DEFAULTS.roundTo)
})

test('getPricingConfig mengabaikan nilai pengaturan yang rusak', () => {
  const fx = muatFx({ settings: { fx_usd_idr: 'entah', reseller_margin_persen: null } })
  const cfg = fx.getPricingConfig()
  assert.equal(cfg.rate, fx.DEFAULTS.rate)
  assert.equal(cfg.marginPersen, fx.DEFAULTS.marginPersen)
})

test('parseRateResponse mengambil rates.IDR', () => {
  const fx = muatFx()
  assert.equal(fx.parseRateResponse({ result: 'success', rates: { IDR: 16234.5 } }), 16234.5)
})

test('parseRateResponse menolak balasan tanpa IDR yang valid', () => {
  const fx = muatFx()
  assert.equal(fx.parseRateResponse(null), null)
  assert.equal(fx.parseRateResponse({}), null)
  assert.equal(fx.parseRateResponse({ rates: {} }), null)
  assert.equal(fx.parseRateResponse({ rates: { IDR: 0 } }), null)
  assert.equal(fx.parseRateResponse({ rates: { IDR: -1 } }), null)
  assert.equal(fx.parseRateResponse({ rates: { IDR: 'banyak' } }), null)
})

test('refreshRate menyimpan kurs baru saat berhasil', async () => {
  const upserts = []
  const fx = muatFx({ settings: { fx_usd_idr: 16000 }, upserts })
  fx.__setHttp({ get: async () => ({ data: { rates: { IDR: 16750 } } }) })

  const hasil = await fx.refreshRate()
  assert.equal(hasil.ok, true)
  assert.equal(hasil.rate, 16750)
  const kurs = upserts.find((r) => r.setting_key === 'fx_usd_idr')
  assert.deepEqual(kurs.setting_value, { value: 16750 })
  assert.ok(upserts.find((r) => r.setting_key === 'fx_updated_at'))
})

test('refreshRate mempertahankan kurs lama saat jaringan gagal', async () => {
  const upserts = []
  const fx = muatFx({ settings: { fx_usd_idr: 16000 }, upserts })
  fx.__setHttp({ get: async () => { throw new Error('ETIMEDOUT') } })

  const hasil = await fx.refreshRate()
  assert.equal(hasil.ok, false)
  assert.equal(hasil.rate, 16000, 'kurs terakhir yang baik tetap dipakai')
  assert.equal(upserts.length, 0, 'tidak boleh menulis apa pun saat gagal')
})

test('refreshRate mempertahankan kurs lama saat balasan rusak', async () => {
  const upserts = []
  const fx = muatFx({ settings: { fx_usd_idr: 16000 }, upserts })
  fx.__setHttp({ get: async () => ({ data: { error: 'quota' } }) })

  const hasil = await fx.refreshRate()
  assert.equal(hasil.ok, false)
  assert.equal(upserts.length, 0)
})

test('refreshRate dilewati saat mode manual, kecuali dipaksa', async () => {
  const upserts = []
  const fx = muatFx({ settings: { fx_mode: 'manual', fx_usd_idr: 16000 }, upserts })
  fx.__setHttp({ get: async () => ({ data: { rates: { IDR: 99999 } } }) })

  const dilewati = await fx.refreshRate()
  assert.equal(dilewati.skipped, true)
  assert.equal(upserts.length, 0)

  const dipaksa = await fx.refreshRate({ force: true })
  assert.equal(dipaksa.ok, true)
  assert.equal(dipaksa.rate, 99999)
})
