# Tiered Pricing (Phase 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add optional quantity → unit-price tiers per variant so checkout charges the correct `harga_satuan × qty`, then stacks voucher `potongan`, with dashboard CRUD on the product detail page.

**Architecture:** New `HargaTier` table stores `{varian_id, min_qty, harga}`. Pure `lib/pricing.js` resolves unit price (highest `min_qty ≤ qty`, else `Varian.harga`). Bot and dashboard load tiers and call the resolver everywhere totals are computed. Vouchers remain and stack after tier subtotal.

**Tech Stack:** Node.js 20, Express 5 + EJS, `@supabase/supabase-js`, Telegram Bot API, `node --test`, Railway + Supabase.

**Design spec:** [docs/superpowers/specs/2026-08-09-tiered-pricing-design.md](../specs/2026-08-09-tiered-pricing-design.md)

## Global Constraints

- Discounts = tiered unit prices + existing vouchers (stack: tier subtotal then `potongan`); do not invent a third discount type
- `Varian.harga` = base/fallback; tiers optional; `min_qty >= 2` only (open-ended ranges)
- `kode` stays on the variant; cart still stores `{ kode, jumlah, trxid, voucher, voucher_status, selectedStokIds }` — no price in cart
- Keep EJS + vanilla JS; no React/Vue
- Tests: pure functions only via `node --test`; reuse fake-Supabase `require.cache` pattern from `test/catalog.test.js` / `test/cart.test.js`
- Leave `User`, `Deposit`, `Payment` schema, `Voucher` table schema, Premium/Admin tables alone (voucher *behavior* at checkout still applies)
- Do not start Phase 4+ work in this plan
- Prepend `SET search_path TO public, extensions;` in new migrations (Supabase hosts `uuid-ossp` in `extensions`)

---

## File map

| File | Responsibility |
|------|----------------|
| `supabase/migrations/20260812000000_harga_tier.sql` | Create `HargaTier` + RLS + trigger |
| `lib/pricing.js` | Pure resolve + async load tiers for a variant |
| `test/pricing.test.js` | Pure matching / fallback / subtotal / load helper |
| `index.js` | All qty×harga and Trx write sites use resolver |
| `dashboard.js` | Tier CRUD APIs under variant |
| `views/produk-detail.ejs` | Tier UI per variant |
| `views/partials/variant-row.ejs` | Optional: link/badge showing tier count |
| `docs/runbooks/phase3-tiered-pricing.md` | Apply migration + seed example tiers |
| Update | `docs/superpowers/plans/2026-08-09-admin-ux-overhaul-roadmap.md` Phase 3 status |

---

### Task 1: Migration + runbook

**Files:**
- Create: `supabase/migrations/20260812000000_harga_tier.sql`
- Create: `docs/runbooks/phase3-tiered-pricing.md`
- Modify: `docs/superpowers/plans/2026-08-09-admin-ux-overhaul-roadmap.md` (Phase 3 → plan linked)

**Interfaces:**
- Consumes: Phase 2 `Varian` table; `update_updated_at_column()`; extensions search_path pattern from Phase 2 hotfix
- Produces: table `HargaTier` with columns below

- [ ] **Step 1: Write the migration file**

```sql
-- supabase/migrations/20260812000000_harga_tier.sql
SET search_path TO public, extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS "HargaTier" (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    varian_id UUID NOT NULL REFERENCES "Varian"(id) ON DELETE CASCADE,
    min_qty INTEGER NOT NULL CHECK (min_qty >= 2),
    harga INTEGER NOT NULL CHECK (harga >= 0),
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    UNIQUE (varian_id, min_qty)
);
CREATE INDEX idx_hargatier_varian ON "HargaTier"(varian_id, min_qty);

DROP TRIGGER IF EXISTS update_hargatier_updated_at ON "HargaTier";
CREATE TRIGGER update_hargatier_updated_at
    BEFORE UPDATE ON "HargaTier"
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE "HargaTier" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all for service role" ON "HargaTier";
CREATE POLICY "Allow all for service role" ON "HargaTier"
    FOR ALL USING (true) WITH CHECK (true);
```

- [ ] **Step 2: Write the runbook**

