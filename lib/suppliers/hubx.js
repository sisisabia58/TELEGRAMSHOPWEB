// lib/suppliers/hubx.js — adapter HubX Store Reseller API.
// Docs: https://open-greeting-glow-production.up.railway.app/api-docs
//
// Kontrak sama dengan bitestore.js (lihat lib/suppliers/index.js): listProducts,
// getBalance, createOrder, getOrder, testConnection. Pemanggil (sync, fulfillment,
// tombol test) tidak perlu tahu bentuk JSON HubX.
//
// AUTH
//   Header `Authorization: Bearer <api_key>`. Kunci tidak pernah di-hardcode.
//   Prioritas: api_key pada baris Supplier, kalau kosong env HUBX_API_KEY.
//   Keduanya kosong = supplier terpasang tetapi belum diautentikasi (HTTP 401
//   sebelum ada request, tanpa mengirim header).
//
// HARGA
//   price_usdt disimpan apa adanya di harga_asal dengan currency USDT.
//   Konversi ke rupiah bukan di adapter ini. lib/fx.js hargaJualIdr mengalikan
//   peg eksplisit fx_usdt_per_usd (bawaan 1 = 1 USDT dihitung 1 USD) lalu kurs
//   USD→IDR yang sudah ada. Tidak ada kurs tersembunyi di file ini.
//
// STOK
//   Angka utuh. String "unlimited" menjadi STOK_TAK_TERBATAS (999999), muat di
//   kolom integer SupplierProduct dan cukup besar untuk qty pesanan (maks API 500).
//
// PESANAN
//   external_order_id = idempotencyKey Teleshop (membawa trxid). HubX idempoten
//   pada nilai itu. Status awaiting_manual_delivery di-poll GET /orders/:id
//   dengan jeda terbatas. Kalau masih menunggu, hasilnya placed:true supaya
//   fulfillment TIDAK membeli ke penjual lain (pesanan HubX sudah terbit).
//   items[] (string user:pass) menjadi keys yang sama yang dipakai stok sendiri.

const urlSafety = require('./url-safety')

let http = require('axios')

const TIMEOUT = 30000
const DEFAULT_BASE_URL = 'https://open-greeting-glow-production.up.railway.app/api/public/reseller/v1'
const ALLOWED_HOSTS = ['open-greeting-glow-production.up.railway.app']
const ADAPTER_ID = {
  key: 'hubx',
  defaultBaseUrl: DEFAULT_BASE_URL,
  allowedHosts: ALLOWED_HOSTS,
}

// Muat di kolom integer Postgres dan di jumlah stok bot. Bukan stok sungguhan.
const STOK_TAK_TERBATAS = 999999
const STOK_MAX_KOLOM = 2147483647

