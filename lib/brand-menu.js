// Menu brand ala Byte Shop: tombol brand (A–Z, 2 per baris) lalu satu baris
// per item yang bisa dijual. Murni — tidak menyentuh Telegram atau database.
const purchaseFlow = require('./purchase-flow')

const BRANDS_PER_PAGE = 20
const ITEMS_PER_PAGE = 8
const BUTTON_MAX = 64

// Tidak ada jenis pengiriman per produk di kode. Setelah bayar, isi pesanan
// dikirim di chat (lihat pesan selesai di index.js dan screen.cara_order).
const DELIVERY_DEFAULT = 'Langsung di chat'

function warrantyFromLabel(label) {
  const match = String(label || '').match(/\((FW|PW|NW)\)\s*$/i)
  if (!match) return 'Klaim garansi lewat admin'
  const tag = match[1].toUpperCase()
  if (tag === 'FW') return 'Full warranty — klaim lewat admin'
  if (tag === 'PW') return 'Partial warranty — klaim lewat admin'
  return 'No warranty'
}

function detailLines({ garansi, stok, harga, pengiriman } = {}) {
  return [
    `Warranty: ${garansi || ''}`,
    `Stock: ${stok == null ? '' : stok}`,
    `Price: ${harga || ''}`,
    `Delivery: ${pengiriman || DELIVERY_DEFAULT}`,
  ].join('\n')
}

function appendDetailLines(caption, lines) {
  const body = String(caption || '').replace(/\s+$/, '')
  const block = String(lines || '').trim()
  if (!block) return body
  if (body.includes(block)) return body
  return body ? `${body}\n\n${block}` : block
}

function brandKey(name) {
  const key = String(name || 'Umum').trim().toLocaleLowerCase('id')
  return key || 'umum'
}

function listBrands(products) {
  const map = new Map()
  for (const product of products || []) {
    if (!product || product.is_active === false) continue
    const variants = (product.variants || []).filter((v) => v && v.is_active !== false)
    if (!variants.length) continue
    const name = String(product.kategori || 'Umum').trim() || 'Umum'
    const key = brandKey(name)
    if (!map.has(key)) map.set(key, { name, key, count: 0 })
    map.get(key).count += variants.length
  }
  return [...map.values()].sort((a, b) => (
    a.name.localeCompare(b.name, 'en', { sensitivity: 'base', numeric: true })
  ))
}

function paginate(items, page, perPage) {
  const list = items || []
  const size = Math.max(1, Number(perPage) || 1)
  const totalPages = Math.max(1, Math.ceil(list.length / size) || 1)
  let safe = Number(page)
  if (!Number.isFinite(safe) || safe < 0) safe = 0
  safe = Math.min(Math.floor(safe), totalPages - 1)
  return {
    items: list.slice(safe * size, safe * size + size),
    page: safe,
    totalPages,
    total: list.length,
  }
}

function pairRows(buttons) {
  const rows = []
  for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2))
  return rows
}

function fitButton(text) {
  const raw = String(text || '')
  if (raw.length <= BUTTON_MAX) return raw
  return `${raw.slice(0, BUTTON_MAX - 1)}…`
}

function durationRank(label) {
  const match = String(label || '').match(/(\d+)\s*(hari|bulan|tahun|token)/i)
  if (!match) return 100000
  const n = Number(match[1])
  const unit = match[2].toLowerCase()
  if (unit.startsWith('hari')) return n
  if (unit.startsWith('bulan')) return n * 30
  if (unit.startsWith('tahun')) return n * 365
  return 50000 + n
}

function buyerTitle(produkNama, label) {
  return `${produkNama || ''} ${label || ''}`.replace(/\s+/g, ' ').trim()
}

function priceFacts(variant, formatPrice) {
  const fmt = typeof formatPrice === 'function' ? formatPrice : (n) => String(n)
  const options = purchaseFlow.sellerOptions(variant && variant.offers)
  const stock = purchaseFlow.variantDisplayedStock(variant)
  let amount = null
  let fromPrice = false
  if (options.length) {
    amount = Math.min(...options.map((o) => o.harga_satuan))
    fromPrice = options.length > 1
  } else {
    const fallback = variant && variant.harga_efektif != null
      ? variant.harga_efektif
      : variant && variant.harga
    amount = fallback == null || fallback === '' ? null : Number(fallback)
  }
  const priceText = amount == null || !Number.isFinite(Number(amount)) ? '—' : fmt(Number(amount))
  return { stock, fromPrice, priceText, soldOut: stock <= 0 }
}

function itemButtonText({ title, priceText, fromPrice, stock, soldOut }) {
  const priceLabel = fromPrice ? `from ${priceText}` : priceText
  const stockLabel = stock === null || stock === undefined ? 'stok' : String(stock)
  const tail = ` | ${priceLabel} | (${stockLabel})`
  const prefix = soldOut ? '❌ ' : ''
  const room = BUTTON_MAX - prefix.length - tail.length
  let name = String(title || '')
  if (room < 4) return fitButton(`${prefix}${name}${tail}`)
  if (name.length > room) name = `${name.slice(0, Math.max(1, room - 1))}…`
  return `${prefix}${name}${tail}`
}

function callbackFits(data) {
  return Buffer.byteLength(String(data || ''), 'utf8') <= 64
}

function brandCallback(name) {
  const data = `kategori_${name}`
  return callbackFits(data) ? data : null
}

function shapeItem(product, variant, formatPrice) {
  const facts = priceFacts(variant, formatPrice)
  const title = buyerTitle(product.nama, variant.label)
  const callback = `v:${variant.kode}`
  return {
    kode: variant.kode,
    title,
    label: variant.label,
    produk: product.nama,
    brand: product.kategori,
    ...facts,
    text: itemButtonText({ title, priceText: facts.priceText, fromPrice: facts.fromPrice, stock: facts.stock, soldOut: facts.soldOut }),
    callback_data: callbackFits(callback) ? callback : `v:${String(variant.kode).slice(0, 60)}`,
  }
}

