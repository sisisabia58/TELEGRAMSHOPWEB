// Akses tabel "Stok" — satu sumber untuk bot dan dashboard.
// Kolom: varian_id + varian_kode (kode varian = unit yang dibeli).
const supabase = require('./supabase')

const TERSEDIA = 'tersedia'

async function getStokCountByKode(kode) {
  if (!kode) return 0
  try {
    const { count, error } = await supabase
      .from('Stok')
      .select('*', { count: 'exact', head: true })
      .eq('varian_kode', String(kode).toLowerCase())
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

async function getStokCountByVarianId(varianId) {
  if (!varianId) return 0
  try {
    const { count, error } = await supabase
      .from('Stok')
      .select('*', { count: 'exact', head: true })
      .eq('varian_id', varianId)
      .eq('status', TERSEDIA)

    if (error) {
      console.error('Error getStokCountByVarianId:', error)
      return 0
    }
    return count || 0
  } catch (error) {
    console.error('Error getStokCountByVarianId:', error)
    return 0
  }
}

async function getStokCountsByKode(kodeList) {
  const hasil = Object.create(null)
  const kodes = [...new Set((kodeList || []).filter(Boolean).map((k) => String(k).toLowerCase()))]
  for (const k of kodes) hasil[k] = 0
  if (kodes.length === 0) return hasil

  try {
    const { data, error } = await supabase
      .from('Stok')
      .select('varian_kode')
      .in('varian_kode', kodes)
      .eq('status', TERSEDIA)

    if (error) {
      console.error('Error getStokCountsByKode:', error)
      return hasil
    }
    for (const row of data || []) {
      const k = String(row.varian_kode).toLowerCase()
      hasil[k] = (hasil[k] || 0) + 1
    }
    return hasil
  } catch (error) {
    console.error('Error getStokCountsByKode:', error)
    return hasil
  }
}

async function getStokForTransaction(kode, jumlah) {
  try {
    const { data, error } = await supabase
      .from('Stok')
      .select('id, data')
      .eq('varian_kode', String(kode).toLowerCase())
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

async function getStokItems(kode, limit = null) {
  try {
    let query = supabase
      .from('Stok')
      .select('id, data, status, created_at, terjual_at, trx_id, varian_id, varian_kode')
      .eq('varian_kode', String(kode).toLowerCase())
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

// Klaim baris stok secara ATOMIK.
//
// markStokTerjual() menandai baris tanpa memeriksa statusnya dan menelan error,
// jadi dua pembeli yang menekan tombol bersamaan bisa sama-sama "berhasil"
// membeli baris yang sama, dan kegagalan update tidak terlihat sama sekali.
//
// Di sini syarat status='tersedia' ikut masuk ke dalam UPDATE, sehingga
// Postgres yang menentukan pemenangnya: hanya baris yang MASIH tersedia yang
// berubah, dan .select() mengembalikan persis baris yang benar-benar kita
// menangkan. Pemanggil membandingkan jumlahnya dengan yang diminta.
//
// Mengembalikan { ok, rows, error }.
async function claimStok(stokIds, trxid) {
  const ids = [...new Set((stokIds || []).filter(Boolean))]
  if (!ids.length) return { ok: false, rows: [], error: 'tidak ada stok untuk diklaim' }

  try {
    const { data, error } = await supabase
      .from('Stok')
      .update({
        status: 'terjual',
        terjual_at: new Date().toISOString(),
        trx_id: trxid,
      })
      .in('id', ids)
      .eq('status', TERSEDIA) // <- inilah yang membuatnya atomik
      .select('id, data')

    if (error) return { ok: false, rows: [], error: error.message }
    return { ok: true, rows: data || [] }
  } catch (error) {
    return { ok: false, rows: [], error: error.message }
  }
}

// Kembalikan baris yang terlanjur diklaim ke status tersedia. Dipakai kalau
// klaim hanya berhasil sebagian: lebih baik melepas yang sudah didapat daripada
// mengunci stok yang tidak jadi terjual.
async function releaseStok(stokIds) {
  const ids = [...new Set((stokIds || []).filter(Boolean))]
  if (!ids.length) return
  try {
    const { error } = await supabase
      .from('Stok')
      .update({ status: TERSEDIA, terjual_at: null, trx_id: null })
      .in('id', ids)
    if (error) console.error('Error releaseStok:', error)
  } catch (error) {
    console.error('Error releaseStok:', error)
  }
}

async function markStokTerjual(stokIds, trxid) {
  try {
    if (!stokIds || stokIds.length === 0) return

    const { error } = await supabase
      .from('Stok')
      .update({
        status: 'terjual',
        terjual_at: new Date().toISOString(),
        trx_id: trxid,
      })
      .in('id', stokIds)

    if (error) console.error('Error markStokTerjual:', error)
  } catch (error) {
    console.error('Error markStokTerjual:', error)
  }
}

module.exports = {
  getStokCountByKode,
  getStokCountByVarianId,
  getStokCountsByKode,
  getStokForTransaction,
  getStokItems,
  markStokTerjual,
  claimStok,
  releaseStok,
}
