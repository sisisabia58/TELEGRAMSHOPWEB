# Bulk Upload Rework (Phase 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align dashboard bulk import/price/stock/tier/export and bot stock-add with Product → Variant → Stock (+ optional HargaTier), via pure `lib/bulk.js` helpers and fixed UI/API contracts.

**Architecture:** Extract pure normalize/group/compute helpers into `lib/bulk.js` (TDD). Rework `/bulk/*` routes to write `Produk`/`Varian`/`Stok`/`HargaTier` correctly. Fix `bulk-operations.ejs` to cascade product→variant and list variants for price updates. Fix bot `/addstok` + `.txt` upload to resolve `Varian` by kode. No schema migration.

**Tech Stack:** Node.js 20, Express 5 + EJS, `@supabase/supabase-js`, multer + csv-parser + xlsx, Telegram Bot API, `node --test`, Railway + Supabase.

**Design spec:** [docs/superpowers/specs/2026-08-09-bulk-upload-design.md](../specs/2026-08-09-bulk-upload-design.md)

## Global Constraints

- Discounts = tiered unit prices + vouchers (Phase 3); mass price update touches **`Varian.harga` only**, never invents a third discount type
- `kode` lives on the variant; every imported product must create ≥1 variant in the same import
- Keep EJS + vanilla JS; no React/Vue
- Tests: pure functions only via `node --test`; prefer pure helpers (no Telegram/HTTP integration tests)
- Leave `User`, `Deposit`, `Payment`, `Voucher` schema alone; deposit bulk approve/reject UI/routes unchanged
- Do not start Phase 5+ work in this plan
- No destructive migrations; no new tables
- Catalog re-import does **not** overwrite existing product deskripsi/snk (skip product fields; may add variants)

---

## File map

| File | Responsibility |
|------|----------------|
| `lib/bulk.js` | Pure normalize/group/parse/compute helpers |
| `test/bulk.test.js` | Unit tests for `lib/bulk.js` |
| `dashboard.js` | Rework import, templates, update-harga, stock parse, tier import, export produk |
| `views/bulk-operations.ejs` | Variant-aware price list, stock cascade, tier upload section, template links |
| `index.js` | Fix `/addstok` + interactive + `.txt` upload to `catalog.getVariantByKode` |
| `docs/runbooks/phase4-bulk-upload.md` | Templates + verification checklist |
| Update | `docs/superpowers/plans/2026-08-09-admin-ux-overhaul-roadmap.md` Phase 3 Done / Phase 4 plan linked |

---

### Task 1: Design + roadmap + runbook stubs

**Files:**
- Create: `docs/superpowers/specs/2026-08-09-bulk-upload-design.md` (verify present)
- Create: `docs/runbooks/phase4-bulk-upload.md`
- Modify: `docs/superpowers/plans/2026-08-09-admin-ux-overhaul-roadmap.md`

**Interfaces:**
- Consumes: Phase 2 `Produk`/`Varian`/`Stok`, Phase 3 `HargaTier`
- Produces: ops checklist + roadmap status

- [ ] **Step 1: Write the runbook**

Create `docs/runbooks/phase4-bulk-upload.md`:

```markdown
# Phase 4 cutover runbook — Bulk upload rework

1. Confirm Phase 2+3 live (`Varian`, `HargaTier` exist).
2. Merge Phase 4 PR → Railway deploys from `main` (no DB migration).
3. Download templates from `/bulk`:
   - Catalog: `/bulk/produk/template`
   - Tiers: `/bulk/tiers/template`
4. Smoke:
   - Import 1 product / 2 variants CSV → appear on `/produk/:id`
   - Bulk update harga on one variant → `Varian.harga` changes
   - Bulk stok: pick product → variant → paste 3 lines → Stok count +3
   - Tier CSV for existing `varian_kode` → dashboard tier panel shows rows
   - Bot: `/addstok <varian_kode>|line1` succeeds
5. Deposit bulk approve still loads pending deposits.
```

- [ ] **Step 2: Update roadmap**

In `docs/superpowers/plans/2026-08-09-admin-ux-overhaul-roadmap.md`:

- Phase 3 status → **Done**
- Phase 4 plan file → `[2026-08-09-bulk-upload.md](./2026-08-09-bulk-upload.md)`, status → **Plan ready**

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-08-09-bulk-upload-design.md \
  docs/runbooks/phase4-bulk-upload.md \
  docs/superpowers/plans/2026-08-09-admin-ux-overhaul-roadmap.md \
  docs/superpowers/plans/2026-08-09-bulk-upload.md
