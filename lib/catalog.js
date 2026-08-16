// Katalog produk + varian — satu sumber untuk bot dan dashboard.
const supabase = require('./supabase')
const stock = require('./stock')
const sourcing = require('./sourcing')

function slugify(nama) {
  return String(nama || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function shouldSkipVariantPicker(variants) {
  const active = (variants || []).filter((v) => v && v.is_active !== false)
  return active.length === 1
}

async function fetchVariantsForProdukIds(produkIds, { activeOnly = false } = {}) {
  if (!produkIds.length) return []
  let q = supabase.from('Varian').select('*').in('produk_id', produkIds).order('urutan', { ascending: true })
  if (activeOnly) q = q.eq('is_active', true)
  const { data, error } = await q
  if (error) {
    console.error('catalog.fetchVariants:', error)
    return []
  }
  return data || []
}

// Titik tunggal tempat "berapa stoknya" dan "berapa harganya" dijawab.
//
// Setiap pembacaan produk di bot maupun dashboard lewat sini, jadi menambahkan
// kesadaran supplier di satu fungsi ini membuat seluruh permukaan ikut sadar
// tanpa menyentuh puluhan layar.
//
// Yang ditempelkan ke tiap varian:
//   stok_count    – stok sendiri + stok semua supplier yang memetakan ke varian ini
//   stok_sendiri  – khusus baris tabel "Stok" milik kita
//   harga_efektif – penawaran termurah yang benar-benar tersedia (null kalau habis)
//   sumber_terbaik– 'sendiri' | 'supplier' | null
//   punya_supplier– apakah varian ini punya penawaran supplier sama sekali
//
// Varian tanpa penawaran supplier keluar dengan harga_efektif = Varian.harga dan
// stok_count = hitungan lama, jadi perilakunya identik dengan sebelum fase ini.
async function attachStock(variants) {
  const daftar = variants || []
  if (!daftar.length) return []

  let ringkasan = null
  try {
    ringkasan = await sourcing.summarizeVariants(daftar)
  } catch (e) {
    // Supplier tidak boleh menjatuhkan katalog: kalau lapisan sourcing gagal,
    // jatuh kembali ke perhitungan stok-sendiri yang lama.
    console.error('catalog.attachStock (sourcing):', e)
  }

  if (!ringkasan) {
    const counts = await stock.getStokCountsByKode(daftar.map((v) => v.kode))
    return daftar.map((v) => {
      const n = counts[String(v.kode).toLowerCase()] || 0
      return {
        ...v,
        stok_count: n,
        stok_sendiri: n,
        offers: n > 0
          ? [{ sumber: sourcing.SENDIRI, harga_satuan: Number(v.harga) || 0, stok: n, prioritas: 0, varian_id: v.id }]
          : [],
        harga_efektif: n > 0 ? v.harga : null,
        sumber_terbaik: n > 0 ? 'sendiri' : null,
        punya_supplier: false,
      }
    })
  }

  return daftar.map((v) => {
    const r = ringkasan[v.id] || {}
    const offers = r.offers || []
    const stokSendiri = offers
      .filter((o) => o.sumber === sourcing.SENDIRI)
      .reduce((n, o) => n + o.stok, 0)
    return {
      ...v,
      stok_count: r.stok_total || 0,
      stok_sendiri: stokSendiri,
      // Daftar penawaran ikut dibawa supaya pemanggil bisa menghitung ulang
      // untuk jumlah tertentu. harga_efektif hanya berlaku untuk 1 unit: pada
      // qty besar, sumber termurah bisa BERBEDA karena stok yang murah tidak
      // cukup. Lihat hargaUntukQty() di index.js.
      offers,
      // Kalau semua sumber habis, harga_efektif null dan pemanggil jatuh ke
      // Varian.harga — layar "habis" tetap menampilkan angka, bukan kosong.
      harga_efektif: r.harga_efektif ?? null,
      sumber_terbaik: r.sumber_terbaik || null,
      punya_supplier: Boolean(r.punya_supplier),
    }
  })
}

// Harga yang harus DITAMPILKAN dan DITAGIH untuk satu varian. Semua layar bot
// dan dashboard memanggil ini alih-alih membaca v.harga langsung, supaya varian
// yang dipasok supplier tidak pernah menampilkan harga cadangannya.
function hargaVarian(varian) {
  if (!varian) return 0
  const efektif = varian.harga_efektif
  if (efektif !== null && efektif !== undefined) return efektif
  return Number(varian.harga) || 0
}

async function listProducts({ kategori, activeOnly = true, withStock = true } = {}) {
  let q = supabase.from('Produk').select('*').order('urutan', { ascending: true })
  if (activeOnly) q = q.eq('is_active', true)
  if (kategori) q = q.eq('kategori', kategori)
  const { data: products, error } = await q
  if (error) {
    console.error('catalog.listProducts:', error)
    return []
  }
  const list = products || []
  const variants = await fetchVariantsForProdukIds(list.map((p) => p.id), { activeOnly })
  let variantsWithStock = variants
  if (withStock) {
    variantsWithStock = await attachStock(variants)
  } else {
    variantsWithStock = variants.map((v) => ({ ...v, stok_count: 0 }))
  }
  const byProduk = Object.create(null)
  for (const v of variantsWithStock) {
    if (!byProduk[v.produk_id]) byProduk[v.produk_id] = []
    byProduk[v.produk_id].push(v)
  }
  return list.map((p) => ({ ...p, variants: byProduk[p.id] || [] }))
}

async function getProductBySlug(slug) {
  const { data, error } = await supabase.from('Produk').select('*').eq('slug', slug).maybeSingle()
  if (error || !data) return null
  let variants = await fetchVariantsForProdukIds([data.id])
  variants = await attachStock(variants)
  return { ...data, variants }
}

async function getProductById(id) {
  const { data, error } = await supabase.from('Produk').select('*').eq('id', id).maybeSingle()
  if (error || !data) return null
  let variants = await fetchVariantsForProdukIds([data.id])
  variants = await attachStock(variants)
  return { ...data, variants }
}

async function getVariantByKode(kode) {
  if (!kode) return null
  const normalized = String(kode).toLowerCase()
  const { data, error } = await supabase
    .from('Varian')
    .select('*, produk:Produk(*)')
    .eq('kode', normalized)
    .maybeSingle()
  if (error) {
    console.error('catalog.getVariantByKode:', error)
    return null
  }
  if (!data) {
    const { data: rows, error: err2 } = await supabase
      .from('Varian')
      .select('*, produk:Produk(*)')
      .ilike('kode', normalized)
    if (err2 || !rows?.length) return null
    const row = rows[0]
    const { produk, ...varian } = row
    return { ...varian, produk: produk || null }
  }
  const { produk, ...varian } = data
  return { ...varian, produk: produk || null }
}

async function variantCount(produkId) {
  const { count, error } = await supabase
    .from('Varian')
    .select('*', { count: 'exact', head: true })
    .eq('produk_id', produkId)
  if (error) return 0
  return count || 0
}

async function totalStock(produkId) {
  const variants = await fetchVariantsForProdukIds([produkId], { activeOnly: true })
  if (!variants.length) return 0
  const withStock = await attachStock(variants)
  return withStock.reduce((sum, v) => sum + (v.stok_count || 0), 0)
}

module.exports = {
  slugify,
  shouldSkipVariantPicker,
  attachStock,
  hargaVarian,
  listProducts,
  getProductBySlug,
  getProductById,
  getVariantByKode,
  variantCount,
  totalStock,
}