function angkaEnv(nama, fallback) {
  const n = Number(process.env[nama])
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

function pollBawaan() {
  return {
    attempts: angkaEnv('HUBX_POLL_ATTEMPTS', 5),
    baseMs: angkaEnv('HUBX_POLL_BASE_MS', 1000),
    maxMs: 8000,
  }
}

let pollConfig = pollBawaan()
let sleepFn = (ms) => new Promise((r) => setTimeout(r, ms))

function pollSaatIni() {
  return pollConfig
}

function resolveApiKey(apiKey) {
  const baris = String(apiKey ?? '').trim()
  if (baris) return baris
  return String(process.env.HUBX_API_KEY || '').trim()
}

function kesalahanTidakLogin() {
  const err = new Error('HTTP 401: HubX api_key kosong — supplier terpasang, belum diautentikasi')
  err.response = { status: 401, data: { error: 'missing_api_key' } }
  return err
}

// Salinan error tanpa config axios (config memuat Authorization).
function tanpaRahasia(e) {
  const status = Number(e?.response?.status)
  const err = new Error(Number.isFinite(status) && status > 0
    ? `HTTP ${status}`
    : (e?.message || 'HubX request gagal'))
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
    throw tanpaRahasia(e)
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

function produkAktif(raw) {
  if (!raw || raw.active === undefined || raw.active === null || raw.active === '') return true
  if (typeof raw.active === 'boolean') return raw.active
  if (typeof raw.active === 'number') return raw.active !== 0
  const s = String(raw.active).toLowerCase()
  if (['false', '0', 'no', 'n'].includes(s)) return false
  return true
}

function normalStok(stock) {
  if (typeof stock === 'string' && stock.trim().toLowerCase() === 'unlimited') {
    return STOK_TAK_TERBATAS
  }
  const n = Math.max(0, Math.trunc(toNumber(stock, 0)))
  return Math.min(n, STOK_MAX_KOLOM)
}

// MURNI. Satu produk HubX -> bentuk seragam. null = dilewati (nonaktif / tanpa id).
function normalizeProductRow(raw) {
  if (!raw || typeof raw !== 'object') return null
  if (!produkAktif(raw)) return null

  const externalId = raw.id ?? raw.slug
  if (externalId === null || externalId === undefined || String(externalId).trim() === '') return null

  const stok = normalStok(raw.stock)
  const bagian = []
  if (raw.slug) bagian.push(`slug:${raw.slug}`)
  if (raw.fulfillment_type) bagian.push(`fulfillment:${raw.fulfillment_type}`)

  return {
    externalId: String(externalId),
    nama: String(raw.name ?? raw.nama ?? '').trim() || `Produk ${externalId}`,
    deskripsi: bagian.join(' '),
    hargaAsal: parseHarga(raw.price_usdt ?? raw.price),
    currency: 'USDT',
    stok,
    inStock: stok > 0,
    takTerbatas: typeof raw.stock === 'string' && raw.stock.trim().toLowerCase() === 'unlimited',
  }
}

function itemKeKey(item) {
  if (item === null || item === undefined) return ''
  if (typeof item === 'string') return item.trim()
  if (typeof item === 'number' && Number.isFinite(item)) return String(item)
  if (typeof item === 'object') {
    const user = item.user ?? item.username ?? item.login ?? ''
    const pass = item.pass ?? item.password ?? ''
    if (String(user).trim() || String(pass).trim()) return `${user}:${pass}`.trim()
    const kode = item.code ?? item.key ?? item.coupon
    if (kode !== null && kode !== undefined && String(kode).trim()) return String(kode).trim()
  }
  return ''
}

// MURNI. POST /orders atau GET /orders/:id -> bentuk seragam.
function normalizeOrderResponse(body) {
  const src = body?.order && typeof body.order === 'object' ? body.order : (body || {})
  const mentah = src.items ?? src.deliveredKeys ?? src.delivered_keys ?? []
  const keys = Array.isArray(mentah) ? mentah.map(itemKeKey).filter((k) => k !== '') : []
  const status = String(src.status || (keys.length ? 'delivered' : 'unknown')).toLowerCase()
  const orderId = src.order_id ?? src.orderId ?? src.id ?? null
  const idTeks = orderId === null || orderId === undefined || String(orderId).trim() === ''
    ? null
    : String(orderId)
  const menunggu = status === 'awaiting_manual_delivery'
  const terkirim = status === 'delivered' || (status === 'unknown' && keys.length > 0)

  return {
    ok: keys.length > 0 && !menunggu && status !== 'refunded',
    orderId: idTeks,
    keys,
    status: terkirim && keys.length ? 'delivered' : status,
    // Pesanan sudah terbit di HubX tetapi belum ada key. Fulfillment harus
    // berhenti, bukan membeli lagi ke supplier lain.
    placed: Boolean(idTeks) && keys.length === 0 && (menunggu || status === 'delivered'),
    idempotentReplay: Boolean(body?.idempotent_replay),
  }
}

function normalizeBalance(body) {
  const usdt = toNumber(body?.balance_usdt ?? body?.usdt ?? body?.balance, 0)
  return {
    // Kolom usd dipakai cron dompet yang sudah ada. Angkanya adalah USDT;
    // peg ke USD ada di fx_usdt_per_usd, bukan di sini.
    usd: usdt,
    points: 0,
    usdt,
    currency: String(body?.currency || 'USDT').toUpperCase(),
  }
}

async function listProducts({ baseUrl, apiKey } = {}) {
  const { data } = await request('get', { baseUrl, apiKey, path: '/products' })
  const baris = Array.isArray(data?.products) ? data.products : []
  const produk = []
  let skipped = 0
  for (const r of baris) {
    const n = normalizeProductRow(r)
    if (n && n.hargaAsal !== null) produk.push(n)
    else skipped++
  }
  return { produk, skipped }
}

async function getProduct({ baseUrl, apiKey, productId } = {}) {
  const { data } = await request('get', {
    baseUrl,
    apiKey,
    path: `/products/${encodeURIComponent(productId)}`,
  })
  const raw = data?.product && typeof data.product === 'object' ? data.product : data
  const n = normalizeProductRow(raw)
  return { product: n && n.hargaAsal !== null ? n : null, raw }
}

async function getBalance({ baseUrl, apiKey } = {}) {
  const { data } = await request('get', { baseUrl, apiKey, path: '/balance' })
  return normalizeBalance(data)
}

async function listOrders({ baseUrl, apiKey } = {}) {
  const { data } = await request('get', { baseUrl, apiKey, path: '/orders' })
  const baris = Array.isArray(data?.orders) ? data.orders : []
  return baris.map((row) => normalizeOrderResponse(row))
}

async function getOrder({ baseUrl, apiKey, orderId } = {}) {
  const { data } = await request('get', {
    baseUrl,
    apiKey,
    path: `/orders/${encodeURIComponent(orderId)}`,
  })
  return normalizeOrderResponse(data)
}

function jedaPoll(i, cfg) {
  if (!cfg.baseMs) return 0
  const ms = cfg.baseMs * (2 ** i)
  return Math.min(cfg.maxMs || ms, ms)
}

async function createOrder({ baseUrl, apiKey, externalId, quantity = 1, idempotencyKey } = {}) {
  if (!idempotencyKey || !String(idempotencyKey).trim()) {
    throw new Error('createOrder butuh idempotencyKey yang tidak kosong')
  }
  if (externalId === null || externalId === undefined || String(externalId).trim() === '') {
    throw new Error('createOrder butuh externalId (product id atau slug HubX)')
  }

  const qty = Math.max(1, Math.trunc(Number(quantity) || 1))
  const { data } = await request('post', {
    baseUrl,
    apiKey,
    path: '/orders',
    body: {
      product_id: String(externalId),
      quantity: qty,
      external_order_id: String(idempotencyKey),
    },
    extraHeaders: { 'Content-Type': 'application/json' },
  })

  let order = normalizeOrderResponse(data)
  if (order.status !== 'awaiting_manual_delivery' || order.ok || !order.orderId) return order

  const cfg = pollSaatIni()
  const percobaan = Math.max(0, Math.trunc(cfg.attempts))
  for (let i = 0; i < percobaan; i++) {
    await sleepFn(jedaPoll(i, cfg))
    let polled
    try {
      polled = await getOrder({ baseUrl, apiKey, orderId: order.orderId })
    } catch (_) {
      // Pesanan sudah terbit. Jangan lempar 4xx yang membuat fulfillment
      // pindah ke supplier lain dan membeli kedua kalinya.
      return {
        ok: false,
        orderId: order.orderId,
        keys: [],
        status: 'awaiting_manual_delivery',
        placed: true,
        idempotentReplay: order.idempotentReplay,
      }
    }
    if (polled.status === 'refunded') {
      return { ...polled, placed: false, idempotentReplay: order.idempotentReplay }
    }
    if (polled.ok || polled.status !== 'awaiting_manual_delivery') {
      return { ...polled, idempotentReplay: polled.idempotentReplay || order.idempotentReplay }
    }
    order = { ...polled, idempotentReplay: order.idempotentReplay }
  }

  return { ...order, ok: false, placed: true, status: 'awaiting_manual_delivery' }
}

async function testConnection({ baseUrl, apiKey } = {}) {
  const saldo = await getBalance({ baseUrl, apiKey })
  const { data } = await request('get', { baseUrl, apiKey, path: '/products' })
  const baris = Array.isArray(data?.products) ? data.products : []
  return {
    ok: true,
    balance: { usd: saldo.usd, points: saldo.points, usdt: saldo.usdt, currency: saldo.currency },
    sampleCount: baris.length,
    sampleRaw: baris[0] || null,
    sampleNormalized: baris[0] ? normalizeProductRow(baris[0]) : null,
  }
}

module.exports = {
  key: 'hubx',
  label: 'HubX Store',
  defaultBaseUrl: DEFAULT_BASE_URL,
  allowedHosts: ALLOWED_HOSTS,
  authHint: 'Header Authorization: Bearer. Tempel rsk_live_… (produksi) atau rsk_test_… (sandbox) di sini, atau set env HUBX_API_KEY di server. Kosongkan keduanya sampai kunci siap — supplier tetap tersimpan, tetapi belum terautentikasi. Jangan commit kunci ke repo.',
  keyPlaceholder: 'rsk_test_… atau rsk_live_…',
  STOK_TAK_TERBATAS,
  listProducts,
  getProduct,
  getBalance,
  listOrders,
  createOrder,
  getOrder,
  testConnection,
  normalizeProductRow,
  normalizeOrderResponse,
  normalizeBalance,
  __setHttp: (m) => { http = m },
  __setPoll: (cfg = {}) => {
    if (cfg.sleep) sleepFn = cfg.sleep
    pollConfig = {
      attempts: cfg.attempts ?? pollConfig.attempts,
      baseMs: cfg.baseMs ?? pollConfig.baseMs,
      maxMs: cfg.maxMs ?? pollConfig.maxMs,
    }
  },
  __resetPoll: () => {
    pollConfig = pollBawaan()
    sleepFn = (ms) => new Promise((r) => setTimeout(r, ms))
  },
}
