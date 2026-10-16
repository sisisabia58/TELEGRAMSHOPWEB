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
// Setiap fungsi di atas WAJIB memanggil assertSafeOutbound sebelum HTTP,
// menolak redirect, dan tidak pernah meneruskan api_key ke host di luar
// allowlist adapter. Adapter melempar saat gagal (persis pakasir.js).
const bitestore = require('./bitestore')
const urlSafety = require('./url-safety')

const ADAPTERS = {
  [bitestore.key]: bitestore,
}

function getAdapter(key) {
  return ADAPTERS[String(key || '').toLowerCase()] || null
}

function validateBaseUrl(adapterKey, baseUrl) {
  const adapter = getAdapter(adapterKey)
  if (!adapter) return { ok: false, error: 'Adapter tidak dikenal' }
  return urlSafety.validateBaseUrl(adapter, baseUrl)
}

async function assertSafeOutbound(adapterKey, baseUrl) {
  const adapter = getAdapter(adapterKey)
  if (!adapter) throw new Error('Adapter tidak dikenal')
  return urlSafety.assertSafeOutbound(adapter, baseUrl)
}

// Kolom yang boleh sampai ke view / JSON dashboard. api_key sengaja tidak
// ada di sini — klien (EJS, fetch, anon key) tidak boleh pernah melihatnya.
const SUPPLIER_PUBLIC_COLUMNS = [
  'id', 'nama', 'slug', 'adapter', 'base_url', 'is_active', 'prioritas',
  'last_sync_at', 'last_sync_status', 'last_sync_error', 'created_at', 'updated_at',
].join(', ')

function tanpaApiKey(row) {
  if (!row || typeof row !== 'object') return row
  const { api_key: _buang, ...rest } = row
  return rest
}

function listAdapters() {
  return Object.values(ADAPTERS).map((a) => ({
    key: a.key,
    label: a.label,
    defaultBaseUrl: a.defaultBaseUrl,
  }))
}

module.exports = {
  ADAPTERS,
  getAdapter,
  listAdapters,
  validateBaseUrl,
  assertSafeOutbound,
  hostPrivat: urlSafety.hostPrivat,
  ipPrivat: urlSafety.ipPrivat,
  tanpaApiKey,
  SUPPLIER_PUBLIC_COLUMNS,
  __setLookup: urlSafety.__setLookup,
}
