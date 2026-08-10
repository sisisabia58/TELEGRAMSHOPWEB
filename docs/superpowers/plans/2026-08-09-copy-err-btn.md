# Copy Registry err/btn (Phase 9) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `BotCopy` with `err`/`btn` kinds, seed curated buyer error and keyboard-label keys, wire bot call sites to `copy.get`, and add dashboard kind filtering.

**Architecture:** Additive migration widens the `BotCopy.kind` CHECK and seeds new rows. `lib/copy.js` `DEFAULTS` mirrors seeds (same `get`/`render`/`refresh` API). `index.js` and `lib/retired-commands.js` replace hardcoded strings with `copy.get`. Dashboard `/settings/bot-copy` gains kind filter chips; flow builder accepts `btn.*` as `label_key`.

**Tech Stack:** Node.js 20, Express + EJS, `@supabase/supabase-js`, Telegram Bot API, `node --test`, Railway + Supabase.

**Design spec:** [docs/superpowers/specs/2026-08-09-copy-err-btn-design.md](../specs/2026-08-09-copy-err-btn-design.md)

## Global Constraints

- Kinds after this phase: **`screen` | `msg` | `err` | `btn`** — same `BotCopy` table; no second table or cache version key
- Do **not** rename Phase 5 `msg.btn_perbarui` / `msg.btn_kembali`
- Do not overload `MessageTemplate`
- Shared invalidation: `runtimeSettings.bump()` after copy writes
- Keep EJS + vanilla JS; no React/Vue
- Tests: pure helpers via `node --test` only; no Telegram/HTTP mocks
- Templating: `{{var}}` only — no conditionals/loops
- Prepend `SET search_path TO public, extensions;` in new migrations
- Do not change bot checkout/payment logic — string source only
- Leave success templates, channel feeds, dynamic amount/variant labels hardcoded (design D5)
- Remove dead **Tambah Stok** buttons when touching those sites; do not seed `btn.tambah_stok`

---

## File map

| File | Responsibility |
|------|----------------|
| `supabase/migrations/20260816000000_bot_copy_err_btn.sql` | Extend kind CHECK + seed err/btn rows |
| `lib/copy.js` | Add DEFAULTS for new keys |
| `test/copy.test.js` | Tests for new keys + var rendering |
| `lib/retired-commands.js` | `retiredOwnerHelpText` via `copy.get` |
| `index.js` | Wire err/btn call sites; remove dead Tambah Stok buttons |
| `dashboard.js` | Optional `?kind=` filter on GET bot-copy |
| `views/settings-bot-copy.ejs` | Kind filter chips + updated intro |
| `public/js/flow-builder.js` | Accept `btn.` prefix for `label_key` |
| `docs/runbooks/phase9-copy-err-btn.md` | Apply migration + verify |
| Update | `docs/superpowers/plans/2026-08-09-admin-ux-overhaul-roadmap.md` |

---

### Task 1: Migration + DEFAULTS + unit tests (TDD)

**Files:**
- Create: `supabase/migrations/20260816000000_bot_copy_err_btn.sql`
- Modify: `lib/copy.js`
- Modify: `test/copy.test.js`
- Create: `docs/runbooks/phase9-copy-err-btn.md`
- Modify: `docs/superpowers/plans/2026-08-09-admin-ux-overhaul-roadmap.md` (link plan; status stays Not started until Task 6)

**Interfaces:**
- Consumes: existing `copy.get(key, vars?, fallback?)`, `DEFAULTS`, `BotCopy` table
- Produces: kinds `err`/`btn` allowed in DB; DEFAULTS keys listed below available via `copy.get` without DB

- [ ] **Step 1: Write failing tests**

Append to `test/copy.test.js`:

```js
test('err and btn defaults exist and render vars', () => {
  assert.match(copy.get('err.stock_insufficient', { count: 3 }), /3/)
  assert.match(copy.get('err.voucher_not_found', { kode: 'ABC' }), /ABC/)
  assert.equal(copy.get('btn.konfirmasi'), '✅ Konfirmasi')
  assert.match(copy.get('err.retired_command', { dashboard_url: 'https://dash.example' }), /dash\.example/)
})

test('unknown err key falls back', () => {
  assert.equal(copy.get('err.does_not_exist', {}, 'fallback'), 'fallback')
})
```

