// lib/suppliers/insightx.js — adapter InsightX Pro Developer API.
// Docs: https://insightxpro.com/api-docs
//
// Kontrak sama dengan hubx.js (lihat lib/suppliers/index.js): listProducts,
// getBalance, createOrder, getOrder, testConnection. Pemanggil (sync, fulfillment,
// tombol test) tidak perlu tahu bentuk JSON InsightX.
//
// AUTH
//   Header `Authorization: Bearer <api_key>`. Dokumentasi juga menerima
//   X-API-Key; probe ke /balance dengan kunci palsu mengembalikan badan
//   401 yang sama untuk kedua header, jadi Bearer saja (tidak mengirim
//   rahasia dua kali). Kunci tidak pernah di-hardcode. Prioritas: api_key
//   pada baris Supplier, kalau kosong env INSIGHTX_API_KEY. Keduanya kosong
//   = supplier terpasang tetapi belum diautentikasi (HTTP 401 sebelum ada
//   request, tanpa header, pesan "api_key kosong" — berbeda dari 401 InsightX).
//   normalizeApiKey membuang "Authorization:" / "Bearer ", kutip, dan spasi
//   tepi supaya tempelan dari contoh curl tidak jadi "Bearer Bearer …".
//   Kunci sungguhan berawalan isk_live_ (sandbox isk_test_). sk_live_ /
//   sk_test_ tetap dikenali kalau ada. Nilai kunci tidak diubah.
//
// HARGA
//   `price` adalah yang kunci ini bayar per unit, dalam USD (dompet USD).
//   Disimpan apa adanya di harga_asal dengan currency USD. Konversi ke rupiah
//   bukan di adapter ini: lib/fx.js hargaJualIdr sudah memakai kurs USD→IDR
//   + buffer + margin. Tidak ada peg baru. `list_price` hanya harga publik
//   dan tidak pernah dipakai sebagai modal.
//
// STOK
//   Angka utuh disimpan apa adanya. `stock: null` + `in_stock: true` berarti
//   tersedia tanpa hitungan — menjadi STOK_TAK_TERBATAS (999999), sama seperti
//   stok "unlimited" HubX, supaya muat di kolom integer dan langkah penjual
//   tetap menampilkan stok.
//
// PESANAN
//   POST /orders body { product, quantity, max_price? }. max_price diisi dari
//   harga_asal yang tersinkron kalau pemanggil mengirim maxPrice: kalau harga
//   naik, InsightX menolak 409 price_changed dan tidak memotong dompet.
//   API ini tidak mendokumentasikan kunci idempoten. idempotencyKey tetap
//   wajib (kontrak fulfillment) tetapi TIDAK dikirim, supaya field asing
//   tidak membuat setiap pesanan ditolak. items[].delivered menjadi keys.
const urlSafety = require('./url-safety')

let http = require('axios')

const TIMEOUT = 30000
const DEFAULT_BASE_URL = 'https://insightxpro.com/api/v1'
const ALLOWED_HOSTS = ['insightxpro.com']
const ADAPTER_ID = {
  key: 'insightx',
  defaultBaseUrl: DEFAULT_BASE_URL,
  allowedHosts: ALLOWED_HOSTS,
}

const QTY_MIN = 1
const QTY_MAX = 50

// Muat di kolom integer Postgres dan di jumlah stok bot. Bukan stok sungguhan.
const STOK_TAK_TERBATAS = 999999
const STOK_MAX_KOLOM = 2147483647

const STATUS_GAGAL = new Set([
  'refunded', 'cancelled', 'canceled', 'failed',
  'out_of_stock', 'insufficient_balance', 'price_changed', 'product_not_found',
])
const STATUS_TERKIRIM = new Set(['completed', 'complete', 'delivered', 'success', 'partial'])

