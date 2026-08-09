// Katalog produk + varian — satu sumber untuk bot dan dashboard.
const supabase = require('./supabase')
const stock = require('./stock')

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

async function attachStock(variants) {
  const kodes = variants.map((v) => v.kode)
  const counts = await stock.getStokCountsByKode(kodes)
  return variants.map((v) => ({
    ...v,
    stok_count: counts[String(v.kode).toLowerCase()] || 0,
  }))
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
  listProducts,
  getProductBySlug,
  getProductById,
  getVariantByKode,
  variantCount,
  totalStock,
}