Create `docs/runbooks/phase3-tiered-pricing.md`:

```markdown
# Phase 3 cutover runbook — Tiered pricing

1. Confirm Phase 2 schema is live (`Varian` exists; `Produk` has no `kode`).
2. Deploy app code that includes `lib/pricing.js` + tier APIs (merge PR to `main` → Railway).
3. Apply migration:
   `supabase db push` (linked to sajffqniegtvhyopshvx)
   OR paste SQL into Supabase SQL Editor (keep search_path line).
4. Confirm: `\d "HargaTier"` / Studio shows table; RLS on.
5. Optional seed (example for Netflix 7d):
   ```sql
   INSERT INTO "HargaTier" (varian_id, min_qty, harga)
   SELECT id, 5, 12000 FROM "Varian" WHERE kode = 'netflix-7d';
   INSERT INTO "HargaTier" (varian_id, min_qty, harga)
   SELECT id, 10, 10000 FROM "Varian" WHERE kode = 'netflix-7d';
   ```
6. Verify dashboard: open product → variant → tiers list; bot qty 5 shows new unit price.
```

- [ ] **Step 3: Update roadmap status**

In `docs/superpowers/plans/2026-08-09-admin-ux-overhaul-roadmap.md`, set Phase 2 to **Done**, Phase 3 to link this plan file and status **Plan ready**.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260812000000_harga_tier.sql \
  docs/runbooks/phase3-tiered-pricing.md \
  docs/superpowers/plans/2026-08-09-admin-ux-overhaul-roadmap.md \
  docs/superpowers/specs/2026-08-09-tiered-pricing-design.md
git commit -m "feat(phase3): add HargaTier migration and design/runbook"
```

---

### Task 2: `lib/pricing.js` + tests (TDD)

**Files:**
- Create: `lib/pricing.js`
- Create: `test/pricing.test.js`

**Interfaces:**
- Consumes: `lib/supabase.js` for async load only
- Produces:
  - `resolveUnitPrice(baseHarga: number, qty: number, tiers: Array<{min_qty: number, harga: number}>): { harga_satuan: number, subtotal: number, matched_min_qty: number|null }`
  - `async getTiersForVarian(varianId: string): Promise<Array<{id, varian_id, min_qty, harga}>>` — ordered by `min_qty` ascending
  - `async resolveForVarian(varian: {id, harga}, qty: number): Promise<{ harga_satuan, subtotal, matched_min_qty }>` — loads tiers then resolves

- [ ] **Step 1: Write the failing tests**

```js
// test/pricing.test.js
const test = require('node:test')
const assert = require('node:assert')

const jalurClient = require.resolve('../lib/supabase.js')
const jalurPricing = require.resolve('../lib/pricing.js')

function muatPricing(tiersRows = []) {
  delete require.cache[jalurPricing]
  require.cache[jalurClient] = {
    id: jalurClient,
    filename: jalurClient,
    loaded: true,
    exports: {
      from(tabel) {
        assert.equal(tabel, 'HargaTier')
        const st = { filter: {} }
        const b = {
          select() { return b },
          eq(col, val) { st.filter[col] = val; return b },
          order() { return b },
          then(res, rej) {
            let rows = tiersRows.slice()
            for (const [k, v] of Object.entries(st.filter)) {
              rows = rows.filter((r) => r[k] === v)
            }
            rows.sort((a, b) => a.min_qty - b.min_qty)
            return Promise.resolve({ data: rows, error: null }).then(res, rej)
          },
        }
        return b
      },
    },
  }
  return require(jalurPricing)
}

test.after(() => {
  delete require.cache[jalurClient]
  delete require.cache[jalurPricing]
})

test('resolveUnitPrice falls back to base when no tiers', () => {
  const pricing = muatPricing()
  const r = pricing.resolveUnitPrice(25000, 3, [])
  assert.deepEqual(r, { harga_satuan: 25000, subtotal: 75000, matched_min_qty: null })
})

test('resolveUnitPrice falls back when qty below all min_qty', () => {
  const pricing = muatPricing()
  const tiers = [{ min_qty: 5, harga: 20000 }, { min_qty: 10, harga: 18000 }]
  const r = pricing.resolveUnitPrice(25000, 4, tiers)
  assert.equal(r.harga_satuan, 25000)
  assert.equal(r.matched_min_qty, null)
  assert.equal(r.subtotal, 100000)
})

