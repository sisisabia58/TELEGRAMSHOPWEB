// Merencanakan regroup katalog 2026-11-06.
//
// Murni terhadap snapshot { products, variants, supplierProducts }. Skrip CLI
// yang memuat database dan menulis. Aman diulang: operasi hanya muncul kalau
// keadaan hidup masih beda dari peta.
const fs = require('fs')
const brandMenu = require('./brand-menu')
const { formatrupiah } = require('./format')

function loadMapping(file) {
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (!doc || !Array.isArray(doc.products) || !Array.isArray(doc.offers)) {
    throw new Error('berkas peta tidak berisi products dan offers')
  }
  return doc
}

function normId(id) {
  return String(id == null ? '' : id)
}

function kodeKey(kode) {
  return String(kode || '').toLowerCase()
}

function desiredVariants(mapping) {
  const byKode = new Map()
  for (const offer of mapping.offers || []) {
    if (offer.action !== 'map' && offer.action !== 'own') continue
    if (!offer.variant_kode || !offer.product_slug) continue
    if (!byKode.has(offer.variant_kode)) {
      byKode.set(offer.variant_kode, {
        kode: offer.variant_kode,
        label: offer.variant_label,
        product_slug: offer.product_slug,
        plan: offer.plan,
        brand: offer.brand,
        prices: [],
        own: false,
      })
    }
    const row = byKode.get(offer.variant_kode)
    if (offer.action === 'own') row.own = true
    const price = Number(offer.price_idr)
    if (Number.isFinite(price)) row.prices.push(price)
  }
  for (const row of byKode.values()) {
    row.harga = row.prices.length ? Math.min(...row.prices) : 0
  }
  return [...byKode.values()]
}

function indexLive(live) {
  const productsById = new Map()
  const variantsByKode = new Map()
  const variantsByProduct = new Map()
  const offersByKey = new Map()
  for (const product of live.products || []) productsById.set(product.id, product)
  for (const variant of live.variants || []) {
    variantsByKode.set(kodeKey(variant.kode), variant)
    if (!variantsByProduct.has(variant.produk_id)) variantsByProduct.set(variant.produk_id, [])
    variantsByProduct.get(variant.produk_id).push(variant)
  }
  for (const row of live.supplierProducts || []) {
    offersByKey.set(`${row.supplier_id}::${normId(row.external_id)}`, row)
  }
  return { productsById, variantsByKode, variantsByProduct, offersByKey }
}

function productValues(product) {
  return {
    nama: product.nama,
    slug: product.slug,
    kategori: product.brand,
    deskripsi: product.deskripsi,
    snk: product.snk,
    is_active: true,
  }
}

function changedKeys(before, values) {
  return Object.keys(values).filter((key) => before[key] !== values[key])
}

