# Copy Registry screen/msg (Phase 5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dashboard-editable `BotCopy` registry for buyer `screen`/`msg` strings, cache it via the existing `cache_version` bump, and wire welcome / product / qty / saldo / cara-order screens in the bot to read from it.

**Architecture:** New `BotCopy` table + seed. Pure `lib/copy.js` (`render`, `get`, in-process cache + `refresh`). Bot reloads copy when `runtimeSettings.refresh()` sees a version change. Dashboard `/settings/bot-copy` CRUD calls `bump()`. High-value buyer screens in `index.js` call `copy.get(key, vars)` with code DEFAULTS as fallback.

**Tech Stack:** Node.js 20, Express 5 + EJS, `@supabase/supabase-js`, Telegram Bot API, `node --test`, Railway + Supabase.

**Design spec:** [docs/superpowers/specs/2026-08-09-copy-registry-design.md](../specs/2026-08-09-copy-registry-design.md)

## Global Constraints

- Kinds in this phase: **`screen` | `msg` only** — do not invent `err`/`btn` tables or keys (Phase 9)
- Do not overload `MessageTemplate` (admin broadcast only)
- Shared invalidation: call existing `runtimeSettings.bump()` after copy writes — **no second version key**
- Keep EJS + vanilla JS; no React/Vue
- Tests: pure functions only via `node --test` (render + get/fallback); no Telegram mocks
- Leave `User`, `Deposit`, `Payment`, `Voucher`, `Varian`/`HargaTier` schema alone
- Do not start Phase 6+ work (no flow graph, do not write `BotSession.screen_key` yet)
- Product content (`deskripsi`/`snk`/`nama`) stays on Produk — copy registry is chrome/templates only
- Templating: `{{var}}` replace only — no conditionals/loops
- Prepend `SET search_path TO public, extensions;` in new migrations

---

## File map

| File | Responsibility |
|------|----------------|
| `supabase/migrations/20260813000000_bot_copy.sql` | Create `BotCopy` + RLS + seed rows |
| `lib/copy.js` | DEFAULTS, render, get, refresh cache |
| `test/copy.test.js` | Pure render/get/fallback tests |
| `index.js` | Refresh hook; wire welcome/product/qty/saldo/cara-order |
| `dashboard.js` | `/settings/bot-copy` list + PATCH/POST |
| `views/settings-bot-copy.ejs` | Edit UI |
| `views/partials/sidebar.ejs` | Nav link |
| `docs/runbooks/phase5-copy-registry.md` | Apply migration + verify bump latency |
| Update | `docs/superpowers/plans/2026-08-09-admin-ux-overhaul-roadmap.md` |

---

### Task 1: Migration + runbook + roadmap

**Files:**
- Create: `supabase/migrations/20260813000000_bot_copy.sql`
- Create: `docs/runbooks/phase5-copy-registry.md`
- Modify: `docs/superpowers/plans/2026-08-09-admin-ux-overhaul-roadmap.md`
- Create (if missing): `docs/superpowers/specs/2026-08-09-copy-registry-design.md`

**Interfaces:**
- Consumes: Phase 0 `cache_version` convention; RLS pattern from earlier migrations
- Produces: table `BotCopy` with seeded keys listed in design D2

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260813000000_bot_copy.sql
SET search_path TO public, extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS "BotCopy" (
    key TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('screen', 'msg')),
    body TEXT NOT NULL,
    description TEXT,
    variables JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_botcopy_kind ON "BotCopy"(kind);

DROP TRIGGER IF EXISTS update_botcopy_updated_at ON "BotCopy";
CREATE TRIGGER update_botcopy_updated_at
    BEFORE UPDATE ON "BotCopy"
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE "BotCopy" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all for service role" ON "BotCopy";
CREATE POLICY "Allow all for service role" ON "BotCopy"
    FOR ALL USING (true) WITH CHECK (true);

