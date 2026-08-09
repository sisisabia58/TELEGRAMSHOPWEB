function slugify(nama) {
  return String(nama || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function pick(row, keys) {
  for (const k of keys) {
    if (row[k] !== undefined && row[k] !== null && String(row[k]).trim() !== '') {
      return String(row[k]).trim()
    }
  }
  return ''
}

function normalizeCatalogRow(row) {
  const nama = pick(row, ['produk_nama', 'Produk_Nama', 'nama', 'Nama'])
  const slugRaw = pick(row, ['produk_slug', 'Produk_Slug', 'slug', 'Slug'])
  const kategori = pick(row, ['kategori', 'Kategori']) || 'umum'
  const deskripsi = pick(row, ['deskripsi', 'Deskripsi', 'description'])
  const snk = pick(row, ['snk', 'SNK', 'syarat', 'Syarat'])
  const label = pick(row, ['varian_label', 'Varian_Label', 'label', 'Label'])
  const kode = pick(row, ['varian_kode', 'Varian_Kode', 'kode', 'Kode']).toLowerCase()
  const format = pick(row, ['format', 'Format']) || null
  const hargaRaw = pick(row, ['harga', 'Harga', 'price', 'Price'])
  const harga = parseInt(hargaRaw, 10)

  if (!nama) return { ok: false, error: 'produk_nama wajib' }
  if (!label) return { ok: false, error: 'varian_label wajib' }
  if (!kode) return { ok: false, error: 'varian_kode wajib' }
  if (!deskripsi) return { ok: false, error: 'deskripsi wajib' }
  if (!snk) return { ok: false, error: 'snk wajib' }
  if (!Number.isFinite(harga) || harga < 0) return { ok: false, error: 'harga tidak valid' }

  const slug = slugRaw ? slugify(slugRaw) : slugify(nama)
  if (!slug) return { ok: false, error: 'slug kosong' }

  return {
    ok: true,
    value: {
      nama,
      slug,
      kategori: kategori.toLowerCase(),
      deskripsi,
      snk,
      varian: { label, kode, harga, format },
    },
  }
}

function groupCatalogRows(rawRows) {
  const productsBySlug = Object.create(null)
  const order = []
  const failures = []
  const seenKode = Object.create(null)

  for (let i = 0; i < (rawRows || []).length; i++) {
    const rowNum = i + 2
    const norm = normalizeCatalogRow(rawRows[i] || {})
    if (!norm.ok) {
      failures.push({ row: rowNum, error: norm.error })
      continue
    }
    const v = norm.value
    if (seenKode[v.varian.kode]) {
      failures.push({ row: rowNum, error: `varian_kode duplikat dalam file: ${v.varian.kode}` })
      continue
    }
    seenKode[v.varian.kode] = true

    if (!productsBySlug[v.slug]) {
      productsBySlug[v.slug] = {
        slug: v.slug,
        nama: v.nama,
        kategori: v.kategori,
        deskripsi: v.deskripsi,
        snk: v.snk,
        variants: [],
      }
      order.push(v.slug)
    }
    productsBySlug[v.slug].variants.push(v.varian)
  }

  return {
    products: order.map((s) => productsBySlug[s]),
    failures,
  }
}

function parseStockLines(text) {
  return String(text || '')
    .split(/[\n\r,]+/)
    .map((s) => s.trim())
    .filter((s) => s !== '')
}

function normalizeTierRow(row) {
  const kode = pick(row, ['varian_kode', 'Varian_Kode', 'kode', 'Kode']).toLowerCase()
  const min_qty = parseInt(pick(row, ['min_qty', 'Min_Qty', 'min', 'Min']), 10)
  const harga = parseInt(pick(row, ['harga', 'Harga']), 10)
  if (!kode) return { ok: false, error: 'varian_kode wajib' }
  if (!Number.isFinite(min_qty) || min_qty < 2) return { ok: false, error: 'min_qty minimal 2' }
  if (!Number.isFinite(harga) || harga < 0) return { ok: false, error: 'harga tidak valid' }
  return { ok: true, value: { varian_kode: kode, min_qty, harga } }
}

function computeNewHarga(oldHarga, update_type, value) {
  const old = Number(oldHarga)
  const val = Number(value)
  if (!Number.isFinite(old) || !Number.isFinite(val)) {
    return { ok: false, error: 'nilai tidak valid' }
  }
  let harga
  if (update_type === 'percentage') {
    harga = Math.round(old * (1 + val / 100))
  } else if (update_type === 'fixed') {
    harga = old + val
  } else {
    return { ok: false, error: 'tipe update tidak valid' }
  }
  if (harga < 0) return { ok: false, error: 'harga baru tidak boleh negatif' }
  return { ok: true, harga }
}

module.exports = {
  pick,
  normalizeCatalogRow,
  groupCatalogRows,
  parseStockLines,
  normalizeTierRow,
  computeNewHarga,
}
