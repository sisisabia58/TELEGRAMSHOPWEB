// lib/sourcing.js — dari mana satu varian sebenarnya dipenuhi.
//
// Satu varian ("Netflix — 30 Hari") bisa punya beberapa sumber sekaligus:
// stok milik kita sendiri di tabel "Stok", plus penawaran dari berapa pun
// supplier yang menjual barang yang sama. Modul ini menyusun semuanya menjadi
// daftar penawaran seragam dan memilih yang termurah.
//
// STOK SENDIRI IKUT BERSAING. Ia bukan kasus istimewa: ia satu penawaran biasa
// yang dihargai Varian.harga. Kalau harga kita lebih murah, kita menang dan
// tidak ada panggilan ke supplier sama sekali — jalur pembelian lama berjalan
// persis seperti sebelumnya. Ini yang menjaga dua sumber stok lama tetap utuh.
//
// buildOffers dan pickBestOffer MURNI (tanpa I/O) supaya aturan uangnya bisa
// dites tuntas; pembungkus di bawahnya yang mengambil baris dari database.
const supabase = require('./supabase')
const stock = require('./stock')
const fx = require('./fx')

const SENDIRI = 'sendiri'
const SUPPLIER = 'supplier'

// MURNI. Susun semua penawaran untuk satu varian.
//
//   varian        : { id, kode, harga, sumber }
//   ownStokCount  : jumlah baris "Stok" berstatus tersedia
//   supplierRows  : baris "SupplierProduct" yang sudah tergabung dengan
//                   supplier-nya ({ ..., supplier: { id, nama, prioritas, is_active } })
//   pricing       : { rate, marginPersen, bufferPersen, roundTo }
//
// Penawaran yang harganya tidak bisa dihitung DIBUANG, bukan dianggap gratis —
// menjual seharga Rp 0 jauh lebih buruk daripada tidak menawarkan sama sekali.
function buildOffers({ varian, ownStokCount = 0, supplierRows = [], pricing = {} } = {}) {
  const offers = []

  // Varian yang dibuat oleh sync tidak punya stok sendiri yang bermakna;
  // harganya cuma cadangan tampilan, jadi jangan dijadikan penawaran.
  const punyaStokSendiri = varian && varian.sumber !== SUPPLIER && Number(ownStokCount) > 0
  if (punyaStokSendiri) {
    offers.push({
      sumber: SENDIRI,
      supplier_id: null,
      supplier_nama: null,
      supplier_product_id: null,
      external_id: null,
      varian_id: varian.id || null,
      harga_satuan: Math.max(0, Math.trunc(Number(varian.harga) || 0)),
      harga_asal: null,
      currency: 'IDR',
      stok: Math.trunc(Number(ownStokCount)),
      prioritas: 0, // tidak dipakai untuk stok sendiri; lihat sortOffers
    })
  }

  for (const row of supplierRows || []) {
    if (!row) continue
    if (row.is_available === false) continue
    if (row.in_stock === false) continue
    const supplier = row.supplier || {}
    if (supplier.is_active === false) continue

    const stok = Math.max(0, Math.trunc(Number(row.stok) || 0))
    if (stok <= 0) continue

    const harga = fx.computeIdrPrice(row.harga_asal, pricing)
    if (harga === null) continue

    offers.push({
      sumber: SUPPLIER,
      supplier_id: row.supplier_id || supplier.id || null,
      supplier_nama: supplier.nama || null,
      supplier_product_id: row.id || null,
      external_id: row.external_id || null,
      varian_id: row.varian_id || null,
      harga_satuan: harga,
      harga_asal: Number(row.harga_asal) || 0,
      currency: String(row.currency || 'USD').toUpperCase(),
      stok,
      prioritas: Number.isFinite(Number(supplier.prioritas)) ? Number(supplier.prioritas) : 0,
    })
  }

  return offers
}

// MURNI. Urutkan termurah dulu.
//
// Penyeri saat harga sama persis:
//   1. stok sendiri selalu menang — tanpa modal, tanpa risiko API pihak ketiga,
//      dan barangnya sudah ada di tangan. Ini di ATAS prioritas supplier supaya
//      angka prioritas serendah apa pun tidak bisa merebut penjualan dari stok
//      kita sendiri.
//   2. prioritas supplier (kecil menang)
//   3. stok terbanyak, supaya pembelian besar tidak selalu jatuh ke penawaran tipis
function sortOffers(offers) {
  return [...(offers || [])].sort((a, b) => {
    if (a.harga_satuan !== b.harga_satuan) return a.harga_satuan - b.harga_satuan
    const aSendiri = a.sumber === SENDIRI ? 0 : 1
    const bSendiri = b.sumber === SENDIRI ? 0 : 1
    if (aSendiri !== bSendiri) return aSendiri - bSendiri
    if (a.prioritas !== b.prioritas) return a.prioritas - b.prioritas
    return b.stok - a.stok
  })
}