function planRegroup(live, mapping) {
  const snapshot = live || {}
  const products = mapping.products || []
  const variants = desiredVariants(mapping)
  const idx = indexLive(snapshot)
  const writes = []
  const skips = []
  const unchanged = []

  const variantsBySlug = new Map()
  for (const variant of variants) {
    if (!variantsBySlug.has(variant.product_slug)) variantsBySlug.set(variant.product_slug, [])
    variantsBySlug.get(variant.product_slug).push(variant)
  }

  const claims = new Map()
  for (const variant of variants) {
    const liveVar = idx.variantsByKode.get(kodeKey(variant.kode))
    if (!liveVar) continue
    if (!claims.has(liveVar.produk_id)) claims.set(liveVar.produk_id, new Set())
    claims.get(liveVar.produk_id).add(variant.product_slug)
  }

  const reuseBySlug = new Map()
  for (const product of products) {
    const owned = variantsBySlug.get(product.slug) || []
    const liveIds = new Set()
    for (const variant of owned) {
      const liveVar = idx.variantsByKode.get(kodeKey(variant.kode))
      if (liveVar) liveIds.add(liveVar.produk_id)
    }
    let reuse = null
    if (liveIds.size === 1) {
      const id = [...liveIds][0]
      const claimed = claims.get(id)
      if (claimed && claimed.size === 1) reuse = idx.productsById.get(id) || null
    }
    if (!reuse) {
      const bySlug = (snapshot.products || []).find((row) => row.slug === product.slug)
      const vars = bySlug ? (idx.variantsByProduct.get(bySlug.id) || []) : []
      const supplierish = vars.some((variant) => variant.sumber === 'supplier')
      if (bySlug && !supplierish) reuse = bySlug
    }
    reuseBySlug.set(product.slug, reuse)
    const values = productValues(product)
    if (!reuse) {
      writes.push({
        op: 'ensure_product',
        slug: product.slug,
        reuse_id: null,
        values,
        before: null,
      })
      continue
    }
    const before = {
      nama: reuse.nama,
      slug: reuse.slug,
      kategori: reuse.kategori,
      deskripsi: reuse.deskripsi,
      snk: reuse.snk,
      is_active: reuse.is_active !== false,
    }
    const changed = changedKeys(before, values)
    if (!changed.length) unchanged.push({ op: 'ensure_product', slug: product.slug })
    else {
      writes.push({
        op: 'ensure_product',
        slug: product.slug,
        reuse_id: reuse.id,
        values,
        before,
        changed,
      })
    }
  }

  const keptKodes = new Set(variants.map((variant) => kodeKey(variant.kode)))
  const reusedIds = new Set([...reuseBySlug.values()].filter(Boolean).map((product) => product.id))

  for (const variant of variants) {
    const liveVar = idx.variantsByKode.get(kodeKey(variant.kode))
    const values = { label: variant.label, is_active: true, sumber: 'sendiri' }
    if (!liveVar) {
      values.harga = variant.harga
      writes.push({
        op: 'ensure_variant',
        kode: variant.kode,
        product_slug: variant.product_slug,
        reuse_id: null,
        set_harga: true,
        move: false,
        values,
        before: null,
      })
      continue
    }
    const reuseProduct = reuseBySlug.get(variant.product_slug)
    const moving = !reuseProduct || liveVar.produk_id !== reuseProduct.id
    const before = {
      label: liveVar.label,
      is_active: liveVar.is_active !== false,
      sumber: liveVar.sumber,
      produk_id: liveVar.produk_id,
    }
    const changed = []
    if (before.label !== values.label) changed.push('label')
    if (before.is_active !== true) changed.push('is_active')
    if (before.sumber !== 'sendiri') changed.push('sumber')
    if (moving) changed.push('produk_id')
    if (!changed.length) unchanged.push({ op: 'ensure_variant', kode: variant.kode })
    else {
      writes.push({
        op: 'ensure_variant',
        kode: variant.kode,
        product_slug: variant.product_slug,
        reuse_id: liveVar.id,
        set_harga: false,
        move: moving,
        values,
        before,
        changed,
      })
    }
  }

  for (const product of snapshot.products || []) {
    if (reusedIds.has(product.id)) continue
    const vars = idx.variantsByProduct.get(product.id) || []
    const supplierish = vars.some((variant) => variant.sumber === 'supplier')
    const onlyMoved = vars.length > 0 && vars.every((variant) => keptKodes.has(kodeKey(variant.kode)))
    if (!supplierish && !onlyMoved) continue
    if (product.is_active !== false) {
      writes.push({
        op: 'deactivate_product',
        id: product.id,
        slug: product.slug,
        nama: product.nama,
        before: { is_active: true },
      })
    } else unchanged.push({ op: 'deactivate_product', slug: product.slug })
    for (const variant of vars) {
      if (keptKodes.has(kodeKey(variant.kode))) continue
      if (variant.is_active === false) {
        unchanged.push({ op: 'deactivate_variant', kode: variant.kode })
        continue
      }
      writes.push({
        op: 'deactivate_variant',
        id: variant.id,
        kode: variant.kode,
        label: variant.label,
        before: { is_active: true },
      })
    }
  }

  for (const offer of mapping.offers || []) {
    if (offer.action === 'own') continue
    const key = `${offer.supplier_id}::${normId(offer.external_id)}`
    const row = idx.offersByKey.get(key)
    if (!row) {
      skips.push({
        op: 'skip_offer',
        external_id: offer.external_id,
        source: offer.source,
        reason: 'not_found',
      })
      continue
    }
    if (row.is_available !== true) {
      skips.push({
        op: 'skip_offer',
        external_id: offer.external_id,
        source: offer.source,
        reason: 'hilang',
        id: row.id,
      })
      continue
    }
    const liveManual = /fulfillment:\s*manual/i.test(String(row.deskripsi || ''))
    const liveFree = row.harga_asal !== null && row.harga_asal !== undefined && row.harga_asal !== ''
      && Number(row.harga_asal) <= 0
    const exclude = offer.action === 'exclude_manual'
      || offer.action === 'exclude_price0'
      || liveManual
      || liveFree
    if (exclude) {
      const reason = offer.action === 'exclude_price0' || liveFree ? 'price0' : 'manual'
      if (row.varian_id == null && row.mapping_mode === 'manual') {
        unchanged.push({ op: 'unmap_offer', external_id: offer.external_id })
      } else {
        writes.push({
          op: 'unmap_offer',
          supplier_product_id: row.id,
          external_id: offer.external_id,
          source: offer.source,
          reason,
          from_varian_id: row.varian_id || null,
          from_mode: row.mapping_mode,
        })
      }
      continue
    }
    const target = idx.variantsByKode.get(kodeKey(offer.variant_kode))
    if (target && row.varian_id === target.id && row.mapping_mode === 'manual') {
      unchanged.push({ op: 'remap_offer', external_id: offer.external_id })
      continue
    }
    writes.push({
      op: 'remap_offer',
      supplier_product_id: row.id,
      external_id: offer.external_id,
      source: offer.source,
      offer_name: offer.offer_name,
      to_kode: offer.variant_kode,
      from_varian_id: row.varian_id || null,
      from_mode: row.mapping_mode,
    })
  }

  return { writes, skips, unchanged }
}

