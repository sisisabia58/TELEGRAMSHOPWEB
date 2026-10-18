// lib/fulfillment.js — memenuhi satu pembelian dari sumber termurah yang bisa.
//
// Ini satu-satunya tempat "dari mana barangnya diambil" diputuskan saat uang
// pembeli sudah berpindah, jadi aturannya sengaja galak:
//
//   * Coba penawaran dari yang termurah. Penolakan pasti (4xx, termasuk 402)
//     TURUN ke penawaran berikutnya. Hasil yang tidak jelas (timeout, koneksi
//     putus, 5xx) TIDAK boleh pindah penjual: retry sekali dengan kunci
//     idempoten yang sama, coba getOrder, dan kalau tetap gelap tandai
//     rekonsiliasi manual. Pembeli tidak perlu tahu penjual mana yang bermasalah.
//   * Penawaran stok sendiri berjalan lewat jalur lama persis: ambil baris
//     "Stok" FIFO lalu tandai terjual. Tidak ada panggilan supplier sama sekali.
//   * Sebuah pesanan hanya dianggap berhasil kalau benar-benar ada isi yang bisa
//     dikirim. "ok" tanpa key berarti pembeli membayar dan tidak menerima apa pun.
//   * Setiap percobaan ke supplier memakai Idempotency-Key yang stabil dan
//     diturunkan dari trxid, jadi percobaan ulang tidak pernah membeli dua kali.
//
// Semua ketergantungan disuntikkan lewat `deps` supaya modul ini bisa dites
// tuntas tanpa Supabase maupun HTTP — dan supaya jalur yang menghabiskan uang
// betulan punya tes, bukan cuma dibaca.
const supabase = require('./supabase')
const sourcing = require('./sourcing')
const stock = require('./stock')
const { getAdapter, assertSafeOutbound } = require('./suppliers')

const DEPS_DEFAULT = {
  getOffers: (varian) => sourcing.getOffersForVarian(varian),
  rankOffers: (offers, qty) => sourcing.rankOffers(offers, qty),
  getStokForTransaction: (kode, jumlah) => stock.getStokForTransaction(kode, jumlah),
  claimStok: (ids, trxid) => stock.claimStok(ids, trxid),
  releaseStok: (ids) => stock.releaseStok(ids),
  getSupplier: async (supplierId) => {
    const { data } = await supabase.from('Supplier').select('*').eq('id', supplierId).maybeSingle()
    return data || null
  },
  createOrder: async (supplier, args) => {
    const adapter = getAdapter(supplier.adapter)
    if (!adapter) throw new Error(`adapter "${supplier.adapter}" tidak dikenal`)
    const baseUrl = await assertSafeOutbound(supplier.adapter, supplier.base_url)
    return adapter.createOrder({ baseUrl, apiKey: supplier.api_key, ...args })
  },
  getOrder: async (supplier, args) => {
    const adapter = getAdapter(supplier.adapter)
    if (!adapter) throw new Error(`adapter "${supplier.adapter}" tidak dikenal`)
    if (typeof adapter.getOrder !== 'function') {
      throw new Error(`adapter "${supplier.adapter}" tidak mendukung getOrder`)
    }
    const baseUrl = await assertSafeOutbound(supplier.adapter, supplier.base_url)
    return adapter.getOrder({ baseUrl, apiKey: supplier.api_key, ...args })
  },
  recordSupplierOrder: async (row) => {
    const { data, error } = await supabase.from('SupplierOrder').insert(row).select().maybeSingle()
    if (error) {
      // Jejak audit tidak boleh menggagalkan pengiriman yang sudah berhasil:
      // pembeli sudah membayar dan key-nya sudah di tangan kita.
      console.error('fulfillment.recordSupplierOrder:', error)
      return null
    }
    return data
  },
}