// MURNI. Bentuk yang benar-benar dikirim. Tidak pernah menambah "Bearer".
function normalizeApiKey(apiKey) {
  let s = String(apiKey ?? '')
  s = s.replace(/[\u200B-\u200D\uFEFF]/g, '')
  s = s.replace(/\u00A0/g, ' ')
  s = s.replace(/[\r\n\t]/g, '')
  s = s.trim()
  s = s.replace(/^authorization:\s*/i, '').trim()
  const bukaKutip = () => {
    if ((s.startsWith('"') && s.endsWith('"') && s.length >= 2)
      || (s.startsWith("'") && s.endsWith("'") && s.length >= 2)) {
      s = s.slice(1, -1).trim()
    }
  }
  bukaKutip()
  // Hanya awalan. Replace tanpa ^ pada "Bearer" atau "sk_live_" akan
  // memotong isk_live_FOO menjadi iFOO, karena "sk_live_" ada di dalam "isk_live_".
  while (/^bearer\s+/i.test(s)) s = s.replace(/^bearer\s+/i, '').trim()
  if (/^bearer$/i.test(s)) s = ''
  bukaKutip()
  return s
}

function resolveApiKey(apiKey) {
  const baris = normalizeApiKey(apiKey)
  if (baris) return baris
  return normalizeApiKey(process.env.INSIGHTX_API_KEY || '')
}

function teksUpstream(nilai) {
  if (typeof nilai === 'number' && Number.isFinite(nilai)) return String(nilai)
  if (typeof nilai !== 'string') return ''
  return nilai.replace(/\s+/g, ' ').trim().slice(0, 300)
}

// Hanya code + message dari { ok:false, error:{ code, message } }.
// Jangan menyalin badan mentah: bisa panjang, dan jangan sampai memuat kunci.
function detailUpstream(data, kunci) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return ''
  const err = data.error
  if (!err || typeof err !== 'object' || Array.isArray(err)) return ''
  const code = teksUpstream(err.code)
  const message = teksUpstream(err.message)
  let detail = [code, message].filter(Boolean).join(': ')
  if (kunci && kunci.length >= 8 && detail.includes(kunci)) {
    detail = detail.split(kunci).join('[redacted]')
  }
  return detail
}

// Panjang dan kelas awalan saja. Tidak ada karakter rahasia.
// isk_ dicek dulu: itu awalan yang InsightX benar-benar menerbitkan.
const BENTUK_KUNCI = [
  ['isk_live_', /^isk_live_/i],
  ['isk_test_', /^isk_test_/i],
  ['sk_live_', /^sk_live_/i],
  ['sk_test_', /^sk_test_/i],
]

function jejakKunci(kunci) {
  const s = String(kunci || '')
  const ketemu = BENTUK_KUNCI.find(([, re]) => re.test(s))
  const bentuk = ketemu ? ketemu[0] : 'tidak dikenal'
  return `kunci terkirim panjang ${s.length}, bentuk ${bentuk}`
}

function kesalahanTidakLogin() {
  const err = new Error('HTTP 401: InsightX api_key kosong — supplier terpasang, belum diautentikasi')
  err.response = { status: 401, data: { error: { code: 'missing_api_key' } } }
  return err
}

function kesalahanQty(qty) {
  const err = new Error(`HTTP 400: InsightX quantity harus ${QTY_MIN}-${QTY_MAX} (dapat ${qty})`)
  err.response = { status: 400, data: { ok: false, error: { code: 'quantity_out_of_range' } } }
  return err
}

// Salinan error tanpa config axios (config memuat Authorization).
// Pesan memuat code + message InsightX kalau ada, supaya Test/Sync tidak
// berhenti di "HTTP 401" sementara badan { ok:false, error } dibuang.
function tanpaRahasia(e, kunci) {
  const status = Number(e?.response?.status)
  const detail = detailUpstream(e?.response?.data, kunci)
  let pesan
  if (Number.isFinite(status) && status > 0) {
    pesan = `HTTP ${status}`
    if (detail) pesan += `: ${detail}`
    if (status === 401) pesan += ` (${jejakKunci(kunci)})`
  } else {
    pesan = e?.message || 'InsightX request gagal'
    if (kunci && kunci.length >= 8 && pesan.includes(kunci)) {
      pesan = pesan.split(kunci).join('[redacted]')
    }
  }
  const err = new Error(pesan)
  if (Number.isFinite(status) && status > 0) {
    err.response = { status, data: e.response?.data }
  }
  return err
}