git commit -m "docs(phase4): bulk upload design, plan, and runbook"
```

---

### Task 2: `lib/bulk.js` + tests (TDD)

**Files:**
- Create: `lib/bulk.js`
- Create: `test/bulk.test.js`

**Interfaces:**
- Consumes: `catalog.slugify` (pure sync export from `./catalog`)
- Produces:
  - `pick(row, keys: string[]): string`
  - `normalizeCatalogRow(row): { ok:true, value } | { ok:false, error:string }`
  - `groupCatalogRows(rawRows): { products: Array<{slug,nama,kategori,deskripsi,snk,variants}>, failures }`
  - `parseStockLines(text: string): string[]`
  - `normalizeTierRow(row): { ok:true, value:{varian_kode,min_qty,harga} } | { ok:false, error }`
  - `computeNewHarga(oldHarga, update_type, value): { ok:true, harga } | { ok:false, error }`

- [ ] **Step 1: Write the failing tests**

```js
// test/bulk.test.js
const test = require('node:test')
const assert = require('node:assert')
const bulk = require('../lib/bulk')

test('normalizeCatalogRow requires produk_nama, varian fields, harga', () => {
  const bad = bulk.normalizeCatalogRow({ produk_nama: 'X' })
  assert.equal(bad.ok, false)

  const good = bulk.normalizeCatalogRow({
    produk_nama: 'Netflix',
    deskripsi: 'desc',
    snk: 'snk',
    varian_label: '7 Hari',
    varian_kode: 'Netflix-7D',
    harga: '15000',
  })
  assert.equal(good.ok, true)
  assert.equal(good.value.slug, 'netflix')
  assert.equal(good.value.varian.kode, 'netflix-7d')
  assert.equal(good.value.varian.harga, 15000)
  assert.equal(good.value.kategori, 'umum')
})

test('groupCatalogRows groups variants under one slug', () => {
  const { products, failures } = bulk.groupCatalogRows([
    {
      produk_nama: 'Netflix', deskripsi: 'd', snk: 's',
      varian_label: '7d', varian_kode: 'netflix-7d', harga: 15000,
    },
    {
      produk_nama: 'Netflix', deskripsi: 'ignored', snk: 'ignored',
      varian_label: '1b', varian_kode: 'netflix-1b', harga: 45000,
    },
  ])
  assert.equal(failures.length, 0)
  assert.equal(products.length, 1)
  assert.equal(products[0].variants.length, 2)
  assert.equal(products[0].deskripsi, 'd')
})

test('groupCatalogRows reports duplicate kode in file as failure', () => {
  const { failures } = bulk.groupCatalogRows([
    {
      produk_nama: 'A', deskripsi: 'd', snk: 's',
      varian_label: '1', varian_kode: 'same', harga: 1,
    },
    {
      produk_nama: 'B', deskripsi: 'd', snk: 's',
      varian_label: '2', varian_kode: 'same', harga: 2,
    },
  ])
  assert.ok(failures.some((f) => /duplikat/i.test(f.error)))
})

test('parseStockLines splits on newlines and commas', () => {
  assert.deepEqual(bulk.parseStockLines('a:b\nc:d, e:f\n'), ['a:b', 'c:d', 'e:f'])
})

test('normalizeTierRow enforces min_qty >= 2', () => {
  assert.equal(bulk.normalizeTierRow({ varian_kode: 'x', min_qty: 1, harga: 10 }).ok, false)
  const r = bulk.normalizeTierRow({ varian_kode: 'X', min_qty: 5, harga: '12000' })
  assert.equal(r.ok, true)
  assert.equal(r.value.varian_kode, 'x')
  assert.equal(r.value.min_qty, 5)
  assert.equal(r.value.harga, 12000)
})