// Kunci idempotensi.
//
// SENGAJA TIDAK memakai urutan percobaan. Urutan penawaran berubah setiap kali
// harga, stok, atau status aktif supplier berubah, jadi kunci berbasis indeks
// TIDAK stabil: percobaan ulang untuk transaksi yang sama bisa mengirim kunci
// berbeda ke penjual yang sama dan membuat pesanan berbayar KEDUA.
//
// Diturunkan dari identitas yang tidak berubah antar percobaan: transaksi,
// pembeli, penjual, produk di sisi penjual, dan jumlah. trxid dibuat dari
// Date.now() di checkout, jadi dua pembeli di milidetik yang sama bisa
// mendapat trxid identik — tanpa userId, penjual akan memantulkan key
// pembeli pertama ke yang kedua. Percobaan ke penjual berbeda tetap
// menghasilkan kunci berbeda (memang seharusnya — itu pesanan berbeda).
function idempotencyKey(trxid, offer, quantity, userId = null) {
  const bagian = [
    trxid,
    userId ?? 'nouser',
    offer?.supplier_id || 'nosup',
    offer?.external_id || 'noext',
    `q${Math.max(1, Math.trunc(Number(quantity) || 1))}`,
  ]
  return bagian.map((b) => String(b).replace(/[^A-Za-z0-9_-]/g, '')).join('-')
}

// Penuhi qty unit dari `varian`. Tidak pernah melempar.
//
// Mengembalikan:
//   { ok: true,  lines: string[], sumber, offer, supplierOrder, attempts }
//   { ok: false, error, attempts }
//     Kegagalan pasti (4xx, stok habis): pemanggil mengembalikan saldo.
//   { ok: false, error, attempts, stopFailover: true }
//     Hasil supplier tidak jelas (timeout/5xx setelah retry). Jangan pindah
//     penjual dan jangan refund otomatis — harusRefund() membaca flag ini.
async function fulfill({ varian, qty = 1, trxid, userId = null, hargaSatuan = 0, deps = {} } = {}) {
  const d = { ...DEPS_DEFAULT, ...deps }
  const jumlah = Math.max(1, Math.trunc(Number(qty) || 1))
  const attempts = []
  let stopFailover = false

  if (!varian || !varian.kode) {
    return { ok: false, error: 'varian tidak valid', attempts }
  }

  let offers
  try {
    offers = await d.getOffers(varian)
  } catch (e) {
    return { ok: false, error: `gagal membaca sumber: ${e.message}`, attempts }
  }

  // Satu penawaran harus menanggung seluruh qty. Jumlah yang hanya muat kalau
  // dipecah (stok sendiri 2 + supplier 3, minta 5) ditolak di sini. Batas
  // pembelian di sourcing.batasBeli memakai angka yang sama supaya pembeli
  // tidak membayar qty yang jalur ini tidak bisa kirim.
  const urut = d.rankOffers(offers, jumlah)
  if (!urut.length) {
    return { ok: false, error: 'stok habis di semua sumber', attempts }
  }

  // Pembeli sudah dipotong hargaSatuan (penawaran termurah yang muat qty).
  // Failover ke supplier yang lebih mahal berarti toko merugi diam-diam.
  // Stok sendiri dibiarkan: itu modal kita, bukan belanja ke penjual.
  const ditagih = Math.trunc(Number(hargaSatuan) || 0)

  for (let i = 0; i < urut.length; i++) {
    const offer = urut[i]
    if (
      offer.sumber === sourcing.SUPPLIER
      && ditagih > 0
      && Number(offer.harga_satuan) > ditagih
    ) {
      attempts.push({
        sumber: offer.sumber,
        supplier_id: offer.supplier_id,
        ok: false,
        error: `harga ${offer.harga_satuan} di atas yang ditagih ${ditagih}`,
      })
      continue
    }
    try {
      const hasil = offer.sumber === sourcing.SUPPLIER
        ? await ambilDariSupplier({ offer, varian, jumlah, trxid, userId, hargaSatuan, d })
        : await ambilDariStokSendiri({ offer, varian, jumlah, trxid, d })

      if (hasil.ok) {
        attempts.push({ sumber: offer.sumber, supplier_id: offer.supplier_id, ok: true })
        return { ...hasil, offer, sumber: offer.sumber, attempts }
      }
      attempts.push({ sumber: offer.sumber, supplier_id: offer.supplier_id, ok: false, error: hasil.error })
      if (hasil.stopFailover) {
        // Flag ini hanya hidup di hasil percobaan. Kalau dibuang di objek
        // akhir, harusRefund menganggap pesanan gelap sebagai gagal pasti
        // dan mengembalikan uang meski supplier mungkin sudah mengirim.
        stopFailover = true
        break
      }
    } catch (e) {
      attempts.push({ sumber: offer.sumber, supplier_id: offer.supplier_id, ok: false, error: e.message })
    }
  }

  const gagal = {
    ok: false,
    error: attempts.map((a) => a.error).filter(Boolean).join('; ') || 'semua sumber gagal',
    attempts,
  }
  if (stopFailover) gagal.stopFailover = true
  return gagal
}