-- Seed: bodies match current Indonesian copy; {{vars}} for dynamic bits.
INSERT INTO "BotCopy" (key, kind, body, description, variables) VALUES
(
  'screen.welcome',
  'screen',
  E'Halo, *{{first_name}}* 👋\n\nSelamat datang di *{{nama_bot}}*\n\n👥 Total User: *{{user_count}}*\n🛍️ Total Terjual: *{{stok_terjual}}*\n📦 Stok Tersedia: *{{stok_tersedia}}*\n💰 Saldo Anda: *{{saldo}}*\n\nSilahkan pilih menu dibawah ini!',
  'Caption welcome /start dan kembaliawal',
  '["first_name","nama_bot","user_count","stok_terjual","stok_tersedia","saldo"]'::jsonb
),
(
  'screen.product_list',
  'screen',
  E'*LIST PRODUCT*\n=======================\n{{rows}}\n=======================',
  'Chrome daftar produk; {{rows}} diisi bot',
  '["rows"]'::jsonb
),
(
  'screen.product_card',
  'screen',
  E'*{{nama}}*\n=======================\n{{deskripsi}}\n\n*S&K:*\n{{snk}}\n=======================\n{{variants_block}}',
  'Chrome kartu produk; fields dari Produk/Varian',
  '["nama","deskripsi","snk","variants_block"]'::jsonb
),
(
  'screen.qty',
  'screen',
  E'tambahkan jumlah pembelian:\n\n┌──────────────────\n│ • Produk : {{produk_label}}\n│ • Stok Terjual : {{terjual}}\n│ • Desk : {{deskripsi}}\n└──────────────────\n\n┌──────────────────\n│ Harga: {{harga}} — (Stok {{stok}})\n└──────────────────\n\nCurrent Date: {{waktu}}',
  'Layar pilih qty setelah varian',
  '["produk_label","terjual","deskripsi","harga","stok","waktu"]'::jsonb
),
(
  'screen.saldo_menu',
  'screen',
  E'💰 *SALDO & DEPOSIT*\n=======================\nSaldo Anda: *{{saldo}}*\n\nPilih menu di bawah.',
  'Menu saldo & deposit',
  '["saldo"]'::jsonb
),
(
  'screen.cara_order',
  'screen',
  E'❓ *CARA ORDER*\n=======================\n1. Pilih *Daftar Produk* atau *Kategori*\n2. Pilih varian & jumlah\n3. Bayar via saldo atau QRIS\n4. Akun dikirim otomatis setelah pembayaran\n\nButuh bantuan? Hubungi Customer Service.',
  'Panduan cara order',
  '[]'::jsonb
),
(
  'msg.reply_nav_enabled',
  'msg',
  '⌨️ Menu navigasi cepat diaktifkan.',
  'Pesan setelah reply keyboard dikirim',
  '[]'::jsonb
),
(
  'msg.menu_daftar_produk',
  'msg',
  '‹📦› Daftar Produk',
  'Label tombol daftar produk (inline)',
  '[]'::jsonb
),
(
  'msg.menu_daftar_produk_reply',
  'msg',
  '📦 Daftar Produk',
  'Label reply keyboard daftar produk',
  '[]'::jsonb
),
(
  'msg.menu_riwayat',
  'msg',
  '‹📋› Riwayat Transaksi',
  'Label riwayat (inline)',
  '[]'::jsonb
),
(
  'msg.menu_riwayat_reply',
  'msg',
  '📋 Riwayat Transaksi',
  'Label reply keyboard riwayat',
  '[]'::jsonb
),
(
  'msg.menu_kategori',
  'msg',
  '‹📂› Kategori Produk',
  'Label kategori',
  '[]'::jsonb
),
(
  'msg.menu_cara_order',
  'msg',
  '‹❓› Cara Order',
  'Label cara order',
  '[]'::jsonb
),
(
  'msg.menu_saldo',
  'msg',
  '‹💰› Saldo & Deposit',
  'Label saldo menu',
  '[]'::jsonb
),
(
  'msg.menu_saldo_reply',
  'msg',
  '💰 Saldo: {{saldo}}',
  'Reply keyboard cell saldo',
  '["saldo"]'::jsonb
),
(
  'msg.menu_stok',
  'msg',
  '‹📊› Stok',
  'Label stok',
  '[]'::jsonb
),
(
  'msg.menu_channel',
  'msg',
  '‹📢› Channel',
  'Label channel',
  '[]'::jsonb
),
(
  'msg.menu_cs',
  'msg',
  '‹📞› Customer Service',
  'Label CS',
  '[]'::jsonb
),
(
  'msg.btn_perbarui',
  'msg',
  '⟳ Perbarui',
  'Tombol refresh kartu produk',
  '[]'::jsonb
),
(
  'msg.btn_kembali',
  'msg',
  '← Kembali',
  'Tombol kembali chrome produk',
  '[]'::jsonb
)
ON CONFLICT (key) DO NOTHING;
```

- [ ] **Step 2: Write the runbook**

Create `docs/runbooks/phase5-copy-registry.md`:

```markdown
# Phase 5 cutover runbook — Copy registry

