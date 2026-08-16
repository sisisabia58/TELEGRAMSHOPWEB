// lib/fulfillment.js — memenuhi satu pembelian dari sumber termurah yang bisa.
//
// Ini satu-satunya tempat "dari mana barangnya diambil" diputuskan saat uang
// pembeli sudah berpindah, jadi aturannya sengaja galak:
//
//   * Coba penawaran dari yang termurah. Kalau satu gagal (stok ternyata habis,
//     saldo dompet kurang, API penjual mati), TURUN ke penawaran berikutnya.
//     Pembeli tidak perlu tahu penjual mana yang bermasalah.
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
const { getAdapter } = require('./suppliers')

const DEPS_DEFAULT = {
  getOffers: (varian) => sourcing.getOffersForVarian(varian),
  rankOffers: (offers, qty) => sourcing.rankOffers(offers, qty),
  getStokForTransaction: (kode, jumlah) => stock.getStokForTransaction(kode, jumlah),
  markStokTerjual: (ids, trxid) => stock.markStokTerjual(ids, trxid),
  getSupplier: async (supplierId) => {
    const { data } = await supabase.from('Supplier').select('*').eq('id', supplierId).maybeSingle()
    return data || null
  },
  createOrder: async (supplier, args) => {
    const adapter = getAdapter(supplier.adapter)
    if (!adapter) throw new Error(`adapter "${supplier.adapter}" tidak dikenal`)
    return adapter.createOrder({ baseUrl: supplier.base_url, apiKey: supplier.api_key, ...args })
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

// Kunci idempotensi yang stabil. Diturunkan dari trxid + urutan percobaan,
// jadi menjalankan ulang pembelian yang sama menghasilkan kunci yang sama dan
// penjual mengembalikan pesanan lama alih-alih menjual dua kali.
function idempotencyKey(trxid, indeks) {
  return `${trxid}-${indeks}`
}

// Penuhi qty unit dari `varian`. Tidak pernah melempar.
//
// Mengembalikan:
//   { ok: true,  lines: string[], sumber, offer, supplierOrder, attempts }
//   { ok: false, error, attempts }   -> pemanggil WAJIB mengembalikan saldo
async function fulfill({ varian, qty = 1, trxid, userId = null, hargaSatuan = 0, deps = {} } = {}) {
  const d = { ...DEPS_DEFAULT, ...deps }
  const jumlah = Math.max(1, Math.trunc(Number(qty) || 1))
  const attempts = []

  if (!varian || !varian.kode) {
    return { ok: false, error: 'varian tidak valid', attempts }
  }

  let offers
  try {
    offers = await d.getOffers(varian)
  } catch (e) {
    return { ok: false, error: `gagal membaca sumber: ${e.message}`, attempts }
  }

  const urut = d.rankOffers(offers, jumlah)
  if (!urut.length) {
    return { ok: false, error: 'stok habis di semua sumber', attempts }
  }

  for (let i = 0; i < urut.length; i++) {
    const offer = urut[i]
    try {
      const hasil = offer.sumber === sourcing.SUPPLIER
        ? await ambilDariSupplier({ offer, varian, jumlah, trxid, userId, hargaSatuan, indeks: i, d })
        : await ambilDariStokSendiri({ offer, varian, jumlah, trxid, d })

      if (hasil.ok) {
        attempts.push({ sumber: offer.sumber, supplier_id: offer.supplier_id, ok: true })
        return { ...hasil, offer, sumber: offer.sumber, attempts }
      }
      attempts.push({ sumber: offer.sumber, supplier_id: offer.supplier_id, ok: false, error: hasil.error })
    } catch (e) {
      attempts.push({ sumber: offer.sumber, supplier_id: offer.supplier_id, ok: false, error: e.message })
    }
  }

  return {
    ok: false,
    error: attempts.map((a) => a.error).filter(Boolean).join('; ') || 'semua sumber gagal',
    attempts,
  }
}

// Jalur lama, tidak berubah: FIFO dari tabel "Stok" lalu tandai terjual.
async function ambilDariStokSendiri({ offer, varian, jumlah, trxid, d }) {
  const kode = String(varian.kode).toLowerCase()
  const items = await d.getStokForTransaction(kode, jumlah)

  if (!items || items.length < jumlah) {
    return { ok: false, error: `stok sendiri kurang (${items?.length || 0}/${jumlah})` }
  }

  const ids = items.map((s) => s.id)
  await d.markStokTerjual(ids, trxid)

  return {
    ok: true,
    lines: items.map((s) => s.data),
    stokIds: ids,
    supplierOrder: null,
  }
}

// Beli dari penjual, lalu catat modal vs jual untuk jejak untung-rugi.
async function ambilDariSupplier({ offer, varian, jumlah, trxid, userId, hargaSatuan, indeks, d }) {
  const supplier = await d.getSupplier(offer.supplier_id)
  if (!supplier) return { ok: false, error: 'supplier tidak ditemukan' }
  if (supplier.is_active === false) return { ok: false, error: 'supplier nonaktif' }

  const key = idempotencyKey(trxid, indeks)
  let balasan
  try {
    balasan = await d.createOrder(supplier, {
      externalId: offer.external_id,
      quantity: jumlah,
      idempotencyKey: key,
    })
  } catch (e) {
    const pesan = e.response?.status ? `HTTP ${e.response.status}` : e.message
    await catatPesanan({ offer, varian, jumlah, trxid, userId, hargaSatuan, key, d, status: 'failed', error: pesan })
    return { ok: false, error: `${supplier.nama}: ${pesan}` }
  }

  // Adapter sudah memperlakukan "tanpa key" sebagai gagal; pertahankan itu di
  // sini juga supaya pembeli tidak pernah dianggap terlayani tanpa isi.
  if (!balasan?.ok || !balasan.keys?.length) {
    const pesan = `tidak ada key terkirim (status ${balasan?.status || 'unknown'})`
    await catatPesanan({ offer, varian, jumlah, trxid, userId, hargaSatuan, key, d, status: 'failed', error: pesan, externalOrderId: balasan?.orderId })
    return { ok: false, error: `${supplier.nama}: ${pesan}` }
  }

  const supplierOrder = await catatPesanan({
    offer, varian, jumlah, trxid, userId, hargaSatuan, key, d,
    status: 'ok',
    externalOrderId: balasan.orderId,
    delivered: balasan.keys,
  })

  return { ok: true, lines: balasan.keys, stokIds: [], supplierOrder }
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
  if (error) console.error('fulfillment.markRefunded:', error)
}

module.exports = {
  fulfill,
  markRefunded,
  idempotencyKey,
  DEPS_DEFAULT,
}
