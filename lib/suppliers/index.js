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

// Untuk dropdown "Adapter" di dashboard.
function listAdapters() {
  return Object.values(ADAPTERS).map((a) => ({
    key: a.key,
    label: a.label,
    defaultBaseUrl: a.defaultBaseUrl,
  }))
}

module.exports = { ADAPTERS, getAdapter, listAdapters }