1. Merge Phase 5 PR → Railway deploys (code falls back to DEFAULTS if table missing).
2. Apply migration: `supabase db push` (project sajffqniegtvhyopshvx) OR paste SQL (keep search_path).
3. Confirm Studio shows `BotCopy` with seeded keys.
4. Dashboard → Settings → Bot Copy → edit `screen.welcome` body → save.
5. Within ~10s, bot `/start` shows edited text (no restart).
6. Delete a row in Studio → bot still renders DEFAULTS for that key.
```

- [ ] **Step 3: Update roadmap**

In `docs/superpowers/plans/2026-08-09-admin-ux-overhaul-roadmap.md`:

- Phase 4 status → **Done**
- Phase 5 → `[2026-08-09-copy-registry.md](./2026-08-09-copy-registry.md)`, status **Plan ready**

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260813000000_bot_copy.sql \
  docs/runbooks/phase5-copy-registry.md \
  docs/superpowers/plans/2026-08-09-admin-ux-overhaul-roadmap.md \
  docs/superpowers/specs/2026-08-09-copy-registry-design.md \
  docs/superpowers/plans/2026-08-09-copy-registry.md
git commit -m "docs(phase5): copy registry design, plan, migration stub"
```

(If committing migration in Task 1 with empty follow-up, prefer committing migration SQL here as final; implementers may split “docs only” vs “migration” — this plan keeps migration in Task 1.)

---

### Task 2: `lib/copy.js` + tests (TDD)

**Files:**
- Create: `lib/copy.js`
- Create: `test/copy.test.js`

**Interfaces:**
- Consumes: `lib/supabase.js` for `refresh` only
- Produces:
  - `render(body: string, vars: object): string`
  - `get(key: string, vars?: object, fallback?: string): string`
  - `async refresh(): Promise<boolean>` — reload from `BotCopy`
  - `DEFAULTS: Record<string,string>` — exported for seed parity / tests
  - `isReady(): boolean`

- [ ] **Step 1: Write failing tests**

```js
// test/copy.test.js
const test = require('node:test')
const assert = require('node:assert')

const jalurClient = require.resolve('../lib/supabase.js')
const jalurCopy = require.resolve('../lib/copy.js')

function muatCopy(rows = []) {
  delete require.cache[jalurCopy]
  require.cache[jalurClient] = {
    id: jalurClient,
    filename: jalurClient,
    loaded: true,
    exports: {
      from(tabel) {
        assert.equal(tabel, 'BotCopy')
        const b = {
          select() { return b },
          then(res, rej) {
            return Promise.resolve({ data: rows, error: null }).then(res, rej)
          },
        }
        return b
      },
    },
  }
  return require(jalurCopy)
}

test.after(() => {
  delete require.cache[jalurClient]
  delete require.cache[jalurCopy]
})

test('render replaces {{vars}} and missing becomes empty', () => {
  const copy = muatCopy()
  assert.equal(copy.render('Halo {{nama}}!', { nama: 'Wisnu' }), 'Halo Wisnu!')
  assert.equal(copy.render('X{{missing}}Y', {}), 'XY')
})

test('get uses DEFAULTS when cache empty', () => {
  const copy = muatCopy()
  const body = copy.get('msg.reply_nav_enabled')
  assert.match(body, /navigasi cepat/i)
})

test('get prefers DB body after refresh', async () => {
  const copy = muatCopy([
    { key: 'msg.reply_nav_enabled', body: 'CUSTOM NAV' },
  ])
  await copy.refresh()
  assert.equal(copy.get('msg.reply_nav_enabled'), 'CUSTOM NAV')
})

test('get renders vars on DB body', async () => {
  const copy = muatCopy([
    { key: 'screen.welcome', body: 'Hi {{first_name}} @ {{nama_bot}}' },
  ])
  await copy.refresh()
  assert.equal(
    copy.get('screen.welcome', { first_name: 'A', nama_bot: 'Shop' }),
    'Hi A @ Shop'
  )
})

test('get unknown key returns fallback or key', () => {
  const copy = muatCopy()
  assert.equal(copy.get('no.such', {}, 'FALL'), 'FALL')
  assert.equal(copy.get('no.such'), 'no.such')
})
```