test('computeNewHarga percentage and fixed', () => {
  assert.equal(bulk.computeNewHarga(10000, 'percentage', 10).harga, 11000)
  assert.equal(bulk.computeNewHarga(10000, 'fixed', -2500).harga, 7500)
  assert.equal(bulk.computeNewHarga(1000, 'fixed', -2000).ok, false)
})
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
node --test test/bulk.test.js
```

Expected: FAIL with `Cannot find module '../lib/bulk.js'` (or missing exports).

- [ ] **Step 3: Implement `lib/bulk.js`**

```js
// lib/bulk.js
const { slugify } = require('./catalog')

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
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
node --test test/bulk.test.js
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/bulk.js test/bulk.test.js
git commit -m "feat(phase4): add lib/bulk pure catalog/stock/tier helpers"
```

---

### Task 3: Rework catalog import + templates in dashboard

**Files:**
- Modify: `dashboard.js` (require `lib/bulk`; replace `POST /bulk/produk/import` and `GET /bulk/produk/template`; add `GET /bulk/tiers/template`)

**Interfaces:**
- Consumes: `bulk.groupCatalogRows`, existing `parseCSV`/`parseExcel`/`cleanupFile`
- Produces: import creates `Produk` then `Varian` rows; template CSV matches design columns

- [ ] **Step 1: Add require near other libs**

```js
const bulk = require('./lib/bulk')
```

- [ ] **Step 2: Replace product template route + add tier template**

```js
app.get('/bulk/produk/template', isAuthenticated, (req, res) => {
  const csvContent = `produk_nama,produk_slug,kategori,deskripsi,snk,varian_label,varian_kode,harga,format
Netflix,netflix,streaming,Akun Netflix,S&K berlaku,7 Hari,netflix-7d,15000,Email:Password
Netflix,netflix,streaming,Akun Netflix,S&K berlaku,1 Bulan,netflix-1b,45000,Email:Password
Spotify Solo,spotify-solo,streaming,Akun Spotify,S&K berlaku,Default,spotify-solo,25000,Email:Password
`
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', 'attachment; filename=template-import-katalog.csv')
  res.send('\ufeff' + csvContent)
})

app.get('/bulk/tiers/template', isAuthenticated, (req, res) => {
  const csvContent = `varian_kode,min_qty,harga
netflix-7d,5,12000
netflix-7d,10,10000
`
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', 'attachment; filename=template-import-tiers.csv')
  res.send('\ufeff' + csvContent)
})
```

- [ ] **Step 3: Replace import handler body (keep multer/parse shell)**

Inside `POST /bulk/produk/import`, after parsing `data` array, replace the per-row insert loop with:

```js
    const { products, failures } = bulk.groupCatalogRows(data)
    const results = { success: [], failed: failures.map((f) => ({ row: f.row, error: f.error })), skipped: [] }

    for (const product of products) {
      try {
        const { data: existingProduk } = await supabase
          .from('Produk')
          .select('id, slug')
          .eq('slug', product.slug)
          .maybeSingle()

        let produkId = existingProduk?.id || null

        if (!produkId) {
          const { data: created, error: createErr } = await supabase
            .from('Produk')
            .insert([{
              nama: product.nama,
              slug: product.slug,
              kategori: product.kategori,
              deskripsi: product.deskripsi,
              snk: product.snk,
              is_active: true,
              urutan: 0,
            }])
            .select('id')
            .single()
          if (createErr) {
            results.failed.push({ row: null, error: `Produk ${product.slug}: ${createErr.message}` })
            continue
          }
          produkId = created.id
          await logActivity(req, 'BULK_IMPORT_PRODUK', 'Produk', produkId, { slug: product.slug, nama: product.nama })
        }

        for (const varian of product.variants) {
          const { data: existingVar } = await supabase
            .from('Varian')
            .select('id, kode')
            .eq('kode', varian.kode)
            .maybeSingle()

          if (existingVar) {
            results.skipped.push({ kode: varian.kode, reason: 'varian_kode sudah ada' })
            continue
          }

          const { count } = await supabase
            .from('Varian')
            .select('*', { count: 'exact', head: true })
            .eq('produk_id', produkId)

          const { data: newVar, error: varErr } = await supabase
            .from('Varian')
            .insert([{
              produk_id: produkId,
              label: varian.label,
              kode: varian.kode,
              harga: varian.harga,
              format: varian.format,
              is_active: true,
              urutan: count || 0,
              terjual: 0,
            }])
            .select('id, kode')
            .single()

          if (varErr) {
            results.failed.push({ kode: varian.kode, error: varErr.message })
          } else {
            results.success.push({ produk_id: produkId, varian_id: newVar.id, kode: newVar.kode })
            await logActivity(req, 'BULK_IMPORT_VARIAN', 'Varian', newVar.id, { kode: newVar.kode })
          }
        }
      } catch (error) {
        results.failed.push({ slug: product.slug, error: error.message })
      }
    }

    cleanupFile(filePath)
    res.json({
      success: true,
      results: {
        total: data.length,
        success: results.success.length,
        failed: results.failed.length,
        skipped: results.skipped.length,
        details: results,
      },
    })