// FIFO dari tabel "Stok", lalu KLAIM secara atomik.
//
// Memilih baris dan menandainya terjual adalah dua operasi terpisah; di antara
// keduanya pembeli lain bisa mengambil baris yang sama. Karena itu klaimnya
// bersyarat (hanya baris yang masih 'tersedia' yang berubah) dan kita percaya
// pada jumlah baris yang BENAR-BENAR kita menangkan, bukan pada jumlah yang
// kita pilih. Klaim sebagian dilepas kembali dan dianggap gagal, supaya
// pemanggil turun ke penawaran berikutnya alih-alih mengirim barang kurang.
async function ambilDariStokSendiri({ offer, varian, jumlah, trxid, d }) {
  const kode = String(varian.kode).toLowerCase()
  const items = await d.getStokForTransaction(kode, jumlah)

  if (!items || items.length < jumlah) {
    return { ok: false, error: `stok sendiri kurang (${items?.length || 0}/${jumlah})` }
  }

  const ids = items.map((s) => s.id)
  const klaim = await d.claimStok(ids, trxid)

  if (!klaim.ok) {
    return { ok: false, error: `gagal klaim stok: ${klaim.error}` }
  }

  if (klaim.rows.length < jumlah) {
    // Kalah balapan dengan pembeli lain. Lepas yang sempat didapat.
    await d.releaseStok(klaim.rows.map((r) => r.id))
    return { ok: false, error: `stok keburu diambil pembeli lain (${klaim.rows.length}/${jumlah})` }
  }

  return {
    ok: true,
    lines: klaim.rows.map((s) => s.data),
    stokIds: klaim.rows.map((s) => s.id),
    supplierOrder: null,
  }
}

const REKON_PREFIX = 'perlu rekonsiliasi manual'

function perluRekonsiliasi(hasil) {
  return Boolean(hasil && hasil.ok === false && hasil.stopFailover)
}

// Timeout/5xx bisa berarti pesanan supplier sudah terbit. Refund otomatis
// di atas itu = pembeli dapat uang kembali sementara wallet penjual terpotong.
function harusRefund(hasil) {
  if (!hasil || hasil.ok) return false
  if (perluRekonsiliasi(hasil)) return false
  return true
}

function pesanHttp(e) {
  return e?.response?.status ? `HTTP ${e.response.status}` : (e?.message || 'error tidak dikenal')
}

// 4xx = penjual menolak (boleh pindah). Tanpa response / timeout / 5xx = tidak
// jelas apakah pesanan sudah terbit di sisi mereka.
function gagalAmbigu(e) {
  const status = Number(e?.response?.status)
  if (Number.isFinite(status) && status > 0) return status >= 500
  return true
}

function orderIdDariError(e) {
  const body = e?.response?.data
  if (!body || typeof body !== 'object') return null
  const id = body.orderId ?? body.order_id ?? body.id
    ?? (body.data && typeof body.data === 'object'
      ? (body.data.orderId ?? body.data.order_id ?? body.data.id)
      : null)
  if (id === null || id === undefined || String(id).trim() === '') return null
  return String(id)
}

function pesananBerhasil(balasan) {
  return Boolean(balasan?.ok && balasan.keys?.length)
}