- [ ] **Step 2: Run — expect FAIL**

```bash
node --test test/copy.test.js
```

Expected: FAIL `Cannot find module '../lib/copy.js'`.

- [ ] **Step 3: Implement `lib/copy.js`**

```js
// lib/copy.js
const supabase = require('./supabase')

const DEFAULTS = {
  'screen.welcome':
    'Halo, *{{first_name}}* 👋\n\nSelamat datang di *{{nama_bot}}*\n\n👥 Total User: *{{user_count}}*\n🛍️ Total Terjual: *{{stok_terjual}}*\n📦 Stok Tersedia: *{{stok_tersedia}}*\n💰 Saldo Anda: *{{saldo}}*\n\nSilahkan pilih menu dibawah ini!',
  'screen.product_list': '*LIST PRODUCT*\n=======================\n{{rows}}\n=======================',
  'screen.product_card':
    '*{{nama}}*\n=======================\n{{deskripsi}}\n\n*S&K:*\n{{snk}}\n=======================\n{{variants_block}}',
  'screen.qty':
    'tambahkan jumlah pembelian:\n\n┌──────────────────\n│ • Produk : {{produk_label}}\n│ • Stok Terjual : {{terjual}}\n│ • Desk : {{deskripsi}}\n└──────────────────\n\n┌──────────────────\n│ Harga: {{harga}} — (Stok {{stok}})\n└──────────────────\n\nCurrent Date: {{waktu}}',
  'screen.saldo_menu':
    '💰 *SALDO & DEPOSIT*\n=======================\nSaldo Anda: *{{saldo}}*\n\nPilih menu di bawah.',
  'screen.cara_order':
    '❓ *CARA ORDER*\n=======================\n1. Pilih *Daftar Produk* atau *Kategori*\n2. Pilih varian & jumlah\n3. Bayar via saldo atau QRIS\n4. Akun dikirim otomatis setelah pembayaran\n\nButuh bantuan? Hubungi Customer Service.',
  'msg.reply_nav_enabled': '⌨️ Menu navigasi cepat diaktifkan.',
  'msg.menu_daftar_produk': '‹📦› Daftar Produk',
  'msg.menu_daftar_produk_reply': '📦 Daftar Produk',
  'msg.menu_riwayat': '‹📋› Riwayat Transaksi',
  'msg.menu_riwayat_reply': '📋 Riwayat Transaksi',
  'msg.menu_kategori': '‹📂› Kategori Produk',
  'msg.menu_cara_order': '‹❓› Cara Order',
  'msg.menu_saldo': '‹💰› Saldo & Deposit',
  'msg.menu_saldo_reply': '💰 Saldo: {{saldo}}',
  'msg.menu_stok': '‹📊› Stok',
  'msg.menu_channel': '‹📢› Channel',
  'msg.menu_cs': '‹📞› Customer Service',
  'msg.btn_perbarui': '⟳ Perbarui',
  'msg.btn_kembali': '← Kembali',
}

let cache = Object.create(null)
let ready = false

function render(body, vars) {
  const text = String(body ?? '')
  const v = vars && typeof vars === 'object' ? vars : {}
  return text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, name) => {
    const val = v[name]
    return val === undefined || val === null ? '' : String(val)
  })
}

function get(key, vars, fallback) {
  const body = (cache[key] !== undefined && cache[key] !== null && cache[key] !== '')
    ? cache[key]
    : (DEFAULTS[key] !== undefined ? DEFAULTS[key] : undefined)
  if (body === undefined) {
    return fallback !== undefined ? fallback : String(key)
  }
  return render(body, vars)
}

async function refresh() {
  try {
    const { data, error } = await supabase.from('BotCopy').select('key, body')
    if (error) {
      console.error('[copy] refresh:', error.message)
      return false
    }
    const next = Object.create(null)
    for (const row of data || []) {
      if (row && row.key) next[row.key] = row.body
    }
    cache = next
    ready = true
    return true
  } catch (e) {
    console.error('[copy] refresh:', e.message)
    return false
  }
}

function isReady() {
  return ready
}

module.exports = {
  DEFAULTS,
  render,
  get,
  refresh,
  isReady,
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
node --test test/copy.test.js
```