test('resolveUnitPrice picks highest min_qty <= qty', () => {
  const pricing = muatPricing()
  const tiers = [{ min_qty: 5, harga: 20000 }, { min_qty: 10, harga: 18000 }]
  assert.equal(pricing.resolveUnitPrice(25000, 5, tiers).harga_satuan, 20000)
  assert.equal(pricing.resolveUnitPrice(25000, 9, tiers).harga_satuan, 20000)
  assert.equal(pricing.resolveUnitPrice(25000, 10, tiers).harga_satuan, 18000)
  assert.equal(pricing.resolveUnitPrice(25000, 10, tiers).matched_min_qty, 10)
  assert.equal(pricing.resolveUnitPrice(25000, 10, tiers).subtotal, 180000)
})

test('resolveForVarian loads tiers and resolves', async () => {
  const pricing = muatPricing([
    { id: 't1', varian_id: 'v1', min_qty: 5, harga: 20000 },
  ])
  const r = await pricing.resolveForVarian({ id: 'v1', harga: 25000 }, 5)
  assert.equal(r.harga_satuan, 20000)
  assert.equal(r.subtotal, 100000)
})
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
node --test test/pricing.test.js
```

Expected: FAIL with `Cannot find module '../lib/pricing.js'` or similar.

- [ ] **Step 3: Implement `lib/pricing.js`**

```js
// lib/pricing.js
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
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
node --test test/pricing.test.js
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/pricing.js test/pricing.test.js
git commit -m "feat(phase3): add lib/pricing resolveUnitPrice helpers"
```

---

### Task 3: Wire bot checkout to resolver + fix leftover `Produk.kode` price paths

**Files:**
- Modify: `index.js`

**Interfaces:**
- Consumes: `pricing.resolveForVarian(item, Data.jumlah)` where `item` comes from `getVarianForCart` (has `id`, `harga`)
- Produces: displays and charges use `harga_satuan` / `subtotal`; voucher applies to `subtotal`; `Trx.harga_satuan` = resolved unit

- [ ] **Step 1: Require pricing near catalog**

```js
const catalog = require('./lib/catalog')
const pricing = require('./lib/pricing')
```

- [ ] **Step 2: Add a small helper used by purchase screens**

```js
async function hargaUntukQty(item, qty) {
  return pricing.resolveForVarian(item, qty)
}
```

- [ ] **Step 3: Inventory and replace every `qty * item.harga` / `Data.jumlah * item.harga` on live paths**

```bash
rg -n "jumlah \* item\.harga|selectedStokIds\.length \* item\.harga|Produk\[.*\]\.harga" index.js
```

For each live site (stock picker, qty `plus`/`min`/`reset`, `checkout_payment` saldo, `batalvoucher`, `bayarsaldo`, voucher apply message, QRIS `bayar` + fulfill):

**Before:**
```js
let harga = Data.jumlah * item.harga
if (vcr && ...) harga = harga - vcr.potongan
// ...
harga_satuan: item.harga,
```

**After:**
```js
const resolved = await hargaUntukQty(item, Data.jumlah)
let harga = resolved.subtotal
if (vcr && !vcr.user.some(a => a === query.from.id) && vcr.limit > 0) {
  harga = Math.max(0, harga - vcr.potongan)
}
// displays: formatrupiah(resolved.harga_satuan) for unit, formatrupiah(harga) for charge
// Trx:
harga_satuan: resolved.harga_satuan,
harga: harga,
```

Display captions that show unit price should use `resolved.harga_satuan`, not raw `item.harga`. Optional: if `matched_min_qty`, append a short note like `(tier ≥${matched_min_qty})` — keep copy minimal; do not add badges/stickers.

- [ ] **Step 4: Fix broken legacy lookups still on `Produk.kode` in the same PR**

Any remaining purchase UI that does `Produk.find` / `.eq('kode')` on `Produk` for price (e.g. `konfirmasi`, `lihat_voucher`, `apply_voucher_*`, `pilih_payment_method`, incomplete QRIS `bayar`) must switch to `getVarianForCart(Data.kode)` + `hargaUntukQty`. Do not leave dual paths.

- [ ] **Step 5: Smoke mentally / local**

With seeded Netflix 7d tiers (5→12000, 10→10000) after migration:
- qty 3 → unit 15000 (base)
- qty 5 → unit 12000
- qty 10 → unit 10000
- voucher 2000 on qty 5 → charge `5*12000 - 2000 = 58000`

- [ ] **Step 6: Commit**

```bash
git add index.js
git commit -m "feat(phase3): bot checkout uses tiered unit price then voucher"
```

---

### Task 4: Dashboard tier CRUD API

**Files:**
- Modify: `dashboard.js`

**Interfaces:**
- Consumes: `HargaTier` table; `isAuthenticated`; existing `loadProdukVarian` / variant ownership checks
- Produces HTTP:
  - `GET /api/produk/:id/varian/:varianId/tiers` → `{ tiers: [...] }`
  - `POST /api/produk/:id/varian/:varianId/tiers` body `{ min_qty, harga }` → created row JSON
  - `PATCH /api/produk/:id/varian/:varianId/tiers/:tierId` body `{ min_qty?, harga? }` → updated row
  - `DELETE /api/produk/:id/varian/:varianId/tiers/:tierId` → `{ ok: true }`

- [ ] **Step 1: Add require**

```js
const pricing = require('./lib/pricing')
```

(Optional for list; APIs can query supabase directly.)

- [ ] **Step 2: Helper to assert variant belongs to product**

```js
async function loadVarianForProduk(produkId, varianId) {
  const { data, error } = await supabase
    .from('Varian')
    .select('*')
    .eq('id', varianId)
    .eq('produk_id', produkId)
    .maybeSingle()
  if (error || !data) return null
  return data
}
```

- [ ] **Step 3: Implement routes (place near existing variant API block ~1138)**

```js
app.get('/api/produk/:id/varian/:varianId/tiers', isAuthenticated, async (req, res) => {
  try {
    const varian = await loadVarianForProduk(req.params.id, req.params.varianId)
    if (!varian) return res.status(404).json({ error: 'Varian tidak ditemukan' })
    const tiers = await pricing.getTiersForVarian(varian.id)
    res.json({ tiers })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/produk/:id/varian/:varianId/tiers', isAuthenticated, async (req, res) => {
  try {
    const varian = await loadVarianForProduk(req.params.id, req.params.varianId)
    if (!varian) return res.status(404).json({ error: 'Varian tidak ditemukan' })
    const min_qty = parseInt(req.body.min_qty, 10)
    const harga = parseInt(req.body.harga, 10)
    if (!Number.isFinite(min_qty) || min_qty < 2) {
      return res.status(400).json({ error: 'min_qty minimal 2' })
    }
    if (!Number.isFinite(harga) || harga < 0) {
      return res.status(400).json({ error: 'harga tidak valid' })
    }
    const { data, error } = await supabase
      .from('HargaTier')
      .insert([{ varian_id: varian.id, min_qty, harga }])
      .select()
      .single()
    if (error) {
      if (error.code === '23505') return res.status(400).json({ error: 'min_qty sudah ada untuk varian ini' })
      throw error
    }
    res.status(201).json({ tier: data })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.patch('/api/produk/:id/varian/:varianId/tiers/:tierId', isAuthenticated, async (req, res) => {
  try {
    const varian = await loadVarianForProduk(req.params.id, req.params.varianId)
    if (!varian) return res.status(404).json({ error: 'Varian tidak ditemukan' })
    const patch = {}
    if (req.body.min_qty !== undefined) {
      const min_qty = parseInt(req.body.min_qty, 10)
      if (!Number.isFinite(min_qty) || min_qty < 2) return res.status(400).json({ error: 'min_qty minimal 2' })
      patch.min_qty = min_qty
    }
    if (req.body.harga !== undefined) {
      const harga = parseInt(req.body.harga, 10)
      if (!Number.isFinite(harga) || harga < 0) return res.status(400).json({ error: 'harga tidak valid' })
      patch.harga = harga
    }
    if (!Object.keys(patch).length) return res.status(400).json({ error: 'Tidak ada field diubah' })
    const { data, error } = await supabase
      .from('HargaTier')
      .update(patch)
      .eq('id', req.params.tierId)
      .eq('varian_id', varian.id)
      .select()
      .maybeSingle()
    if (error) {
      if (error.code === '23505') return res.status(400).json({ error: 'min_qty sudah ada untuk varian ini' })
      throw error
    }
    if (!data) return res.status(404).json({ error: 'Tier tidak ditemukan' })
    res.json({ tier: data })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.delete('/api/produk/:id/varian/:varianId/tiers/:tierId', isAuthenticated, async (req, res) => {
  try {
    const varian = await loadVarianForProduk(req.params.id, req.params.varianId)
    if (!varian) return res.status(404).json({ error: 'Varian tidak ditemukan' })
    const { error } = await supabase
      .from('HargaTier')
      .delete()
      .eq('id', req.params.tierId)
      .eq('varian_id', varian.id)
    if (error) throw error
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})
```

- [ ] **Step 4: Commit**

```bash
git add dashboard.js
git commit -m "feat(phase3): add HargaTier CRUD API under product variants"
```

---

### Task 5: Dashboard tier UI on product detail

**Files:**
- Modify: `views/produk-detail.ejs`
- Modify: `views/partials/variant-row.ejs` (optional tier-count badge in actions — keep minimal; prefer expandable section below table)

**Interfaces:**
- Consumes: tier APIs from Task 4; `formatrupiah` already on page if present — otherwise format in JS with existing helpers
- Produces: per-variant tier panel: list + add form; no new SPA framework

- [ ] **Step 1: After the variants table in `produk-detail.ejs`, add a tiers panel**

Structure (one panel; select variant via `data-variant-id` from row click or a `<select id="tierVarianSelect">` populated from `produk.variants`):

```html
<section class="card" id="tierPanel" style="margin-top:20px;">
  <div class="card-header">
    <h2 class="card-title">Harga bertingkat</h2>
  </div>
  <div class="card-body">
    <p style="color:#666;margin-bottom:12px;">
      Harga dasar varian dipakai jika qty di bawah semua tier.
      Tier: min qty → harga satuan (open-ended). Voucher tetap mengurangi total setelah tier.
    </p>
    <div class="form-group">
      <label class="form-label">Varian</label>
      <select id="tierVarianSelect" class="form-input">
        <% produk.variants.forEach(v => { %>
          <option value="<%= v.id %>"><%= v.label %> (<%= v.kode %>) — dasar <%= formatrupiah(v.harga) %></option>
        <% }) %>
      </select>
    </div>
    <div class="table-wrapper">
      <table>
        <thead><tr><th>Min qty</th><th>Harga satuan</th><th>Aksi</th></tr></thead>
        <tbody id="tierTableBody"></tbody>
      </table>
    </div>
    <form id="tierAddForm" style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px;align-items:end;">
      <div class="form-group" style="margin:0;">
        <label class="form-label">Min qty (≥2)</label>
        <input type="number" name="min_qty" class="form-input" min="2" required style="width:100px;">
      </div>
      <div class="form-group" style="margin:0;">
        <label class="form-label">Harga satuan</label>
        <input type="number" name="harga" class="form-input" min="0" required style="width:140px;">
      </div>
      <button type="submit" class="btn btn-success">+ Tambah tier</button>
    </form>
  </div>
</section>
```

- [ ] **Step 2: Add page JS to load/render/CRUD tiers**

```js
const produkId = '<%= produk.id %>';
const select = document.getElementById('tierVarianSelect');
const tbody = document.getElementById('tierTableBody');

async function loadTiers() {
  const varianId = select.value;
  const res = await fetch(`/api/produk/${produkId}/varian/${varianId}/tiers`);
  const data = await res.json();
  tbody.innerHTML = '';
  (data.tiers || []).forEach((t) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${t.min_qty}</td>
      <td>${Number(t.harga).toLocaleString('id-ID')}</td>
      <td><button type="button" class="btn-icon" data-del="${t.id}" style="color:#dc3545;">🗑️</button></td>`;
    tbody.appendChild(tr);
  });
  if (!(data.tiers || []).length) {
    tbody.innerHTML = '<tr><td colspan="3" style="color:#888;">Belum ada tier — harga dasar dipakai.</td></tr>';
  }
}

select.addEventListener('change', loadTiers);
document.getElementById('tierAddForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const res = await fetch(`/api/produk/${produkId}/varian/${select.value}/tiers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      min_qty: Number(fd.get('min_qty')),
      harga: Number(fd.get('harga')),
    }),
  });
  const data = await res.json();
  if (!res.ok) return toast.error(data.error || 'Gagal', 'Error');
  e.target.reset();
  toast.success('Tier ditambahkan', 'Berhasil');
  loadTiers();
});

tbody.addEventListener('click', async (e) => {
  const id = e.target.getAttribute('data-del');
  if (!id) return;
  if (!confirm('Hapus tier ini?')) return;
  const res = await fetch(`/api/produk/${produkId}/varian/${select.value}/tiers/${id}`, { method: 'DELETE' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    return toast.error(data.error || 'Gagal hapus', 'Error');
  }
  loadTiers();
});

if (select && select.value) loadTiers();
```

Reuse existing `toast` / sidebar scripts already on the page. Under `max-width: 768px`, rely on existing `.table-wrapper` / dashboard stacked patterns — do not invent a new card-heavy layout.

- [ ] **Step 3: Manual UI check**

Desktop: add tiers 5 and 10, delete one, duplicate min_qty → 400 error toast.  
Mobile width: form usable.

- [ ] **Step 4: Commit**

```bash
git add views/produk-detail.ejs views/partials/variant-row.ejs
git commit -m "feat(phase3): product detail UI for per-variant price tiers"
```

---

### Task 6: Apply migration + verification

**Files:** none required (ops); optionally seed SQL in runbook already

- [ ] **Step 1: Ensure code is on `main` / Railway deploying** (merge PR first if migration-only was already applied — prefer **deploy code then `db push`**, same order as Phase 2)

- [ ] **Step 2: Apply migration**

```bash
supabase link --project-ref sajffqniegtvhyopshvx
supabase db push --yes
```

If history conflicts, repair only with explicit versions — do not re-run destructive Phase 2 migration.

- [ ] **Step 3: Seed example tiers** (runbook SQL for `netflix-7d`)

- [ ] **Step 4: Automated tests**

```bash
node --test
```

Expected: all existing + `test/pricing.test.js` PASS.

- [ ] **Step 5: E2E checklist (Phase 3-specific)**

1. Variant with **no tiers** — qty 1/3 same as Phase 2 base harga  
2. Add tiers 5 / 10 — bot qty 4 base, qty 5 mid, qty 10 low  
3. Apply voucher — charge = `max(0, subtotal - potongan)`  
4. Complete saldo purchase — `Trx.harga_satuan` matches tier; `Trx.harga` matches charge  
5. Dashboard list/add/delete tier without page crash  

- [ ] **Step 6: Final commit if runbook tweaks; push / update PR**

```bash
git push -u origin HEAD
```

---

## Spec coverage self-review

| Spec requirement | Task |
|------------------|------|
| `HargaTier` table, min_qty ≥ 2, unique (varian, min_qty) | Task 1 |
| `Varian.harga` fallback; tiers optional | Task 2 + 3 |
| Highest min_qty ≤ qty wins | Task 2 |
| Voucher stacks after tier subtotal | Task 3 |
| `Trx.harga_satuan` = resolved unit | Task 3 |
| Dashboard configurable per variant | Tasks 4–5 |
| Pure `node --test` for pricing | Task 2 |
| Migration search_path for uuid | Task 1 |
| Out of scope: % off, pack total, voucher retirement, Phase 4+ | (excluded) |

## Placeholder scan

No TBD/TODO steps. All tasks include concrete SQL, JS, commands, and expected outcomes.

## Type consistency

- `resolveUnitPrice(baseHarga, qty, tiers) → { harga_satuan, subtotal, matched_min_qty }`
- `resolveForVarian({ id, harga }, qty)` loads `HargaTier` then resolves
- API paths: `/api/produk/:id/varian/:varianId/tiers[/:tierId]`
- Cart unchanged: still no price fields; always re-resolve from DB