```

Remove the old `Produk` insert that used `kode`/`harga`/`data`/`terjual`.

- [ ] **Step 4: Syntax check**

```bash
node --check dashboard.js
```

Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add dashboard.js
git commit -m "feat(phase4): catalog CSV import creates Produk+Varian"
```

---

### Task 4: Mass price update → Varian + tier CSV import

**Files:**
- Modify: `dashboard.js` (`POST /bulk/produk/update-harga`, add `POST /bulk/tiers/import`, use `bulk.parseStockLines` in stock route)

**Interfaces:**
- Consumes: `bulk.computeNewHarga`, `bulk.normalizeTierRow`, `bulk.parseStockLines`
- Produces: `{ varian_ids, update_type, value }` updates; tier upsert JSON results

- [ ] **Step 1: Replace update-harga to select/update Varian**

```js
app.post('/bulk/produk/update-harga', isAuthenticated, async (req, res) => {
  try {
    const { varian_ids, update_type, value } = req.body
    if (!varian_ids || !Array.isArray(varian_ids) || varian_ids.length === 0) {
      return res.json({ success: false, error: 'Pilih minimal 1 varian' })
    }
    if (!update_type || value === undefined || value === null || value === '') {
      return res.json({ success: false, error: 'Tipe update dan nilai wajib diisi' })
    }
    const valueNum = parseFloat(value)
    if (isNaN(valueNum)) return res.json({ success: false, error: 'Nilai tidak valid' })

    const { data: variants, error: fetchError } = await supabase
      .from('Varian')
      .select('id, label, kode, harga, produk_id')
      .in('id', varian_ids)
    if (fetchError) throw fetchError

    const results = { success: [], failed: [] }
    for (const variant of variants || []) {
      const computed = bulk.computeNewHarga(variant.harga, update_type, valueNum)
      if (!computed.ok) {
        results.failed.push({ varian_id: variant.id, error: computed.error })
        continue
      }
      const { error: updateError } = await supabase
        .from('Varian')
        .update({ harga: computed.harga })
        .eq('id', variant.id)
      if (updateError) {
        results.failed.push({ varian_id: variant.id, error: updateError.message })
      } else {
        results.success.push({
          varian_id: variant.id,
          kode: variant.kode,
          label: variant.label,
          harga_lama: variant.harga,
          harga_baru: computed.harga,
        })
        await logActivity(req, 'BULK_UPDATE_HARGA', 'Varian', variant.id, {
          kode: variant.kode,
          harga_lama: variant.harga,
          harga_baru: computed.harga,
          update_type,
        })
      }
    }

    res.json({
      success: true,
      results: {
        total: (variants || []).length,
        success: results.success.length,
        failed: results.failed.length,
        details: results,
      },
    })
  } catch (error) {
    console.error('Error bulk updating prices:', error)
    res.json({ success: false, error: error.message })
  }
})
```

- [ ] **Step 2: Add tier import route**

