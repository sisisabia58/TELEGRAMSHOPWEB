const test = require('node:test')
const assert = require('node:assert')
const path = require('path')
const regroup = require('../lib/catalog-regroup')
const brand = require('../lib/brand-menu')
const { formatrupiah } = require('../lib/format')

const mapping = regroup.loadMapping(path.join(__dirname, '..', 'data', 'catalog-regroup-2026-11-06.json'))

function syntheticLive(doc) {
  const products = []
  const variants = []
  const supplierProducts = []
  const seen = new Map()
  let n = 0
  function productId(slug, seed) {
    if (!seen.has(slug)) {
      n += 1
      const id = `p${n}`
      seen.set(slug, id)
      products.push({
        id,
        slug,
        nama: seed.current_product_nama || slug,
        kategori: seed.current_kategori || 'reseller',
        deskripsi: seed.action === 'own'
          ? 'Paket uji — tidak untuk produksi'
          : `slug:${slug} fulfillment:instant`,
        snk: seed.action === 'own' ? 'S&K uji: tidak untuk produksi.' : '',
        is_active: true,
      })
    }
    return seen.get(slug)
  }
  doc.offers.forEach((offer, i) => {
    if (offer.action === 'own') {
      const id = productId(offer.current_slug, offer)
      variants.push({
        id: `own${i}`,
        produk_id: id,
        kode: offer.variant_kode,
        label: offer.current_variant_label,
        harga: offer.price_idr,
        sumber: 'sendiri',
        is_active: true,
      })
      return
    }
    const id = productId(offer.current_slug, offer)
    const vid = `sv${i}`
    const kode = `${offer.source === 'InsightX' ? 'insightx' : 'hubx'}-${offer.external_id}`
    variants.push({
      id: vid,
      produk_id: id,
      kode,
      label: offer.current_variant_label,
      harga: offer.price_idr || 0,
      sumber: 'supplier',
      is_active: true,
    })
    supplierProducts.push({
      id: `sp${i}`,
      supplier_id: offer.supplier_id,
      external_id: offer.external_id,
      nama: offer.offer_name,
      deskripsi: offer.action === 'exclude_manual'
        ? 'slug:x fulfillment:manual'
        : 'slug:x fulfillment:instant',
      harga_asal: offer.action === 'exclude_price0' ? 0 : 1.5,
      is_available: true,
      varian_id: vid,
      mapping_mode: 'auto',
    })
  })
  return { products, variants, supplierProducts, suppliers: [] }
}

function ops(plan, name) {
  return plan.writes.filter((op) => op.op === name)
}

test('peta menerapkan keputusan pemilik', () => {
  const byId = (id) => mapping.offers.find((offer) => offer.external_id === id)
  const shared = (a, b) => {
    assert.equal(byId(a).variant_kode, byId(b).variant_kode)
    assert.equal(byId(a).action, 'map')
  }
  shared('7cac6c4c-23fa-497d-b5e7-b55913536eb1', '115')
  shared('5e9b9ba7-9751-4e03-96b4-f5ee8350020d', '40')
  shared('a7176528-a116-4d2e-ba07-58fbb5023876', '41')

  const surf = mapping.offers.filter((offer) => offer.brand === 'Surfshark')
  assert.equal(surf.length, 2)
  assert.equal(new Set(surf.map((offer) => offer.variant_kode)).size, 1)
  assert.equal(surf[0].variant_label, '2 Bulan (FW)')

  const team = byId('31')
  assert.equal(team.plan, 'CapCut Team')
  assert.equal(team.variant_label, '1 Bulan (FW)')
  assert.equal(byId('68').plan, 'CapCut Pro')
  assert.equal(byId('113').plan, 'CapCut Pro')
  assert.equal(byId('00870fca-cc16-461e-baba-0dfcaeb73b74').variant_label, '1 Bulan (NW)')

  for (const id of [
    '9eaaacc8-1310-4c39-8de8-ffc8e37d09eb',
    '166107c2-0c81-4a06-91cb-fe0a00740ed2',
    'cf939df9-ac98-480e-b15b-a22fe38d1481',
    '03598249-0ce5-4394-8288-bcceb8baccbf',
    '4579844a-5280-4c8d-96fa-cdeb146b11ae',
    '5bdae557-e186-4584-bbc1-768985ae315c',
    'a09ed03c-8c38-4a14-a030-61f853c90fb5',
  ]) {
    assert.match(byId(id).variant_label, /\(NW\)$/)
  }

  assert.equal(byId('0a7a6040-fc71-4eea-8b64-da1e7ab1e3db').action, 'exclude_price0')
  const manual = mapping.offers.filter((offer) => offer.action === 'exclude_manual')
  assert.equal(manual.length, 6)
  assert.ok(manual.every((offer) => offer.variant_kode == null))

  for (const id of ['canva-personal', 'canva-team5', 'canva-edu']) {
    assert.equal(byId(id).variant_label, '1 Bulan')
    assert.equal(byId(id).brand, 'Canva')
  }
  assert.equal(byId('spotify-1b').plan, 'Spotify Premium Individual')
  assert.equal(byId('netflix-30d').variant_label, '1 Bulan')
  assert.equal(byId('netflix-90d').variant_label, '3 Bulan')
  assert.equal(byId('netflix-7d').variant_kode, 'netflix-7d')
})