function headers(apiKey, extra = {}) {
  return {
    Authorization: `Bearer ${apiKey}`,
    Accept: 'application/json',
    ...extra,
  }
}

async function request(method, { baseUrl, apiKey, path, params, body, extraHeaders } = {}) {
  const kunci = resolveApiKey(apiKey)
  if (!kunci) throw kesalahanTidakLogin()

  const safeBase = await urlSafety.assertSafeOutbound(ADAPTER_ID, baseUrl)
  const cfg = {
    headers: headers(kunci, extraHeaders),
    timeout: TIMEOUT,
    maxRedirects: 0,
    lookup: urlSafety.safeLookup,
  }
  if (params) cfg.params = params
  const url = `${safeBase}${path}`
  try {
    if (method === 'get') return await http.get(url, cfg)
    return await http.post(url, body, cfg)
  } catch (e) {
    throw tanpaRahasia(e, kunci)
  }
}

function toNumber(nilai, fallback = 0) {
  if (nilai === null || nilai === undefined || nilai === '') return fallback
  const n = typeof nilai === 'string' ? Number(nilai.replace(/[^0-9.\-]/g, '')) : Number(nilai)
  return Number.isFinite(n) ? n : fallback
}

function parseHarga(nilai) {
  if (nilai === null || nilai === undefined || nilai === '') return null
  let n
  if (typeof nilai === 'string') {
    const bersih = nilai.replace(/[^0-9.\-]/g, '')
    if (!/\d/.test(bersih)) return null
    n = Number(bersih)
  } else {
    n = Number(nilai)
  }
  if (!Number.isFinite(n) || n < 0) return null
  return n
}

function toBool(nilai, fallback = false) {
  if (nilai === null || nilai === undefined || nilai === '') return fallback
  if (typeof nilai === 'boolean') return nilai
  if (typeof nilai === 'number') return nilai !== 0
  const s = String(nilai).toLowerCase()
  if (['true', '1', 'yes', 'y'].includes(s)) return true
  if (['false', '0', 'no', 'n'].includes(s)) return false
  return fallback
}

// null = tidak ada hitungan (bukan nol). Angka tak valid juga null.
function stokAngka(stock) {
  if (stock === null || stock === undefined || stock === '') return null
  if (typeof stock === 'string' && !/\d/.test(stock)) return null
  const n = typeof stock === 'string' ? Number(stock.replace(/[^0-9.\-]/g, '')) : Number(stock)
  if (!Number.isFinite(n)) return null
  return Math.min(Math.max(0, Math.trunc(n)), STOK_MAX_KOLOM)
}

function benderaStok(raw) {
  if (!raw || (raw.in_stock === undefined && raw.inStock === undefined)) return null
  return toBool(raw.in_stock ?? raw.inStock, false)
}

// MURNI. Satu produk InsightX -> bentuk seragam. null = dilewati.
function normalizeProductRow(raw) {
  if (!raw || typeof raw !== 'object') return null

  const externalId = raw.id ?? raw.slug
  if (externalId === null || externalId === undefined || String(externalId).trim() === '') return null

  const currency = String(raw.currency || 'USD').toUpperCase()
  // Mata uang selain USD tidak punya kurs di lib/fx.js. Jangan simpan,
  // supaya sync tidak membuat varian berharga Rp 0.
  if (currency !== 'USD') return null

  const angka = stokAngka(raw.stock)
  const tersedia = benderaStok(raw)
  const takTerbatas = angka === null && tersedia === true
  let stok
  if (tersedia === false) stok = 0
  else if (takTerbatas) stok = STOK_TAK_TERBATAS
  else if (angka === null) stok = 0
  else stok = angka

  const bagian = []
  if (raw.slug) bagian.push(`slug:${raw.slug}`)
  if (raw.reseller_price === true) bagian.push('harga:reseller')
  else if (raw.list_price !== null && raw.list_price !== undefined && raw.list_price !== '') {
    bagian.push(`list:${raw.list_price}`)
  }

  return {
    externalId: String(externalId),
    nama: String(raw.name ?? raw.nama ?? '').trim() || `Produk ${externalId}`,
    deskripsi: bagian.join(' '),
    // `price` = yang kunci ini bayar. list_price sengaja tidak dipakai.
    hargaAsal: parseHarga(raw.price),
    currency: 'USD',
    stok,
    inStock: stok > 0,
    takTerbatas,
  }
}

