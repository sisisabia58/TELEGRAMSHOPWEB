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
}
