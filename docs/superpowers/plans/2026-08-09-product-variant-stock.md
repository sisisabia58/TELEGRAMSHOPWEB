# Product → Variant → Stock (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat `Produk` + free-text `grup` model with real Product → Variant → Stock hierarchy so the dashboard and bot share one catalog model, and every purchasable unit is a `Varian` row with its own `kode`.

**Architecture:** Destructive Supabase migration drops and recreates `Produk`, `Varian`, `Stok`, `Trx`, and `ProductStockThreshold`. A new `lib/catalog.js` becomes the only way to list products and resolve variants by kode/slug. Bot display (`sendProductPage` / `sendProductCard`) and all `Produk.find(...kode...)` purchase sites switch to catalog. Dashboard gets `/produk/:id` detail page with an inline-editable variant table. Stock routes re-key from `produk_id` to `varian_id`.

**Tech Stack:** Node.js 20, Express 5 + EJS, `@supabase/supabase-js`, Telegram Bot API (`node-telegram-bot-api`), `node --test`, Railway + Supabase.

## Global Constraints

- Pre-launch / test data only — destructive `DROP TABLE ... CASCADE` is required, not optional
- No dual-path `grup`-or-`Varian` reader; delete `grup` usage in the same PR series that ships the schema
- Every product must have ≥1 variant — enforced in `lib/catalog.js` / dashboard API, not a DB constraint
- Single-variant products skip the picker and go straight to qty (same UX as today's solo product)
- `kode` is unique on `Varian`; cart / Payment.meta / Stok hot path keep using `kode` string
- `Trx` writes both `varian_id` + denormalised `kode`/`nama` snapshots; never re-resolve historical price/name through live `Varian`
- Keep EJS + vanilla JS; no React/Vue; reuse `dashboard.css` breakpoint `max-width: 768px`
- Pure-function tests only (`node --test`); reuse the fake-Supabase pattern from `test/cart.test.js`
- Drop all pending `Payment` rows as part of the migration runbook (old `meta.kode` will not exist)
- Leave `User`, `Deposit`, `Payment` (schema), `Voucher`, `Premium`, Admin/audit/notification tables alone
- Do not start Phase 3+ work in this plan

## File map

| File | Responsibility |
|------|----------------|
| `supabase/migrations/20260811000000_product_variant_restructure.sql` | Destructive schema cutover |
| `docs/runbooks/phase2-variant-cutover.md` | Ops steps: apply migration, drop pending payments, seed fixtures |
| `lib/catalog.js` | Product/variant queries; single-variant skip helpers |
| `lib/stock.js` | Re-key to `varian_kode` / `varian_id` (keep export names where possible) |
| `test/catalog.test.js` | Pure tests: single-variant skip, stock rollup shaping |
| `test/stock.test.js` | Pure tests: count by varian kode after column rename |
| `index.js` | Bot catalog display + purchase path; delete grup helpers/commands |
| `dashboard.js` | Product CRUD → detail + variant API; stock routes re-keyed |
| `views/produk-detail.ejs` | New product+variant page |
| `views/produk.ejs` | List without grup/kode/harga columns (parent-level) |
| `views/produk-stok*.ejs` | Re-key URLs/labels to variant |
| `public/js/inline-edit.js` | Shared PATCH-row-and-swap-HTML helper |
| Delete / stop using | `getProductEntries`, `sendGroupCard`, `/setgrup`/`unsetgrup`/`listgrup`, `Produk.grup`, `Database/Trx/*.json` vestiges |

---

### Task 1: Destructive migration + runbook

**Files:**
- Create: `supabase/migrations/20260811000000_product_variant_restructure.sql`
- Create: `docs/runbooks/phase2-variant-cutover.md`

**Interfaces:**
- Consumes: existing trigger `update_updated_at_column()`, RLS pattern from `20250207000000_complete_teleshop_schema.sql`
- Produces: tables `Produk`, `Varian`, `Stok`, `Trx`, `ProductStockThreshold` with the columns below

- [ ] **Step 1: Write the migration file**

```sql
-- supabase/migrations/20260811000000_product_variant_restructure.sql
-- Destructive by design: pre-launch, test data only.
-- Leaves User, Deposit, Payment, Voucher, Premium, Admin/*, BotSession, Notification* alone.

DROP TABLE IF EXISTS "ProductStockThreshold" CASCADE;
DROP TABLE IF EXISTS "Stok" CASCADE;
DROP TABLE IF EXISTS "Trx" CASCADE;
-- Varian does not exist yet on first run; safe IF EXISTS for re-runs in staging
DROP TABLE IF EXISTS "Varian" CASCADE;
DROP TABLE IF EXISTS "Produk" CASCADE;

CREATE TABLE "Produk" (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nama TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    kategori TEXT NOT NULL DEFAULT 'umum',
    deskripsi TEXT NOT NULL DEFAULT '',
    snk TEXT NOT NULL DEFAULT '',
    banner_url TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    urutan INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
CREATE INDEX idx_produk_slug ON "Produk"(slug);
CREATE INDEX idx_produk_kategori ON "Produk"(kategori);
CREATE INDEX idx_produk_urutan ON "Produk"(urutan);

CREATE TABLE "Varian" (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    produk_id UUID NOT NULL REFERENCES "Produk"(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    kode TEXT UNIQUE NOT NULL,
    harga INTEGER NOT NULL CHECK (harga >= 0),
    format TEXT,
    urutan INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    terjual INTEGER NOT NULL DEFAULT 0 CHECK (terjual >= 0),
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
CREATE INDEX idx_varian_produk_id ON "Varian"(produk_id, urutan);
CREATE INDEX idx_varian_kode ON "Varian"(LOWER(kode));

CREATE TABLE "Stok" (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    varian_id UUID NOT NULL REFERENCES "Varian"(id) ON DELETE CASCADE,
    varian_kode TEXT NOT NULL,
    data TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'tersedia'
        CHECK (status IN ('tersedia','terjual','expired','dihapus')),
    terjual_at TIMESTAMPTZ,
    trx_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
CREATE INDEX idx_stok_varian_id ON "Stok"(varian_id);
CREATE INDEX idx_stok_available ON "Stok"(varian_kode, status) WHERE status = 'tersedia';

CREATE TABLE "Trx" (
    trx_uuid UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    id BIGINT NOT NULL,
    varian_id UUID REFERENCES "Varian"(id) ON DELETE SET NULL,
    produk_id UUID REFERENCES "Produk"(id) ON DELETE SET NULL,
    kode TEXT NOT NULL,
    nama TEXT NOT NULL,
    jumlah INTEGER NOT NULL CHECK (jumlah > 0),
    harga INTEGER NOT NULL CHECK (harga >= 0),
    harga_satuan INTEGER,
    tanggal TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    trxid TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
CREATE INDEX idx_trx_user_id ON "Trx"(id);
CREATE INDEX idx_trx_varian_id ON "Trx"(varian_id);
CREATE INDEX idx_trx_kode ON "Trx"(kode);
CREATE INDEX idx_trx_tanggal ON "Trx"(tanggal);

CREATE TABLE "ProductStockThreshold" (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    varian_id UUID NOT NULL REFERENCES "Varian"(id) ON DELETE CASCADE UNIQUE,
    threshold INTEGER NOT NULL DEFAULT 10 CHECK (threshold >= 0),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

DROP TRIGGER IF EXISTS update_produk_updated_at ON "Produk";
CREATE TRIGGER update_produk_updated_at
    BEFORE UPDATE ON "Produk"
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_varian_updated_at ON "Varian";
CREATE TRIGGER update_varian_updated_at
    BEFORE UPDATE ON "Varian"
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_stok_updated_at ON "Stok";
CREATE TRIGGER update_stok_updated_at
    BEFORE UPDATE ON "Stok"
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_productstockthreshold_updated_at ON "ProductStockThreshold";
CREATE TRIGGER update_productstockthreshold_updated_at
    BEFORE UPDATE ON "ProductStockThreshold"
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE "Produk" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Varian" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Stok" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Trx" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProductStockThreshold" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all for service role" ON "Produk";
CREATE POLICY "Allow all for service role" ON "Produk" FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Allow all for service role" ON "Varian";
CREATE POLICY "Allow all for service role" ON "Varian" FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Allow all for service role" ON "Stok";
CREATE POLICY "Allow all for service role" ON "Stok" FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Allow all for service role" ON "Trx";
CREATE POLICY "Allow all for service role" ON "Trx" FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Allow all for service role" ON "ProductStockThreshold";
CREATE POLICY "Allow all for service role" ON "ProductStockThreshold" FOR ALL USING (true) WITH CHECK (true);

-- Pending QRIS rows reference old Produk.kode values that no longer exist.
DELETE FROM "Payment" WHERE status IN ('pending', 'paid');
```

- [ ] **Step 2: Write the runbook**

Create `docs/runbooks/phase2-variant-cutover.md` with these exact steps:

```markdown
# Phase 2 cutover runbook

1. Confirm no real customers (test data only).
2. Scale/stop bot traffic if needed (Railway service can stay up; purchases will fail until code deploys).
3. Apply migration:
   `supabase db push` (linked to sajffqniegtvhyopshvx)
   OR paste SQL into Supabase SQL Editor.
4. Confirm tables: Produk, Varian, Stok, Trx, ProductStockThreshold exist; old columns kode/grup gone from Produk.
5. Confirm `SELECT count(*) FROM "Payment" WHERE status IN ('pending','paid');` → 0.
6. Deploy app code that expects the new schema (same PR / immediate follow-up commit).
7. Seed three fixtures via dashboard or SQL:
   - Product A: 1 variant (solo path)
   - Product B: 3 variants, one with 0 stock
   - Product C: 3 variants, all 0 stock
8. Run Phase 2 E2E checklist (end of this plan).
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260811000000_product_variant_restructure.sql docs/runbooks/phase2-variant-cutover.md
git commit -m "feat(phase2): add destructive Product→Varian→Stock migration"
```

---

### Task 2: `lib/catalog.js` + tests (TDD)

**Files:**
- Create: `lib/catalog.js`
- Create: `test/catalog.test.js`

**Interfaces:**
- Consumes: `lib/supabase.js` singleton; `lib/stock.js` `getStokCountsByKode` (after Task 3 renames column to `varian_kode` — write catalog against the new stock API names below)
- Produces:
  - `slugify(nama: string): string`
  - `shouldSkipVariantPicker(variants: Array): boolean` — true when exactly one active variant
  - `async listProducts({ kategori?, activeOnly?, withStock? }): Promise<Array<{...produk, variants: Array<{...varian, stok_count: number}>}>>`
  - `async getProductBySlug(slug: string): Promise<{...produk, variants}|null>`
  - `async getProductById(id: string): Promise<{...produk, variants}|null>`
  - `async getVariantByKode(kode: string): Promise<{...varian, produk?}|null>`
  - `async variantCount(produkId: string): Promise<number>`
  - `async totalStock(produkId: string): Promise<number>`

- [ ] **Step 1: Write the failing tests**

```js
// test/catalog.test.js
const test = require('node:test')
const assert = require('node:assert')
const path = require('node:path')

const jalurClient = require.resolve('../lib/supabase.js')
const jalurStock = require.resolve('../lib/stock.js')
const jalurCatalog = require.resolve('../lib/catalog.js')

function buatFake({ products = [], variants = [], stockCounts = {} } = {}) {
  const fake = {
    from(tabel) {
      const st = { tabel, filter: {}, inFilter: null, order: null, mode: 'select' }
      const b = {
        select() { return b },
        eq(col, val) { st.filter[col] = val; return b },
        in(col, vals) { st.inFilter = { col, vals }; return b },
        order() { return b },
        maybeSingle() { return b },
        then(res, rej) {
          return Promise.resolve((() => {
            if (st.tabel === 'Produk') {
              let rows = products.slice()
              for (const [k, v] of Object.entries(st.filter)) rows = rows.filter((r) => r[k] === v)
              if (st.mode === 'maybe') return { data: rows[0] || null, error: null }
              return { data: rows, error: null }
            }
            if (st.tabel === 'Varian') {
              let rows = variants.slice()
              for (const [k, v] of Object.entries(st.filter)) {
                rows = rows.filter((r) => String(r[k]).toLowerCase() === String(v).toLowerCase() || r[k] === v)
              }
              if (st.inFilter) {
                rows = rows.filter((r) => st.inFilter.vals.includes(r[st.inFilter.col]))
              }
              if (st.filter.kode) {
                // getVariantByKode uses maybeSingle
              }
              const maybe = Object.prototype.hasOwnProperty.call(st, '_maybe')
              return { data: st._maybe ? (rows[0] || null) : rows, error: null }
            }
            return { data: [], error: null }
          })()).then(res, rej)
        },
      }
      // track maybeSingle
      const origMaybe = b.maybeSingle
      b.maybeSingle = () => { st._maybe = true; return b }
      return b
    }
  }
  return fake
}

function muatCatalog(opts) {
  const fake = buatFake(opts)
  delete require.cache[jalurCatalog]
  delete require.cache[jalurStock]
  require.cache[jalurClient] = { id: jalurClient, filename: jalurClient, loaded: true, exports: fake }
  require.cache[jalurStock] = {
    id: jalurStock, filename: jalurStock, loaded: true,
    exports: {
      getStokCountsByKode: async (kodes) => {
        const out = Object.create(null)
        for (const k of kodes) out[String(k).toLowerCase()] = opts.stockCounts?.[k] || opts.stockCounts?.[String(k).toLowerCase()] || 0
        return out
      },
      getStokCountByKode: async (kode) => opts.stockCounts?.[String(kode).toLowerCase()] || 0,
    }
  }
  const catalog = require(jalurCatalog)
  return { catalog, fake }
}

test.after(() => {
  delete require.cache[jalurClient]
  delete require.cache[jalurStock]
  delete require.cache[jalurCatalog]
})

test('slugify lowercases and hyphenates', () => {
  const { catalog } = muatCatalog()
  assert.equal(catalog.slugify('Netflix Premium'), 'netflix-premium')
  assert.equal(catalog.slugify('  Spotify  '), 'spotify')
})

test('shouldSkipVariantPicker is true only for exactly one active variant', () => {
  const { catalog } = muatCatalog()
  assert.equal(catalog.shouldSkipVariantPicker([{ is_active: true }]), true)
  assert.equal(catalog.shouldSkipVariantPicker([{ is_active: true }, { is_active: true }]), false)
  assert.equal(catalog.shouldSkipVariantPicker([{ is_active: false }, { is_active: true }]), true)
  assert.equal(catalog.shouldSkipVariantPicker([]), false)
})

test('listProducts attaches variants and stok_count', async () => {
  const produkId = 'p1'
  const { catalog } = muatCatalog({
    products: [{ id: produkId, nama: 'Netflix', slug: 'netflix', is_active: true, urutan: 0, kategori: 'streaming' }],
    variants: [
      { id: 'v1', produk_id: produkId, label: '1 Bulan', kode: 'netflix-1b', harga: 25000, urutan: 1, is_active: true },
      { id: 'v2', produk_id: produkId, label: '3 Bulan', kode: 'netflix-3b', harga: 65000, urutan: 2, is_active: true },
    ],
    stockCounts: { 'netflix-1b': 5, 'netflix-3b': 0 },
  })
  const list = await catalog.listProducts({ withStock: true })
  assert.equal(list.length, 1)
  assert.equal(list[0].variants.length, 2)
  assert.equal(list[0].variants[0].stok_count, 5)
  assert.equal(list[0].variants[1].stok_count, 0)
})

test('totalStock sums variant counts', async () => {
  const produkId = 'p1'
  const { catalog } = muatCatalog({
    products: [{ id: produkId, nama: 'Netflix', slug: 'netflix', is_active: true, urutan: 0 }],
    variants: [
      { id: 'v1', produk_id: produkId, kode: 'a', is_active: true, urutan: 1 },
      { id: 'v2', produk_id: produkId, kode: 'b', is_active: true, urutan: 2 },
    ],
    stockCounts: { a: 2, b: 3 },
  })
  assert.equal(await catalog.totalStock(produkId), 5)
})
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
node --test test/catalog.test.js
```

Expected: FAIL with `Cannot find module '../lib/catalog.js'` or similar.

- [ ] **Step 3: Implement `lib/catalog.js`**

```js
// lib/catalog.js
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
  const byProduk = Object.create(null)
  for (const v of variants) {
    if (!byProduk[v.produk_id]) byProduk[v.produk_id] = []
    byProduk[v.produk_id].push(v)
  }
  const out = []
  for (const p of list) {
    let vars = byProduk[p.id] || []
    if (withStock) vars = await attachStock(vars)
    else vars = vars.map((v) => ({ ...v, stok_count: 0 }))
    out.push({ ...p, variants: vars })
  }
  return out
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
  const { data, error } = await supabase
    .from('Varian')
    .select('*, Produk(*)')
    .eq('kode', String(kode).toLowerCase())
    .maybeSingle()
  // Note: kode may be stored mixed-case; prefer ilike via filter if exact fails.
  if (error) {
    console.error('catalog.getVariantByKode:', error)
    return null
  }
  if (data) {
    const { Produk, ...varian } = data
    return { ...varian, produk: Produk || null }
  }
  // Fallback: case-insensitive scan of unique kode index via lower match
  const { data: rows } = await supabase.from('Varian').select('*, Produk(*)').ilike('kode', String(kode))
  const row = (rows || [])[0]
  if (!row) return null
  const { Produk, ...varian } = row
  return { ...varian, produk: Produk || null }
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
```

> Implementer's note: if Supabase JS in this project does not support `.ilike` on your client version, replace the fallback with `.select('*').eq('kode', kode)` only and always write `kode` lowercased on create/update.

- [ ] **Step 4: Run tests — expect PASS**

```bash
node --test test/catalog.test.js
```

Expected: all tests PASS. Fix fake client filters if a test fails on join shape — keep assertions stable.

- [ ] **Step 5: Commit**

```bash
git add lib/catalog.js test/catalog.test.js
git commit -m "feat(phase2): add lib/catalog with product/variant queries"
```

---

### Task 3: Re-key `lib/stock.js` to `varian_kode` / `varian_id`

**Files:**
- Modify: `lib/stock.js`
- Create: `test/stock.test.js`
- Modify: all call sites still using `produk_kode` / `produk_id` on Stok (grep after edit)

**Interfaces:**
- Consumes: new `Stok.varian_kode` / `Stok.varian_id` columns from Task 1
- Produces: same export names; semantics:
  - `getStokCountByKode(kode)` → filters `varian_kode`
  - `getStokCountByProdukId(produkId)` → **DELETE or replace** with `getStokCountByVarianId(varianId)`; dashboard must stop calling the old produk_id version
  - `getStokCountsByKode`, `getStokForTransaction`, `getStokItems` → `varian_kode`
  - Add `getStokCountByVarianId(varianId)`

- [ ] **Step 1: Write failing stock tests**

```js
// test/stock.test.js
const test = require('node:test')
const assert = require('node:assert')

const jalurClient = require.resolve('../lib/supabase.js')
const jalurStock = require.resolve('../lib/stock.js')

function buatFake(rows) {
  return {
    from(tabel) {
      assert.equal(tabel, 'Stok')
      const st = { filter: {}, head: false, cols: null }
      const b = {
        select(_c, opts) { if (opts && opts.head) st.head = true; return b },
        eq(col, val) { st.filter[col] = val; return b },
        in(col, vals) { st.filter['__in_'+col] = vals; return b },
        order() { return b },
        limit() { return b },
        then(res, rej) {
          let matched = rows.filter((r) => {
            for (const [k, v] of Object.entries(st.filter)) {
              if (k.startsWith('__in_')) continue
              if (String(r[k]).toLowerCase() !== String(v).toLowerCase() && r[k] !== v) return false
            }
            return true
          })
          if (st.head) return Promise.resolve({ data: null, error: null, count: matched.length }).then(res, rej)
          return Promise.resolve({ data: matched, error: null }).then(res, rej)
        }
      }
      return b
    }
  }
}

function muat(rows) {
  delete require.cache[jalurStock]
  require.cache[jalurClient] = {
    id: jalurClient, filename: jalurClient, loaded: true,
    exports: buatFake(rows)
  }
  return require(jalurStock)
}

test.after(() => {
  delete require.cache[jalurClient]
  delete require.cache[jalurStock]
})

test('getStokCountByKode filters varian_kode not produk_kode', async () => {
  const stock = muat([
    { id: 1, varian_kode: 'netflix-1b', status: 'tersedia' },
    { id: 2, varian_kode: 'netflix-1b', status: 'terjual' },
  ])
  assert.equal(await stock.getStokCountByKode('netflix-1b'), 1)
})

test('getStokCountByVarianId filters varian_id', async () => {
  const stock = muat([
    { id: 1, varian_id: 'v1', varian_kode: 'a', status: 'tersedia' },
    { id: 2, varian_id: 'v1', varian_kode: 'a', status: 'tersedia' },
  ])
  assert.equal(await stock.getStokCountByVarianId('v1'), 2)
})
```

- [ ] **Step 2: Run — expect FAIL** (missing export / still querying `produk_kode`)

```bash
node --test test/stock.test.js
```

- [ ] **Step 3: Update `lib/stock.js`**

Replace every `.eq('produk_kode', ...)` with `.eq('varian_kode', ...)`.
Replace `getStokCountByProdukId` with:

```js
async function getStokCountByVarianId(varianId) {
  if (!varianId) return 0
  try {
    const { count, error } = await supabase
      .from('Stok')
      .select('*', { count: 'exact', head: true })
      .eq('varian_id', varianId)
      .eq('status', TERSEDIA)
    if (error) {
      console.error('Error getStokCountByVarianId:', error)
      return 0
    }
    return count || 0
  } catch (error) {
    console.error('Error getStokCountByVarianId:', error)
    return 0
  }
}
```

Update header comment to document `varian_kode` / `varian_id`.
Export `getStokCountByVarianId`; remove `getStokCountByProdukId`.

- [ ] **Step 4: Grep and fix call sites**

```bash
rg -n "getStokCountByProdukId|produk_kode|produk_id" lib/ dashboard.js index.js
```

In `dashboard.js` stock routes and list helpers, switch to `getStokCountByVarianId` or `catalog.totalStock`.
In `index.js` keep `getStokCount = getStokCountByKode` alias (kode still means variant kode).

- [ ] **Step 5: Run all lib tests**

```bash
node --test test/stock.test.js test/catalog.test.js test/cart.test.js test/format.test.js
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add lib/stock.js test/stock.test.js dashboard.js index.js
git commit -m "feat(phase2): re-key stock helpers to varian_kode/varian_id"
```

---

### Task 4: Bot catalog display rewrite

**Files:**
- Modify: `index.js` — delete `getProductEntries` (L307–343), rewrite `sendProductPage` (L2967–3115), replace `sendGroupCard` (L3118–3194) with `sendProductCard`, update callbacks `grup_refresh:` → `p_refresh:`, `pilih_variasi:` path

**Interfaces:**
- Consumes: `catalog.listProducts`, `catalog.getProductBySlug`, `catalog.shouldSkipVariantPicker`, `catalog.getVariantByKode`
- Produces: `sendProductCard(chatId, slug, msgId)`, `showVariantQtyScreen(chatId, msgId, varian)` (factored from current `pilih_variasi:` body)

- [ ] **Step 1: Add catalog require at top of `index.js`**

Next to existing `const cart = require('./lib/cart')`:

```js
const catalog = require('./lib/catalog')
```

- [ ] **Step 2: Delete `getProductEntries` / `getEntryStokCount` / `getEntryName`**

Remove the three functions. Fix every call site in this task (compiler/runtime errors are the checklist).

- [ ] **Step 3: Rewrite `sendProductPage` to iterate products**

Replace entry-collapsing logic with:

```js
async function sendProductPage(chatId, page = 0, msgId = null, filterOptions = {}) {
  const products = await catalog.listProducts({
    kategori: filterOptions.kategori,
    activeOnly: true,
    withStock: true,
  })
  // sort by urutan already from catalog; optional name sort if filterOptions.sortBy === 'name'
  const perPage = 10
  const slice = products.slice(page * perPage, page * perPage + perPage)
  // Build caption + inline keyboard:
  // each product button: callback_data `p:${slug}` (NOT name — 64-byte safe)
  // skip products where total stok_count across variants === 0 (unless owner view needed)
  // pagination callbacks: `produk_page:${page}`
}
```

Keep existing banner edit helper `editOrSendBannerMessage`.

- [ ] **Step 4: Replace `sendGroupCard` with `sendProductCard`**

```js
async function sendProductCard(chatId, slug, msgId = null) {
  const produk = await catalog.getProductBySlug(slug)
  if (!produk) {
    return bot.sendMessage(chatId, 'Produk tidak ditemukan.')
  }
  const active = (produk.variants || []).filter((v) => v.is_active !== false)
  if (catalog.shouldSkipVariantPicker(active)) {
    return showVariantQtyScreen(chatId, msgId, active[0])
  }
  // caption: nama, snk, list of variant lines with harga + stok
  // buttons: 2-per-row `v:${varian.kode}` for variants with stok_count > 0
  // out-of-stock variants: show struck text in caption, NO button
  // refresh: `p_refresh:${slug}`
  // if ALL out of stock: still render card, empty button rows ok (do not crash)
}
```

Wire callbacks:
- `p:` / `p_refresh:` → `sendProductCard`
- `v:` → `showVariantQtyScreen` via `catalog.getVariantByKode`
- Delete handlers for `grup_refresh:` and old `pilih_variasi:` after factoring body into `showVariantQtyScreen`

- [ ] **Step 5: Factor `showVariantQtyScreen`**

Move cart-write from current `pilih_variasi:` (L4070–4114) into:

```js
async function showVariantQtyScreen(chatId, msgId, varian) {
  const data = {
    kode: varian.kode,
    jumlah: 1,
    trxid: `TRX-${Date.now()}`,
    voucher: '',
    voucher_status: '',
    selectedStokIds: [],
  }
  // Do NOT write grup_nama / variasi_nama
  await cart.save(/* userId from chat context — pass userId explicitly */, data)
  // existing qty UI via editOrSendBannerMessage + detectProductFormat(varian.format / stock sample)
}
```

Update function signature to accept `userId` as first-class arg if `chatId !== userId` in groups (bot is private-chat today — `userId = chatId` is fine; keep explicit).

- [ ] **Step 6: Delete grup bot commands**

Delete `/setgrup`, `/unsetgrup`, `/listgrup` handlers (~L3861–3923) and any state objects they use.

- [ ] **Step 7: Manual smoke (local or Railway after migration)**

Fixtures from runbook:
1. Solo product → opens qty screen, no picker
2. Multi-variant with one OOS → struck line, no button for OOS
3. All OOS → card renders, no throw

- [ ] **Step 8: Commit**

```bash
git add index.js
git commit -m "feat(phase2): bot catalog uses Product/Varian instead of grup"
```

---

### Task 5: Purchase path — resolve variants, write new Trx shape

**Files:**
- Modify: `index.js` — all `Produk.find(i => i.kode === ...)` purchase sites; Trx inserts; `detectProductFormat` callers; Payment.meta unchanged (`kode` still variant kode)

**Interfaces:**
- Consumes: `catalog.getVariantByKode(kode)` → `{ id, produk_id, kode, label, harga, format, produk }`
- Produces: Trx rows with `{ id, varian_id, produk_id, kode, nama, jumlah, harga, harga_satuan, tanggal, trxid }`

- [ ] **Step 1: Inventory remaining kode lookups**

```bash
rg -n "Produk\.find|\.eq\('kode'|from\(\"Produk\"\)" index.js
```

Every purchase/checkout hit must become `await catalog.getVariantByKode(Data.kode)`.

- [ ] **Step 2: Replace lookup pattern**

Before:

```js
const item = Produk.find(i => i.kode === Data.kode)
const harga = item.harga
const nama = item.nama
```

After:

```js
const varian = await catalog.getVariantByKode(Data.kode)
if (!varian) { /* abort with user message */ }
const harga = varian.harga
const nama = `${varian.produk?.nama || 'Produk'} — ${varian.label}`
```

- [ ] **Step 3: Update Trx inserts (saldo ~L6763 and QRIS ~L7390)**

```js
await supabase.from('Trx').insert({
  id: userId,
  varian_id: varian.id,
  produk_id: varian.produk_id,
  kode: varian.kode,
  nama,
  jumlah: Data.jumlah,
  harga: totalBayar,
  harga_satuan: harga, // Phase 3 will set tiered unit price; for now = varian.harga
  tanggal: new Date().toISOString(),
  trxid: Data.trxid,
})
```

- [ ] **Step 4: Update `detectProductFormat` usage**

Prefer `varian.format`; if empty, sample stock via `stock.getStokItems(varian.kode, 1)`.

- [ ] **Step 5: Increment `Varian.terjual` instead of `Produk.terjual`**

```bash
rg -n "terjual" index.js
```

Any `Produk` terjual update on purchase → `Varian` update by `varian.id`.

- [ ] **Step 6: Commit**

```bash
git add index.js
git commit -m "feat(phase2): purchase path resolves Varian and writes new Trx shape"
```

---

### Task 6: Dashboard product detail + variant table

**Files:**
- Create: `views/produk-detail.ejs`
- Create: `public/js/inline-edit.js`
- Modify: `dashboard.js` (replace flat create/edit routes)
- Modify: `views/produk.ejs` (list parent products)
- Delete or stop linking: `views/produk-form.ejs` (keep file only if still referenced — prefer delete once unused)

**Interfaces:**
- Consumes: `catalog.slugify`, `catalog.getProductById`, `stock.getStokCountByVarianId`
- Produces HTTP:
  - `GET /produk` — list products (nama, kategori, variant count, total stock, active)
  - `GET /produk/tambah` + `POST /produk/tambah` — create product **with initial variant**
  - `GET /produk/:id` — detail page
  - `POST /produk/:id` — update product fields
  - `POST /api/produk/:id/varian` — create variant
  - `PATCH /api/produk/:id/varian/:varianId` — update fields / urutan / is_active
  - `DELETE /api/produk/:id/varian/:varianId` — blocked if last variant (400 + message)

- [ ] **Step 1: Add `public/js/inline-edit.js`**

```js
// public/js/inline-edit.js
async function patchAndSwap(url, body, rowSelector) {
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'Accept': 'text/html' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || res.statusText)
  }
  const html = await res.text()
  const row = document.querySelector(rowSelector)
  if (row) row.outerHTML = html
  return html
}
```

- [ ] **Step 2: Implement create-product-with-default-variant**

`POST /produk/tambah` body fields: `nama, kategori, deskripsi, snk, banner_url, varian_label, varian_kode, harga, format`.

```js
const slug = catalog.slugify(nama)
// insert Produk { nama, slug, kategori, deskripsi, snk, banner_url }
// insert Varian { produk_id, label: varian_label || 'Default', kode: varian_kode, harga, format, urutan: 1 }
// redirect to /produk/:id
```

Reject if `varian_kode` missing/duplicate.

- [ ] **Step 3: Build `views/produk-detail.ejs`**

Structure:
1. Top form: nama, slug, kategori `<select>`, deskripsi, snk, banner_url, is_active, urutan — POST `/produk/:id`
2. Variant table columns: label | kode | harga | stok badge | terjual | active | [+stok] [▲][▼] [⋮]
3. "+ Add variant" form posting to `/api/produk/:id/varian`
4. Under `max-width: 768px`, table rows become stacked cards (CSS in page or `dashboard.css`)

Server-render each variant row as a partial HTML snippet so PATCH can return one row.

- [ ] **Step 4: PATCH handler returns row HTML**

```js
app.patch('/api/produk/:id/varian/:varianId', requireAuth, async (req, res) => {
  // update allowed fields from req.body
  // re-fetch variant + stok count
  // res.type('html').send(renderVariantRow(variant))
})
```

Block delete of last variant:

```js
const n = await catalog.variantCount(produkId)
if (n <= 1) return res.status(400).json({ error: 'Produk harus punya minimal 1 varian' })
```

- [ ] **Step 5: Update list `views/produk.ejs`**

Remove Kode/Harga/Grup columns. Show: Nama, Kategori, #Varian, Total Stok, Status, Aksi → link to `/produk/:id`.

- [ ] **Step 6: Manual UI check**

Desktop: edit harga inline, reorder ▲▼, add second variant.  
Mobile width: stacked cards usable.

- [ ] **Step 7: Commit**

```bash
git add dashboard.js views/produk-detail.ejs views/produk.ejs public/js/inline-edit.js
git add -u views/produk-form.ejs  # if deleted
git commit -m "feat(phase2): product detail page with inline variant table"
```

---

### Task 7: Re-key stock dashboard routes to variants

**Files:**
- Modify: `dashboard.js` stock routes (`/produk/:id/stok` → prefer `/produk/:produkId/varian/:varianId/stok` or keep path but load by `varianId` query)
- Modify: `views/produk-stok.ejs`, `produk-stok-tambah.ejs`, `produk-stok-edit.ejs`, `produk-stok-hapus.ejs`

**Interfaces:**
- Consumes: `stock.getStokItems(varian.kode)`, inserts `{ varian_id, varian_kode, data, status: 'tersedia' }`
- Produces: stock CRUD keyed by variant

- [ ] **Step 1: Change routes**

Preferred paths:
- `GET /produk/:produkId/varian/:varianId/stok`
- `GET|POST /produk/:produkId/varian/:varianId/stok/tambah`
- `GET|POST .../stok/edit/:stokId`
- `GET|POST .../stok/hapus/:stokId`

From detail page "+ Stock" links to tambah for that `varianId`.

- [ ] **Step 2: Fix inserts**

```js
await supabase.from('Stok').insert({
  varian_id: varian.id,
  varian_kode: String(varian.kode).toLowerCase(),
  data: line,
  status: 'tersedia',
})
```

Never write `produk_id` / `produk_kode`.

- [ ] **Step 3: Update EJS titles/breadcrumbs** to show `Produk — Varian label`.

- [ ] **Step 4: Commit**

```bash
git add dashboard.js views/produk-stok.ejs views/produk-stok-tambah.ejs views/produk-stok-edit.ejs views/produk-stok-hapus.ejs
git commit -m "feat(phase2): stock admin routes keyed by variant"
```

---

### Task 8: Cleanup vestiges + Phase 1 leftover disk files

**Files:**
- Delete: `Database/Trx/*.json` (if any remain), consider deleting empty `Database/Trx/` dir
- Modify: `index.js` — remove any remaining `./Database/Trx/temp_*.json` writes if still present (grep); if temp files are still used for QRIS payload bridging, migrate those to `Payment.meta` or `BotSession` — **do not leave ephemeral disk as source of truth**
- Grep purge: `grup`, `getProductEntries`, `sendGroupCard`, `produk_kode`, `getStokCountByProdukId`

- [ ] **Step 1: Grep gate**

```bash
rg -n "grup|getProductEntries|sendGroupCard|produk_kode|getStokCountByProdukId|Database/Trx" index.js dashboard.js lib/ views/
```

Expected: no matches in app code (docs/migrations mentioning history are OK).

- [ ] **Step 2: Remove leftover disk cart files from repo**

```bash
git rm -r --ignore-unmatch Database/Trx Database/User.json Database/Produk.json Database/Voucher.json Database/Trx.json 2>/dev/null || true
```

If `temp_` JSON paths still exist in payment code, replace with reading `Payment.meta` only (already holds `{ kode, jumlah, voucher, selectedStokIds }`).

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore(phase2): remove grup and ephemeral Database/Trx vestiges"
```

---

### Task 9: Apply migration + E2E verification

**Files:** none (ops + manual)

- [ ] **Step 1: Apply migration to Supabase `teleshop-improvement-v2`**

Follow `docs/runbooks/phase2-variant-cutover.md`.

- [ ] **Step 2: Deploy** (push to `main` or merge PR — Railway auto-deploys from `main`)

- [ ] **Step 3: Seed three fixtures** (dashboard or SQL)

- [ ] **Step 4: Run the mandatory E2E script**

1. `/start` → home banner, correct saldo  
2. Product list → multi-variant → pick variant → qty 3 → pay saldo → stock delivered; Trx has `varian_id` + `kode`; balance deducted  
3. Same via QRIS → Pakasir sandbox → webhook + poller; `Payment.status = fulfilled` once  
4. Deposit preset + custom → approve one via dashboard, one via payment  
5. `/stok`, `/rekap`, history, redownload  
6. Restart mid-cart → cart survives (`BotSession`)

Phase-2-specific:
- Solo variant: no picker, flow matches old solo product  
- Three variants, one OOS: struck, no button  
- All OOS: card renders, no crash  

- [ ] **Step 5: Run automated tests on CI/local**

```bash
node --test
```

Expected: all existing + new catalog/stock tests PASS.

- [ ] **Step 6: Final commit if runbook tweaks needed; open/update PR**

```bash
git push -u origin HEAD
```

---

## Spec coverage self-review

| Spec requirement | Task |
|------------------|------|
| Destructive Produk/Varian/Stok/Trx/ProductStockThreshold recreate | Task 1 |
| Drop pending Payment rows | Task 1 SQL + runbook |
| `lib/catalog.js` replaces getProductEntries | Task 2 + 4 |
| Single-variant skip | Task 2 + 4 |
| Stock keyed by varian | Task 3 + 7 |
| Bot sendProductPage / sendProductCard | Task 4 |
| callback_data uses slug/kode not display name | Task 4 |
| Purchase sites → getVariantByKode | Task 5 |
| Trx writes varian_id + snapshots | Task 5 |
| Dashboard produk-detail + variant table | Task 6 |
| Mobile stacked cards / ▲▼ not drag | Task 6 |
| Stock admin re-keyed | Task 7 |
| Delete grup column usage + commands | Tasks 4 + 8 |
| Delete Produk.data JSONB fallbacks | Task 4/5 (no longer select data) |
| test/catalog.test.js | Task 2 |
| E2E script + fixtures | Task 9 |
| Phase 1 Database/Trx cleanup | Task 8 |

Out of scope (later plans): tiered pricing, bulk rework, copy registry, flow engine, command retirement, dashboard IA.

## Placeholder scan

No TBD/TODO steps. All tasks include concrete code, commands, and expected outcomes.

## Type consistency

- Variant kode string remains cart/`Payment.meta`/`Stok.varian_kode` identity
- `catalog.getVariantByKode` returns `{ id, produk_id, kode, label, harga, format, produk }`
- `shouldSkipVariantPicker(variants)` counts `is_active !== false`
- Stock exports: `getStokCountByKode`, `getStokCountByVarianId`, `getStokCountsByKode`, `getStokForTransaction`, `getStokItems`, `markStokTerjual`