// MURNI. Penawaran termurah yang benar-benar bisa memenuhi qty.
function pickBestOffer(offers, qty = 1) {
  const q = Math.max(1, Math.trunc(Number(qty) || 1))
  const layak = (offers || []).filter((o) => o && o.stok >= q)
  if (!layak.length) return null
  return sortOffers(layak)[0]
}

// MURNI. Daftar penawaran yang layak, termurah dulu — dipakai fulfillment untuk
// mundur ke penawaran berikutnya saat satu penjual gagal.
function rankOffers(offers, qty = 1) {
  const q = Math.max(1, Math.trunc(Number(qty) || 1))
  return sortOffers((offers || []).filter((o) => o && o.stok >= q))
}

// MURNI. Ringkasan untuk layar bot dan dashboard: harga efektif = penawaran
// termurah untuk 1 unit, stok = gabungan semua sumber.
function summarize(offers) {
  const daftar = offers || []
  const totalStok = daftar.reduce((n, o) => n + (Number(o.stok) || 0), 0)
  const terbaik = pickBestOffer(daftar, 1)
  return {
    harga_efektif: terbaik ? terbaik.harga_satuan : null,
    stok_total: totalStok,
    sumber_terbaik: terbaik ? terbaik.sumber : null,
    punya_supplier: daftar.some((o) => o.sumber === SUPPLIER),
  }
}

// ---------------------------------------------------------------------------
// Pembungkus yang menyentuh database
// ---------------------------------------------------------------------------

// Baris SupplierProduct yang tersedia untuk sekumpulan varian, sekali query
// (mengikuti pola batch stock.getStokCountsByKode supaya layar daftar tidak
// berubah jadi N+1).
async function fetchSupplierRowsForVarianIds(varianIds) {
  const hasil = Object.create(null)
  const ids = [...new Set((varianIds || []).filter(Boolean))]
  if (!ids.length) return hasil

  const { data, error } = await supabase
    .from('SupplierProduct')
    .select('*, supplier:Supplier(id, nama, prioritas, is_active)')
    .in('varian_id', ids)
    .eq('is_available', true)

  if (error) {
    // Supplier tidak boleh menjatuhkan katalog: tanpa baris supplier, semuanya
    // kembali ke perilaku stok-sendiri yang lama.
    console.error('sourcing.fetchSupplierRowsForVarianIds:', error)
    return hasil
  }

  for (const row of data || []) {
    if (!row.varian_id) continue
    if (!hasil[row.varian_id]) hasil[row.varian_id] = []
    hasil[row.varian_id].push(row)
  }
  return hasil
}

// Semua penawaran untuk satu varian, siap dipakai checkout.
async function getOffersForVarian(varian) {
  if (!varian) return []
  const [ownStokCount, byVarian] = await Promise.all([
    varian.sumber === SUPPLIER ? Promise.resolve(0) : stock.getStokCountByKode(varian.kode),
    fetchSupplierRowsForVarianIds([varian.id]),
  ])
  return buildOffers({
    varian,
    ownStokCount,
    supplierRows: byVarian[varian.id] || [],
    pricing: fx.getPricingConfig(),
  })
}

// Versi batch untuk layar daftar. `variants` butuh { id, kode, harga, sumber }.
// Mengembalikan { [varianId]: ringkasan } supaya pemanggil bisa menempelkan
// harga_efektif dan stok tanpa query tambahan per baris.
async function summarizeVariants(variants) {
  const daftar = (variants || []).filter(Boolean)
  const hasil = Object.create(null)
  if (!daftar.length) return hasil

  const kodes = daftar.filter((v) => v.sumber !== SUPPLIER).map((v) => v.kode)
  const [ownCounts, supplierByVarian] = await Promise.all([
    stock.getStokCountsByKode(kodes),
    fetchSupplierRowsForVarianIds(daftar.map((v) => v.id)),
  ])

  const pricing = fx.getPricingConfig()
  for (const v of daftar) {
    const offers = buildOffers({
      varian: v,
      ownStokCount: ownCounts[String(v.kode).toLowerCase()] || 0,
      supplierRows: supplierByVarian[v.id] || [],
      pricing,
    })
    hasil[v.id] = { ...summarize(offers), offers }
  }
  return hasil
}

module.exports = {
  SENDIRI,
  SUPPLIER,
  buildOffers,
  sortOffers,
  pickBestOffer,
  rankOffers,
  summarize,
  fetchSupplierRowsForVarianIds,
  getOffersForVarian,
  summarizeVariants,
}
