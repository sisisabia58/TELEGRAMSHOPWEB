// Akses tabel "Stok" — satu sumber untuk bot dan dashboard.
//
// PENTING — kenapa modul ini ada:
// Sebelumnya ada DUA fungsi bernama getStokCount dengan arti berbeda:
//   - index.js     : getStokCount(kode)     -> filter kolom produk_kode
//   - dashboard.js : getStokCount(produkId) -> filter kolom produk_id
// Nama sama, parameter beda, kolom beda. Akibatnya bot dan dashboard bisa
// melaporkan jumlah stok yang berbeda untuk produk yang sama, dan memanggil
// yang salah tidak menimbulkan error — hanya angka 0 yang menyesatkan.
//
// Karena itu nama di sini dibuat eksplisit menyebut kunci yang dipakai.
const supabase = require('./supabase')

const TERSEDIA = 'tersedia'

// Jumlah stok tersedia berdasarkan kode produk (dipakai bot).
async function getStokCountByKode(kode) {
  if (!kode) return 0
  try {
    const { count, error } = await supabase
      .from('Stok')
      .select('*', { count: 'exact', head: true })
      .eq('produk_kode', String(kode).toLowerCase())
      .eq('status', TERSEDIA)

    if (error) {
      console.error('Error getStokCountByKode:', error)
      return 0
    }
    return count || 0
  } catch (error) {
    console.error('Error getStokCountByKode:', error)
    return 0
  }
}

// Jumlah stok tersedia berdasarkan id produk (dipakai dashboard).
async function getStokCountByProdukId(produkId) {
  if (!produkId) return 0
  try {
    const { count, error } = await supabase
      .from('Stok')
      .select('*', { count: 'exact', head: true })
      .eq('produk_id', produkId)
      .eq('status', TERSEDIA)

    if (error) {
      console.error('Error getStokCountByProdukId:', error)
      return 0
    }
    return count || 0
  } catch (error) {
    console.error('Error getStokCountByProdukId:', error)
    return 0
  }
}

// Hitung stok tersedia untuk banyak kode sekaligus.
// Menghindari pola N+1 (satu query per produk di dalam loop).
// Mengembalikan objek { [kode]: jumlah }, termasuk 0 untuk kode tanpa stok.
async function getStokCountsByKode(kodeList) {
  const hasil = Object.create(null)
  const kodes = [...new Set((kodeList || []).filter(Boolean).map((k) => String(k).toLowerCase()))]
  for (const k of kodes) hasil[k] = 0
  if (kodes.length === 0) return hasil

  try {
    const { data, error } = await supabase
      .from('Stok')
      .select('produk_kode')
      .in('produk_kode', kodes)
      .eq('status', TERSEDIA)

    if (error) {
      console.error('Error getStokCountsByKode:', error)
      return hasil
    }
    for (const row of data || []) {
      const k = String(row.produk_kode).toLowerCase()
      hasil[k] = (hasil[k] || 0) + 1
    }
    return hasil
  } catch (error) {
    console.error('Error getStokCountsByKode:', error)
    return hasil
  }
}

// Ambil stok untuk transaksi (FIFO — yang paling lama masuk dipakai dulu).
async function getStokForTransaction(kode, jumlah) {
  try {
    const { data, error } = await supabase
      .from('Stok')
      .select('id, data')
      .eq('produk_kode', String(kode).toLowerCase())
      .eq('status', TERSEDIA)
      .limit(jumlah)
      .order('created_at', { ascending: true })

    if (error) {
      console.error('Error getStokForTransaction:', error)
      return []
    }
    return data || []
  } catch (error) {
    console.error('Error getStokForTransaction:', error)
    return []
  }
}

// Semua item stok untuk satu kode produk (semua status), urut terlama.
async function getStokItems(kode, limit = null) {
  try {
    let query = supabase
      .from('Stok')
      .select('id, data, status, created_at, terjual_at, trx_id')
      .eq('produk_kode', String(kode).toLowerCase())
      .order('created_at', { ascending: true })

    if (limit) query = query.limit(limit)

    const { data, error } = await query

    if (error) {
      console.error('Error getStokItems:', error)
      return []
    }
    return data || []
  } catch (error) {
    console.error('Error getStokItems:', error)
    return []
  }
}

// Tandai stok sebagai terjual dan kaitkan ke transaksi.
async function markStokTerjual(stokIds, trxid) {
  try {
    if (!stokIds || stokIds.length === 0) return

    const { error } = await supabase
      .from('Stok')
      .update({
        status: 'terjual',
        terjual_at: new Date().toISOString(),
        trx_id: trxid
      })
      .in('id', stokIds)

    if (error) console.error('Error markStokTerjual:', error)
  } catch (error) {
    console.error('Error markStokTerjual:', error)
  }
}

module.exports = {
  getStokCountByKode,
  getStokCountByProdukId,
  getStokCountsByKode,
  getStokForTransaction,
  getStokItems,
  markStokTerjual
}