function summarize(plan) {
  const writes = {}
  for (const op of plan.writes || []) writes[op.op] = (writes[op.op] || 0) + 1
  const skips = {}
  for (const op of plan.skips || []) skips[op.reason] = (skips[op.reason] || 0) + 1
  return { writes, skips, unchanged: (plan.unchanged || []).length }
}

function applyOpsInMemory(live, plan) {
  const next = {
    products: (live.products || []).map((row) => ({ ...row })),
    variants: (live.variants || []).map((row) => ({ ...row })),
    supplierProducts: (live.supplierProducts || []).map((row) => ({ ...row })),
    suppliers: live.suppliers || [],
  }
  const slugToId = new Map(next.products.map((product) => [product.slug, product.id]))
  for (const op of plan.writes || []) {
    if (op.op === 'ensure_product') {
      if (op.reuse_id) {
        const product = next.products.find((row) => row.id === op.reuse_id)
        Object.assign(product, op.values)
        slugToId.set(op.slug, op.reuse_id)
      } else {
        const id = `prod:${op.slug}`
        next.products.push({ id, ...op.values })
        slugToId.set(op.slug, id)
      }
    } else if (op.op === 'ensure_variant') {
      const produkId = slugToId.get(op.product_slug)
      if (op.reuse_id) {
        const variant = next.variants.find((row) => row.id === op.reuse_id)
        Object.assign(variant, op.values, { produk_id: produkId })
      } else {
        next.variants.push({
          id: `var:${op.kode}`,
          produk_id: produkId,
          kode: op.kode,
          sumber: 'sendiri',
          is_active: true,
          ...op.values,
        })
      }
    } else if (op.op === 'deactivate_product') {
      const product = next.products.find((row) => row.id === op.id)
      if (product) product.is_active = false
    } else if (op.op === 'deactivate_variant') {
      const variant = next.variants.find((row) => row.id === op.id)
      if (variant) variant.is_active = false
    } else if (op.op === 'remap_offer') {
      const row = next.supplierProducts.find((item) => item.id === op.supplier_product_id)
      const variant = next.variants.find((item) => kodeKey(item.kode) === kodeKey(op.to_kode))
      if (row) {
        row.varian_id = variant ? variant.id : op.to_kode
        row.mapping_mode = 'manual'
      }
    } else if (op.op === 'unmap_offer') {
      const row = next.supplierProducts.find((item) => item.id === op.supplier_product_id)
      if (row) {
        row.varian_id = null
        row.mapping_mode = 'manual'
      }
    }
  }
  return next
}

