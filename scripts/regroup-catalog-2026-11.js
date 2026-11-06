#!/usr/bin/env node
// Regroup katalog Teleshop ke menu brand (2026-11-06).
//
// Bawaan: dry-run. Tidak menulis apa pun.
//   node scripts/regroup-catalog-2026-11.js
//   node scripts/regroup-catalog-2026-11.js --apply
//   node scripts/regroup-catalog-2026-11.js --apply --allow-remote
//   node scripts/regroup-catalog-2026-11.js --rollback regroup-rollback.json
//
// --apply ke host selain localhost ditolak tanpa --allow-remote.
// Baris supplier is_available !== true (HILANG) tidak diubah.
// Penawaran manual dan harga 0 dilepas (mapping_mode manual, varian kosong)
// supaya sinkron berikutnya tidak menempelkannya lagi.
// Produk lama tidak dihapus; yang [dibuat sync] hanya dinonaktifkan.
const fs = require('fs')
const path = require('path')
const regroup = require('../lib/catalog-regroup')

const MAPPING = path.join(__dirname, '..', 'data', 'catalog-regroup-2026-11-06.json')
const ROLLBACK_FILE = path.join(process.cwd(), 'regroup-rollback.json')

function argValue(flag) {
  const i = process.argv.indexOf(flag)
  if (i === -1) return null
  return process.argv[i + 1] || null
}

function isLocalUrl(url) {
  try {
    const host = new URL(url).hostname
    return host === 'localhost' || host === '127.0.0.1'
  } catch {
    return false
  }
}

function guardRemote(url, { apply }) {
  if (!url) {
    console.error('SUPABASE_URL kosong. Isi .env dulu. Tidak ada yang ditulis.')
    process.exit(1)
  }
  let host = url
  try { host = new URL(url).host } catch { /* biarkan mentah */ }
  console.log(`Database: ${host}`)
  if (apply && !isLocalUrl(url) && !process.argv.includes('--allow-remote')) {
    console.error('Menolak --apply ke database yang bukan localhost.')
    console.error('Tinjau dry-run, lalu ulang dengan --apply --allow-remote kalau ini memang database yang dituju.')
    process.exit(2)
  }
}

async function main() {
  const mapping = regroup.loadMapping(MAPPING)
  const rollbackPath = argValue('--rollback')
  const apply = process.argv.includes('--apply')
  if (apply && rollbackPath) {
    console.error('Pilih salah satu: --apply atau --rollback.')
    process.exit(1)
  }

  const { SUPABASE_URL } = require('../settings')
  guardRemote(SUPABASE_URL, { apply: apply || Boolean(rollbackPath) })
  const supabase = require('../lib/supabase')

  if (rollbackPath) {
    const payload = JSON.parse(fs.readFileSync(rollbackPath, 'utf8'))
    const n = await regroup.applyUndos(supabase, payload)
    console.log(`Rollback ${n} operasi dari ${rollbackPath}`)
    return
  }

  const live = await regroup.fetchLive(supabase)
  const plan = regroup.planRegroup(live, mapping)
  if (!apply) console.log('DRY-RUN. Tidak ada yang ditulis. Tambah --apply untuk menulis.')
  regroup.printPlan(plan, mapping)
  if (!apply) return

  const result = await regroup.applyPlan(supabase, plan, live)
  const payload = {
    at: new Date().toISOString(),
    supabase_host: (() => { try { return new URL(SUPABASE_URL).host } catch { return '' } })(),
    undos: result.undos,
  }
  fs.writeFileSync(ROLLBACK_FILE, `${JSON.stringify(payload, null, 2)}\n`)
  console.log(`Tersimpan. Rollback: node scripts/regroup-catalog-2026-11.js --rollback ${ROLLBACK_FILE}`)
}

main().catch((error) => {
  console.error(error.message || error)
  process.exit(1)
})