- [ ] **Step 2: Run — expect FAIL**

```bash
node --test test/copy.test.js
```

Expected: FAIL (keys missing from DEFAULTS / wrong bodies).

- [ ] **Step 3: Extend `DEFAULTS` in `lib/copy.js`**

Add these entries (exact Indonesian bodies — match current bot wording where possible):

```js
  // --- err.* ---
  'err.owner_only': '⚠️ Hanya bisa diakses oleh owner!',
  'err.retired_command':
    '🛠️ *Perintah admin bot sudah dipensiunkan.*\n\nKelola toko lewat *Dashboard* (produk, stok, voucher, broadcast, flow, copy).\n{{dashboard_block}}\nLaporan cepat di bot: `/stok` · `/rekap` · `/listuser`',
  'err.cart_session_lost': '⚠️ Harap ulangi pilih produk!',
  'err.product_not_found': '⚠️ Produk tidak ditemukan.',
  'err.load_failed': '⚠️ Terjadi kesalahan saat memuat data. Silakan coba lagi.',
  'err.load_product_failed': '⚠️ Terjadi kesalahan saat memuat produk.',
  'err.load_stok_failed': '⚠️ Terjadi kesalahan saat memuat data stok.',
  'err.deposit_qris_not_configured': 'Sistem QRIS belum dikonfigurasi. Hubungi admin.',
  'err.deposit_verify_not_configured': 'Sistem verifikasi pembayaran belum dikonfigurasi. Hubungi admin.',
  'err.deposit_create_failed': 'Terjadi kesalahan saat membuat deposit.\n\nError: `{{error}}`',
  'err.deposit_qris_create_failed': 'Terjadi kesalahan saat membuat QRIS pembayaran.\n\nError: `{{error}}`',
  'err.deposit_expired': '⏰ *DEPOSIT EXPIRED*\n\nDeposit Anda telah kedaluwarsa. Silakan buat deposit baru.',
  'err.deposit_cancelled': '❌ *DEPOSIT DIBATALKAN*\n\nDeposit berhasil dibatalkan.',
  'err.deposit_amount_invalid': '❌ *JUMLAH TIDAK VALID*\n\nMasukkan nominal yang valid.',
  'err.deposit_no_history': '📋 *RIWAYAT DEPOSIT*\n\nBelum ada riwayat deposit.',
  'err.toast_deposit_preparing': '💸 Menyiapkan deposit Rp {{amount}}',
  'err.saldo_insufficient':
    '❌ *SALDO TIDAK CUKUP*\n\nSaldo Anda tidak mencukupi untuk transaksi ini.\nSilakan top up terlebih dahulu.',
  'err.order_expired': 'Pesananmu telah expired, harap pesan kembali!',
  'err.order_cancelled': '✅ Pesananmu berhasil dibatalkan.',
  'err.stock_empty': '⚠️ *STOK KOSONG*\n\nStok *{{nama}}* sedang kosong. Silakan pilih produk lain.',
  'err.stock_insufficient': '⚠️ Stok produk tidak mencukupi! Stok tersedia: {{count}}',
  'err.stock_selection_unavailable': '⚠️ Beberapa stok yang dipilih sudah tidak tersedia! Silakan pilih ulang.',
  'err.stock_reservation_timeout': '⚠️ Beberapa stok sudah tidak tersedia atau timeout reservasi!',
  'err.voucher_text_required': '⚠️ Silakan kirim kode voucher dalam bentuk teks.',
  'err.voucher_not_found': '❌ *Kode Voucher Tidak Ditemukan!*\n\nKode: `{{kode}}`',
  'err.voucher_already_used': '❌ *Voucher Sudah Digunakan!*',
  'err.voucher_exhausted': '❌ *Voucher Habis!*',
  'err.voucher_wrong_product': '❌ *Voucher Tidak Berlaku!*\n\nVoucher ini tidak berlaku untuk produk yang dipilih.',
  'err.voucher_none_available': 'Tidak ada voucher yang tersedia!',
  'err.voucher_min_purchase': 'Minimal pembelian {{amount}}!',
  'err.no_products':
    '⚠️ *BELUM ADA PRODUK*\n\nBelum ada produk di katalog.\nKelola produk lewat *Dashboard*.',
  'err.no_transactions': '⚠️ Belum ada transaksi apapun!',
  'err.no_users': '⚠️ Tidak ada user!',
  'err.transaction_not_found': '❌ Transaksi tidak ditemukan!',
  'err.access_denied': '❌ Anda tidak memiliki akses!',
  'err.file_unavailable': '❌ File tidak tersedia lagi!',
  'err.data_unavailable': '❌ Data tidak tersedia lagi!',
  // --- btn.* ---
  'btn.kembali': '🔙 Kembali',
  'btn.kembali_menu': '🔙 Menu Utama',
  'btn.kembali_pilih_stok': '🔙 Kembali Pilih Stok',
  'btn.konfirmasi': '✅ Konfirmasi',
  'btn.reset': '🔄 Reset',
  'btn.batal': '❌ Batal',
  'btn.batal_pesanan': '❌ Batal Pesanan',
  'btn.batal_confirm_ya': '✅ Ya, Batalkan',
  'btn.batal_confirm_tidak': '❌ Tidak, Kembali',
  'btn.top_up': '💳 Top Up Saldo',
  'btn.riwayat_deposit': '📋 Riwayat Deposit',
  'btn.deposit_custom': '⌨️ Custom Nominal',
  'btn.bayar_saldo': '💰 Bayar Pakai Saldo',
  'btn.bayar_qris': '💳 Bayar QRIS',
  'btn.lanjut_bayar': '💳 Lanjut ke Pembayaran',
  'btn.edit_stok': '✏️ Edit Pilihan Stok',
  'btn.edit_qty': '✏️ Edit Jumlah',
  'btn.hubungi_cs': '💬 Hubungi CS',
  'btn.voucher_lihat': '🎟️ Lihat Voucher',
  'btn.voucher_input': '🎟️ Input Voucher',
  'btn.voucher_tidak': 'Tidak',
  'btn.voucher_punya': 'Punya',
  'btn.belanja_lagi': '🛍️ Belanja Lagi',
  'btn.filter': '🔍 Filter',
  'btn.statistik': '📊 Statistik',
  'btn.prev': '⏪ Prev',
  'btn.next': 'Next ⏩',
  'btn.semua_produk': '📦 Semua Produk',
  'btn.populer': '🔥 PRODUK POPULER',
  'btn.mulai_order': '📦 Mulai Order',
  'btn.faq': '❓ FAQ',
  'btn.metode_bayar': '💳 Metode Bayar',
```