function sampleBrand(mapping, brand, formatPrice) {
  const grouped = new Map()
  for (const offer of mapping.offers || []) {
    if (offer.action !== 'map' && offer.action !== 'own') continue
    if (offer.brand !== brand) continue
    if (!grouped.has(offer.variant_kode)) {
      grouped.set(offer.variant_kode, {
        plan: offer.plan,
        label: offer.variant_label,
        sellers: [],
      })
    }
    grouped.get(offer.variant_kode).sellers.push(offer)
  }
  const fmt = typeof formatPrice === 'function' ? formatPrice : (n) => String(n)
  const items = [...grouped.values()].map((group) => {
    const prices = group.sellers.map((seller) => Number(seller.price_idr)).filter((n) => Number.isFinite(n))
    const min = prices.length ? Math.min(...prices) : null
    const title = `${group.plan} ${group.label}`.replace(/\s+/g, ' ').trim()
    return {
      plan: group.plan,
      label: group.label,
      sellers: group.sellers.length,
      text: brandMenu.itemButtonText({
        title,
        priceText: min == null ? '—' : fmt(min),
        fromPrice: group.sellers.length > 1,
        stock: null,
        soldOut: false,
      }),
    }
  })
  items.sort((a, b) => {
    const byName = a.plan.localeCompare(b.plan, 'en', { sensitivity: 'base' })
    if (byName) return byName
    return brandMenu.durationRank(a.label) - brandMenu.durationRank(b.label)
  })
  const lines = [`*${brand}* (${items.length})`, 'Pilih item.', ...items.map((item) => item.text)]
  return { brand, count: items.length, items, text: lines.join('\n') }
}

function printPlan(plan, mapping) {
  const summary = summarize(plan)
  console.log('Perubahan yang akan ditulis:')
  const keys = Object.keys(summary.writes)
  if (!keys.length) console.log('  (tidak ada)')
  for (const key of keys) console.log(`  ${key}: ${summary.writes[key]}`)
  console.log('Dilewati:', Object.keys(summary.skips).length
    ? Object.entries(summary.skips).map(([k, n]) => `${k}=${n}`).join(', ')
    : '(tidak ada)')
  console.log(`Sudah sesuai: ${summary.unchanged}`)
  for (const op of plan.writes) {
    if (op.op === 'ensure_product') {
      console.log(`  produk ${op.reuse_id ? 'ubah' : 'buat'} ${op.slug} [${op.values.kategori}]`)
    } else if (op.op === 'ensure_variant') {
      console.log(`  varian ${op.reuse_id ? 'ubah' : 'buat'} ${op.kode} → ${op.product_slug} "${op.values.label}"`)
    } else if (op.op === 'deactivate_product') {
      console.log(`  nonaktifkan produk ${op.slug}`)
    } else if (op.op === 'deactivate_variant') {
      console.log(`  nonaktifkan varian ${op.kode}`)
    } else if (op.op === 'remap_offer') {
      console.log(`  petakan ${op.source} ${op.external_id} → ${op.to_kode}`)
    } else if (op.op === 'unmap_offer') {
      console.log(`  lepas ${op.source} ${op.external_id} (${op.reason})`)
    }
  }
  if (mapping) {
    console.log('\nContoh menu (stok diisi saat bot jalan; di sini ditulis "stok"):')
    for (const brand of ['Google AI', 'CapCut', 'Canva']) {
      console.log(`\n${sampleBrand(mapping, brand, formatrupiah).text}`)
    }
  }
}

async function fetchAll(supabase, table, columns) {
  const out = []
  const page = 1000
  for (let from = 0; ; from += page) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .order('id', { ascending: true })
      .range(from, from + page - 1)
    if (error) throw new Error(`${table}: ${error.message}`)
    const rows = data || []
    out.push(...rows)
    if (rows.length < page) break
  }
  return out
}

async function fetchLive(supabase) {
  const [products, variants, supplierProducts, suppliers] = await Promise.all([
    fetchAll(supabase, 'Produk', 'id, nama, slug, kategori, deskripsi, snk, is_active'),
    fetchAll(supabase, 'Varian', 'id, produk_id, label, kode, harga, sumber, is_active'),
    fetchAll(supabase, 'SupplierProduct', 'id, supplier_id, external_id, nama, deskripsi, harga_asal, is_available, varian_id, mapping_mode'),
    fetchAll(supabase, 'Supplier', 'id, nama, adapter, slug'),
  ])
  return { products, variants, supplierProducts, suppliers }
}

