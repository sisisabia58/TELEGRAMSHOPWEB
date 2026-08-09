// lib/pricing.js — tiered unit price resolution
const supabase = require('./supabase')

function resolveUnitPrice(baseHarga, qty, tiers) {
  const base = Number(baseHarga) || 0
  const q = Number(qty) || 0
  const list = Array.isArray(tiers) ? tiers : []
  let best = null
  for (const t of list) {
    const min = Number(t.min_qty)
    if (!Number.isFinite(min) || min > q) continue
    if (!best || min > best.min_qty) best = { min_qty: min, harga: Number(t.harga) || 0 }
  }
  const harga_satuan = best ? best.harga : base
  return {
    harga_satuan,
    subtotal: harga_satuan * q,
    matched_min_qty: best ? best.min_qty : null,
  }
}

async function getTiersForVarian(varianId) {
  if (!varianId) return []
  const { data, error } = await supabase
    .from('HargaTier')
    .select('*')
    .eq('varian_id', varianId)
    .order('min_qty', { ascending: true })
  if (error) {
    console.error('pricing.getTiersForVarian:', error)
    return []
  }
  return data || []
}

async function resolveForVarian(varian, qty) {
  const tiers = await getTiersForVarian(varian?.id)
  return resolveUnitPrice(varian?.harga, qty, tiers)
}

module.exports = {
  resolveUnitPrice,
  getTiersForVarian,
  resolveForVarian,
}