For `err.retired_command`, callers pass `dashboard_block` already formatted (`\n🔗 url\n` or `''`) so the template stays simple — **or** pass `dashboard_url` and use body:

```js
'err.retired_command':
  '🛠️ *Perintah admin bot sudah dipensiunkan.*\n\nKelola toko lewat *Dashboard* (produk, stok, voucher, broadcast, flow, copy).{{dashboard_line}}\n\nLaporan cepat di bot: `/stok` · `/rekap` · `/listuser`',
```

with caller:

```js
copy.get('err.retired_command', {
  dashboard_line: url ? `\n\n🔗 ${url}` : '',
})
```

Use the `dashboard_line` approach in implementation (tests assert URL substring).

Adjust test bodies to match the chosen DEFAULTS exactly if wording above differs from live `index.js` — **prefer copying live strings** from `index.js` at implement time when they conflict with this plan’s wording (plan is the starting point; live bot text wins for seed accuracy).

- [ ] **Step 4: Write migration**

```sql
-- supabase/migrations/20260816000000_bot_copy_err_btn.sql
SET search_path TO public, extensions;

ALTER TABLE "BotCopy" DROP CONSTRAINT IF EXISTS "BotCopy_kind_check";
ALTER TABLE "BotCopy" ADD CONSTRAINT "BotCopy_kind_check"
  CHECK (kind IN ('screen', 'msg', 'err', 'btn'));

-- INSERT seed rows: one row per DEFAULTS key above.
-- Columns: key, kind ('err'|'btn'), body, description, variables JSONB
-- Use ON CONFLICT (key) DO UPDATE SET body = EXCLUDED.body, kind = EXCLUDED.kind
-- so re-apply is idempotent.
```