```js
app.post('/bulk/tiers/import', isAuthenticated, upload.single('file'), async (req, res) => {
  let filePath = null
  try {
    if (!req.file) return res.json({ success: false, error: 'File tidak ditemukan' })
    filePath = req.file.path
    const fileExt = path.extname(req.file.originalname).toLowerCase()
    let data = []
    if (fileExt === '.csv') data = await parseCSV(filePath)
    else if (fileExt === '.xlsx' || fileExt === '.xls') data = await parseExcel(filePath)
    else {
      cleanupFile(filePath)
      return res.json({ success: false, error: 'Format file tidak didukung' })
    }

    const results = { success: [], failed: [], skipped: [] }
    for (let i = 0; i < data.length; i++) {
      const rowNum = i + 2
      const norm = bulk.normalizeTierRow(data[i])
      if (!norm.ok) {
        results.failed.push({ row: rowNum, error: norm.error })
        continue
      }
      const { varian_kode, min_qty, harga } = norm.value
      const { data: varian } = await supabase
        .from('Varian')
        .select('id, kode')
        .eq('kode', varian_kode)
        .maybeSingle()
      if (!varian) {
        results.failed.push({ row: rowNum, error: `varian tidak ditemukan: ${varian_kode}` })
        continue
      }

      const { data: existing } = await supabase
        .from('HargaTier')
        .select('id')
        .eq('varian_id', varian.id)
        .eq('min_qty', min_qty)
        .maybeSingle()

      if (existing) {
        const { error } = await supabase
          .from('HargaTier')
          .update({ harga })
          .eq('id', existing.id)
        if (error) results.failed.push({ row: rowNum, error: error.message })
        else results.success.push({ row: rowNum, action: 'update', varian_kode, min_qty, harga })
      } else {
        const { error } = await supabase
          .from('HargaTier')
          .insert([{ varian_id: varian.id, min_qty, harga }])
        if (error) results.failed.push({ row: rowNum, error: error.message })
        else results.success.push({ row: rowNum, action: 'insert', varian_kode, min_qty, harga })
      }
    }

    cleanupFile(filePath)
    res.json({
      success: true,
      results: {
        total: data.length,
        success: results.success.length,
        failed: results.failed.length,
        details: results,
      },
    })
  } catch (error) {
    if (filePath) cleanupFile(filePath)
    console.error('Error bulk importing tiers:', error)
    res.json({ success: false, error: error.message })
  }
})
```

- [ ] **Step 3: Use `bulk.parseStockLines` in `POST /bulk/stok/tambah`**

```js
    const dataArray = bulk.parseStockLines(data_stok)
```

- [ ] **Step 4: Commit**

```bash
git add dashboard.js
git commit -m "feat(phase4): variant mass price update and tier CSV import"
```

---

### Task 5: Export produk as variant rows

**Files:**
- Modify: `dashboard.js` (`GET /bulk/export` case `produk`)

**Interfaces:**
- Consumes: `catalog.listProducts({ activeOnly: false, withStock: false })`
- Produces: CSV/JSON/Excel rows with catalog import columns

- [ ] **Step 1: Replace `case 'produk'` data assembly**

```js
      case 'produk': {
        const list = await catalog.listProducts({ activeOnly: false, withStock: false })
        data = []
        for (const p of list) {
          for (const v of p.variants || []) {
            data.push({
              produk_nama: p.nama,
              produk_slug: p.slug,
              kategori: p.kategori,
              deskripsi: p.deskripsi,
              snk: p.snk,
              varian_label: v.label,
              varian_kode: v.kode,
              harga: v.harga,
              format: v.format || '',
            })
          }
        }
        filename = 'katalog'
        headers = [
          'produk_nama', 'produk_slug', 'kategori', 'deskripsi', 'snk',
          'varian_label', 'varian_kode', 'harga', 'format',
        ]
        break
      }
```

- [ ] **Step 2: Replace CSV row builder for `produk`**

```js
          case 'produk':
            row.push(
              `"${(item.produk_nama || '').replace(/"/g, '""')}"`,
              `"${(item.produk_slug || '').replace(/"/g, '""')}"`,
              `"${(item.kategori || '').replace(/"/g, '""')}"`,
              `"${(item.deskripsi || '').replace(/"/g, '""')}"`,
              `"${(item.snk || '').replace(/"/g, '""')}"`,
              `"${(item.varian_label || '').replace(/"/g, '""')}"`,
              `"${(item.varian_kode || '').replace(/"/g, '""')}"`,
              item.harga || 0,
              `"${(item.format || '').replace(/"/g, '""')}"`
            )
            break
```

- [ ] **Step 3: Commit**

```bash
git add dashboard.js
git commit -m "feat(phase4): export katalog as one row per variant"
```

---

### Task 6: Fix `bulk-operations.ejs` UI

**Files:**
- Modify: `views/bulk-operations.ejs`

**Interfaces:**
- Consumes: `/api/produk/list` → `{ products: [{ id, nama, variants:[{id,label,kode,harga}] }] }`
- Produces: variant checkboxes for price; product→variant cascade for stock; tier upload form

- [ ] **Step 1: Update import blurb + add tier section HTML**

Change catalog import help to mention product+variant columns. After the catalog import card, add a tier import card with upload area posting to `/bulk/tiers/import`, template link `/bulk/tiers/template`, and `#tierImportResults`.

- [ ] **Step 2: Replace price form product list with variant checkboxes**

Title → “Bulk Update Harga Varian”. Each checkbox:

```js
input.value = variant.id
input.name = 'varian_ids'
// label: `${produk.nama} — ${variant.label} (${variant.kode}) — ${variant.harga}`
```

Submit body: `{ varian_ids, update_type, value }` (not `produk_ids`).

- [ ] **Step 3: Fix stock form cascade**

```html
<select name="produk_id" id="produk_id_stok" class="form-select" required>...</select>
<select name="varian_id" id="varian_id_stok" class="form-select" required>
  <option value="">-- Pilih Varian --</option>
</select>
```

Cache `/api/produk/list` products; on product change, fill variant options. Submit `{ varian_id, data_stok }`. Remove uses of `produk.kode` / `produk.harga` at product level.

- [ ] **Step 4: Wire tier import form JS** (FormData file → `POST /bulk/tiers/import`).

- [ ] **Step 5: Commit**

```bash
git add views/bulk-operations.ejs
git commit -m "feat(phase4): bulk UI for variants, stock cascade, tier import"
```

---

### Task 7: Fix bot `/addstok` + `.txt` upload

**Files:**
- Modify: `index.js`

**Interfaces:**
- Consumes: `catalog.getVariantByKode(kode)`, `addStokItems(varianId, varianKode, dataArray)`, `getStokCount` / stock helpers
- Produces: owner stock-add works against `Varian.kode`

- [ ] **Step 1: Fix quick `/addstok kode|data` path**

Replace `Produk` lookup (~1512–1573) with `catalog.getVariantByKode(kode)` then `addStokItems(item.id, item.kode, dataArray)`. Feed message uses `item.produk?.nama`, `item.label`, `item.harga`.

- [ ] **Step 2: Fix interactive + `.txt` handlers**

```bash
rg -n "addStokItems|Produk\.data|/addstok|addstok_template|upload file stok" index.js
```

List variants from `catalog.listProducts` (display `${p.nama} — ${v.label}`, kode = `v.kode`). Session/state must store **varian id**. For `.txt` upload: never read `Produk.data`; resolve kode via `getVariantByKode`; YAGNI skip dupe check if it depended on removed column.

- [ ] **Step 3: Syntax check**

```bash
node --check index.js
```

Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add index.js
git commit -m "feat(phase4): bot addstok resolves Varian by kode"
```

---

### Task 8: Full verification

**Files:** none required (ops + tests)

- [ ] **Step 1: Run full test suite**

```bash
node --test
```

Expected: all existing + `test/bulk.test.js` PASS.

- [ ] **Step 2: Manual E2E checklist (Phase 4-specific)**

1. Import template CSV → Netflix with 2 variants + Spotify Solo
2. Re-import same `netflix-7d` → skipped, no crash
3. Mass +10% on `netflix-7d` → base harga updates; tiers unchanged
4. Bulk stok cascade → 3 lines inserted
5. Tier CSV upsert → dashboard product detail tier panel shows min_qty 5/10
6. Export katalog CSV columns match import template
7. `/addstok netflix-7d|a:b` succeeds
8. Deposit bulk load still works

- [ ] **Step 3: Final push / update PR**

```bash
git push -u origin HEAD
```

---

## Spec coverage self-review

| Spec requirement | Task |
|------------------|------|
| Catalog CSV → Produk + Varian grouped by slug | Task 2–3 |
| Mass price → `Varian.harga` only | Task 4 + 6 |
| Bulk stock UI posts `varian_id` | Task 6 |
| Tier CSV upsert | Task 4 + 6 |
| Bot addstok / .txt → Varian | Task 7 |
| Export variant rows | Task 5 |
| Pure `lib/bulk.js` + tests | Task 2 |
| Deposit bulk unchanged | (excluded) |
| No migration / no Phase 5+ | Global constraints |

## Placeholder scan

No TBD/TODO steps. All tasks include concrete code, commands, and expected outcomes.

## Type consistency

- `normalizeCatalogRow` → `{ ok, value:{ nama, slug, kategori, deskripsi, snk, varian:{label,kode,harga,format} } }`
- `groupCatalogRows` → `{ products, failures }`
- `normalizeTierRow` → `{ ok, value:{ varian_kode, min_qty, harga } }`
- `computeNewHarga(old, 'percentage'|'fixed', value)` → `{ ok, harga }`
- API: update-harga body `varian_ids`; stock body `varian_id`; tier import `POST /bulk/tiers/import`