test('dry-run dari katalog lama idempoten dan melewati HILANG', () => {
  const live = syntheticLive(mapping)
  const hilang = live.supplierProducts.find((row) => row.external_id === '78' || row.nama === 'Adobe Express 1 Year')
    || live.supplierProducts[0]
  hilang.is_available = false
  const forced = live.supplierProducts.find((row) => row.external_id === '4')
  forced.deskripsi = 'fulfillment:manual'

  const plan = regroup.planRegroup(live, mapping)
  const summary = regroup.summarize(plan)
  assert.equal(summary.writes.ensure_product, 50)
  assert.ok(summary.writes.deactivate_product >= 84)
  assert.equal(ops(plan, 'deactivate_product').some((op) => op.slug === 'canva-pro'), true)
  assert.equal(ops(plan, 'deactivate_product').some((op) => op.slug === 'netflix-family'), false)
  assert.equal(ops(plan, 'deactivate_product').some((op) => op.slug === 'spotify-solo'), false)
  assert.equal(ops(plan, 'unmap_offer').some((op) => op.external_id === '0a7a6040-fc71-4eea-8b64-da1e7ab1e3db'), true)
  assert.equal(ops(plan, 'unmap_offer').filter((op) => op.reason === 'manual').length, 7)
  assert.equal(plan.skips.filter((op) => op.reason === 'hilang' && op.id === hilang.id).length, 1)
  assert.equal(plan.writes.some((op) => op.supplier_product_id === hilang.id), false)
  assert.equal(ops(plan, 'remap_offer').some((op) => op.external_id === '4'), false)

  const spotify = ops(plan, 'ensure_product').find((op) => op.slug === 'spotify-premium-individual')
  assert.equal(spotify.reuse_id != null, true)
  assert.match(spotify.values.deskripsi, /Spotify Premium Individual/)
  assert.doesNotMatch(spotify.values.deskripsi, /uji/)
  const netflix30 = ops(plan, 'ensure_variant').find((op) => op.kode === 'netflix-30d')
  assert.equal(netflix30.values.label, '1 Bulan')
  assert.equal(netflix30.set_harga, false)

  const own = live.variants.find((variant) => variant.kode === 'spotify-1b')
  own.harga = 99999
  const applied = regroup.applyOpsInMemory(live, plan)
  assert.equal(applied.variants.find((variant) => variant.kode === 'spotify-1b').harga, 99999)
  assert.equal(applied.products.find((product) => product.id === spotify.reuse_id).slug, 'spotify-premium-individual')
  assert.equal(applied.products.find((product) => product.slug === 'canva-pro').is_active, false)
  const surf = applied.supplierProducts.filter((row) => (
    row.external_id === '79cfe6bd-098a-4273-bed7-0c09ae059975'
    || row.external_id === 'b563a028-054a-4299-bae9-1c3200c6f7d2'
  ))
  assert.equal(surf.length, 2)
  assert.equal(surf[0].varian_id, surf[1].varian_id)
  assert.equal(surf[0].mapping_mode, 'manual')
  const dropped = applied.supplierProducts.find((row) => row.external_id === '0a7a6040-fc71-4eea-8b64-da1e7ab1e3db')
  assert.equal(dropped.varian_id, null)
  assert.equal(dropped.mapping_mode, 'manual')
  assert.equal(applied.supplierProducts.find((row) => row.id === hilang.id).is_available, false)
  assert.equal(applied.supplierProducts.find((row) => row.id === hilang.id).mapping_mode, 'auto')

  const again = regroup.planRegroup(applied, mapping)
  assert.equal(again.writes.length, 0)
  assert.ok(again.skips.some((op) => op.reason === 'hilang'))

  const shell = {
    ...applied,
    products: applied.products.map((product) => (
      product.slug === 'google-ai-plus' ? { ...product, is_active: false, deskripsi: 'setengah jalan' } : product
    )),
    variants: applied.variants.filter((variant) => variant.kode !== 'ed-google-ai-plus-3-bulan-fw'
      && variant.kode !== 'ed-google-ai-plus-1-tahun-nw'),
  }
  const repaired = regroup.planRegroup(shell, mapping)
  const gap = repaired.writes.find((op) => op.op === 'ensure_product' && op.slug === 'google-ai-plus')
  assert.equal(gap.reuse_id != null, true)
  assert.equal(repaired.writes.some((op) => op.op === 'ensure_product' && op.slug === 'google-ai-plus' && !op.reuse_id), false)
})

test('contoh menu Google AI, CapCut, dan Canva', () => {
  for (const name of ['Google AI', 'CapCut', 'Canva']) {
    const sample = regroup.sampleBrand(mapping, name, formatrupiah)
    assert.ok(sample.count > 0, name)
    assert.match(sample.text, new RegExp(`\\*${name}\\* \\(${sample.count}\\)`))
    for (const item of sample.items) {
      assert.ok(item.text.length <= brand.BUTTON_MAX, item.text)
      assert.match(item.text, /\| \(stok\)$/)
    }
  }
  const google = regroup.sampleBrand(mapping, 'Google AI', formatrupiah)
  const plus = google.items.find((item) => item.label === '1 Tahun (NW)')
  assert.match(plus.text, /from /)
  const capcut = regroup.sampleBrand(mapping, 'CapCut', formatrupiah)
  assert.ok(capcut.items.some((item) => item.plan === 'CapCut Team'))
  assert.ok(capcut.items.some((item) => item.plan === 'CapCut Pro' && item.label === '1 Bulan (NW)'))
  const canva = regroup.sampleBrand(mapping, 'Canva', formatrupiah)
  assert.equal(canva.items.filter((item) => item.label === '1 Bulan').length, 3)

  for (const offer of mapping.offers) {
    if (!offer.variant_kode) continue
    assert.ok(brand.callbackFits(`v:${offer.variant_kode}`), offer.variant_kode)
    if (offer.brand) assert.ok(brand.callbackFits(`kategori_${offer.brand}`), offer.brand)
  }
})
