// Aturan murni untuk alur beli di bot:
//   daftar produk → durasi (stok gabungan) → penjual (harga masing-masing) → jumlah.
//
// Tidak menyentuh Telegram atau database supaya bisa dites tanpa bot.
// Stok di daftar produk dijumlah dari varian. Angka stok_count di baris Produk
// (sisa pencarian Produk.kode yang sudah tidak ada) tidak boleh menutupi stok varian.

const SENDIRI = 'sendiri'
const SUPPLIER = 'supplier'
const OWN_LABEL = 'Stok sendiri'

function offersInStock(offers) {
  return (offers || []).filter((o) => o && Math.trunc(Number(o.stok) || 0) > 0)
}

function combinedStock(offers) {
  return offersInStock(offers).reduce((n, o) => n + Math.trunc(Number(o.stok) || 0), 0)
}

function variantDisplayedStock(variant) {
  if (!variant || variant.is_active === false) return 0
  if (Array.isArray(variant.offers) && variant.offers.length) return combinedStock(variant.offers)
  return Math.max(0, Math.trunc(Number(variant.stok_count) || 0))
}

function hasAttachedVariants(products) {
  return (products || []).some((p) => Array.isArray(p && p.variants) && p.variants.length > 0)
}

function productDisplayedStock(product) {
  if (!product) return 0
  if (Array.isArray(product.variants) && product.variants.length) {
    return product.variants.reduce((n, v) => n + variantDisplayedStock(v), 0)
  }
  return Math.max(0, Math.trunc(Number(product.stok_count) || 0))
}

