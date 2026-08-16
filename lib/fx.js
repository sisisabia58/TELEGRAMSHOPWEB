// lib/fx.js — konversi mata uang supplier (USD) ke rupiah + margin keuntungan.
//
// Supplier menjual dalam USD, bot kita menjual dalam rupiah bulat. Modul ini
// satu-satunya tempat aturan itu ditulis, supaya harga yang tampil di bot,
// di dashboard, dan yang benar-benar ditagih tidak pernah berbeda.
//
// KENAPA HARGA IDR TIDAK DISIMPAN DI DATABASE:
// kalau disimpan, mengubah margin atau kurs berarti harus menulis ulang setiap
// baris SupplierProduct — dan setiap baris yang terlewat menjual dengan harga
// lama. Rumusnya murni aritmetika di atas baris yang toh sudah dimuat, jadi
// menghitungnya saat dibaca selalu benar dan tidak pernah basi.
const runtimeSettings = require('./runtime-settings')

// Gratis, tanpa API key, mengembalikan { result: 'success', rates: { IDR: n } }.
const FX_ENDPOINT = 'https://open.er-api.com/v6/latest/USD'

let http = require('axios') // bisa ditukar saat tes lewat __setHttp

const DEFAULTS = {
  rate: 16500,
  marginPersen: 10,
  bufferPersen: 2,
  roundTo: 500,
}

function angka(nilai, fallback) {
  const n = Number(nilai)
  return Number.isFinite(n) ? n : fallback
}

// true untuk nilai yang berarti "tidak diisi". Dipakai supaya opsi yang memang
// dikosongkan jatuh ke default, sementara opsi yang diisi TAPI rusak (NaN, 0,
// negatif) tetap dianggap kesalahan dan bukan diam-diam ditambal default.
function kosong(nilai) {
  return nilai === undefined || nilai === null || nilai === ''
}

// MURNI. harga_asal (USD) -> rupiah bulat.
//
//   idr = harga × kurs × (1 + buffer/100) × (1 + margin/100)
//
// lalu dibulatkan KE ATAS ke kelipatan roundTo. Selalu ke atas, tidak pernah ke
// bawah: pembulatan ke bawah bisa menjual di bawah modal saat harga supplier
// pas-pasan.
//
// Mengembalikan null (bukan 0) untuk input yang tidak masuk akal, supaya
// pemanggil bisa membedakan "gratis" dari "tidak bisa dihitung" dan menjatuhkan
// penawarannya alih-alih menjualnya seharga Rp 0.
function computeIdrPrice(hargaAsal, opsi = {}) {
  if (kosong(hargaAsal)) return null
  const harga = Number(hargaAsal)
  if (!Number.isFinite(harga) || harga < 0) return null

  const rate = kosong(opsi.rate) ? DEFAULTS.rate : Number(opsi.rate)
  if (!Number.isFinite(rate) || rate <= 0) return null

  const marginPersen = Math.max(0, angka(opsi.marginPersen, DEFAULTS.marginPersen))
  const bufferPersen = Math.max(0, angka(opsi.bufferPersen, DEFAULTS.bufferPersen))
  const roundTo = angka(opsi.roundTo, DEFAULTS.roundTo)

  const kotor = harga * rate * (1 + bufferPersen / 100) * (1 + marginPersen / 100)
  if (!Number.isFinite(kotor)) return null

  // Bersihkan derau biner SEBELUM dibulatkan ke atas. Tanpa ini
  // 2.5 × 10000 × 1.1 menghasilkan 27500.000000000004 dan Math.ceil
  // menaikkannya jadi 27501 — satu rupiah nyasar di setiap harga yang
  // kebetulan jatuh pas di bilangan bulat.
  const bersih = Number(kotor.toFixed(6))

  if (!Number.isFinite(roundTo) || roundTo <= 0) return Math.ceil(bersih)
  return Math.ceil(Number((bersih / roundTo).toFixed(9))) * roundTo
}

// Semua angka penetapan harga dalam satu objek, dibaca dari cache
// runtime-settings (sinkron — pemanggil tidak perlu await).
function getPricingConfig() {
  return {
    rate: angka(runtimeSettings.get('fx_usd_idr'), DEFAULTS.rate),
    marginPersen: angka(runtimeSettings.get('reseller_margin_persen'), DEFAULTS.marginPersen),
    bufferPersen: angka(runtimeSettings.get('fx_buffer_persen'), DEFAULTS.bufferPersen),
    roundTo: angka(runtimeSettings.get('reseller_rounding'), DEFAULTS.roundTo),
  }
}

function getRate() {
  return getPricingConfig().rate
}

function getMode() {
  const m = runtimeSettings.get('fx_mode', 'auto')
  return m === 'manual' ? 'manual' : 'auto'
}

// MURNI. Mengurai balasan open.er-api.com. Dipisah dari HTTP supaya bisa dites.
function parseRateResponse(body) {
  const rate = Number(body?.rates?.IDR)
  if (!Number.isFinite(rate) || rate <= 0) return null
  return rate
}

// Ambil kurs terbaru dan simpan. Tidak pernah throw dan tidak pernah menulis
// nilai buruk: kalau gagal, kurs terakhir yang diketahui baik tetap dipakai,
// jadi kegagalan jaringan tidak pernah membuat harga jadi kacau.
async function refreshRate({ force = false } = {}) {
  if (!force && getMode() === 'manual') {
    return { ok: true, skipped: true, reason: 'mode manual', rate: getRate() }
  }

  try {
    const { data } = await http.get(FX_ENDPOINT, { timeout: 20000 })
    const rate = parseRateResponse(data)
    if (rate === null) {
      return { ok: false, error: 'balasan kurs tidak berisi rates.IDR yang valid', rate: getRate() }
    }

    await setRate(rate)
    return { ok: true, rate }
  } catch (e) {
    return { ok: false, error: e.message, rate: getRate() }
  }
}

const supabase = require('./supabase')

// Tulis kurs + cap waktu, lalu bump supaya proses bot memuat ulang cache-nya.
async function setRate(rate) {
  const now = new Date().toISOString()
  const rows = [
    { setting_key: 'fx_usd_idr', setting_value: { value: rate }, updated_at: now },
    { setting_key: 'fx_updated_at', setting_value: { value: now }, updated_at: now },
  ]
  for (const row of rows) {
    const { error } = await supabase
      .from('NotificationSettings')
      .upsert(row, { onConflict: 'setting_key' })
    if (error) throw error
  }
  await runtimeSettings.bump()
  return rate
}

module.exports = {
  FX_ENDPOINT,
  DEFAULTS,
  computeIdrPrice,
  parseRateResponse,
  getPricingConfig,
  getRate,
  getMode,
  refreshRate,
  setRate,
  __setHttp: (m) => { http = m },
}