// Beli dari penjual, lalu catat modal vs jual untuk jejak untung-rugi.
async function ambilDariSupplier({ offer, varian, jumlah, trxid, userId, hargaSatuan, d }) {
  const supplier = await d.getSupplier(offer.supplier_id)
  if (!supplier) return { ok: false, error: 'supplier tidak ditemukan' }
  if (supplier.is_active === false) return { ok: false, error: 'supplier nonaktif' }

  const key = idempotencyKey(trxid, offer, jumlah, userId)
  const args = { externalId: offer.external_id, quantity: jumlah, idempotencyKey: key }
  const jejak = { offer, varian, jumlah, trxid, userId, hargaSatuan, key, d }

  let balasan
  let kesalahanAmbigu = null
  let orderIdHint = null
  try {
    balasan = await d.createOrder(supplier, args)
  } catch (e) {
    if (!gagalAmbigu(e)) {
      const pesan = pesanHttp(e)
      await catatPesanan({ ...jejak, status: 'failed', error: pesan })
      return { ok: false, error: `${supplier.nama}: ${pesan}` }
    }
    kesalahanAmbigu = e
    orderIdHint = orderIdDariError(e)
    try {
      balasan = await d.createOrder(supplier, args)
    } catch (e2) {
      kesalahanAmbigu = e2
      orderIdHint = orderIdHint || orderIdDariError(e2)
      return rekonsiliasiAtauGetOrder({
        supplier, jejak, d, kesalahanAmbigu, orderIdHint,
      })
    }
  }

  if (pesananBerhasil(balasan)) {
    return catatSukses({ jejak, balasan })
  }

  // HTTP sukses tapi tanpa key: penjual menjawab, boleh pindah. Kalau kita
  // sampai sini lewat retry setelah kegagalan ambigu, pesanan mungkin sudah
  // terbit — selesaikan lewat getOrder dulu.
  if (kesalahanAmbigu) {
    return rekonsiliasiAtauGetOrder({
      supplier, jejak, d, kesalahanAmbigu,
      orderIdHint: orderIdHint || balasan?.orderId || null,
    })
  }

  const pesan = `tidak ada key terkirim (status ${balasan?.status || 'unknown'})`
  await catatPesanan({ ...jejak, status: 'failed', error: pesan, externalOrderId: balasan?.orderId })
  return { ok: false, error: `${supplier.nama}: ${pesan}` }
}

async function catatSukses({ jejak, balasan }) {
  const supplierOrder = await catatPesanan({
    ...jejak,
    status: 'ok',
    externalOrderId: balasan.orderId,
    delivered: balasan.keys,
  })
  return { ok: true, lines: balasan.keys, stokIds: [], supplierOrder }
}

async function rekonsiliasiAtauGetOrder({ supplier, jejak, d, kesalahanAmbigu, orderIdHint }) {
  if (orderIdHint && typeof d.getOrder === 'function') {
    try {
      const resolved = await d.getOrder(supplier, { orderId: orderIdHint })
      if (pesananBerhasil(resolved)) {
        return catatSukses({ jejak, balasan: resolved })
      }
    } catch (_) {
      // getOrder juga gelap — tetap rekonsiliasi, jangan pindah penjual.
    }
  }

  const pesan = `${REKON_PREFIX}: ${pesanHttp(kesalahanAmbigu)}`
  await catatPesanan({
    ...jejak,
    status: 'failed',
    error: pesan,
    externalOrderId: orderIdHint || null,
  })
  return { ok: false, error: `${supplier.nama}: ${pesan}`, stopFailover: true }
}

function catatPesanan({ offer, varian, jumlah, trxid, userId, hargaSatuan, key, d, status, error = null, externalOrderId = null, delivered = null }) {
  return d.recordSupplierOrder({
    supplier_id: offer.supplier_id,
    supplier_product_id: offer.supplier_product_id,
    varian_id: varian.id || null,
    trx_id: trxid,
    idempotency_key: key,
    external_order_id: externalOrderId,
    user_id: userId,
    quantity: jumlah,
    modal_asal: offer.harga_asal || 0,
    modal_currency: offer.currency || 'USD',
    jual_idr: Math.trunc(Number(hargaSatuan) || 0) * jumlah,
    status,
    error,
    delivered,
  })
}

// Dipanggil setelah saldo pembeli dikembalikan, supaya laporan tidak menghitung
// pesanan yang dibatalkan sebagai penjualan.
async function markRefunded(trxid, deps = {}) {
  const client = deps.supabase || supabase
  const { error } = await client
    .from('SupplierOrder')
    .update({ status: 'refunded', updated_at: new Date().toISOString() })
    .eq('trx_id', trxid)
    .not('error', 'like', `${REKON_PREFIX}%`)
  if (error) console.error('fulfillment.markRefunded:', error)
}

module.exports = {
  fulfill,
  markRefunded,
  harusRefund,
  perluRekonsiliasi,
  idempotencyKey,
  DEPS_DEFAULT,
  REKON_PREFIX,
}