Mirror every DEFAULTS key as an INSERT. Example rows:

```sql
INSERT INTO "BotCopy" (key, kind, body, description, variables) VALUES
(
  'err.stock_insufficient',
  'err',
  '⚠️ Stok produk tidak mencukupi! Stok tersedia: {{count}}',
  'Checkout when available stock < requested qty',
  '["count"]'::jsonb
),
(
  'btn.konfirmasi',
  'btn',
  '✅ Konfirmasi',
  'Order confirm keyboard',
  '[]'::jsonb
)
-- ... all keys ...
ON CONFLICT (key) DO UPDATE SET
  kind = EXCLUDED.kind,
  body = EXCLUDED.body,
  description = EXCLUDED.description,
  variables = EXCLUDED.variables,
  updated_at = NOW();
```

- [ ] **Step 5: Runbook**

Create `docs/runbooks/phase9-copy-err-btn.md`:

```markdown
# Phase 9 cutover — BotCopy err/btn

1. Apply migration `20260816000000_bot_copy_err_btn.sql` on Supabase (`teleshop-improvement-v2`).
2. Deploy code (Railway `main`).
3. Open `/settings/bot-copy` — filter `err` / `btn`; edit one error; wait ~10s; trigger that path in Telegram.
4. Confirm retired commands still show dashboard pointer.
5. `node --test` locally green.
```

- [ ] **Step 6: Run tests — expect PASS**

```bash
node --test test/copy.test.js
```

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260816000000_bot_copy_err_btn.sql lib/copy.js test/copy.test.js docs/runbooks/phase9-copy-err-btn.md docs/superpowers/plans/2026-08-09-admin-ux-overhaul-roadmap.md
git commit -m "feat(phase9): BotCopy err/btn kinds, seeds, and copy defaults"
```

---

### Task 2: Wire `retired-commands` + high-frequency errors

**Files:**
- Modify: `lib/retired-commands.js`
- Modify: `index.js` (cart/product/load/stock/saldo/deposit/voucher/riwayat/owner paths)
- Test: extend `test/copy.test.js` only if new helpers appear; otherwise grep gate

**Interfaces:**
- Consumes: `copy.get` keys from Task 1
- Produces: no new exports required; `retiredOwnerHelpText(dashboardUrl)` still returns a string

- [ ] **Step 1: Update `retiredOwnerHelpText`**

```js
const copy = require('./copy')

