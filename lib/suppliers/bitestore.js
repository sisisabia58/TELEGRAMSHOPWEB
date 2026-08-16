// lib/suppliers/bitestore.js — adapter untuk Bite Store Reseller API.
// Docs: https://bite-store-bot-production.up.railway.app/docs
//
// Mengikuti pola klien pakasir.js: `http` di tingkat modul yang bisa ditukar
// lewat __setHttp untuk tes, timeout 30 detik, tanpa retry internal (pemanggil
// yang memutuskan; lib/fulfillment.js justru ingin gagal cepat lalu pindah ke
// penawaran berikutnya).
//
// PERINGATAN SOAL BENTUK BALASAN:
// openapi.json yang dipublikasikan mendeklarasikan response schema KOSONG ({})
// untuk semua endpoint — daftar fieldnya hanya ada di prosa dokumentasi. Jadi
// normalisasi di bawah sengaja permisif: menerima array telanjang maupun
// amplop { data | products | items | results }, dan harga sebagai angka maupun
// string. Tombol "Test koneksi" di dashboard menampilkan baris mentah pertama
// supaya bentuk aslinya bisa dicocokkan dengan mata begitu ada API key.

let http = require('axios')

const TIMEOUT = 30000
const PER_PAGE = 500
const MAX_PAGES = 50 // pagar aman; 50 x 500 = 25.000 produk

// Rate limit resmi 60 request/menit. Sync memakai per_page=500 jadi normalnya
// cuma beberapa request, tapi jeda kecil antar halaman membuat katalog besar
// tidak pernah menabrak 429.
const JEDA_HALAMAN_MS = 1100

function base(baseUrl) {
  return String(baseUrl || 'https://bite-store-bot-production.up.railway.app').replace(/\/$/, '')
}

function headers(apiKey, extra = {}) {
  return { 'X-API-Key': String(apiKey || ''), Accept: 'application/json', ...extra }
}

// MURNI. Balasan bisa berupa array telanjang atau dibungkus amplop; kembalikan
// arraynya apa pun bentuknya.
function unwrapList(body) {
  if (Array.isArray(body)) return body
  if (!body || typeof body !== 'object') return []
  for (const kunci of ['data', 'products', 'items', 'results', 'rows']) {
    if (Array.isArray(body[kunci])) return body[kunci]
  }
  return []
}

// MURNI. Angka yang mungkin datang sebagai string ("2.50") atau null.
function toNumber(nilai, fallback = 0) {
  if (nilai === null || nilai === undefined || nilai === '') return fallback
  const n = typeof nilai === 'string' ? Number(nilai.replace(/[^0-9.\-]/g, '')) : Number(nilai)
  return Number.isFinite(n) ? n : fallback
}