- [ ] **Step 5: Commit**

```bash
git add lib/copy.js test/copy.test.js
git commit -m "feat(phase5): add lib/copy render/get with BotCopy cache"
```

---

### Task 3: Hook copy.refresh to runtime-settings polling

**Files:**
- Modify: `index.js` (boot + wherever `runtimeSettings.refresh` / `startPolling` is wired)

**Interfaces:**
- Consumes: `copy.refresh`, `runtimeSettings.refresh` / `startPolling`
- Produces: copy cache warm on boot; reloads when version bumps

- [ ] **Step 1: Require copy near other libs**

```js
const runtimeSettings = require('./lib/runtime-settings')
const copy = require('./lib/copy')
```

- [ ] **Step 2: After boot `runtimeSettings.refresh(true)`, call `copy.refresh()`**

Find boot sequence (~`startPolling` / first `refresh(true)`) and ensure:

```js
await runtimeSettings.refresh(true)
await copy.refresh()
runtimeSettings.startPolling(10000)
// Wrap or patch polling: when refresh returns true, also copy.refresh()
```

If `startPolling` only calls `runtimeSettings.refresh()` internally, either:

**Option A (preferred):** change `lib/runtime-settings.js` to accept optional `onReload` callback:

```js
function startPolling(intervalMs = 10000, onReload) {
  if (pollTimer) return pollTimer
  pollTimer = setInterval(() => {
    refresh().then((changed) => {
      if (changed && typeof onReload === 'function') onReload()
    }).catch(() => {})
  }, intervalMs)
  if (pollTimer.unref) pollTimer.unref()
  return pollTimer
}
```

Then in `index.js`:

```js
runtimeSettings.startPolling(10000, () => { copy.refresh().catch(() => {}) })
```

**Option B:** duplicate a small interval in `index.js` that checks version — avoid; prefer A.

Also export nothing new from copy beyond Task 2.

- [ ] **Step 3: Commit**

```bash
git add lib/runtime-settings.js index.js
git commit -m "feat(phase5): reload BotCopy when cache_version bumps"
```

---

### Task 4: Wire welcome + reply keyboard + menu labels

**Files:**
- Modify: `index.js` (`/start`, `kembaliawal`, other duplicated welcome sites, `generateReplyKeyboard`)

**Interfaces:**
- Consumes: `copy.get('screen.welcome', vars)`, menu `msg.*` keys
- Produces: single helper used by all welcome entry points

- [ ] **Step 1: Add helper**

```js
function welcomeCaption(ctx) {
  return copy.get('screen.welcome', {
    first_name: ctx.first_name || 'User',
    nama_bot: NamaBot,
    user_count: ctx.user_count ?? 0,
    stok_terjual: ctx.stok_terjual ?? 0,
    stok_tersedia: ctx.stok_tersedia ?? 0,
    saldo: ctx.saldo_fmt || formatrupiah(ctx.saldo || 0),
  })
}

function welcomeInlineKeyboard(channelContact) {
  return {
    inline_keyboard: [
      [{ text: copy.get('msg.menu_daftar_produk'), callback_data: 'daftarproduk' }],
      [{ text: copy.get('msg.menu_kategori'), callback_data: 'kategori_menu' }],
      [
        { text: copy.get('msg.menu_riwayat'), callback_data: 'riwayattransaksi' },
        { text: copy.get('msg.menu_cara_order'), callback_data: 'caraorder' },
      ],
      [
        { text: copy.get('msg.menu_saldo'), callback_data: 'saldomenu' },
        { text: copy.get('msg.menu_stok'), callback_data: 'stok' },
      ],
      [{ text: copy.get('msg.menu_channel'), url: channelContact.channelStore }],
      [{ text: copy.get('msg.menu_cs'), url: channelContact.cs }],
    ],
  }
}
```

- [ ] **Step 2: Replace `/start` banner send** to use `welcomeCaption` + `welcomeInlineKeyboard`; send `copy.get('msg.reply_nav_enabled')` instead of hardcoded reply-nav line.