function retiredOwnerHelpText(dashboardUrl) {
  const url = dashboardUrl || process.env.DASHBOARD_URL || ''
  return copy.get('err.retired_command', {
    dashboard_line: url ? `\n\n🔗 ${url}` : '',
  })
}
```

Avoid circular requires: `copy.js` must not import `retired-commands.js` (it does not today).

- [ ] **Step 2: Replace high-frequency errors in `index.js`**

Use `rg` to find and replace. Pattern:

```js
// before
await bot.sendMessage(chatId, '⚠️ Harap ulangi pilih produk!')
// after
await bot.sendMessage(chatId, copy.get('err.cart_session_lost'))
```

```js
await bot.sendMessage(chatId, copy.get('err.stock_insufficient', { count: stokTersedia }))
```

```js
await bot.answerCallbackQuery(q.id, {
  text: copy.get('err.voucher_none_available'),
  show_alert: true,
})
```

**Must wire (all occurrences of these semantics):**

| Key | Find via |
|-----|----------|
| `err.cart_session_lost` | `Harap ulangi pilih produk` |
| `err.product_not_found` | `Produk tidak ditemukan` |
| `err.load_failed` / `err.load_product_failed` / `err.load_stok_failed` | matching Indonesian strings |
| `err.stock_empty` / `err.stock_insufficient` / `err.stock_selection_unavailable` / `err.stock_reservation_timeout` | STOK KOSONG / Stok … tidak mencukupi / tidak tersedia |
| `err.saldo_insufficient` | `SALDO TIDAK CUKUP` (and premium variant if still present — map both to this key **or** add `err.saldo_insufficient_premium` to DEFAULTS+migration if wording must stay distinct; prefer one key unless UX differs materially) |
| `err.deposit_*` | QRIS/config/create/expired/cancelled/invalid/no history + toast preparing |
| `err.voucher_*` | voucher block + toasts listed in Task 1 |
| `err.order_expired` / `err.order_cancelled` | matching strings |
| `err.no_products` / `err.no_transactions` / `err.no_users` | empty list messages for kept owner commands |
| `err.owner_only` | `Hanya bisa diakses oleh owner` |
| `err.transaction_not_found` / `err.access_denied` / `err.file_unavailable` / `err.data_unavailable` | riwayat detail paths |

If live wording for a key differs from Task 1 DEFAULTS, **update DEFAULTS + migration seed** to the live string, then wire.

- [ ] **Step 3: Grep gate (expect zero for wired literals)**

```bash
rg -n "Harap ulangi pilih produk|SALDO TIDAK CUKUP|Kode Voucher Tidak Ditemukan|Perintah admin bot sudah dipensiunkan" index.js lib/retired-commands.js || echo OK
```

Expected: `OK` (or only comments). Adjust patterns if partial matches remain in channel logs — channel logs stay hardcoded (design D5).

- [ ] **Step 4: Run tests**

```bash
node --test
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add lib/retired-commands.js index.js lib/copy.js supabase/migrations/20260816000000_bot_copy_err_btn.sql
git commit -m "feat(phase9): wire err.* copy into bot and retired-commands"
```

---

### Task 3: Wire `btn.*` keyboard labels + remove dead Tambah Stok

**Files:**
- Modify: `index.js`

**Interfaces:**
- Consumes: `btn.*` keys from Task 1
- Produces: keyboard `text:` fields sourced from `copy.get`

- [ ] **Step 1: Replace static keyboard labels**

Examples:

```js
{ text: copy.get('btn.konfirmasi'), callback_data: '...' }
{ text: copy.get('btn.bayar_saldo'), callback_data: '...' }
{ text: copy.get('btn.kembali'), callback_data: '...' }
```

Wire all Task 1 `btn.*` keys at their call sites (see design inventory / `rg` for current labels). Prefer one `copy.get('btn.kembali')` even if some sites used slightly different back wording — **canonical label wins**.

Leave dynamic labels hardcoded (amounts, variant names, `±1`).

- [ ] **Step 2: Remove dead Tambah Stok buttons**

```bash
rg -n "Tambah Stok" index.js
```

Delete keyboard rows/buttons that call non-existent add-stock handlers (Phase 7 retirement). Do **not** add `btn.tambah_stok`.

- [ ] **Step 3: Grep gate**

```bash
rg -n "Bayar Pakai Saldo|Bayar QRIS|Ya, Batalkan|Belanja Lagi|Tambah Stok" index.js || echo OK
```

Expected: no static label leftovers for wired buttons; no Tambah Stok.

- [ ] **Step 4: Full test suite**

```bash
node --test
```

- [ ] **Step 5: Commit**

```bash
git add index.js
git commit -m "feat(phase9): wire btn.* keyboard labels; remove dead Tambah Stok"
```

---

### Task 4: Dashboard kind filter + intro copy

**Files:**
- Modify: `dashboard.js` (`GET /settings/bot-copy`)
- Modify: `views/settings-bot-copy.ejs`

**Interfaces:**
- Consumes: `BotCopy.kind` including `err`/`btn`
- Produces: filtered list when `?kind=err` (etc.); `all` or missing = no filter

- [ ] **Step 1: Filter in route**

```js
app.get('/settings/bot-copy', isAuthenticated, async (req, res) => {
  const kind = String(req.query.kind || '').trim()
  let q = supabase.from('BotCopy').select('*').order('kind').order('key')
  if (['screen', 'msg', 'err', 'btn'].includes(kind)) {
    q = q.eq('kind', kind)
  }
  const { data: rows, error } = await q
  // ... existing error handling ...
  res.render('settings-bot-copy', {
    // existing locals...
    rows: rows || [],
    filterKind: kind || 'all',
    success: req.query.success || null,
  })
})
```

Preserve existing POST handler unchanged.

- [ ] **Step 2: Filter chips in EJS**

Above the card list:

```html
<p style="margin-bottom: 16px;">
  <% const kinds = ['all','screen','msg','err','btn']; %>
  <% kinds.forEach(k => { %>
    <a class="btn <%= filterKind === k ? 'btn-primary' : 'btn-secondary' %>"
       href="/settings/bot-copy<%= k === 'all' ? '' : '?kind=' + k %>"
       style="margin-right: 6px;"><%= k %></a>
  <% }) %>