// MURNI. Harga khusus: "tidak diketahui" HARUS dibedakan dari "nol".
//
// Kalau harga hilang atau tidak bisa diurai lalu dianggap 0, penawarannya jadi
// penawaran Rp 0 yang otomatis mengalahkan seluruh penawaran berbayar — kita
// menjual gratis barang yang modalnya tidak kita ketahui. Jadi kembalikan null
// untuk yang tidak diketahui, dan 0 hanya kalau penjual benar-benar menulis 0.
function parseHarga(nilai) {
  if (nilai === null || nilai === undefined || nilai === '') return null

  let n
  if (typeof nilai === 'string') {
    // Buang simbol mata uang, tapi teks yang sama sekali tidak memuat angka
    // ("gratis", "hubungi kami") menyisakan string kosong — dan Number('') itu
    // 0, yang persis kesalahan yang mau dihindari fungsi ini.
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
  if (typeof nilai === 'number') return nilai > 0
  const s = String(nilai).toLowerCase()
  if (['true', '1', 'yes', 'y'].includes(s)) return true
  if (['false', '0', 'no', 'n'].includes(s)) return false
  return fallback
}

// Kita hanya menjual produk yang dikirim otomatis berupa key teks. Produk
// berbasis file dan produk manual (yang balasannya "pending" dan butuh
// polling) dibuang di sini dan dihitung sebagai `skipped` oleh sync — lihat
// batasan fase di docs/superpowers/specs.
const KIND_INSTAN = new Set(['auto', 'static', 'account', 'accounts', 'key', 'keys', 'text', 'instant', ''])

function isInstan(raw) {
  const kind = String(raw?.kind ?? raw?.type ?? raw?.delivery ?? raw?.delivery_type ?? '')
    .toLowerCase()
    .trim()
  if (!kind) return true // tidak dinyatakan -> anggap instan (perilaku default API)
  if (['file', 'manual', 'pending'].includes(kind)) return false
  return KIND_INSTAN.has(kind)
}

// MURNI. Satu baris produk supplier -> bentuk seragam adapter.
// Mengembalikan null kalau barisnya tidak bisa dipakai (tanpa id, atau bukan
// produk key instan), supaya pemanggil bisa menghitungnya sebagai dilewati.
function normalizeProductRow(raw) {
  if (!raw || typeof raw !== 'object') return null

  const externalId = raw.id ?? raw.productId ?? raw.product_id ?? raw.uuid
  if (externalId === null || externalId === undefined || externalId === '') return null
  if (!isInstan(raw)) return null

  const stok = Math.max(0, Math.trunc(toNumber(raw.stock ?? raw.stok ?? raw.qty, 0)))
  // inStock dipercaya kalau ada; kalau tidak, turunkan dari jumlah stok.
  const inStock = raw.inStock === undefined && raw.in_stock === undefined
    ? stok > 0
    : toBool(raw.inStock ?? raw.in_stock, stok > 0)

  return {
    externalId: String(externalId),
    nama: String(raw.name ?? raw.nama ?? raw.title ?? '').trim() || `Produk ${externalId}`,
    namaHtml: raw.name_html ? String(raw.name_html) : null,
    deskripsi: String(raw.description ?? raw.deskripsi ?? '').trim(),
    // null = harga tidak diketahui. Pemanggil WAJIB membuang baris seperti ini
    // (lihat listProducts) alih-alih memperlakukannya sebagai gratis.
    hargaAsal: parseHarga(raw.price ?? raw.harga ?? raw.amount),
    currency: String(raw.currency || 'USD').toUpperCase(),
    stok,
    inStock,
    terjual: Math.max(0, Math.trunc(toNumber(raw.sold, 0))),
  }
}

// MURNI. Balasan POST /v1/orders -> bentuk seragam.
function normalizeOrderResponse(body) {
  const keysMentah = body?.deliveredKeys ?? body?.delivered_keys ?? body?.keys ?? body?.data?.deliveredKeys
  const keys = Array.isArray(keysMentah)
    ? keysMentah.map((k) => String(k)).filter((k) => k.trim() !== '')
    : []
  const status = String(body?.status || (keys.length ? 'completed' : 'unknown')).toLowerCase()
  const orderId = body?.orderId ?? body?.order_id ?? body?.id ?? null

  return {
    // Sengaja ketat: pesanan hanya dianggap berhasil kalau benar-benar ada key
    // yang bisa dikirim. "ok: true" tanpa isi berarti pembeli sudah dipotong
    // saldonya tapi tidak menerima apa pun.
    ok: keys.length > 0,
    orderId: orderId === null || orderId === undefined ? null : String(orderId),
    keys,
    status,
    raw: body,
  }
}

// MURNI.
function normalizeBalance(body) {
  const sumber = body?.data && typeof body.data === 'object' ? body.data : body
  return {
    usd: toNumber(sumber?.usd ?? sumber?.balance_usd ?? sumber?.balance, 0),
    points: toNumber(sumber?.points ?? sumber?.point ?? sumber?.balance_points, 0),
    raw: body,
  }
}

const tidur = (ms) => new Promise((r) => setTimeout(r, ms))

// Ambil seluruh katalog, mengikuti paginasi. Baris yang tidak bisa dipakai
// dihitung, bukan dibuang diam-diam.
async function listProducts({ baseUrl, apiKey } = {}) {
  const produk = []
  let skipped = 0
  let halaman = 1

  for (; halaman <= MAX_PAGES; halaman++) {
    const { data } = await http.get(`${base(baseUrl)}/v1/products`, {
      params: { page: halaman, per_page: PER_PAGE, live: 1 },
      headers: headers(apiKey),
      timeout: TIMEOUT,
    })

    const baris = unwrapList(data)
    for (const r of baris) {
      const n = normalizeProductRow(r)
      // Harga tidak diketahui = tidak bisa dijual. Lebih baik tidak menawarkan
      // sama sekali daripada menawarkan dengan harga tebakan.
      if (n && n.hargaAsal !== null) produk.push(n)
      else skipped++
    }

    if (baris.length < PER_PAGE) break
    await tidur(JEDA_HALAMAN_MS)
  }

  return { produk, skipped, halaman: Math.min(halaman, MAX_PAGES) }
}

async function getBalance({ baseUrl, apiKey } = {}) {
  const { data } = await http.get(`${base(baseUrl)}/v1/balance`, {
    headers: headers(apiKey),
    timeout: TIMEOUT,
  })
  return normalizeBalance(data)
}

// Idempotency-Key wajib diisi pemanggil: kalau permintaan yang sama dikirim
// ulang (retry, restart proses), penjual mengembalikan hasil yang sama alih-alih
// membuat pesanan kedua dan memotong dompet dua kali.
async function createOrder({ baseUrl, apiKey, externalId, quantity = 1, idempotencyKey } = {}) {
  // WAJIB, bukan opsional. Tanpa kunci ini, percobaan ulang apa pun (retry
  // jaringan, restart proses) membuat pesanan berbayar kedua di sisi penjual.
  // Lebih baik gagal di sini daripada membeli dua kali diam-diam.
  if (!idempotencyKey || !String(idempotencyKey).trim()) {
    throw new Error('createOrder butuh idempotencyKey yang tidak kosong')
  }

  const { data } = await http.post(
    `${base(baseUrl)}/v1/orders`,
    { productId: String(externalId), quantity: Number(quantity) || 1 },
    {
      headers: headers(apiKey, {
        'Content-Type': 'application/json',
        'Idempotency-Key': String(idempotencyKey),
      }),
      timeout: TIMEOUT,
    }
  )
  return normalizeOrderResponse(data)
}

async function getOrder({ baseUrl, apiKey, orderId } = {}) {
  const { data } = await http.get(`${base(baseUrl)}/v1/orders/${encodeURIComponent(orderId)}`, {
    headers: headers(apiKey),
    timeout: TIMEOUT,
  })
  return normalizeOrderResponse(data)
}

// Dipakai tombol "Test koneksi": satu halaman kecil, dan baris MENTAH pertama
// ikut dikembalikan supaya bentuk asli API bisa diperiksa langsung di dashboard.
async function testConnection({ baseUrl, apiKey } = {}) {
  const saldo = await getBalance({ baseUrl, apiKey })
  const { data } = await http.get(`${base(baseUrl)}/v1/products`, {
    params: { page: 1, per_page: 3, live: 1 },
    headers: headers(apiKey),
    timeout: TIMEOUT,
  })
  const baris = unwrapList(data)
  return {
    ok: true,
    balance: { usd: saldo.usd, points: saldo.points },
    sampleCount: baris.length,
    sampleRaw: baris[0] || null,
    sampleNormalized: baris[0] ? normalizeProductRow(baris[0]) : null,
  }
}

module.exports = {
  key: 'bitestore',
  label: 'Bite Store',
  defaultBaseUrl: 'https://bite-store-bot-production.up.railway.app',
  listProducts,
  getBalance,
  createOrder,
  getOrder,
  testConnection,
  // diekspor untuk tes
  unwrapList,
  normalizeProductRow,
  normalizeOrderResponse,
  normalizeBalance,
  __setHttp: (m) => { http = m },
}