function itemKeKey(item) {
  if (item === null || item === undefined) return ''
  if (typeof item === 'string') return item.trim()
  if (typeof item === 'number' && Number.isFinite(item)) return String(item)
  if (typeof item === 'object') {
    const delivered = item.delivered ?? item.code ?? item.key ?? item.coupon
    if (delivered !== null && delivered !== undefined && String(delivered).trim()) {
      return String(delivered).trim()
    }
    const user = item.user ?? item.username ?? item.login ?? ''
    const pass = item.pass ?? item.password ?? ''
    if (String(user).trim() || String(pass).trim()) return `${user}:${pass}`.trim()
  }
  return ''
}

function sumberOrder(body) {
  if (!body || typeof body !== 'object') return {}
  const data = body.data
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    if (data.id != null || data.status || data.items || data.order_id || data.orderId) return data
  }
  if (body.order && typeof body.order === 'object') return body.order
  return body
}

// MURNI. POST /orders atau GET /orders/:id -> bentuk seragam.
function normalizeOrderResponse(body) {
  const src = sumberOrder(body)
  const mentah = src.items ?? src.deliveredKeys ?? src.delivered_keys
  const adaDaftar = Array.isArray(mentah)
  const keys = adaDaftar ? mentah.map(itemKeKey).filter((k) => k !== '') : []
  const status = String(src.status || (keys.length ? 'completed' : 'unknown')).toLowerCase()
  const orderId = src.id ?? src.order_id ?? src.orderId ?? null
  const idTeks = orderId === null || orderId === undefined || String(orderId).trim() === ''
    ? null
    : String(orderId)
  const gagal = STATUS_GAGAL.has(status)
  const terkirim = STATUS_TERKIRIM.has(status)

  return {
    ok: keys.length > 0 && !gagal && (terkirim || status === 'unknown'),
    orderId: idTeks,
    keys,
    status,
    // Pesanan sudah terbit (completed/partial) tetapi kode tidak ada di
    // payload ini. Jangan membeli lagi. Daftar riwayat tanpa field items
    // (metadata only) tidak ditandai placed.
    placed: Boolean(idTeks) && keys.length === 0 && adaDaftar && terkirim && !gagal,
  }
}

function normalizeBalance(body) {
  const src = body?.data && typeof body.data === 'object' && !Array.isArray(body.data)
    ? body.data
    : (body || {})
  return {
    usd: toNumber(src.balance ?? src.usd ?? src.balance_usd, 0),
    points: 0,
    currency: String(src.currency || 'USD').toUpperCase(),
  }
}

function unwrapProducts(body) {
  if (Array.isArray(body?.data?.products)) return body.data.products
  if (Array.isArray(body?.products)) return body.products
  if (Array.isArray(body?.data)) return body.data
  if (Array.isArray(body)) return body
  return []
}

function unwrapOrders(body) {
  if (Array.isArray(body?.data?.orders)) return body.data.orders
  if (Array.isArray(body?.orders)) return body.orders
  if (Array.isArray(body?.data)) return body.data
  if (Array.isArray(body)) return body
  return []
}