function sortItems(items) {
  return [...items].sort((a, b) => {
    const byName = String(a.produk || '').localeCompare(String(b.produk || ''), 'en', { sensitivity: 'base' })
    if (byName) return byName
    const byDur = durationRank(a.label) - durationRank(b.label)
    if (byDur) return byDur
    return String(a.label || '').localeCompare(String(b.label || ''), 'en', { sensitivity: 'base' })
  })
}

function itemsForBrand(products, brand, formatPrice) {
  const key = brandKey(brand)
  const items = []
  for (const product of products || []) {
    if (!product || product.is_active === false) continue
    if (brandKey(product.kategori) !== key) continue
    for (const variant of product.variants || []) {
      if (!variant || variant.is_active === false) continue
      items.push(shapeItem(product, variant, formatPrice))
    }
  }
  return sortItems(items)
}

function buildBrandMenu({ products, page = 0, perPage = BRANDS_PER_PAGE, caption } = {}) {
  const brands = listBrands(products)
  const slice = paginate(brands, page, perPage)
  const brandButtons = slice.items.map((brand) => ({
    text: fitButton(`${brand.name} (${brand.count})`),
    callback_data: brandCallback(brand.name) || 'daftarproduk',
    preview: { type: 'brand_items', brand: brand.name },
  }))
  const buttons = pairRows(brandButtons)
  if (slice.totalPages > 1) {
    const nav = []
    if (slice.page > 0) {
      nav.push({
        text: '⬅️ Sebelumnya',
        callback_data: `brandpg:${slice.page - 1}`,
        preview: { type: 'brand_menu', page: slice.page - 1 },
      })
    }
    if (slice.page < slice.totalPages - 1) {
      nav.push({
        text: 'Selanjutnya ➡️',
        callback_data: `brandpg:${slice.page + 1}`,
        preview: { type: 'brand_menu', page: slice.page + 1 },
      })
    }
    if (nav.length) buttons.push(nav)
  }
  buttons.push([{
    text: '🔙 Menu Utama',
    callback_data: 'kembaliawal',
    preview: { type: 'go', key: 'welcome' },
  }])
  const pageLine = slice.totalPages > 1 ? `\nHalaman ${slice.page + 1}/${slice.totalPages}` : ''
  return {
    caption: `${caption || '*PILIH BRAND*\nPilih produk atau brand.'}${pageLine}`,
    buttons,
    brands,
    page: slice.page,
    totalPages: slice.totalPages,
  }
}

function buildBrandItems({ products, brand, page = 0, perPage = ITEMS_PER_PAGE, formatPrice, caption } = {}) {
  const items = itemsForBrand(products, brand, formatPrice)
  const slice = paginate(items, page, perPage)
  const buttons = slice.items.map((item) => [{
    text: item.text,
    callback_data: item.callback_data,
    preview: item.soldOut
      ? { type: 'stub', title: 'Stok habis' }
      : {
        type: 'qty',
        kode: item.kode,
        label: item.label,
        produk_label: item.title,
        harga: item.priceText,
        stok: item.stock,
      },
  }])
  if (slice.totalPages > 1) {
    const nav = []
    if (slice.page > 0) {
      nav.push({
        text: '⬅️ Sebelumnya',
        callback_data: `bip:${slice.page - 1}:${brand}`,
        preview: { type: 'brand_items', brand, page: slice.page - 1 },
      })
    }
    if (slice.page < slice.totalPages - 1) {
      nav.push({
        text: 'Selanjutnya ➡️',
        callback_data: `bip:${slice.page + 1}:${brand}`,
        preview: { type: 'brand_items', brand, page: slice.page + 1 },
      })
    }
    if (nav.length) buttons.push(nav)
  }
  buttons.push([
    { text: '← Kembali', callback_data: 'daftarproduk', preview: { type: 'brand_menu', page: 0 } },
    { text: '🏠 Home', callback_data: 'kembaliawal', preview: { type: 'go', key: 'welcome' } },
  ])
  const pageLine = slice.totalPages > 1 ? `\nHalaman ${slice.page + 1}/${slice.totalPages}` : ''
  const head = caption || `*${brand}* (${items.length})\nPilih item.`
  return {
    caption: `${head}${pageLine}`,
    buttons,
    items,
    page: slice.page,
    totalPages: slice.totalPages,
  }
}

function parseBrandItemPage(cmd) {
  const match = String(cmd || '').match(/^bip:(\d+):(.*)$/)
  if (!match) return null
  return { page: Number(match[1]) || 0, brand: match[2] }
}

function parseBrandPage(cmd) {
  const match = String(cmd || '').match(/^brandpg:(\d+)$/)
  if (!match) return null
  return Number(match[1]) || 0
}

function telegramKeyboard(buttons) {
  return (buttons || []).map((row) => row.map((btn) => ({
    text: btn.text,
    callback_data: btn.callback_data,
  })))
}

module.exports = {
  BRANDS_PER_PAGE,
  ITEMS_PER_PAGE,
  BUTTON_MAX,
  DELIVERY_DEFAULT,
  warrantyFromLabel,
  detailLines,
  appendDetailLines,
  brandKey,
  listBrands,
  paginate,
  pairRows,
  fitButton,
  durationRank,
  buyerTitle,
  priceFacts,
  itemButtonText,
  callbackFits,
  itemsForBrand,
  buildBrandMenu,
  buildBrandItems,
  parseBrandItemPage,
  parseBrandPage,
  telegramKeyboard,
}
