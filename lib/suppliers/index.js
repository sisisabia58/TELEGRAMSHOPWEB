// lib/suppliers/index.js — daftar adapter supplier.
//
// Menambah penjual kedua = satu file baru di folder ini yang mengekspor kontrak
// di bawah, lalu satu baris di ADAPTERS. Tidak ada bagian lain dari sistem yang
// perlu tahu penjual mana yang sedang dipakai — sisanya bekerja di atas bentuk
// seragam yang dikembalikan adapter.
//
// KONTRAK ADAPTER
//   listProducts({ baseUrl, apiKey })
//     -> { produk: [{ externalId, nama, deskripsi, hargaAsal, currency, stok, inStock }], skipped }
//   getBalance({ baseUrl, apiKey })
//     -> { usd, points }
//   createOrder({ baseUrl, apiKey, externalId, quantity, idempotencyKey })
//     -> { ok, orderId, keys: string[], status }
//   getOrder({ baseUrl, apiKey, orderId })
//     -> { ok, orderId, keys: string[], status }
//   testConnection({ baseUrl, apiKey })
//     -> { ok, balance, sampleCount, sampleRaw, sampleNormalized }
//
// Adapter melempar saat gagal (persis pakasir.js). Pemanggil yang memutuskan
// apa artinya; lib/fulfillment.js menganggapnya sebagai "coba penawaran
// berikutnya".
const bitestore = require('./bitestore')

const ADAPTERS = {
  [bitestore.key]: bitestore,
}

function getAdapter(key) {
  return ADAPTERS[String(key || '').toLowerCase()] || null
}

// Host yang dianggap internal. base_url supplier tidak boleh mengarah ke sini:
// sync dan fulfillment mengirim api_key supplier ke host tujuan, jadi URL yang
// bisa diisi bebas berarti siapa pun yang bisa menyunting supplier dapat
// mengambil kredensial yang tersimpan atau memaksa server menembak alamat
// internal (SSRF), termasuk endpoint metadata cloud.
function hostPrivat(host) {
  const h = String(host || '').toLowerCase()
  if (!h) return true
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal') || h.endsWith('.local')) return true
  if (h === '169.254.169.254' || h === 'metadata.google.internal') return true
  if (h === '[::1]' || h === '::1') return true

  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])]
    if (a === 0 || a === 10 || a === 127) return true
    if (a === 169 && b === 254) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a >= 224) return true
  }
  return false
}

// Validasi base_url untuk satu adapter.
//
// Aturannya sengaja ketat: HANYA https, bukan alamat internal, dan host harus
// cocok dengan host bawaan adapter (atau subdomainnya). Adapter itu ditulis
// untuk API satu penjual tertentu; mengarahkannya ke host lain tidak pernah
// menjadi hal yang benar, tapi menjadi cara paling mudah membocorkan api_key.
function validateBaseUrl(adapterKey, baseUrl) {
  const adapter = getAdapter(adapterKey)
  if (!adapter) return { ok: false, error: 'Adapter tidak dikenal' }

  const nilai = String(baseUrl || '').trim()
  if (!nilai) return { ok: true, value: adapter.defaultBaseUrl }

  let url
  try {
    url = new URL(nilai)
  } catch {
    return { ok: false, error: 'Base URL tidak valid' }
  }

  if (url.protocol !== 'https:') {
    return { ok: false, error: 'Base URL harus memakai https' }
  }
  if (hostPrivat(url.hostname)) {
    return { ok: false, error: 'Base URL tidak boleh mengarah ke alamat internal' }
  }

  const hostBawaan = new URL(adapter.defaultBaseUrl).hostname.toLowerCase()
  const host = url.hostname.toLowerCase()
  if (host !== hostBawaan && !host.endsWith(`.${hostBawaan}`)) {
    return {
      ok: false,
      error: `Base URL untuk adapter "${adapter.key}" harus di host ${hostBawaan}`,
    }
  }

  return { ok: true, value: `${url.protocol}//${url.host}${url.pathname.replace(/\/$/, '')}` }
}

// Untuk dropdown "Adapter" di dashboard.
function listAdapters() {
  return Object.values(ADAPTERS).map((a) => ({
    key: a.key,
    label: a.label,
    defaultBaseUrl: a.defaultBaseUrl,
  }))
}

module.exports = { ADAPTERS, getAdapter, listAdapters, validateBaseUrl, hostPrivat }