</p>
```

Update intro paragraph:

```html
Edit teks layar (`screen`), pesan (`msg`), error (`err`), dan label tombol (`btn`).
Gunakan <code>{{variabel}}</code> untuk bagian dinamis. Perubahan aktif ~10 detik tanpa restart bot.
```

Replace leftover purple focus color `#667eea` on `.form-textarea:focus` with `var(--color-accent)` while touching the file.

- [ ] **Step 3: Manual check** — open `/settings/bot-copy?kind=err` (code review if no browser).

- [ ] **Step 4: Commit**

```bash
git add dashboard.js views/settings-bot-copy.ejs
git commit -m "feat(phase9): bot-copy kind filter for err/btn"
```

---

### Task 5: Flow builder `btn.` label_key

**Files:**
- Modify: `public/js/flow-builder.js` (label_key persistence ~line 348)

**Interfaces:**
- Consumes: button label strings
- Produces: `btn.label_key` set when label starts with `msg.` **or** `btn.`

- [ ] **Step 1: Update detection**

```js
else if (prev.label_key && !prev.label && (label.startsWith('msg.') || label.startsWith('btn.'))) {
  btn.label_key = label
}
```

- [ ] **Step 2: Commit**

```bash
git add public/js/flow-builder.js
git commit -m "feat(phase9): flow builder accepts btn.* label_key"
```

---

### Task 6: Verify + roadmap Done + PR

**Files:**
- Modify: `docs/superpowers/plans/2026-08-09-admin-ux-overhaul-roadmap.md`
- Modify: `docs/runbooks/phase9-copy-err-btn.md` (append gate results)

- [ ] **Step 1: Full gates**

```bash
node --test
node --check index.js
node --check dashboard.js
node --check lib/copy.js
node --check lib/retired-commands.js
rg -n "Harap ulangi pilih produk|Perintah admin bot sudah dipensiunkan|Tambah Stok" index.js lib/retired-commands.js || echo OK
```

Expected: tests pass; syntax OK; grep OK.

- [ ] **Step 2: Mark roadmap Done**

In the phase status table:

```markdown
| 9 — Copy err/btn | [2026-08-09-copy-err-btn.md](./2026-08-09-copy-err-btn.md) | **Done** |
```

(Use this plan’s filename; if the plan file is dated `2026-08-10`, keep the link consistent with the file on disk.)

- [ ] **Step 3: Commit + push**

```bash
git add docs/superpowers/plans/2026-08-09-admin-ux-overhaul-roadmap.md docs/runbooks/phase9-copy-err-btn.md
git commit -m "docs(phase9): mark copy err/btn registry done"
git push -u origin HEAD
```

- [ ] **Step 4: Open implementation PR** targeting `main`.

---

## Spec coverage self-review

| Spec / decision | Task |
|-----------------|------|
| D1 kind CHECK + migration | 1 |
| D2 err.* / btn.* naming; keep msg.btn_* | 1–3 |
| D3 dedup canonical keys | 1–2 |
| D4 curated scope | 1–3 |
| D5 leave hardcoded | Global + Task 2/3 notes |
| D6 stale /addproduk + remove Tambah Stok | 2–3 |
| D7 dashboard filter + flow btn. | 4–5 |
| D8 templating/cache unchanged | 1–2 |
| Success criteria (edit latency, DEFAULTS, tests, grep) | 1–6 |

## Placeholder scan

No TBD. Seed key list, migration name, filter query param, and commit messages included. Live `index.js` wording may refine DEFAULTS at implement time — that is an explicit Step 2 rule, not a placeholder.

## Type consistency

- Keys use `err.` / `btn.` prefixes consistently
- `copy.get(key, vars?, fallback?)` unchanged
- `retiredOwnerHelpText` still `(dashboardUrl?) => string`
- Filter kinds: `screen|msg|err|btn|all`