- [ ] **Step 3: Replace every duplicated welcome block** (`kembaliawal` and any copy-paste of the same Halo/Selamat datang caption — search:)

```bash
rg -n "Selamat datang di \*\$\{NamaBot\}\*" index.js
```

Each site → helpers above.

- [ ] **Step 4: Update `generateReplyKeyboard`**

```js
async function generateReplyKeyboard(userId) {
  try {
    const saldo = await cekSaldo(userId)
    const saldoFmt = formatrupiah(saldo)
    return {
      keyboard: [
        [
          copy.get('msg.menu_daftar_produk_reply'),
          copy.get('msg.menu_saldo_reply', { saldo: saldoFmt }),
        ],
        [copy.get('msg.menu_riwayat_reply')],
      ],
      resize_keyboard: true,
    }
  } catch (error) {
    console.error('Error generating reply keyboard:', error)
    return {
      keyboard: [
        [copy.get('msg.menu_daftar_produk_reply')],
        [copy.get('msg.menu_riwayat_reply')],
      ],
      resize_keyboard: true,
    }
  }
}
```

- [ ] **Step 5: `node --check index.js` then commit**

```bash
git add index.js
git commit -m "feat(phase5): welcome and reply keyboard use BotCopy"
```

---

### Task 5: Wire product list/card, qty, saldo, cara order

**Files:**
- Modify: `index.js` (`sendProductPage`, `sendProductCard`, `showVariantQtyScreen`, saldo menu handler, caraorder handler)

**Interfaces:**
- Consumes: `copy.get('screen.product_list'|…)`, `msg.btn_perbarui`, `msg.btn_kembali`
- Produces: same UX, editable chrome

- [ ] **Step 1: `showVariantQtyScreen`** — replace caption template literal with:

```js
  const caption = copy.get('screen.qty', {
    produk_label: `${item.namaProduk.toUpperCase()} — ${item.namaLabel.toUpperCase()}`,
    terjual: varian.terjual || 0,
    deskripsi: item.deskripsi,
    harga: formatrupiah(varian.harga),
    stok: stokCount,
    waktu: formattedTime,
  })
  await editOrSendBannerMessage(userId, msgId, caption, { reply_markup: { ... } })
```

- [ ] **Step 2: `sendProductPage`** — build `rows` string as today, then:

```js
const caption = copy.get('screen.product_list', { rows })
```

- [ ] **Step 3: `sendProductCard`** — build `variants_block` as today; caption via `screen.product_card`; button texts via `copy.get('msg.btn_perbarui')` / `msg.btn_kembali`.

- [ ] **Step 4: Saldo menu + cara order handlers** — replace static bodies with `copy.get('screen.saldo_menu', { saldo: formatrupiah(...) })` and `copy.get('screen.cara_order')`.

Find with:

```bash
rg -n "saldomenu|caraorder|SALDO & DEPOSIT|CARA ORDER" index.js
```

- [ ] **Step 5: Syntax check + commit**

```bash
node --check index.js
git add index.js
git commit -m "feat(phase5): product/qty/saldo/cara-order screens use BotCopy"
```

---

### Task 6: Dashboard Bot Copy UI + API

**Files:**
- Modify: `dashboard.js`
- Create: `views/settings-bot-copy.ejs`
- Modify: `views/partials/sidebar.ejs`

**Interfaces:**
- Consumes: `BotCopy` table; `runtimeSettings.bump()`
- Produces:
  - `GET /settings/bot-copy` → list
  - `POST /settings/bot-copy/:key` or `PATCH /api/bot-copy/:key` body `{ body }` → update + bump

- [ ] **Step 1: Sidebar link** after channel-contact:

```html
        <a href="/settings/bot-copy" class="nav-item <%= typeof currentPage !== 'undefined' && currentPage === 'settings-bot-copy' ? 'active' : '' %>">
            <span class="nav-icon">📝</span>
            <span class="nav-text">Bot Copy</span>
        </a>
```

- [ ] **Step 2: Routes in `dashboard.js`** (near other settings routes)