async function applyPlan(supabase, plan, live) {
  const slugToId = new Map((live.products || []).map((product) => [product.slug, product.id]))
  const undos = []
  for (const op of plan.writes) {
    if (op.op === 'ensure_product') {
      if (op.reuse_id) {
        const { error } = await supabase.from('Produk').update(op.values).eq('id', op.reuse_id)
        if (error) throw new Error(`produk ${op.slug}: ${error.message}`)
        slugToId.set(op.values.slug, op.reuse_id)
        undos.push({ table: 'Produk', id: op.reuse_id, values: op.before })
      } else {
        const { data, error } = await supabase.from('Produk').insert(op.values).select('id').single()
        if (error) throw new Error(`produk ${op.slug}: ${error.message}`)
        slugToId.set(op.slug, data.id)
        undos.push({ table: 'Produk', id: data.id, values: { is_active: false } })
      }
    } else if (op.op === 'ensure_variant') {
      const produkId = slugToId.get(op.product_slug)
      if (!produkId) throw new Error(`produk untuk varian ${op.kode} tidak ketemu (${op.product_slug})`)
      if (op.reuse_id) {
        const patch = { ...op.values, produk_id: produkId }
        const { error } = await supabase.from('Varian').update(patch).eq('id', op.reuse_id)
        if (error) throw new Error(`varian ${op.kode}: ${error.message}`)
        undos.push({ table: 'Varian', id: op.reuse_id, values: op.before })
      } else {
        const { data, error } = await supabase.from('Varian').insert({
          ...op.values,
          kode: op.kode,
          produk_id: produkId,
        }).select('id').single()
        if (error) throw new Error(`varian ${op.kode}: ${error.message}`)
        undos.push({ table: 'Varian', id: data.id, values: { is_active: false } })
      }
    } else if (op.op === 'deactivate_product') {
      const { error } = await supabase.from('Produk').update({ is_active: false }).eq('id', op.id)
      if (error) throw new Error(`nonaktifkan produk ${op.slug}: ${error.message}`)
      undos.push({ table: 'Produk', id: op.id, values: { is_active: true } })
    } else if (op.op === 'deactivate_variant') {
      const { error } = await supabase.from('Varian').update({ is_active: false }).eq('id', op.id)
      if (error) throw new Error(`nonaktifkan varian ${op.kode}: ${error.message}`)
      undos.push({ table: 'Varian', id: op.id, values: { is_active: true } })
    } else if (op.op === 'remap_offer') {
      const { data: varian, error: errVarian } = await supabase
        .from('Varian')
        .select('id')
        .eq('kode', op.to_kode)
        .maybeSingle()
      if (errVarian || !varian) throw new Error(`varian tujuan ${op.to_kode} tidak ketemu`)
      const { error } = await supabase.from('SupplierProduct').update({
        varian_id: varian.id,
        mapping_mode: 'manual',
      }).eq('id', op.supplier_product_id)
      if (error) throw new Error(`petakan ${op.external_id}: ${error.message}`)
      undos.push({
        table: 'SupplierProduct',
        id: op.supplier_product_id,
        values: { varian_id: op.from_varian_id, mapping_mode: op.from_mode },
      })
    } else if (op.op === 'unmap_offer') {
      const { error } = await supabase.from('SupplierProduct').update({
        varian_id: null,
        mapping_mode: 'manual',
      }).eq('id', op.supplier_product_id)
      if (error) throw new Error(`lepas ${op.external_id}: ${error.message}`)
      undos.push({
        table: 'SupplierProduct',
        id: op.supplier_product_id,
        values: { varian_id: op.from_varian_id, mapping_mode: op.from_mode },
      })
    }
  }
  return { undos }
}

async function applyUndos(supabase, payload) {
  const undos = [...(payload.undos || [])].reverse()
  for (const undo of undos) {
    const { error } = await supabase.from(undo.table).update(undo.values).eq('id', undo.id)
    if (error) throw new Error(`rollback ${undo.table} ${undo.id}: ${error.message}`)
  }
  return undos.length
}

module.exports = {
  loadMapping,
  desiredVariants,
  planRegroup,
  summarize,
  applyOpsInMemory,
  sampleBrand,
  printPlan,
  fetchLive,
  applyPlan,
  applyUndos,
}