function plainLabel(value, fallback = 'Seller') {
  const cleaned = String(value || '').replace(/[*_`[\]]/g, '').trim()
  return cleaned || fallback
}

function sellerOptions(offers) {
  const rows = offersInStock(offers).map((o) => ({
    sumber: o.sumber === SUPPLIER ? SUPPLIER : SENDIRI,
    supplier_id: o.supplier_id || null,
    supplier_product_id: o.sumber === SUPPLIER ? (o.supplier_product_id || null) : null,
    harga_satuan: Math.max(0, Math.trunc(Number(o.harga_satuan) || 0)),
    stok: Math.trunc(Number(o.stok) || 0),
  }))
  // Termurah = Opsi 1. Nama supplier tidak disalin ke label. Harga sama:
  // stok lebih banyak, lalu stok sendiri, lalu id, supaya urutannya stabil.
  rows.sort((a, b) => {
    if (a.harga_satuan !== b.harga_satuan) return a.harga_satuan - b.harga_satuan
    if (a.stok !== b.stok) return b.stok - a.stok
    if (a.sumber !== b.sumber) return a.sumber === SENDIRI ? -1 : 1
    return String(a.supplier_product_id || '').localeCompare(String(b.supplier_product_id || ''))
  })
  return rows.map((row, i) => ({ ...row, label: `Opsi ${i + 1}` }))
}

function needsSellerPicker(offers) {
  return sellerOptions(offers).length > 1
}

function samePin(option, pin) {
  if (!option || !pin) return false
  if (pin.sumber === SENDIRI) return option.sumber !== SUPPLIER
  if (pin.sumber === SUPPLIER) {
    return option.sumber === SUPPLIER
      && String(option.supplier_product_id || '') === String(pin.supplier_product_id || '')
  }
  return false
}

// Label netral untuk opsi yang sedang dipilih. null kalau belum dipilih dan
// masih ada lebih dari satu penjual.
function optionForPin(offers, pin) {
  const options = sellerOptions(offers)
  if (!pin) return options.length === 1 ? options[0] : null
  return options.find((option) => samePin(option, pin)) || null
}

function buyerProductName(nama, opsiLabel) {
  const base = String(nama || 'Produk')
  if (!opsiLabel) return base
  return `${base} (${opsiLabel})`
}

function pinFromOption(option) {
  if (!option) return null
  if (option.sumber === SUPPLIER) {
    return { sumber: SUPPLIER, supplier_product_id: option.supplier_product_id || null }
  }
  return { sumber: SENDIRI, supplier_product_id: null }
}

function sellerCallbackData(option) {
  if (option && option.sumber === SUPPLIER && option.supplier_product_id) {
    return `src:${option.supplier_product_id}`
  }
  return 'src:own'
}

function pinFromCallback(data) {
  if (data === 'src:own') return { sumber: SENDIRI, supplier_product_id: null }
  if (typeof data === 'string' && /^src:[0-9a-f-]{36}$/i.test(data)) {
    return { sumber: SUPPLIER, supplier_product_id: data.slice(4) }
  }
  return null
}

function offerMatchesPin(offer, pin) {
  if (!offer || !pin) return false
  if (pin.sumber === SENDIRI) return offer.sumber !== SUPPLIER
  if (pin.sumber === SUPPLIER) {
    return offer.sumber === SUPPLIER
      && String(offer.supplier_product_id || '') === String(pin.supplier_product_id || '')
  }
  return false
}

function applyPin(variant, pin) {
  if (!variant || !pin) return variant
  const match = (variant.offers || []).filter((o) => offerMatchesPin(o, pin) && Math.trunc(Number(o.stok) || 0) > 0)
  const stok = match.reduce((n, o) => n + Math.trunc(Number(o.stok) || 0), 0)
  const stokSendiri = match
    .filter((o) => o.sumber !== SUPPLIER)
    .reduce((n, o) => n + Math.trunc(Number(o.stok) || 0), 0)
  const harga = match.length
    ? Math.min(...match.map((o) => Math.trunc(Number(o.harga_satuan) || 0)))
    : null
  return {
    ...variant,
    offers: match,
    stok_count: stok,
    stok_sendiri: stokSendiri,
    harga_efektif: stok > 0 ? harga : null,
    sumber_terbaik: match[0] ? (match[0].sumber === SUPPLIER ? SUPPLIER : SENDIRI) : null,
    punya_supplier: match.some((o) => o.sumber === SUPPLIER),
  }
}

function durationLine(variant, formatPrice) {
  const fmt = typeof formatPrice === 'function' ? formatPrice : (n) => String(n)
  const stock = variantDisplayedStock(variant)
  const options = sellerOptions(variant && variant.offers)
  const label = plainLabel(variant && variant.label, 'Varian')
  const priceText = (n) => (Number.isFinite(Number(n)) ? fmt(Number(n)) : '—')
  if (stock <= 0) {
    const fallback = variant && variant.harga_efektif != null ? variant.harga_efektif : (variant && variant.harga)
    return { inStock: false, stock: 0, text: `~${label}~ - ${priceText(fallback)} _(Habis)_` }
  }
  if (options.length > 1) {
    const min = Math.min(...options.map((o) => o.harga_satuan))
    return { inStock: true, stock, text: `*${label}* — Stok ${stock} (mulai ${priceText(min)})` }
  }
  const price = options.length === 1
    ? options[0].harga_satuan
    : (variant && variant.harga_efektif != null ? variant.harga_efektif : variant && variant.harga)
  return { inStock: true, stock, text: `*${label}* - ${priceText(price)} (Stok ${stock})` }
}

function buyerStockFacts(product) {
  const variants = ((product && product.variants) || []).filter((v) => v && v.is_active !== false)
  const prices = []
  for (const v of variants) {
    const raw = v.harga_efektif != null ? v.harga_efektif : v.harga
    const n = Number(raw)
    if (Number.isFinite(n)) prices.push(n)
  }
  return {
    stok: variants.reduce((n, v) => n + variantDisplayedStock(v), 0),
    terjual: variants.reduce((n, v) => n + (Number(v.terjual) || 0), 0),
    minHarga: prices.length ? Math.min(...prices) : null,
    maxHarga: prices.length ? Math.max(...prices) : null,
    slug: (product && product.slug) || '',
    nama: (product && product.nama) || '',
  }
}

function formatHargaRange(min, max, formatPrice) {
  const fmt = typeof formatPrice === 'function' ? formatPrice : (n) => String(n)
  if (min == null || !Number.isFinite(Number(min))) return '—'
  if (max == null || Number(min) === Number(max)) return fmt(Number(min))
  return `${fmt(Number(min))} – ${fmt(Number(max))}`
}

function parseProductNumber(text) {
  const m = String(text || '').trim().match(/^(\d{1,4})$/)
  if (!m) return null
  const n = Number(m[1])
  if (!Number.isInteger(n) || n < 1) return null
  return n
}

function normalizeName(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

function matchProductQuery(products, text) {
  const list = Array.isArray(products) ? products : []
  const raw = String(text || '').trim()
  if (!raw) return null
  const n = parseProductNumber(raw)
  if (n) {
    if (!list.length || n > list.length) {
      return { product: null, index: n, outOfRange: true, total: list.length }
    }
    return { product: list[n - 1], index: n }
  }
  const q = normalizeName(raw)
  if (!q || q.length < 2) return null
  const exact = []
  const partial = []
  list.forEach((p, i) => {
    const name = normalizeName(p && p.nama)
    if (!name) return
    const row = { product: p, index: i + 1 }
    if (name === q) exact.push(row)
    else if (q.length >= 3 && (name.includes(q) || (name.length >= 3 && q.includes(name)))) partial.push(row)
  })
  if (exact.length === 1) return exact[0]
  if (exact.length > 1) return { product: null, ambiguous: exact }
  if (partial.length === 1) return partial[0]
  if (partial.length > 1) return { product: null, ambiguous: partial }
  return null
}

module.exports = {
  SENDIRI,
  SUPPLIER,
  OWN_LABEL,
  offersInStock,
  combinedStock,
  variantDisplayedStock,
  hasAttachedVariants,
  productDisplayedStock,
  plainLabel,
  sellerOptions,
  needsSellerPicker,
  optionForPin,
  buyerProductName,
  pinFromOption,
  sellerCallbackData,
  pinFromCallback,
  offerMatchesPin,
  applyPin,
  durationLine,
  buyerStockFacts,
  formatHargaRange,
  parseProductNumber,
  matchProductQuery,
}