```js
app.get('/settings/bot-copy', isAuthenticated, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('BotCopy')
      .select('*')
      .order('kind', { ascending: true })
      .order('key', { ascending: true })
    if (error) throw error
    res.render('settings-bot-copy', {
      title: `Bot Copy - ${NamaBot}`,
      namaBot: NamaBot,
      username: req.session.username,
      currentPage: 'settings-bot-copy',
      pageTitle: '📝 Bot Copy',
      rows: data || [],
      req,
      success: req.query.success || '',
    })
  } catch (e) {
    console.error(e)
    res.status(500).send(e.message)
  }
})

app.post('/settings/bot-copy/:key', isAuthenticated, async (req, res) => {
  try {
    const key = req.params.key
    const body = String(req.body.body ?? '')
    if (!body.trim()) {
      return res.redirect('/settings/bot-copy?error=empty')
    }
    const { error } = await supabase
      .from('BotCopy')
      .update({ body, updated_at: new Date().toISOString() })
      .eq('key', key)
    if (error) throw error
    await runtimeSettings.bump()
    res.redirect('/settings/bot-copy?success=1')
  } catch (e) {
    console.error(e)
    res.status(500).send(e.message)
  }
})
```

Ensure `runtimeSettings` is already required in `dashboard.js` (it is for other settings).

- [ ] **Step 3: Create `views/settings-bot-copy.ejs`**

Structure: top-bar + sidebar include; for each row a `<details>` or card with `key`, `kind`, `description`, `variables` help, textarea `name="body"`, form POST to `/settings/bot-copy/<%= row.key %>`. Show success toast if `success=1`. Reuse `dashboard.css` / existing settings page patterns from `settings-channel-contact.ejs` (read that file for layout chrome).

Minimal body sketch:

```html
<% rows.forEach(row => { %>
  <div class="card" style="margin-bottom:16px;">
    <div class="card-header">
      <h2 class="card-title"><code><%= row.key %></code> <small>(<%= row.kind %>)</small></h2>
    </div>
    <div class="card-body">
      <p style="color:#666;"><%= row.description || '' %></p>
      <p style="color:#888;font-size:13px;">Variables: <%= (row.variables || []).join(', ') || '—' %></p>
      <form method="POST" action="/settings/bot-copy/<%= encodeURIComponent(row.key) %>">
        <textarea name="body" class="form-textarea" rows="8" required><%= row.body %></textarea>
        <button type="submit" class="btn btn-primary" style="margin-top:10px;">Simpan</button>
      </form>
    </div>
  </div>
<% }) %>
```

- [ ] **Step 4: Commit**

```bash
git add dashboard.js views/settings-bot-copy.ejs views/partials/sidebar.ejs
git commit -m "feat(phase5): dashboard Bot Copy settings page"
```

---

### Task 7: Apply migration + verification

**Files:** none required beyond runbook tweaks

- [ ] **Step 1: Full tests**

```bash
node --test
```

Expected: all existing + `test/copy.test.js` PASS.

- [ ] **Step 2: Apply migration**

```bash
supabase db push --yes
```

- [ ] **Step 3: E2E checklist**

1. `/settings/bot-copy` lists seeded keys  
2. Edit `screen.welcome` → bump → `/start` shows new text within ~10s  
3. Missing key / deleted row → DEFAULTS  
4. Product list/card/qty/saldo/cara-order still render  
5. Owner CRUD errors still hardcoded (unchanged)  
6. Broadcast `MessageTemplate` UI untouched  

- [ ] **Step 4: Push / update PR**

```bash
git push -u origin HEAD
```

---

## Spec coverage self-review

| Spec requirement | Task |
|------------------|------|
| `BotCopy` table screen/msg + seed | Task 1 |
| `{{var}}` render + DEFAULTS fallback | Task 2 |
| Shared `cache_version` bump reload | Task 3 |
| Welcome + reply keyboard + menu labels | Task 4 |
| Product/qty/saldo/cara-order | Task 5 |
| Dashboard edit UI | Task 6 |
| Not MessageTemplate; no err/btn; no Phase 6 flow write | Global + out of scope |
| Pure `node --test` | Task 2 |

## Placeholder scan

No TBD/TODO steps. Concrete SQL, JS, routes, and commands included.

## Type consistency

- `copy.get(key, vars?, fallback?): string`
- `copy.render(body, vars): string`
- `copy.refresh(): Promise<boolean>`
- Keys: `screen.*` / `msg.*` as seeded
- Dashboard: `GET /settings/bot-copy`, `POST /settings/bot-copy/:key`