async function listProducts({ baseUrl, apiKey } = {}) {
  const { data } = await request('get', { baseUrl, apiKey, path: '/products' })
  const baris = unwrapProducts(data)
  const produk = []
  let skipped = 0
  for (const r of baris) {
    const n = normalizeProductRow(r)
    if (n && n.hargaAsal !== null) produk.push(n)
    else skipped++
  }
  return { produk, skipped }
}

async function getBalance({ baseUrl, apiKey } = {}) {
  const { data } = await request('get', { baseUrl, apiKey, path: '/balance' })
  return normalizeBalance(data)
}

async function listOrders({ baseUrl, apiKey } = {}) {
  const { data } = await request('get', { baseUrl, apiKey, path: '/orders' })
  return unwrapOrders(data).map((row) => normalizeOrderResponse(row))
}

async function getOrder({ baseUrl, apiKey, orderId } = {}) {
  const { data } = await request('get', {
    baseUrl,
    apiKey,
    path: `/orders/${encodeURIComponent(orderId)}`,
  })
  return normalizeOrderResponse(data)
}

async function createOrder({ baseUrl, apiKey, externalId, quantity = 1, idempotencyKey, maxPrice } = {}) {
  if (!idempotencyKey || !String(idempotencyKey).trim()) {
    throw new Error('createOrder butuh idempotencyKey yang tidak kosong')
  }
  if (externalId === null || externalId === undefined || String(externalId).trim() === '') {
    throw new Error('createOrder butuh externalId (product id atau slug InsightX)')
  }

  // 0 bukan "kosong": API menolak quantity di luar 1-50, jadi jangan
  // diam-diam menaikkannya jadi 1.
  const qty = quantity === undefined || quantity === null || quantity === ''
    ? 1
    : Math.trunc(Number(quantity))
  if (!Number.isFinite(qty) || qty < QTY_MIN || qty > QTY_MAX) throw kesalahanQty(qty)

  const body = {
    product: String(externalId),
    quantity: qty,
  }
  if (maxPrice !== undefined && maxPrice !== null && maxPrice !== '') {
    const batas = Number(maxPrice)
    if (!Number.isFinite(batas) || batas < 0) {
      throw new Error('createOrder maxPrice harus angka >= 0')
    }
    body.max_price = batas
  }

  const { data } = await request('post', {
    baseUrl,
    apiKey,
    path: '/orders',
    body,
    extraHeaders: { 'Content-Type': 'application/json' },
  })
  return normalizeOrderResponse(data)
}

async function testConnection({ baseUrl, apiKey } = {}) {
  const saldo = await getBalance({ baseUrl, apiKey })
  const { data } = await request('get', { baseUrl, apiKey, path: '/products' })
  const baris = unwrapProducts(data)
  return {
    ok: true,
    balance: { usd: saldo.usd, points: saldo.points, currency: saldo.currency },
    sampleCount: baris.length,
    sampleRaw: baris[0] || null,
    sampleNormalized: baris[0] ? normalizeProductRow(baris[0]) : null,
  }
}

module.exports = {
  key: 'insightx',
  label: 'InsightX Pro',
  defaultBaseUrl: DEFAULT_BASE_URL,
  allowedHosts: ALLOWED_HOSTS,
  authHint: 'Header Authorization: Bearer. Tempel rahasia isk_live_… saja (sandbox: isk_test_…). Jangan ikutkan kata Bearer atau "Authorization:". Awalan itu, kutip, dan spasi di tepi dibuang otomatis. Atau set env INSIGHTX_API_KEY di server. Kosongkan keduanya sampai kunci siap — supplier tetap tersimpan, tetapi belum terautentikasi. Harga API adalah USD dan ikut kurs USD→IDR yang sudah ada. Jangan commit kunci ke repo.',
  normalizeApiKey,
  keyPlaceholder: 'isk_live_…',
  STOK_TAK_TERBATAS,
  QTY_MAX,
  listProducts,
  getBalance,
  listOrders,
  createOrder,
  getOrder,
  testConnection,
  normalizeProductRow,
  normalizeOrderResponse,
  normalizeBalance,
  __setHttp: (m) => { http = m },
}
